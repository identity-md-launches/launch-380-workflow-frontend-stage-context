import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAbiParameters, zeroAddress } from "viem";
import {
  amountInput,
  interfaceData,
  priceLimitBps,
  sqrtLimit,
  switchNetwork,
  isqrt,
} from "../src/domain";
import { canonical, abiHash, safePath } from "../src/integrity";

test("strict amounts preserve every wei, reject rounding, scientific notation and overflow", () => {
  assert.equal(amountInput("0.000000000000000001", 18), 1n);
  assert.equal(amountInput("123.456", 6), 123456000n);
  for (const v of ["0", "-1", "1e5", " 1", "1.0000001", "Infinity", "01", ""])
    assert.throws(() => amountInput(v, 6));
  assert.throws(() => amountInput((1n << 127n).toString(), 0));
});
test("interface data uses exactly one ABI address word; blank means no attribution", () => {
  assert.equal(interfaceData(""), "0x");
  const address = "0x1234567890123456789012345678901234567890";
  assert.equal(interfaceData(address).length, 66);
  assert.equal(
    decodeAbiParameters([{ type: "address" }], interfaceData(address))[0],
    address,
  );
  assert.throws(() => interfaceData(zeroAddress));
  assert.throws(() => interfaceData("0x123"));
});
test("price caps are rounded conservatively in both directions across fuzzed integer prices", () => {
  for (let i = 1n; i <= 160n; i++) {
    const p = 79228162514264337593543950336n * i * 997n;
    const bps = 10 + Number(i % 491n),
      buy = sqrtLimit(p, true, bps),
      sell = sqrtLimit(p, false, bps);
    assert(buy < p && sell > p);
    assert(buy * buy * 10000n >= p * p * BigInt(10000 - bps));
    assert(sell * sell * 10000n <= p * p * BigInt(10000 + bps));
  }
  for (let n = 0n; n < 200n; n++) {
    const s = isqrt(n);
    assert(s * s <= n && (s + 1n) ** 2n > n);
  }
  assert.equal(priceLimitBps("1.25"), 125);
  for (const x of ["0", "6", "abc", "1.234"])
    assert.throws(() => priceLimitBps(x));
});
test("unknown chains are added from exact handoff parameters then switched again", async () => {
  const methods: string[] = [],
    add = {
      chainId: "0xaa36a7",
      chainName: "Sepolia",
      rpcUrls: ["https://example.invalid"],
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      blockExplorerUrls: [],
    };
  await switchNetwork(
    {
      request: async (args: any) => {
        methods.push(args.method);
        if (methods.length === 1) throw { code: 4902 };
        if (args.method === "wallet_addEthereumChain")
          assert.deepEqual(args.params, [add]);
      },
    } as any,
    { walletAddChain: add } as any,
  );
  assert.deepEqual(methods, [
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
    "wallet_switchEthereumChain",
  ]);
});
test("wallet rejection never falls through to adding a chain", async () => {
  let requests = 0;
  await assert.rejects(() =>
    switchNetwork(
      {
        request: async () => {
          requests++;
          throw { code: 4001 };
        },
      } as any,
      { walletAddChain: { chainId: "0xaa36a7" } } as any,
    ),
  );
  assert.equal(requests, 1);
});
test("ABI canonicalization sorts object keys, preserves ordered arrays and rejects path traversal", () => {
  assert.equal(
    canonical({ b: 1, a: [{ z: 2, b: 3 }] }),
    '{"a":[{"b":3,"z":2}],"b":1}',
  );
  assert.equal(abiHash([{ a: 1, b: 2 }]), abiHash([{ b: 2, a: 1 }]));
  assert.notEqual(abiHash([1, 2]), abiHash([2, 1]));
  for (const p of ["../a", "https://a", "/a", "a//b", "a/./b"])
    assert.equal(safePath(p), false);
  assert.equal(safePath("abi/THRW.json"), true);
});
