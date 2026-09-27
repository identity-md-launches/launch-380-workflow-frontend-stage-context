import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { keccak256, stringToHex } from "viem";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = async (p) => JSON.parse(await readFile(resolve(root, p), "utf8"));
const m = await read("dist/imd-deployment.json"),
  h = await read("web/config/deployment-handoff.json"),
  n = await read("web/config/network.json");
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(",")}]`
    : v !== null && typeof v === "object"
      ? `{${Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
          .join(",")}}`
      : JSON.stringify(v);
for (const k of ["launchId", "chainId", "sourceCommit", "attestationHash"])
  assert.equal(m[k], h[k]);
assert.deepEqual(m.network, n.network);
assert.deepEqual(m.walletAddChain, n.walletAddChain);
assert.deepEqual(
  m.contracts.map(({ abiPath, ...c }) => c),
  h.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })),
);
for (const c of m.contracts)
  assert.equal(
    keccak256(stringToHex(canonical(await read("dist/" + c.abiPath)))).slice(2),
    c.abiHash,
  );
const paths = [];
let bytes = 0;
async function walk(path, prefix = "") {
  for (const f of await readdir(path)) {
    const p = resolve(path, f);
    if ((await stat(p)).isDirectory()) await walk(p, prefix + f + "/");
    else if (prefix + f !== "imd-deployment.json") {
      paths.push(prefix + f);
      bytes += (await stat(p)).size;
    }
  }
}
await walk(resolve(root, "dist"));
assert.deepEqual(paths.sort(), m.assets.map((a) => a.path).sort());
assert(m.assets.length <= 128);
for (const a of m.assets) {
  assert(!a.path.startsWith("/") && !a.path.split("/").includes(".."));
  const b = await readFile(resolve(root, "dist", a.path));
  assert(b.length <= 8388608);
  assert.equal(createHash("sha256").update(b).digest("hex"), a.sha256);
}
assert(bytes < 32 * 1024 * 1024);
assert(
  (await readFile(resolve(root, "dist/index.html"), "utf8")).includes(
    "./assets/",
  ),
);
console.log(
  JSON.stringify(
    {
      result: "pass",
      assets: m.assets.length,
      exportBytes: bytes,
      abiHashes: "match",
      network: "unchanged",
      sourceCommit: m.sourceCommit,
    },
    null,
    2,
  ),
);
