import { getAbiItem, type Address, type AbiEvent, type Hex } from "viem";
import type { Runtime } from "./config";
import { poolId, poolKey } from "./domain";
export async function verifyChain(r: Runtime) {
  const c = r.publicClient,
    n = r.deployment.network.uniswapV4;
  if ((await c.getChainId()) !== r.deployment.chainId)
    throw Error(
      "RPC returned the wrong network. Retry verification before continuing.",
    );
  const addresses = [
    r.token.address,
    r.hook.address,
    r.deployment.execution.address,
    n.poolManager,
    n.quoter,
    n.stateView,
  ];
  const codes = await Promise.all(
    addresses.map((address) => c.getCode({ address })),
  );
  if (codes.some((code) => !code || code === "0x"))
    throw Error(
      "A required contract has no deployed code. Transactions are disabled.",
    );
  const [hookManager, routerManager] = await Promise.all([
    c.readContract({
      address: r.hook.address,
      abi: r.hook.abi,
      functionName: "poolManager",
    }),
    c.readContract({
      address: r.deployment.execution.address,
      abi: r.routerAbi,
      functionName: "manager",
    }),
  ]);
  if (
    String(hookManager).toLowerCase() !== n.poolManager ||
    String(routerManager).toLowerCase() !== n.poolManager
  )
    throw Error("PoolManager binding does not match the deployment.");
}
export async function readSnapshot(r: Runtime, account?: Address) {
  const c = r.publicClient,
    blockNumber = await c.getBlockNumber({ cacheTime: 0 }),
    id = poolId(r);
  const hook = (functionName: string, args: unknown[] = []) =>
    c.readContract({
      address: r.hook.address,
      abi: r.hook.abi,
      functionName,
      args,
      blockNumber,
    });
  const token = (functionName: string, args: unknown[] = []) =>
    c.readContract({
      address: r.token.address,
      abi: r.token.abi,
      functionName,
      args,
      blockNumber,
    });
  const values = await Promise.all([
    hook("lifetimeTotals", [id]),
    hook("pendingLP", [id]),
    hook("pendingBurn", [id]),
    hook("totalPendingBurn"),
    hook("totalPending"),
    hook("FEE_BPS"),
    hook("INTERFACE_BPS"),
    hook("LP_BPS"),
    hook("BURN_BPS"),
    hook("BPS"),
    c.readContract({
      address: r.deployment.network.uniswapV4.stateView,
      abi: r.stateAbi,
      functionName: "getSlot0",
      args: [id],
      blockNumber,
    }),
    c.readContract({
      address: r.deployment.network.uniswapV4.stateView,
      abi: r.stateAbi,
      functionName: "getLiquidity",
      args: [id],
      blockNumber,
    }),
    token("decimals"),
    token("totalSupply"),
    account ? token("balanceOf", [account]) : 0n,
    account ? c.getBalance({ address: account, blockNumber }) : 0n,
    account ? hook("pendingInterface", [account]) : 0n,
    account
      ? token("allowance", [account, r.deployment.execution.address])
      : 0n,
    hook("totalPendingInterface"),
    hook("totalPendingLP"),
    hook("BURN_ADDRESS"),
  ]);
  const [
    totals,
    lp,
    burn,
    allBurn,
    total,
    feeBps,
    interfaceBps,
    lpBps,
    burnBps,
    bps,
    slot,
    liquidity,
    decimals,
    supply,
    tokenBalance,
    ethBalance,
    claimable,
    allowance,
    allInterface,
    allLP,
    burnAddress,
  ] = values;
  if (Number(decimals) !== r.deployment.token.decimals)
    throw Error(
      "Token decimals differ from the handoff. Transactions are disabled.",
    );
  const [sqrtPrice, tick, , lpFee] = slot as [bigint, number, number, number];
  return {
    blockNumber,
    totals: totals as [bigint, bigint, bigint],
    lp: lp as bigint,
    burn: burn as bigint,
    allBurn: allBurn as bigint,
    total: total as bigint,
    feeBps: Number(feeBps),
    interfaceBps: Number(interfaceBps),
    lpBps: Number(lpBps),
    burnBps: Number(burnBps),
    bps: Number(bps),
    sqrtPrice,
    tick,
    lpFee,
    liquidity: liquidity as bigint,
    decimals: Number(decimals),
    supply: supply as bigint,
    tokenBalance: tokenBalance as bigint,
    ethBalance: ethBalance as bigint,
    claimable: claimable as bigint,
    allowance: allowance as bigint,
    allInterface: allInterface as bigint,
    allLP: allLP as bigint,
    burnAddress: burnAddress as Address,
    at: Date.now(),
    account,
  };
}
export type Snapshot = Awaited<ReturnType<typeof readSnapshot>>;
export type SwapEvent = {
  transactionHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  args: {
    interfaceAddress: Address;
    fee: bigint;
    interfaceShare: bigint;
    lpShare: bigint;
    burnShare: bigint;
  };
};
export async function readEvents(
  r: Runtime,
  to: bigint,
  progress: (from: bigint) => void,
  signal: AbortSignal,
) {
  const floor = BigInt(r.deployment.deploymentBlock),
    logs: SwapEvent[] = [];
  let end = to,
    chunk = 10000n;
  const event = getAbiItem({ abi: r.hook.abi, name: "FeeSplit" }) as AbiEvent;
  while (end >= floor && logs.length < 20) {
    if (signal.aborted) throw Error("Event scan cancelled");
    const from = end - chunk + 1n > floor ? end - chunk + 1n : floor;
    try {
      const batch = await r.publicClient.getLogs({
        address: r.hook.address,
        event,
        args: { poolId: poolId(r) },
        fromBlock: from,
        toBlock: end,
        strict: true,
      });
      logs.push(...(batch as unknown as SwapEvent[]));
      end = from - 1n;
      progress(from);
    } catch (error) {
      if (chunk <= 100n) throw error;
      chunk = chunk / 2n;
    }
  }
  return logs
    .sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? b.logIndex - a.logIndex
        : a.blockNumber > b.blockNumber
          ? -1
          : 1,
    )
    .slice(0, 20);
}
export async function quote(
  r: Runtime,
  buy: boolean,
  amount: bigint,
  hookData: Hex,
  account: Address,
  blockNumber: bigint,
) {
  const { result } = await r.publicClient.simulateContract({
    address: r.deployment.network.uniswapV4.quoter,
    abi: r.quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      { poolKey: poolKey(r), zeroForOne: buy, exactAmount: amount, hookData },
    ],
    account,
    blockNumber,
  });
  return (result as [bigint, bigint])[0];
}
