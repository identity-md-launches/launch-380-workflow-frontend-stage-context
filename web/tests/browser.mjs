import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  parseEther,
  toHex,
  zeroAddress,
} from "viem";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  dist = resolve(root, "dist"),
  evidence = resolve(root, "docs/evidence");
await mkdir(evidence, { recursive: true });
const manifest = JSON.parse(
  await readFile(resolve(dist, "imd-deployment.json"), "utf8"),
);
const abis = Object.fromEntries(
  await Promise.all(
    ["THRW", "FeeSplitHook", "PoolSwapTest", "StateView", "Quoter"].map(
      async (n) => [
        n,
        JSON.parse(await readFile(resolve(dist, `abi/${n}.json`), "utf8")),
      ],
    ),
  ),
);
const account = "0x1234567890123456789012345678901234567890",
  referral = "0x2222222222222222222222222222222222222222",
  block = BigInt(manifest.deploymentBlock + 100),
  blockHash = "0x" + "ab".repeat(32);
const state = {
  allowance: 0n,
  claimed: false,
  donated: false,
  burned: false,
  failSimulation: false,
  failReads: false,
  emptyCode: false,
  emptyEvents: false,
  noLiquidity: false,
  sends: [],
  calls: [],
};
const unit = parseEther("0.001");
function decode(data) {
  for (const [name, abi] of Object.entries(abis)) {
    try {
      return { name, abi, ...decodeFunctionData({ abi, data }) };
    } catch {}
  }
  throw Error("Unknown calldata " + data);
}
function call(tx) {
  const { abi, functionName: f, args = [] } = decode(tx.data);
  state.calls.push({ f, to: tx.to, args });
  if (state.failReads) throw Error("Mock RPC unavailable");
  let result;
  switch (f) {
    case "manager":
    case "poolManager":
      result = manifest.network.uniswapV4.poolManager;
      break;
    case "FEE_BPS":
      result = 100n;
      break;
    case "INTERFACE_BPS":
      result = 2000n;
      break;
    case "LP_BPS":
      result = 3000n;
      break;
    case "BURN_BPS":
      result = 5000n;
      break;
    case "BPS":
      result = 10000n;
      break;
    case "BURN_ADDRESS":
      result = "0x000000000000000000000000000000000000dEaD";
      break;
    case "lifetimeTotals":
      result = [unit * 2n, unit * 3n, unit * 5n];
      break;
    case "pendingLP":
    case "totalPendingLP":
      result = state.donated ? 0n : unit * 3n;
      break;
    case "pendingBurn":
    case "totalPendingBurn":
      result = state.burned ? 0n : unit * 5n;
      break;
    case "totalPendingInterface":
    case "pendingInterface":
      result = state.claimed ? 0n : unit * 2n;
      break;
    case "totalPending":
      result =
        (state.claimed ? 0n : unit * 2n) +
        (state.donated ? 0n : unit * 3n) +
        (state.burned ? 0n : unit * 5n);
      break;
    case "getSlot0":
      result = [2505414483750479311864138015696063n, 207243, 0, 3000];
      break;
    case "getLiquidity":
      result = state.noLiquidity ? 0n : 10n ** 24n;
      break;
    case "decimals":
      result = 18;
      break;
    case "totalSupply":
      result = parseEther("1000000000");
      break;
    case "balanceOf":
      result = parseEther("100000");
      break;
    case "allowance":
      result = state.allowance;
      break;
    case "quoteExactInputSingle":
      result = [
        args[0].zeroForOne
          ? args[0].exactAmount * 990000000n
          : (args[0].exactAmount * 99n) / 100000000000n,
        150000n,
      ];
      break;
    case "approve":
      result = true;
      break;
    case "swap":
      if (state.failSimulation)
        throw Error("PartialFill: mock price limit reached");
      result = 1n;
      break;
    case "claim":
      result = state.claimed ? 0n : unit * 2n;
      break;
    case "donateAccrued":
      if (state.noLiquidity) throw Error("NoLiquidityToReceiveFees");
      result = unit * 3n;
      break;
    case "burnAccrued":
      result = unit * 5n;
      break;
    default:
      throw Error("Unhandled function " + f);
  }
  return encodeFunctionResult({ abi, functionName: f, result });
}
function rpc(q) {
  try {
    let result;
    switch (q.method) {
      case "eth_chainId":
        result = toHex(manifest.chainId);
        break;
      case "eth_blockNumber":
        result = toHex(block);
        break;
      case "eth_getCode":
        result = state.emptyCode ? "0x" : "0x6001600055";
        break;
      case "eth_getBalance":
        result = toHex(parseEther("10"));
        break;
      case "eth_call":
        result = call(q.params[0]);
        break;
      case "eth_getLogs": {
        const from = BigInt(q.params[0].fromBlock),
          to = BigInt(q.params[0].toBlock);
        result = state.emptyEvents
          ? []
          : Array.from({ length: 25 }, (_, i) => {
              const n = block - BigInt(i);
              return {
                address: manifest.contracts.find(
                  (c) => c.name === "FeeSplitHook",
                ).address,
                blockHash,
                blockNumber: toHex(n),
                data: encodeAbiParameters(
                  [
                    { type: "uint256" },
                    { type: "uint256" },
                    { type: "uint256" },
                    { type: "uint256" },
                  ],
                  [unit, unit / 5n, (unit * 3n) / 10n, unit / 2n],
                ),
                topics: encodeEventTopics({
                  abi: abis.FeeSplitHook,
                  eventName: "FeeSplit",
                  args: {
                    poolId: q.params[0].topics[1],
                    interfaceAddress: referral,
                  },
                }),
                transactionHash: toHex(100 + i, { size: 32 }),
                transactionIndex: "0x0",
                logIndex: toHex(i),
                removed: false,
              };
            }).filter(
              (l) =>
                BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to,
            );
        break;
      }
      case "eth_getTransactionReceipt":
        result = {
          transactionHash: q.params[0],
          transactionIndex: "0x0",
          blockHash,
          blockNumber: toHex(block),
          from: account,
          to: manifest.execution.address,
          cumulativeGasUsed: "0x249f0",
          gasUsed: "0x249f0",
          contractAddress: null,
          logs: [],
          logsBloom: "0x" + "00".repeat(256),
          status: "0x1",
          effectiveGasPrice: "0x3b9aca00",
          type: "0x2",
        };
        break;
      case "eth_estimateGas":
        result = "0x493e0";
        break;
      case "eth_getBlockByNumber":
        result = {
          number: toHex(block),
          hash: blockHash,
          parentHash: blockHash,
          nonce: "0x0000000000000000",
          sha3Uncles: blockHash,
          logsBloom: "0x" + "00".repeat(256),
          transactionsRoot: blockHash,
          stateRoot: blockHash,
          receiptsRoot: blockHash,
          miner: zeroAddress,
          difficulty: "0x0",
          totalDifficulty: "0x0",
          extraData: "0x",
          size: "0x0",
          gasLimit: "0x1c9c380",
          gasUsed: "0x1",
          timestamp: toHex(Math.floor(Date.now() / 1000)),
          transactions: [],
          uncles: [],
          baseFeePerGas: "0x3b9aca00",
        };
        break;
      default:
        throw Error("Unhandled RPC " + q.method);
    }
    return { jsonrpc: "2.0", id: q.id, result };
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id: q.id,
      error: { code: -32000, message: e.message },
    };
  }
}
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/preview/")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const rel = path.slice(9) || "index.html";
    if (rel.includes("..")) throw Error("unsafe path");
    const body = await readFile(resolve(dist, rel));
    res.setHeader(
      "Content-Type",
      {
        ".html": "text/html",
        ".js": "text/javascript",
        ".json": "application/json",
        ".css": "text/css",
      }[extname(rel)] || "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const results = [],
  errors = [],
  failed = [];
const record = (test, detail) => {
  results.push({ test, result: "pass", detail });
  console.log("PASS", test);
};
async function setup(wallet = true) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.route(/^https:\/\//, async (route) => {
    const q = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(Array.isArray(q) ? q.map(rpc) : rpc(q)),
    });
  });
  if (wallet)
    await context.addInitScript(
      ({ account, chainId }) => {
        const listeners = {},
          mock = {
            chain: "0x1",
            added: false,
            connected: false,
            reject: false,
            requests: [],
            sends: [],
          };
        window.__wallet = mock;
        window.ethereum = {
          isMetaMask: true,
          on: (name, fn) => {
            (listeners[name] ??= []).push(fn);
          },
          removeListener: (name, fn) => {
            listeners[name] = (listeners[name] ?? []).filter((f) => f !== fn);
          },
          request: async ({ method, params }) => {
            mock.requests.push({ method, params });
            switch (method) {
              case "eth_accounts":
                return mock.connected ? [account] : [];
              case "eth_requestAccounts":
                if (mock.reject) {
                  mock.reject = false;
                  throw { code: 4001, message: "User rejected request" };
                }
                mock.connected = true;
                return [account];
              case "eth_chainId":
                return mock.chain;
              case "wallet_switchEthereumChain":
                if (!mock.added) throw { code: 4902, message: "Unknown chain" };
                mock.chain = chainId;
                (listeners.chainChanged ?? []).forEach((fn) => fn(chainId));
                return null;
              case "wallet_addEthereumChain":
                mock.added = true;
                return null;
              case "wallet_requestPermissions":
                return [{ parentCapability: "eth_accounts" }];
              case "wallet_revokePermissions":
                mock.connected = false;
                return null;
              case "eth_sendTransaction":
                if (mock.reject) {
                  mock.reject = false;
                  throw { code: 4001, message: "User rejected request" };
                }
                mock.sends.push(params[0]);
                return await window.__sendMock(params[0]);
              default:
                throw {
                  code: -32601,
                  message: "Unsupported mock wallet method " + method,
                };
            }
          },
        };
      },
      { account, chainId: toHex(manifest.chainId) },
    );
  await context.exposeBinding("__sendMock", (_, tx) => {
    const d = decode(tx.data);
    state.sends.push({ tx, ...d });
    if (d.functionName === "approve") state.allowance = d.args[1];
    if (d.functionName === "claim") state.claimed = true;
    if (d.functionName === "donateAccrued") state.donated = true;
    if (d.functionName === "burnAccrued") state.burned = true;
    return toHex(state.sends.length, { size: 32 });
  });
  const page = await context.newPage();
  await page.clock.install();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => failed.push(r.url()));
  await page.goto(url);
  await page.getByRole("heading", { name: /One fee/ }).waitFor();
  await page.getByText(/Read at block/).waitFor();
  return { page, context };
}
async function click(p, name) {
  name = name.replace(/ [↗↻]$/, "");
  await p.getByRole("button", { name, exact: true }).click();
}
async function enabled(p, name) {
  name = name.replace(/ [↗↻]$/, "");
  await p.getByRole("button", { name, exact: true }).waitFor();
  await p.waitForFunction(
    (label) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent.includes(label) && !b.disabled,
      ),
    name,
  );
}
async function confirmed(p) {
  await p
    .getByRole("status")
    .filter({ hasText: /confirmed/ })
    .waitFor();
  await p.waitForFunction(
    () => !document.querySelector(".transaction-region strong"),
  );
}
try {
  const { page: p, context } = await setup();
  assert(
    await p
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  for (const name of ["Claim fees", "Donate accrued", "Burn accrued"])
    assert(await p.getByRole("button", { name, exact: false }).isDisabled());
  record("Disconnected actions are gated");
  await p.keyboard.press("Tab");
  assert.equal(await p.locator(":focus").textContent(), "Skip to content");
  await p.keyboard.press("Enter");
  await p.screenshot({
    path: resolve(evidence, "desktop-disconnected.jpg"),
    fullPage: true,
    type: "jpeg",
    quality: 78,
  });
  record("Keyboard skip link reaches main content");
  await p.evaluate(() => (window.__wallet.reject = true));
  await click(p, "Connect wallet ↗");
  await p.getByRole("alert").filter({ hasText: "Request declined" }).waitFor();
  record("Connection rejection has a retryable message");
  await click(p, "Connect wallet ↗");
  await p.getByRole("button", { name: "Switch to Sepolia" }).waitFor();
  assert(
    await p
      .getByRole("button", { name: "Get quote", exact: true })
      .isDisabled(),
  );
  record("Wrong-chain state keeps transaction controls disabled");
  await click(p, "Switch to Sepolia");
  await enabled(p, "Get quote");
  const requests = await p.evaluate(() => window.__wallet.requests);
  assert(requests.some((x) => x.method === "wallet_addEthereumChain"));
  assert.deepEqual(
    requests.find((x) => x.method === "wallet_addEthereumChain").params,
    [manifest.walletAddChain],
  );
  record("4902 fallback adds exact chain parameters and switches again");
  await click(p, "Get quote ↗");
  await p.locator("#amount-error").waitFor();
  assert.equal(await p.locator(":focus").getAttribute("id"), "amount");
  await p.locator("#amount").fill("0.001");
  await p.locator("#slippage").fill("8");
  await click(p, "Get quote ↗");
  assert(await p.locator("#slippage-error").isVisible());
  await p.locator("#slippage").fill("1");
  await p.locator(".advanced summary").click();
  await p.locator("#recipient").fill("bad");
  await click(p, "Get quote ↗");
  assert(await p.locator("#recipient-error").isVisible());
  record(
    "Amount, price-limit and recipient validation focus the invalid field",
  );
  await p.locator("#recipient").fill(referral);
  await p.keyboard.press("Tab");
  assert.equal(await p.locator(":focus").textContent(), "Get quote ↗");
  await p.keyboard.press("Enter");
  record("Keyboard navigation submits the quote from the form");
  await enabled(p, "Confirm buy");
  const quoteCall = state.calls
    .filter((x) => x.f === "quoteExactInputSingle")
    .at(-1);
  assert.equal(quoteCall.to.toLowerCase(), manifest.network.uniswapV4.quoter);
  assert.equal(quoteCall.args[0].hookData.length, 66);
  assert.equal(quoteCall.args[0].hookData.slice(-40), referral.slice(2));
  record("Buy quote uses configured quoter and ABI-encoded interface address");
  state.failSimulation = true;
  await click(p, "Confirm buy");
  await p
    .getByRole("alert")
    .filter({ hasText: /PartialFill/ })
    .waitFor();
  assert.equal(state.sends.length, 0);
  state.failSimulation = false;
  record("Failed simulation blocks wallet signing");
  await p.evaluate(() => (window.__wallet.reject = true));
  await click(p, "Confirm buy");
  await p.getByRole("alert").filter({ hasText: "Request declined" }).waitFor();
  assert.equal(state.sends.length, 0);
  record("Transaction rejection is recoverable");
  await click(p, "Confirm buy");
  await confirmed(p);
  const tx = state.sends.at(-1);
  assert.equal(tx.tx.to.toLowerCase(), manifest.execution.address);
  assert.equal(BigInt(tx.tx.value), parseEther("0.001"));
  assert.equal(tx.args[1].amountSpecified, -parseEther("0.001"));
  assert(tx.args[1].zeroForOne);
  assert.equal(tx.args[2].takeClaims, false);
  assert.equal(tx.args[2].settleUsingBurn, false);
  assert(tx.args[1].sqrtPriceLimitX96 < 2505414483750479311864138015696063n);
  record(
    "Native buy simulates, sends exact value through assigned router and confirms receipt",
  );
  await click(p, "Sell THRW");
  await p.locator("#amount").fill("1000");
  await p.locator("#recipient").fill("");
  await click(p, "Get quote ↗");
  await enabled(p, "Approve THRW");
  await click(p, "Approve THRW");
  await confirmed(p);
  assert.equal(state.sends.at(-1).functionName, "approve");
  assert.equal(
    state.sends.at(-1).args[0].toLowerCase(),
    manifest.execution.address,
  );
  assert.equal(state.sends.at(-1).args[1], parseEther("1000"));
  record(
    "Sell approval is a separate exact-amount transaction to PoolSwapTest",
  );
  await click(p, "Get quote ↗");
  await enabled(p, "Confirm sell");
  await click(p, "Confirm sell");
  await confirmed(p);
  const sell = state.sends.at(-1);
  assert.equal(sell.args[1].zeroForOne, false);
  assert.equal(BigInt(sell.tx.value ?? "0x0"), 0n);
  assert.equal(sell.args[3], "0x");
  assert(sell.args[1].sqrtPriceLimitX96 > 2505414483750479311864138015696063n);
  record("Sell swaps after approval; empty recipient leaves hookData empty");
  for (const [button, fn] of [
    ["Claim fees ↗", "claim"],
    ["Donate accrued ↗", "donateAccrued"],
    ["Burn accrued ↗", "burnAccrued"],
  ]) {
    await enabled(p, button.replace(" ↗", ""));
    await click(p, button);
    await confirmed(p);
    assert.equal(state.sends.at(-1).functionName, fn);
    assert.equal(
      state.sends.at(-1).tx.to.toLowerCase(),
      manifest.contracts.find((c) => c.name === "FeeSplitHook").address,
    );
    assert(
      await p
        .getByRole("button", { name: button.replace(" ↗", ""), exact: true })
        .isDisabled(),
    );
  }
  record("Claim, donate and burn simulate, confirm and refresh empty buckets");
  assert.equal(await p.locator("tbody tr").count(), 20);
  record("Event history shows exactly the 20 newest matching pool events");
  await p.locator("#amount").fill("100");
  await click(p, "Get quote ↗");
  await enabled(p, "Confirm sell");
  await p.clock.fastForward(46000);
  assert(
    await p
      .getByRole("button", { name: "Confirm sell", exact: true })
      .isDisabled(),
  );
  record("Expired quote cannot be submitted");
  await p.clock.resume();
  await p.locator("#amount").fill("101");
  assert.equal(await p.locator(".quote-box").count(), 0);
  record("Changing trade inputs invalidates the quote");
  const audit = await new AxeBuilder({ page: p })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  await writeFile(
    resolve(evidence, "accessibility.json"),
    JSON.stringify(
      {
        violations: audit.violations,
        incomplete: audit.incomplete.map((x) => ({
          id: x.id,
          impact: x.impact,
          description: x.description,
          nodes: x.nodes.map((n) => ({
            html: n.html,
            target: n.target,
            checks: [...n.any, ...n.all, ...n.none].map((c) => ({
              id: c.id,
              message: c.message,
              data: c.data,
            })),
          })),
        })),
        passes: audit.passes.length,
      },
      null,
      2,
    ),
  );
  assert.equal(
    audit.violations.length,
    0,
    JSON.stringify(
      audit.violations.map((v) => ({
        id: v.id,
        targets: v.nodes.map((n) => n.target),
      })),
    ),
  );
  record(
    "Axe automated accessibility audit",
    `${audit.passes.length} checks passed; manual checks remain separate`,
  );
  for (const [width, height] of [
    [1440, 1000],
    [820, 1100],
    [390, 844],
    [320, 760],
  ]) {
    await p.setViewportSize({ width, height });
    const dimensions = await p.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert(dimensions.scroll <= dimensions.client, `Overflow at ${width}`);
    await p.screenshot({
      path: resolve(evidence, `viewport-${width}.jpg`),
      fullPage: true,
      type: "jpeg",
      quality: 75,
    });
    record(`Production subpath renders at ${width}px without page overflow`);
  }
  await p.setViewportSize({ width: 1440, height: 1000 });
  await p.evaluate(() => (document.documentElement.style.fontSize = "32px"));
  assert(
    await p.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  );
  await p.evaluate(() => (document.documentElement.style.fontSize = ""));
  record(
    "200% text enlargement reflows without page overflow (not native zoom)",
  );
  await p.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(
    await p
      .locator(".primary")
      .first()
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  record("Reduced motion removes button transitions");
  await p.getByRole("button", { name: "Refresh state", exact: true }).focus();
  await p.keyboard.press("Tab");
  await p.keyboard.press("Shift+Tab");
  assert(
    await p.locator(":focus").evaluate((el) => el.matches(":focus-visible")),
  );
  await p.screenshot({
    path: resolve(evidence, "keyboard-focus.jpg"),
    type: "jpeg",
    quality: 78,
  });
  record("Keyboard focus screenshot captured");
  const colors = await p.evaluate(() => {
    const sample = (selector) => {
      const s = getComputedStyle(document.querySelector(selector));
      return {
        color: s.color,
        background: s.backgroundColor,
        fontSize: s.fontSize,
      };
    };
    return {
      body: sample("body"),
      muted: sample(".intro"),
      surface: sample(".trade-panel"),
      action: sample(".primary"),
      rootBackground: getComputedStyle(document.documentElement)
        .backgroundColor,
    };
  });
  await writeFile(
    resolve(evidence, "computed-colors.json"),
    JSON.stringify(colors, null, 2),
  );
  state.emptyEvents = true;
  await click(p, "Refresh events");
  await p.getByText("No fee splits yet.").waitFor();
  record("Empty event history is explicit and refreshable");
  state.emptyCode = true;
  await click(p, "Refresh state ↻");
  await p.getByRole("alert").filter({ hasText: "no deployed code" }).waitFor();
  assert(
    await p
      .getByRole("button", { name: "Get quote", exact: false })
      .isDisabled(),
  );
  state.emptyCode = false;
  record("Missing contract code disables writes with a recovery message");
  state.noLiquidity = true;
  state.donated = false;
  await click(p, "Refresh state ↻");
  await p
    .getByText("No in-range liquidity. Donation is unavailable.")
    .waitFor();
  assert(
    await p
      .getByRole("button", { name: "Donate accrued", exact: true })
      .isDisabled(),
  );
  record(
    "Donation remains disabled without active liquidity even when fees are pending",
  );
  state.noLiquidity = false;
  state.failReads = true;
  await click(p, "Refresh state ↻");
  await p
    .getByRole("alert")
    .filter({ hasText: /Mock RPC unavailable/ })
    .waitFor();
  assert(
    await p
      .getByRole("button", { name: "Get quote", exact: false })
      .isDisabled(),
  );
  state.failReads = false;
  record("RPC failure disables writes without showing stale data as fresh");
  await context.close();
  const missing = await setup(false);
  await click(missing.page, "Connect wallet ↗");
  await missing.page.getByRole("alert").waitFor();
  record("Missing wallet reports a connection error");
  await missing.context.close();
  const corrupt = await browser.newContext();
  await corrupt.route("**/abi/THRW.json", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );
  const bad = await corrupt.newPage();
  await bad.goto(url);
  await bad
    .getByRole("heading", { name: "Threeway is unavailable." })
    .waitFor();
  assert.equal(await bad.getByRole("button", { name: "Get quote" }).count(), 0);
  record("ABI tampering fails closed before wallet controls render");
  await corrupt.close();
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(failed.length, 0, failed.join("\n"));
  record(
    "No browser JavaScript errors or failed resource requests in mocked sessions",
  );
  await writeFile(
    resolve(evidence, "browser-results.json"),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        result: "pass",
        export: "dist served at /preview/",
        walletAndRpc: "mocked; no real transaction broadcast",
        browser: await browser.version(),
        results,
        errors,
        failed,
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  const page = browser.contexts()[0]?.pages()[0];
  if (page) {
    console.log((await page.locator("body").innerText()).slice(-9000));
    await page.screenshot({
      path: resolve(evidence, "failure.jpg"),
      fullPage: true,
      type: "jpeg",
      quality: 70,
    });
  }
  await writeFile(
    resolve(evidence, "browser-failure.json"),
    JSON.stringify({ error: error.stack, results, errors, failed }, null, 2),
  );
  throw error;
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
