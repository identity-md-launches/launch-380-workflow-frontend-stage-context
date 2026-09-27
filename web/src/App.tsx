import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  createWalletClient,
  custom,
  formatUnits,
  type Address,
  type Hex,
  type EIP1193Provider,
} from "viem";
import type { Runtime } from "./config";
import {
  amountInput,
  errorText,
  interfaceData,
  poolId,
  poolKey,
  priceLimitBps,
  sqrtLimit,
  switchNetwork,
} from "./domain";
import {
  quote,
  readEvents,
  readSnapshot,
  verifyChain,
  type Snapshot,
  type SwapEvent,
} from "./chain";

type Trade = {
  amount: bigint;
  output: bigint;
  hookData: Hex;
  limit: bigint;
  buy: boolean;
  created: number;
  fingerprint: string;
  block: bigint;
};
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const units = (v: bigint | undefined, decimals = 18, digits = 6) => {
  if (v === undefined) return "—";
  const text = formatUnits(v, decimals),
    [whole, fraction = ""] = text.split(".");
  if (
    v > 0n &&
    BigInt(whole) === 0n &&
    !/[1-9]/.test(fraction.slice(0, digits))
  )
    return `<0.${"0".repeat(digits - 1)}1`;
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? "." + fraction.slice(0, digits).replace(/0+$/, "") : ""}`.replace(
    /\.$/,
    "",
  );
};
export default function App({ runtime: r }: { runtime: Runtime }) {
  const { address, chainId, connector } = useAccount(),
    { connectAsync, connectors, isPending: connecting } = useConnect(),
    { disconnect } = useDisconnect();
  const [snapshot, setSnapshot] = useState<Snapshot>(),
    [readError, setReadError] = useState(""),
    [loading, setLoading] = useState(false),
    [verified, setVerified] = useState(false);
  const [events, setEvents] = useState<SwapEvent[]>([]),
    [eventsLoading, setEventsLoading] = useState(false),
    [eventsError, setEventsError] = useState(""),
    [scanFrom, setScanFrom] = useState<bigint>(),
    [eventsBlock, setEventsBlock] = useState<bigint>();
  const [buy, setBuy] = useState(true),
    [amount, setAmount] = useState(""),
    [slippage, setSlippage] = useState("1"),
    [recipient, setRecipient] = useState("");
  const [trade, setTrade] = useState<Trade>(),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [actionError, setActionError] = useState(""),
    [fieldError, setFieldError] = useState<{ field: string; text: string }>(),
    [hash, setHash] = useState<Hex>();
  const [now, setNow] = useState(Date.now()),
    [walletChoice, setWalletChoice] = useState("");
  const generation = useRef(0),
    scanAbort = useRef<AbortController | null>(null),
    actionLock = useRef(false),
    mounted = useRef(true);
  const fingerprint = `${address}:${chainId}:${buy}:${amount}:${slippage}:${recipient}`;
  const currentFingerprint = useRef(fingerprint);
  currentFingerprint.current = fingerprint;
  const correctChain = !!address && chainId === r.deployment.chainId;
  const fresh =
    !!snapshot &&
    now - snapshot.at < 60000 &&
    snapshot.account === address &&
    !readError;
  const ready = correctChain && verified && fresh;
  const tradeFresh =
    trade && now - trade.created < 45000 && trade.fingerprint === fingerprint;
  const tokenSymbol = r.deployment.token.symbol,
    network = r.deployment.network;
  const explorer = (type: string, value: string) =>
    `${network.explorer}/${type}/${value}`;
  const refresh = useCallback(async () => {
    const id = ++generation.current;
    setLoading(true);
    setReadError("");
    try {
      await verifyChain(r);
      const next = await readSnapshot(r, address);
      if (id === generation.current && mounted.current) {
        setSnapshot(next);
        setVerified(true);
      }
    } catch (e) {
      if (id === generation.current && mounted.current) {
        setReadError(errorText(e));
        setVerified(false);
      }
    } finally {
      if (id === generation.current && mounted.current) setLoading(false);
    }
  }, [r, address]);
  const refreshEvents = useCallback(async () => {
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    setEventsLoading(true);
    setEventsError("");
    try {
      const block = await r.publicClient.getBlockNumber({ cacheTime: 0 });
      const next = await readEvents(
        r,
        block,
        (from) => {
          if (!controller.signal.aborted) setScanFrom(from);
        },
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setEvents(next);
        setEventsBlock(block);
      }
    } catch (e) {
      if (!controller.signal.aborted) setEventsError(errorText(e));
    } finally {
      if (!controller.signal.aborted) setEventsLoading(false);
    }
  }, [r]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      scanAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    setTrade(undefined);
    void refresh();
    const timer = setInterval(() => void refresh(), 20000);
    return () => {
      clearInterval(timer);
      generation.current++;
    };
  }, [refresh, chainId]);
  useEffect(() => {
    void refreshEvents();
    return () => scanAbort.current?.abort();
  }, [refreshEvents]);
  useEffect(() => {
    setTrade(undefined);
    setFieldError(undefined);
  }, [fingerprint]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  async function task(label: string, run: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(label);
    setNotice("");
    setActionError("");
    setHash(undefined);
    try {
      await run();
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      actionLock.current = false;
      setBusy("");
    }
  }
  async function wallet() {
    if (!connector || !address || !ready)
      throw Error(
        "Connect on the configured network and refresh verified state before continuing.",
      );
    const provider = (await connector.getProvider()) as EIP1193Provider;
    const accounts = await provider.request({ method: "eth_accounts" });
    const id = await provider.request({ method: "eth_chainId" });
    if (
      !accounts[0] ||
      accounts[0].toLowerCase() !== address.toLowerCase() ||
      Number(id) !== r.deployment.chainId
    )
      throw Error(
        "Your wallet account or network changed. Reconnect and review the action again.",
      );
    return createWalletClient({
      account: address,
      chain: r.chain,
      transport: custom(provider),
    });
  }
  async function send(
    functionName: string,
    kind: "hook" | "approval" | "swap",
    selected?: Trade,
  ) {
    const w = await wallet();
    const initial = currentFingerprint.current;
    await verifyChain(r);
    const params =
      kind === "approval"
        ? {
            address: r.token.address,
            abi: r.token.abi,
            functionName: "approve",
            args: [r.deployment.execution.address, selected!.amount],
          }
        : kind === "swap"
          ? {
              address: r.deployment.execution.address,
              abi: r.routerAbi,
              functionName: "swap",
              args: [
                poolKey(r),
                {
                  zeroForOne: selected!.buy,
                  amountSpecified: -selected!.amount,
                  sqrtPriceLimitX96: selected!.limit,
                },
                { takeClaims: false, settleUsingBurn: false },
                selected!.hookData,
              ],
              value: selected!.buy ? selected!.amount : 0n,
            }
          : {
              address: r.hook.address,
              abi: r.hook.abi,
              functionName,
              args: functionName === "donateAccrued" ? [poolKey(r)] : [],
            };
    setNotice("Simulating with current chain state…");
    const { request } = await r.publicClient.simulateContract({
      ...params,
      account: address!,
    });
    if (currentFingerprint.current !== initial)
      throw Error(
        "The account, network or form changed. Review the action again.",
      );
    if (selected && Date.now() - selected.created >= 45000)
      throw Error("The quote expired. Get a fresh quote before continuing.");
    await wallet();
    setNotice("Review the action in your wallet.");
    const tx = await w.writeContract(request);
    setHash(tx);
    setNotice("Transaction submitted. Waiting for confirmation…");
    const receipt = await r.publicClient.waitForTransactionReceipt({
      hash: tx,
      confirmations: 1,
      timeout: 180000,
    });
    if (receipt.status !== "success")
      throw Error(
        "The transaction reverted. No contract state change was applied; network gas may have been spent.",
      );
    setNotice(
      kind === "approval"
        ? "Approval confirmed. Get a fresh quote to review your sell."
        : "Transaction confirmed. Balances and fee buckets are refreshing.",
    );
    setTrade(undefined);
    await refresh();
    void refreshEvents();
  }
  async function requestQuote(e: FormEvent) {
    e.preventDefault();
    setFieldError(undefined);
    let field = "amount";
    try {
      const parsed = amountInput(
        amount,
        buy ? network.nativeCurrency.decimals : snapshot!.decimals,
      );
      field = "slippage";
      const bps = priceLimitBps(slippage);
      field = "recipient";
      const data = interfaceData(recipient);
      field = "amount";
      if (parsed > (buy ? snapshot!.ethBalance : snapshot!.tokenBalance))
        throw Error(
          `Your ${buy ? "ETH" : tokenSymbol} balance is too low for this amount.`,
        );
      await task("Getting quote", async () => {
        if (!ready || !address)
          throw Error(
            "Connect your wallet and refresh verified state to get a quote.",
          );
        const initial = currentFingerprint.current;
        const state = await readSnapshot(r, address);
        const limit = sqrtLimit(state.sqrtPrice, buy, bps);
        const output = await quote(
          r,
          buy,
          parsed,
          data,
          address,
          state.blockNumber,
        );
        if (output <= 0n)
          throw Error("This amount produces no output. Try a larger amount.");
        if (currentFingerprint.current !== initial) return;
        setTrade({
          amount: parsed,
          output,
          hookData: data,
          limit,
          buy,
          created: Date.now(),
          fingerprint: initial,
          block: state.blockNumber,
        });
        setSnapshot(state);
        setNotice("Quote ready. Review the estimate and price limit below.");
      });
    } catch (e) {
      setFieldError({ field, text: errorText(e) });
      document.getElementById(field)?.focus();
    }
  }
  const disabled = !!busy || !ready;
  const needApproval =
    trade && !buy && snapshot && snapshot.allowance < trade.amount;
  const unavailable = !address
    ? "Connect a wallet to trade and manage accrued fees."
    : !correctChain
      ? `Switch your wallet to ${network.name} to continue.`
      : !verified
        ? "Contract verification must complete before you can transact."
        : !fresh
          ? "Refresh live state before you can transact."
          : "";
  const feeRate = snapshot
    ? `${(snapshot.feeBps / snapshot.bps) * 100}%`
    : "1%";
  const nominal = snapshot
    ? [snapshot.interfaceBps, snapshot.lpBps, snapshot.burnBps].map(
        (v) => (v / snapshot.bps) * 100,
      )
    : [20, 30, 50];
  const price = snapshot?.sqrtPrice
    ? (snapshot.sqrtPrice ** 2n *
        10n ** BigInt(network.nativeCurrency.decimals)) /
      (1n << 192n)
    : undefined;
  const ErrorField = ({ name }: { name: string }) =>
    fieldError?.field === name ? (
      <p className="field-error" id={`${name}-error`}>
        {fieldError.text}
      </p>
    ) : null;
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header wrap">
        <a className="wordmark" href="#main" aria-label="Threeway home">
          <span className="mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          threeway<span className="wordmark-dot">.</span>
        </a>
        <div className="wallet-controls">
          <span className="badge">{network.name} testnet</span>
          {!address ? (
            <>
              {connectors.length > 1 && (
                <select
                  aria-label="Choose wallet"
                  value={walletChoice}
                  onChange={(e) => setWalletChoice(e.target.value)}
                >
                  {connectors.map((c) => (
                    <option key={c.uid} value={c.uid}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                disabled={connecting || !!busy}
                onClick={() =>
                  void task("Connecting", async () => {
                    const c =
                      connectors.find((c) => c.uid === walletChoice) ??
                      connectors[0];
                    if (!c)
                      throw Error(
                        "No browser wallet found. Install an Ethereum wallet and reload this page.",
                      );
                    if (!(await c.getProvider()))
                      throw Error(
                        "No browser wallet found. Install an Ethereum wallet and reload this page.",
                      );
                    await connectAsync({ connector: c });
                    setNotice(
                      "Wallet connected. Checking network and balances.",
                    );
                  })
                }
              >
                {connecting ? "Connecting…" : "Connect wallet"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            </>
          ) : (
            <>
              <span className="account" title={address}>
                {short(address)}
              </span>
              <button onClick={() => disconnect()} disabled={!!busy}>
                Disconnect
              </button>
            </>
          )}
        </div>
      </header>
      <main id="main" className="wrap" tabIndex={-1}>
        <section className="hero" aria-labelledby="intro-title">
          <div>
            <p className="eyebrow">A Uniswap v4 experiment</p>
            <h1 id="intro-title">
              One fee.
              <br />
              <span>Three ways.</span>
            </h1>
            <p className="intro">
              Every swap has a part to play. Trade Threeway and follow its ETH
              fee to interfaces, liquidity, and the burn.
            </p>
          </div>
          <div className="hero-note">
            <span className="experiment-number">01 / 03</span>
            <p>
              A small experiment in
              <br />
              transparent fee sharing.
            </p>
            <span className="outline-badge">THRW / ETH</span>
          </div>
        </section>
        <div className="test-note">
          <span aria-hidden="true">ⓘ</span>
          <p>
            <strong>Test tokens. Real mechanics.</strong> Threeway is a Sepolia
            test toy. Tokens and fee buckets have no value. No returns are
            promised.
          </p>
        </div>
        <div className="workspace">
          <section className="flow-panel" aria-labelledby="split-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Follow the fee</p>
                <h2 id="split-title">A split you can see.</h2>
              </div>
              <span className="fee-tag">
                {feeRate}
                <small>of the ETH leg</small>
              </span>
            </div>
            <div
              className="split-bar"
              role="img"
              aria-label={`${nominal[0]} percent to the interface, ${nominal[1]} percent to liquidity, ${nominal[2]} percent to burn when an interface is supplied.`}
            >
              <div />
              <div />
              <div />
            </div>
            <div className="split-columns">
              {["Interface", "Liquidity", "Burn"].map((name, i) => (
                <div className={`split-column bucket-${i}`} key={name}>
                  <span className="bucket-label">
                    <i />
                    {name}
                  </span>
                  <strong className="percentage">
                    {nominal[i]}
                    <small>%</small>
                  </strong>
                  <p>
                    {
                      [
                        "For the address named in the swap.",
                        "For liquidity in range at donation.",
                        "Sent to the permanent dead address.",
                      ][i]
                    }
                  </p>
                  <span className="metric-label">Lifetime accrued</span>
                  <span
                    className="bucket-value"
                    title={
                      snapshot
                        ? formatUnits(snapshot.totals[i], 18) + " ETH"
                        : undefined
                    }
                  >
                    {units(snapshot?.totals[i])} <small>ETH</small>
                  </span>
                </div>
              ))}
            </div>
            <p className="muted fine">
              No interface address? Its share goes to burn: 0% / 30% / 70%. The
              burn also receives rounding remainders.
            </p>
            <div className="pool-line">
              <div>
                <span className="metric-label">Pool spot price</span>
                <strong>
                  {units(price, snapshot?.decimals ?? 18, 2)}{" "}
                  <small>THRW / ETH</small>
                </strong>
              </div>
              <div>
                <span className="metric-label">Pool fee</span>
                <strong>
                  {snapshot ? snapshot.lpFee / 10000 : "—"}
                  <small>% + hook fee</small>
                </strong>
              </div>
            </div>
            <div className="read-status">
              <span>
                {loading
                  ? "Reading chain…"
                  : readError
                    ? "Live reads unavailable"
                    : snapshot
                      ? `Read at block ${snapshot.blockNumber.toLocaleString()}`
                      : "Waiting for live state"}
              </span>
              <button
                className="text-button"
                onClick={() => void refresh()}
                disabled={loading || !!busy}
              >
                Refresh state <span aria-hidden="true">↻</span>
              </button>
            </div>
            {readError && (
              <p className="error" role="alert">
                {readError} Use Refresh state to retry.
              </p>
            )}
          </section>
          <section className="trade-panel" aria-labelledby="trade-title">
            <div className="section-heading">
              <h2 id="trade-title">Trade Threeway</h2>
              <span className="mini-label">Exact input</span>
            </div>
            <div
              className="segmented"
              role="group"
              aria-label="Trade direction"
            >
              <button
                aria-pressed={buy}
                disabled={!!busy}
                onClick={() => setBuy(true)}
              >
                Buy THRW
              </button>
              <button
                aria-pressed={!buy}
                disabled={!!busy}
                onClick={() => setBuy(false)}
              >
                Sell THRW
              </button>
            </div>
            <form onSubmit={requestQuote} noValidate>
              <div className="amount-field">
                <label htmlFor="amount">You pay</label>
                <div className="amount-row">
                  <input
                    id="amount"
                    name="amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0.00"
                    value={amount}
                    disabled={!!busy}
                    onChange={(e) => setAmount(e.target.value)}
                    aria-invalid={fieldError?.field === "amount"}
                    aria-describedby={
                      fieldError?.field === "amount"
                        ? "amount-error"
                        : "balance"
                    }
                  />
                  <span className="currency">{buy ? "ETH" : tokenSymbol}</span>
                </div>
                <p id="balance" className="fine muted">
                  {address
                    ? `Balance: ${units(buy ? snapshot?.ethBalance : snapshot?.tokenBalance, buy ? 18 : (snapshot?.decimals ?? 18))} ${buy ? "ETH" : tokenSymbol}`
                    : "Connect to see your balance"}
                  {buy && address ? " · Keep ETH for gas." : ""}
                </p>
              </div>
              <ErrorField name="amount" />
              <div className="field">
                <label htmlFor="slippage">
                  Price movement limit <span>%</span>
                </label>
                <input
                  id="slippage"
                  name="slippage"
                  inputMode="decimal"
                  value={slippage}
                  disabled={!!busy}
                  onChange={(e) => setSlippage(e.target.value)}
                  aria-invalid={fieldError?.field === "slippage"}
                  aria-describedby={
                    fieldError?.field === "slippage"
                      ? "slippage-help slippage-error"
                      : "slippage-help"
                  }
                />
                <p id="slippage-help" className="fine muted">
                  Caps pool price movement from the quoted spot price. Hitting
                  the limit reverts the full swap.
                </p>
                <ErrorField name="slippage" />
              </div>
              <details className="advanced">
                <summary>
                  Interface address <span>Optional</span>
                </summary>
                <div className="field">
                  <label htmlFor="recipient">Fee recipient</label>
                  <input
                    id="recipient"
                    name="recipient"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0x…"
                    value={recipient}
                    disabled={!!busy}
                    onChange={(e) => setRecipient(e.target.value)}
                    aria-invalid={fieldError?.field === "recipient"}
                    aria-describedby={
                      fieldError?.field === "recipient"
                        ? "recipient-help recipient-error"
                        : "recipient-help"
                    }
                  />
                  <p id="recipient-help" className="fine muted">
                    Receives 20% of the hook fee. Anyone can name an address;
                    only its wallet can claim. Leave empty to send that share to
                    burn.
                  </p>
                  <ErrorField name="recipient" />
                </div>
              </details>
              {unavailable && <p className="prerequisite">{unavailable}</p>}
              {address && !correctChain && (
                <button
                  type="button"
                  className="primary full"
                  disabled={!!busy}
                  onClick={() =>
                    void task("Switching network", async () => {
                      if (!connector) return;
                      await switchNetwork(
                        (await connector.getProvider()) as EIP1193Provider,
                        r.deployment,
                      );
                      setNotice(`Wallet switched to ${network.name}.`);
                    })
                  }
                >
                  Switch to {network.name}
                </button>
              )}
              <button
                type="submit"
                className={`${tradeFresh ? "secondary" : "primary"} full`}
                disabled={disabled}
              >
                {busy === "Getting quote"
                  ? "Getting quote…"
                  : trade
                    ? "Refresh quote"
                    : "Get quote"}{" "}
                <span aria-hidden="true">↗</span>
              </button>
            </form>
            {trade && (
              <div className="quote-box">
                <div>
                  <span>Estimated receive</span>
                  <strong>
                    {units(trade.output, buy ? (snapshot?.decimals ?? 18) : 18)}{" "}
                    {buy ? tokenSymbol : "ETH"}
                  </strong>
                </div>
                <p className="fine">
                  Includes pool and hook fees. Quote at block{" "}
                  {trade.block.toString()};{" "}
                  {tradeFresh
                    ? `${Math.min(45, Math.max(0, 45 - Math.floor((now - trade.created) / 1000)))}s left to submit`
                    : "expired — refresh before continuing"}
                  .
                </p>
                <p className="fine muted">
                  PoolSwapTest enforces the price limit, with no minimum-output
                  or deadline parameter. An unmined transaction can remain
                  pending; cancel it in your wallet if needed.
                </p>
                {needApproval && (
                  <p className="fine">
                    Step 1: approve exactly{" "}
                    {units(trade.amount, snapshot?.decimals)} THRW for
                    PoolSwapTest. Step 2: refresh the quote and confirm the
                    sell.
                  </p>
                )}
                <button
                  className="primary full"
                  disabled={disabled || !tradeFresh}
                  onClick={() =>
                    void task(
                      needApproval ? "Approving THRW" : "Submitting swap",
                      () =>
                        send("swap", needApproval ? "approval" : "swap", trade),
                    )
                  }
                >
                  {needApproval
                    ? "Approve THRW"
                    : `Confirm ${buy ? "buy" : "sell"}`}
                </button>
              </div>
            )}
            <p className="router-caption">
              Via Uniswap{" "}
              <a
                href={explorer("address", r.deployment.execution.address)}
                target="_blank"
                rel="noreferrer"
              >
                PoolSwapTest ↗
              </a>
            </p>
          </section>
        </div>
        <div className="transaction-region" aria-live="polite" role="status">
          {busy && <strong>{busy}… </strong>}
          {notice}
          {hash && (
            <>
              {" "}
              <a href={explorer("tx", hash)} target="_blank" rel="noreferrer">
                View transaction ↗
              </a>
            </>
          )}
        </div>
        {actionError && (
          <div className="error" role="alert">
            {actionError}
          </div>
        )}
        <section className="buckets-section" aria-labelledby="bucket-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Put accrued fees to work</p>
              <h2 id="bucket-title">Ready when you are.</h2>
            </div>
            <span className="muted fine">
              Payouts are separate transactions.
            </span>
          </div>
          <div className="action-grid">
            <article className="action-card">
              <span className="action-number">01</span>
              <h3>Claim interface fees</h3>
              <p>
                Claim the fees credited to your connected wallet, across all
                pools.
              </p>
              <strong className="action-value">
                {units(address ? snapshot?.claimable : undefined)}{" "}
                <small>ETH</small>
              </strong>
              <button
                className="full"
                disabled={disabled || !snapshot?.claimable}
                onClick={() =>
                  void task("Claiming interface fees", () =>
                    send("claim", "hook"),
                  )
                }
              >
                Claim fees <span aria-hidden="true">↗</span>
              </button>
              <p className="fine muted">
                {!address
                  ? "Connect the fee recipient’s wallet."
                  : snapshot?.claimable
                    ? "Paid to your connected wallet."
                    : "No fees available for this wallet."}
              </p>
            </article>
            <article className="action-card">
              <span className="action-number">02</span>
              <h3>Donate to liquidity</h3>
              <p>
                Send this pool’s accrued LP fees to liquidity in range at
                execution.
              </p>
              <strong className="action-value">
                {units(snapshot?.lp)} <small>ETH</small>
              </strong>
              <button
                className="full"
                disabled={disabled || !snapshot?.lp || !snapshot?.liquidity}
                onClick={() =>
                  void task("Donating LP fees", () =>
                    send("donateAccrued", "hook"),
                  )
                }
              >
                Donate accrued <span aria-hidden="true">↗</span>
              </button>
              <p className="fine muted">
                {snapshot?.liquidity === 0n
                  ? "No in-range liquidity. Donation is unavailable."
                  : "Anyone can donate. A just-in-time LP can capture these fees."}
              </p>
            </article>
            <article className="action-card">
              <span className="action-number">03</span>
              <h3>Send fees to burn</h3>
              <p>
                Send all accrued burn fees to the dead address, across all
                pools.
              </p>
              <strong className="action-value">
                {units(snapshot?.allBurn)} <small>ETH</small>
              </strong>
              <button
                className="full"
                disabled={disabled || !snapshot?.allBurn}
                onClick={() =>
                  void task("Burning accrued fees", () =>
                    send("burnAccrued", "hook"),
                  )
                }
              >
                Burn accrued <span aria-hidden="true">↗</span>
              </button>
              <p className="fine muted">
                Anyone can trigger. The ETH cannot be recovered.
              </p>
            </article>
          </div>
          <div className="bucket-summary fine">
            <span>
              All pending: <strong>{units(snapshot?.total)} ETH</strong>
            </span>
            <span>All interface: {units(snapshot?.allInterface)} ETH</span>
            <span>All LP: {units(snapshot?.allLP)} ETH</span>
            <span>This pool’s burn: {units(snapshot?.burn)} ETH</span>
          </div>
        </section>
        <section className="events-section" aria-labelledby="events-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Onchain, in the open</p>
              <h2 id="events-title">The latest fee splits.</h2>
            </div>
            <button
              disabled={eventsLoading}
              onClick={() => void refreshEvents()}
            >
              {eventsLoading ? "Scanning events…" : "Refresh events"}
            </button>
          </div>
          <p className="muted fine">
            The last 20 FeeSplit events for this pool. All amounts in ETH. These
            events record fees, not trade size or direction.
          </p>
          {eventsLoading && (
            <p role="status" className="empty">
              Searching backward from the latest block
              {scanFrom ? `; reached ${scanFrom.toLocaleString()}` : ""}…
            </p>
          )}
          {eventsError && (
            <p className="error" role="alert">
              Event history is incomplete: {eventsError} Retry with Refresh
              events.
            </p>
          )}
          {!eventsLoading && !eventsError && events.length === 0 && (
            <div className="empty">
              <strong>No fee splits yet.</strong>
              <p>
                Successful swaps will appear here. Use Refresh events to check
                again.
              </p>
            </div>
          )}
          {events.length > 0 && (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Recent fee splits, scroll horizontally on small screens"
            >
              <table>
                <caption className="sr-only">
                  Latest FeeSplit events; amounts in ETH
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Transaction / block</th>
                    <th scope="col">Interface</th>
                    <th scope="col">Fee</th>
                    <th scope="col">Interface share</th>
                    <th scope="col">LP share</th>
                    <th scope="col">Burn share</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={`${e.transactionHash}:${e.logIndex}`}>
                      <td>
                        <a
                          href={explorer("tx", e.transactionHash)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`View transaction ${e.transactionHash}`}
                        >
                          {short(e.transactionHash)} ↗
                        </a>
                        <small>#{e.blockNumber.toString()}</small>
                      </td>
                      <td>
                        {BigInt(e.args.interfaceAddress) === 0n ? (
                          "None"
                        ) : (
                          <a
                            title={e.args.interfaceAddress}
                            href={explorer("address", e.args.interfaceAddress)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {short(e.args.interfaceAddress)}
                          </a>
                        )}
                      </td>
                      {[
                        e.args.fee,
                        e.args.interfaceShare,
                        e.args.lpShare,
                        e.args.burnShare,
                      ].map((v, i) => (
                        <td key={i} title={formatUnits(v, 18) + " ETH"}>
                          {units(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {eventsBlock && !eventsLoading && !eventsError && (
            <p className="fine muted">
              {events.length < 20
                ? "Full history searched from deployment."
                : "Most recent 20 matches."}{" "}
              Checked through block {eventsBlock.toString()}.
            </p>
          )}
        </section>
        <details className="deployment-details">
          <summary>
            Deployment & pool details <span>Verify the contracts ↗</span>
          </summary>
          <div className="contract-grid">
            {r.deployment.contracts.map((c) => (
              <div key={c.name}>
                <strong>{c.name}</strong>
                <a
                  href={explorer("address", c.address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.address} ↗
                </a>
                <a href={`./${c.abiPath}`} target="_blank" rel="noreferrer">
                  View verified ABI
                </a>
              </div>
            ))}
            <div>
              <strong>StateView</strong>
              <a
                href={explorer("address", network.uniswapV4.stateView)}
                target="_blank"
                rel="noreferrer"
              >
                {network.uniswapV4.stateView} ↗
              </a>
            </div>
            <div>
              <strong>Pool ID</strong>
              <code>{poolId(r)}</code>
            </div>
            <div>
              <strong>Supply</strong>
              <span>
                {units(snapshot?.supply, snapshot?.decimals, 0)} THRW · fixed
                supply
              </span>
            </div>
            <div>
              <strong>Runtime configuration</strong>
              <a href="./imd-deployment.json" target="_blank" rel="noreferrer">
                Open deployment manifest
              </a>
              <span>
                {verified
                  ? "RPC chain, contract code & manager bindings checked."
                  : "Awaiting live verification."}
              </span>
            </div>
          </div>
          <p className="fine muted">
            No owner, admin, mint function, or upgrade path. “Burn” sends ETH to
            the dead address; it does not burn THRW. Hook fee attribution is
            unauthenticated.
          </p>
        </details>
      </main>
      <footer className="wrap">
        <span className="wordmark">threeway.</span>
        <p>An experiment in sharing. Built on Uniswap v4.</p>
        <a href={network.faucets[0]} target="_blank" rel="noreferrer">
          Get Sepolia ETH ↗
        </a>
      </footer>
    </>
  );
}
