import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, defineChain, http } from "viem";
import { verifyChain, readSnapshot, quote } from "../src/chain";
import { poolId } from "../src/domain";
import type { Runtime } from "../src/config";
const deployment = JSON.parse(
  await readFile("../dist/imd-deployment.json", "utf8"),
);
const contracts = await Promise.all(
  deployment.contracts.map(async (c: any) => ({
    ...c,
    abi: JSON.parse(await readFile("../dist/" + c.abiPath, "utf8")),
  })),
);
const infrastructure = await Promise.all(
  [
    deployment.execution.abiPath,
    deployment.protocolAbis.stateView,
    deployment.protocolAbis.quoter,
  ].map(async (p) => JSON.parse(await readFile("../dist/" + p, "utf8"))),
);
const chain = defineChain({
  id: deployment.chainId,
  name: deployment.network.name,
  nativeCurrency: deployment.network.nativeCurrency,
  rpcUrls: { default: { http: deployment.network.rpcUrls } },
});
const report: any = {
  time: new Date().toISOString(),
  readOnly: true,
  transactionsBroadcast: 0,
  endpoints: [],
};
for (const url of deployment.network.rpcUrls) {
  const publicClient = createPublicClient({
    chain,
    transport: http(url, { timeout: 8000, retryCount: 0 }),
  });
  const endpoint: any = { url };
  report.endpoints.push(endpoint);
  try {
    endpoint.chainId = await publicClient.getChainId();
    const r = {
      deployment,
      token: contracts.find((c) => c.name === "THRW"),
      hook: contracts.find((c) => c.name === "FeeSplitHook"),
      routerAbi: infrastructure[0],
      stateAbi: infrastructure[1],
      quoterAbi: infrastructure[2],
      chain,
      publicClient,
    } as Runtime;
    await verifyChain(r);
    endpoint.verification =
      "Chain ID, six nonempty contract codes, hook/router manager binding passed";
    const snapshot = await readSnapshot(r);
    endpoint.state = snapshot;
    endpoint.poolId = poolId(r);
    try {
      endpoint.buyQuote = {
        amountIn: "1000000000000",
        amountOut: await quote(
          r,
          true,
          1000000000000n,
          "0x",
          "0x1234567890123456789012345678901234567890",
          snapshot.blockNumber,
        ),
      };
    } catch (e: any) {
      endpoint.quoteError = e.shortMessage ?? e.message;
    }
    const events = await publicClient.getContractEvents({
      address: r.hook.address,
      abi: r.hook.abi,
      eventName: "FeeSplit",
      args: { poolId: poolId(r) },
      fromBlock: BigInt(deployment.deploymentBlock),
      toBlock: snapshot.blockNumber,
    });
    endpoint.eventCount = events.length;
    endpoint.eventWindow = [
      deployment.deploymentBlock,
      snapshot.blockNumber.toString(),
    ];
    report.result = "live reads passed";
    break;
  } catch (e: any) {
    endpoint.error = e.shortMessage ?? e.message;
  }
}
report.result ??= "Live RPC validation unavailable";
await writeFile(
  "../docs/evidence/live-rpc.json",
  JSON.stringify(
    report,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    report,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
