import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { createConfig, injected } from "wagmi";
import { abiHash, safePath } from "./integrity";

export type Deployment = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: Record<
      | "poolManager"
      | "universalRouter"
      | "quoter"
      | "stateView"
      | "positionManager"
      | "permit2",
      Address
    >;
  };
  walletAddChain: {
    chainId: Hex;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
  pool: { fee: number; tickSpacing: number; pairedCurrency: Address };
  token: { name: string; symbol: string; contract: string; decimals: number };
  deploymentBlock: number;
  execution: { kind: string; address: Address; abiPath: string };
  protocolAbis: { stateView: string; quoter: string };
};
export async function loadRuntime() {
  const base = new URL("./", window.location.href);
  const response = await fetch(new URL("imd-deployment.json", base), {
    cache: "no-cache",
  });
  if (!response.ok)
    throw Error("Deployment configuration is unavailable. Reload to retry.");
  const deployment: Deployment = await response.json();
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network.chainId ||
    Number(deployment.walletAddChain.chainId) !== deployment.chainId ||
    deployment.execution.kind !== "PoolSwapTest"
  )
    throw Error(
      "Deployment configuration is inconsistent. Transactions are unavailable.",
    );
  if (
    deployment.pool.pairedCurrency !==
    "0x0000000000000000000000000000000000000000"
  )
    throw Error("This interface requires the attested native ETH pool.");
  const loadAbi = async (path: string, expected?: string): Promise<Abi> => {
    if (!safePath(path)) throw Error("Unsafe ABI path in deployment.");
    const asset = deployment.assets.find((a) => a.path === path);
    if (!asset) throw Error(`ABI asset missing: ${path}`);
    const r = await fetch(new URL(path, base));
    if (!r.ok) throw Error(`Unable to load ${path}. Reload to retry.`);
    const bytes = await r.arrayBuffer();
    const sha = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const abi = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !Array.isArray(abi) ||
      sha !== asset.sha256 ||
      (expected && abiHash(abi) !== expected)
    )
      throw Error(`ABI integrity check failed: ${path}`);
    return abi as Abi;
  };
  const contracts = await Promise.all(
    deployment.contracts.map(async (c) => ({
      ...c,
      abi: await loadAbi(c.abiPath, c.abiHash),
    })),
  );
  const token = contracts.find((c) => c.name === deployment.token.contract);
  const hook = contracts.find((c) => c.name === "FeeSplitHook");
  if (!token || !hook || contracts.length !== 2)
    throw Error("The expected deployed contracts are missing.");
  const [routerAbi, stateAbi, quoterAbi] = await Promise.all([
    loadAbi(deployment.execution.abiPath),
    loadAbi(deployment.protocolAbis.stateView),
    loadAbi(deployment.protocolAbis.quoter),
  ]);
  const chain = defineChain({
    id: deployment.chainId,
    name: deployment.network.name,
    testnet: deployment.network.testnet,
    nativeCurrency: deployment.network.nativeCurrency,
    rpcUrls: { default: { http: deployment.network.rpcUrls } },
    blockExplorers: {
      default: { name: "Explorer", url: deployment.network.explorer },
    },
  });
  const transport = fallback(
    deployment.network.rpcUrls.map((url) =>
      http(url, { timeout: 10000, retryCount: 1 }),
    ),
    { rank: false },
  );
  const publicClient = createPublicClient({ chain, transport });
  const wagmi = createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: transport },
    multiInjectedProviderDiscovery: true,
  });
  return {
    deployment,
    token,
    hook,
    routerAbi,
    stateAbi,
    quoterAbi,
    chain,
    publicClient,
    wagmi,
  };
}
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
