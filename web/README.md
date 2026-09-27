# Threeway frontend

One static page for the deployed THRW / ETH Uniswap v4 pool. React, TypeScript, Vite, wagmi and viem. The committed `../dist/` is the production artifact; publishers serve it without rebuilding. No backend, keys, privileged RPC service, WalletConnect project ID, contract changes or deployment steps are required.

## Install, build and preview

Use Node 22 and npm 10. Run from `web/`:

```sh
npm ci
npm run typecheck
npm run build
npm run check:export
npm run preview
```

After dependencies have been cached, `npm ci --offline --cache <your-cache>` and the build run without the network. The worker tested an offline reinstall with its local `/tmp/threeway-npm-cache`; that cache and `node_modules` are intentionally excluded from the submission. A fresh checkout needs dependency installation once. The repository must retain the deployed source commit referenced by the handoff, because the build extracts its exact ABI bytes with `git show`.

`npm run dev` supports editing after the first build. Its middleware serves the same generated manifest and ABI files from `../dist/`; rebuild after configuration or ABI changes. `npm run preview` serves the actual production files. Vite uses `base: './'`; the browser suite also serves the export at `/preview/`, testing gateway-style subpaths. Use HTTP(S), not `file://`.

## Configuration and provenance

- `config/deployment-handoff.json`: verbatim supplied handoff, including source commit, contract set, ABI hashes, pool parameters, launch ID and attestation hash.
- `config/network.json`: verbatim supplied network and wallet-add-chain parameters.
- `config/site.json`: the assignment's explicit PoolSwapTest execution address and infrastructure ABI paths.
- `scripts/build-manifest.mjs`: reads implementation ABIs from `docs/abi/<Contract>.json` **at the handoff source commit**, checks working bytes and canonical Keccak hashes, exports them, then inventories every output file using SHA-256. It writes `dist/imd-deployment.json` last, excluding that manifest from its own inventory.
- `src/config.ts`: loads that exact manifest at runtime, loads every referenced ABI, verifies ABI asset SHA-256 and launch ABI canonical Keccak, and derives wagmi/viem clients from it. No independent address, chain or ABI map exists in the application source.

Canonical ABI hashing is Keccak-256 of UTF-8 JSON with recursively sorted object keys, original array ordering and no whitespace. This matches both supplied hashes. Hash fields omit `0x`. The manifest preserves the network object unchanged and adds `pool`, `token`, `deploymentBlock`, `walletAddChain`, `execution`, and `protocolAbis` fields for the page.

The assignment explicitly names **PoolSwapTest**, while the network table lists **Universal Router** and does not include PoolSwapTest. The specific router requirement is implemented in `execution`; the original network block stays unchanged. Quotes use `network.uniswapV4.quoter`; spot price/liquidity use `stateView`; hook and router manager bindings are checked against `poolManager`. Sell approvals go directly to the configured PoolSwapTest, which pulls ERC-20 input. Permit2 and Universal Router are unused. Replacing PoolSwapTest with the background reference's Universal Router flow would conflict with the approved workflow.

## Reads, wallets and transactions

Public reads work before connection and refresh every 20 seconds. Account balances and claimable amounts load after connection. All hook state in a snapshot is pinned to one block. The app checks RPC chain ID, nonempty code at both deployed contracts and the four required Uniswap contracts, and hook/router manager getters. Failed verification, failed reads, state older than 60 seconds, disconnection or a wrong wallet network disable writes. Live code existence is not a bytecode-equivalence attestation; deployment provenance remains the handoff's responsibility.

Browser-injected wallets, including discovered EIP-6963 providers, use wagmi. No remote wallet service is necessary. Switching requests the configured chain; unknown-chain error 4902 (including its nested form) triggers the exact supplied `wallet_addEthereumChain` parameters, then retries switching. Account/network changes invalidate quotes. Signing stays in the visitor's wallet.

Both directions use exact input. ETH buys send exactly the entered value and require no approval. Token sells show a separate exact-amount ERC-20 approval to PoolSwapTest, wait for its receipt, and require a new quote. Optional hookData is one ABI-encoded nonzero address word; empty input sends `0x`. The address is unauthenticated fee attribution, not proof of identity. Only that recipient can later claim.

Quotes use `quoteExactInputSingle` through `simulateContract`, never a quoter transaction. The **price movement limit** is a 0.1–5% cap around the snapshot's pool price, encoded with integer square-root arithmetic as `sqrtPriceLimitX96`. Buy bounds round up and sell bounds round down. The hook's `PartialFill` check reverts a swap that cannot fill completely before this limit. Quotes expire in the UI after 45 seconds and all transactions are simulated again immediately before signing. This is not an onchain deadline: PoolSwapTest has neither `amountOutMinimum` nor a deadline argument. The page calls its output an estimate, explains the limitation, and tells visitors to cancel unwanted pending transactions in their wallets.

`claim()` redeems the connected wallet's aggregate interface balance. `donateAccrued(poolKey)` applies only to this pool and needs current in-range liquidity. A JIT LP can capture its donation. `burnAccrued()` redeems the aggregate burn bucket across pools to DEAD; this moves ETH and does not destroy THRW. Each action is simulated, submitted separately, linked to the explorer, and refreshed after a successful receipt. No auto-signing, automatic token approvals or automatic payouts.

FeeSplit logs are filtered by hook and pool ID, scanned backward in 10,000-block chunks with adaptive range reduction, and sorted by block/log index. Scanning continues until 20 events are found or the deployment block is reached. Progress and incomplete-history errors are explicit. Refresh repeats the scan against current chain state, avoiding permanent cached reorg data. Logs do not contain swap size, direction or timestamps, so the table does not invent them.

## Validation

```sh
npm test
PLAYWRIGHT_BROWSERS_PATH=/tmp/threeway-browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=/tmp/threeway-browsers npm run test:browser
NODE_USE_ENV_PROXY=1 node --import tsx scripts/check-live.ts
PLAYWRIGHT_BROWSERS_PATH=/tmp/threeway-browsers node scripts/browser-live.mjs
```

The browser scripts own their temporary HTTP server and browser within one foreground process, then close both. The interaction suite uses only mock wallets/RPC and never broadcasts. The two live scripts perform read-only calls. Evidence is under `docs/evidence/`; see [the validation record](../docs/VALIDATION.md) and [the design record](../docs/DESIGN.md).

The source and static artifact are ready for publisher review. IPFS pinning, named hosting and later control-plane checks are outside this worker task. No real wallet transaction, payout or swap was broadcast in validation.
