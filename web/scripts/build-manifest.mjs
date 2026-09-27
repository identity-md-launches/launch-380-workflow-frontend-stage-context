import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, stringToHex, parseAbi } from "viem";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const handoff = await read("web/config/deployment-handoff.json");
const net = await read("web/config/network.json");
const site = await read("web/config/site.json");
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
          .join(",")}}`
      : JSON.stringify(value);
if (
  net.network.chainId !== handoff.chainId ||
  Number(net.walletAddChain.chainId) !== handoff.chainId
)
  throw Error("Network/handoff chain mismatch");
await mkdir(resolve(root, "dist/abi"), { recursive: true });
const contracts = [];
for (const c of handoff.contracts) {
  const path = `docs/abi/${c.name}.json`;
  const bytes = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:${path}`],
    { cwd: root },
  );
  if (!(await readFile(resolve(root, path))).equals(bytes))
    throw Error(`Working ABI differs from source commit: ${c.name}`);
  const abi = JSON.parse(bytes);
  if (
    !Array.isArray(abi) ||
    keccak256(stringToHex(canonical(abi))).slice(2) !== c.abiHash
  )
    throw Error(`ABI hash mismatch: ${c.name}`);
  await writeFile(resolve(root, `dist/abi/${c.name}.json`), bytes);
  contracts.push({
    name: c.name,
    address: c.address,
    abiHash: c.abiHash,
    abiPath: `abi/${c.name}.json`,
  });
  console.log(`Verified ${c.name}: ${c.abiHash}`);
}
// Minimal infrastructure interfaces, matched to Uniswap source; never substitute these for launch ABIs.
const pool =
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }";
const interfaces = {
  PoolSwapTest: parseAbi([
    pool,
    "struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }",
    "struct TestSettings { bool takeClaims; bool settleUsingBurn; }",
    "function manager() view returns (address)",
    "function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)",
    "error NoSwapOccurred()",
  ]),
  StateView: parseAbi([
    "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
    "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  ]),
  Quoter: parseAbi([
    pool,
    "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
    "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)",
  ]),
};
for (const [name, abi] of Object.entries(interfaces))
  await writeFile(
    resolve(root, `dist/abi/${name}.json`),
    JSON.stringify(abi, null, 2) + "\n",
  );
const assets = [];
async function inventory(dir, prefix = "") {
  for (const file of (await readdir(dir)).sort()) {
    const path = prefix + file,
      full = resolve(dir, file);
    if ((await stat(full)).isDirectory()) await inventory(full, `${path}/`);
    else if (path !== "imd-deployment.json") {
      const data = await readFile(full);
      if (data.length > 8388608) throw Error("Oversize asset");
      assets.push({
        path,
        sha256: createHash("sha256").update(data).digest("hex"),
      });
    }
  }
}
await inventory(resolve(root, "dist"));
if (assets.length > 128) throw Error("Too many assets");
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts,
  assets,
  network: net.network,
  walletAddChain: net.walletAddChain,
  pool: handoff.manifest.pool,
  token: handoff.manifest.token,
  deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
  ...site,
};
await writeFile(
  resolve(root, "dist/imd-deployment.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `Manifest written with ${assets.length} assets; network block preserved.`,
);
