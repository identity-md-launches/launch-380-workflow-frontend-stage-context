import { keccak256, stringToHex } from "viem";
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export const abiHash = (abi: unknown) =>
  keccak256(stringToHex(canonical(abi))).slice(2);
export const safePath = (path: string) =>
  /^[a-zA-Z0-9_./-]+$/.test(path) &&
  !path.startsWith("/") &&
  !path.split("/").some((p) => p === ".." || p === "." || p === "");
