import {
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseUnits,
  zeroAddress,
  type Address,
  type EIP1193Provider,
} from "viem";
import type { Runtime } from "./config";
export const poolKey = (r: Runtime) => ({
  currency0: r.deployment.pool.pairedCurrency,
  currency1: r.token.address,
  fee: r.deployment.pool.fee,
  tickSpacing: r.deployment.pool.tickSpacing,
  hooks: r.hook.address,
});
export const poolId = (r: Runtime) =>
  keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      Object.values(poolKey(r)) as [Address, Address, number, number, Address],
    ),
  );
export function amountInput(value: string, decimals: number) {
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) ||
    (value.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const amount = parseUnits(value, decimals);
  if (amount <= 0n || amount > (1n << 127n) - 1n)
    throw Error("Enter a positive amount within the swap size limit.");
  return amount;
}
export function interfaceData(value: string) {
  if (!value.trim()) return "0x" as const;
  if (!isAddress(value.trim()) || value.trim().toLowerCase() === zeroAddress)
    throw Error("Enter a valid, nonzero interface address, or leave it empty.");
  return encodeAbiParameters([{ type: "address" }], [value.trim() as Address]);
}
export function priceLimitBps(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw Error(
      "Use a price movement limit from 0.1% to 5%, with up to two decimals.",
    );
  const bps = Math.round(Number(value) * 100);
  if (bps < 10 || bps > 500)
    throw Error("Use a price movement limit from 0.1% to 5%.");
  return bps;
}
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw Error("Negative square root");
  if (n < 2n) return n;
  let x = n,
    y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
// Round toward the current price so the onchain cap is never wider than requested.
export function sqrtLimit(sqrt: bigint, buy: boolean, bps: number) {
  if (!Number.isInteger(bps) || bps < 10 || bps > 500)
    throw Error("Invalid price limit");
  const ratio = BigInt(buy ? 10000 - bps : 10000 + bps);
  const squared = sqrt * sqrt * ratio;
  let limit = isqrt(squared / 10000n);
  if (buy && limit * limit * 10000n < squared) limit++;
  if (
    limit <= 4295128739n ||
    limit >= 1461446703485210103287273052203988822378723970342n ||
    (buy ? limit >= sqrt : limit <= sqrt)
  )
    throw Error(
      "Pool price is too close to its range boundary for this limit.",
    );
  return limit;
}
export const errorText = (e: unknown) => {
  const err = e as {
    shortMessage?: string;
    message?: string;
    details?: string;
    code?: number;
  };
  if (
    err.code === 4001 ||
    /rejected|denied/i.test(err.shortMessage ?? err.message ?? "")
  )
    return "Request declined in your wallet. You can try again.";
  return (
    (err.shortMessage
      ? err.shortMessage + (err.details ? " " + err.details : "")
      : err.message) ||
    "Unable to complete the request. Check your connection and try again."
  ).slice(0, 650);
};
export async function switchNetwork(
  provider: Pick<EIP1193Provider, "request">,
  deployment: Runtime["deployment"],
) {
  const params: [{ chainId: string }] = [
    { chainId: deployment.walletAddChain.chainId },
  ];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params });
  } catch (error) {
    const e = error as {
      code?: number;
      message?: string;
      data?: { originalError?: { code?: number } };
    };
    if (
      e.code !== 4902 &&
      e.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|chain.*not.*added/i.test(
        e.message ?? "",
      )
    )
      throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [deployment.walletAddChain],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params });
  }
}
