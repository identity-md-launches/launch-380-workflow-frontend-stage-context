# Worker validation — Threeway frontend

## Completion and scope

Frontend source, lockfile, production export, runtime deployment manifest, design record and worker validation are complete within `web/`, `dist/` and `docs/`. No Solidity source, Foundry settings, root build configuration, dependency library or GitHub workflow changed. The only new ignore file is the expressly allowed `web/.gitignore`. No real transaction was broadcast, no contract was redeployed, and nothing was published.

The original workspace's Git metadata is read-only. `git add --dry-run -- web dist docs` failed creating `.git/index.lock` with “Read-only file system.” Consequently the requested commit **could not be made in the original repository**. The files are left for the contributor/publisher to collect and commit. An isolated scratch checkout is used only to rehearse complete Git bundle size, not to claim a commit in the original repository.

Two assignment conflicts were resolved in favor of the narrower instructions:

- Root `DESIGN.md` is outside the explicit allowed paths. Its complete content is delivered at `docs/DESIGN.md` instead.
- The approved workflow explicitly requires PoolSwapTest, but the network block has no PoolSwapTest field and instead includes Universal Router. The network block is preserved unchanged. The separately assigned PoolSwapTest address is centralized in the same runtime manifest's `execution` block; swap and token approval use it. Quotes, price reads and manager verification use the provided network addresses. This is an explicit exception to a literal interpretation that every swap address must appear inside `network.uniswapV4`.

## Checks actually run

All commands below completed successfully after applicable corrections. Logs and machine-readable evidence are in `docs/evidence/`.

| Check | Result / evidence |
| --- | --- |
| Node 22.23.2, npm 10.9.8; lockfile install | `npm ci --prefix web --offline --cache /tmp/threeway-npm-cache --no-audit --no-fund` passed; `install.log`. Cache and dependencies are not submitted. |
| TypeScript | `npm run --prefix web build` invokes `tsc --noEmit`; passed. |
| Production build | Vite 7.3.1 passed; `build.log`. All assets local, relative `./` base, no sourcemaps. |
| Unit/domain suite | `npm run --prefix web test`: 6 tests passed, including 160 integer-price cases and 200 integer square-root cases; `unit-tests.log`. |
| Export integrity | `npm run --prefix web check:export`: exact handoff bindings, ABI hashes, unchanged network block, complete SHA-256 inventory, safe relative paths and size limits passed; `export-check.log`. |
| Browser interactions | `PLAYWRIGHT_BROWSERS_PATH=/tmp/threeway-browsers npm run --prefix web test:browser`: 32 checks passed in Chromium 145.0.7632.6; `browser-results.json`, `browser.log`. |
| Development preview | Bounded foreground Vite server test fetched the same generated manifest and ABI; `dev-check.log`. |
| Read-only live RPC | `NODE_USE_ENV_PROXY=1 node --import tsx scripts/check-live.ts` from `web/`; `live-rpc.json`. |
| Live production browser | `PLAYWRIGHT_BROWSERS_PATH=/tmp/threeway-browsers node scripts/browser-live.mjs` from `web/`; `live-browser.json`, `live-desktop.jpg`, `live-mobile.jpg`. |
| Contrast | `node scripts/measure-contrast.mjs` from `web/`; `computed-colors.json`, `contrast.json`. |
| Package/scope | `python3 web/scripts/check-package.py`: isolated scratch checkout and complete Git bundle rehearsal; `packaging.json`. |

The initial supplied MCP browser call failed with `Transport closed`. Local Playwright was then installed outside the submission, and bounded foreground scripts managed their own preview server/browser. Actual production `dist/` was served at `/preview/`; no external site was published to run these checks.

Build warning: the main bundle is approximately 549 kB before compression (170 kB gzip), slightly above Vite's 500 kB advisory. Total export is approximately 0.6 MB. No chunk-size threshold was increased to hide it. Installation reports deprecated optional connector dependencies from wagmi's connector package tree; only the injected connector is imported into this app. These notices do not establish a complete dependency security audit.

## Interaction coverage

The mock-wallet suite exercises disconnected state; missing wallet; rejected connection; wrong chain; switch error 4902; exact `wallet_addEthereumChain` parameters; retry switching; invalid/overprecision amounts; invalid price limits and recipients; focus on invalid controls; optional address encoding; configured-quoter simulation; failed swap simulation preventing any send; rejected signing; exact ETH buy value and PoolSwapTest target; separate exact-amount approval; refreshed sell quote and zero native value; claim, donate and burn simulations, receipts and bucket refresh; donation disabled with no active liquidity even with fees pending; last 20 sorted events; empty event history; RPC failure; missing contract code; quote expiry and invalidation; ABI tampering; keyboard quote submission; reduced motion; and static-resource/script failures.

The suite decodes calldata and checks execution targets, exact input, trade direction, price-bound direction, settlement flags, approval spender/amount, recipient bytes and payout selectors. Provider and RPC responses are mocked in these interactions. A successful mock receipt is not evidence that an onchain write succeeded.

## Live-chain observations

PublicNode returned chain ID 11155111. Token, hook, PoolSwapTest, PoolManager, quoter and StateView each had nonempty bytecode. The hook's `poolManager()` and router's `manager()` matched the network PoolManager. Reads at block **11791745** returned 18 decimals, fixed supply 1,000,000,000 THRW, fee/split constants 100/2000/3000/5000 over 10000, zero pending/lifetime buckets, initialized pool price and zero liquidity at the current tick. A simulated exact-input buy of `1000000000000` wei quoted `49133859246231437308` THRW base units. The full event window **11791640–11791745** had no FeeSplit events.

The final unmocked production browser loaded the same config/ABIs and public RPC state through block **11791793**, displayed **50,000,000 THRW / ETH**, and showed the empty history and unavailable donation state. No JavaScript errors or failed requests were recorded. Initial zero current-tick liquidity does not categorically prevent a swap from crossing to funded ticks; the app relies on quoting and simulation for swaps and disables donation without active liquidity.

Code existence/manager checks are not a runtime-bytecode equivalence proof. The two implementation ABI canonical Keccak hashes were verified against the supplied attested handoff. The publisher's later immutable/named asset and RPC checks have not run and are not claimed as worker browser evidence.

## Better Interface consolidated review

All six core domains and the workflow/documentation sections of the pinned guide were read and applied during implementation. Review evidence is specific to this one-page light-theme interface. See `ATTRIBUTION.md` for the pinned upstreams and retained licenses.

| Domain | Coverage | Evidence and limitations |
| --- | --- | --- |
| Accessibility | Checked | Native landmarks, one h1, headings, form labels, named buttons, segmented group role, aria-pressed, native disclosures, error focus, polite status, alert errors, skip link, keyboard submission, visible focus screenshot, 44px buttons, reduced motion. Axe: 29 checks passed, zero violations. No actual screen-reader session or physical-device test. |
| Layout | Checked | Actual screenshots at 1440×1000, 820×1100, 390×844, 320×760. No whole-page overflow. Content order survives stacking; event table scroll is contained. 200% text enlargement passed. Native browser zoom and RTL/localization were not tested; English/LTR is the implemented variant. |
| Writing | Checked | Consequence-specific actions, explicit wallet prerequisites, retryable errors, unknown values as dashes, testnet/no-value notice, JIT donation caveat, unauthenticated fee recipient, ETH-versus-THRW burn distinction, estimate versus onchain price cap, no invented swap sizes/directions. |
| Typography | Checked | Heading hierarchy, 12px caption floor, 16px minimum inputs, tabular values, wrapping addresses, full transaction names, large-number and mobile renders. System fonts only; exact installed font faces on other platforms are not verified. |
| Colors | Checked | Opaque computed foreground/background pairs and token pairs measured with WCAG sRGB luminance. Body/page 13.28:1; secondary/page 5.35:1; main action 5.55:1; error 6.18:1; control boundaries 3.26–3.55:1; focus 13.28–14.48:1. Labels supplement all bucket/status colors. No dark theme required. |
| UI details | Checked | Enabled/disabled, selected, loading, empty, error, rejection, expiry and success states; native disclosures; restrained panel elevation; 120ms button-only transitions disabled by reduced motion. No overlays/autoplay/themes to audit. Animation-panel replay at 10% speed was not performed. |

### Findings fixed and rechecked

| Severity / domain | Source location | Finding, correction and recheck |
| --- | --- | --- |
| Medium / writing | `web/src/domain.ts:89` | A failed simulation initially displayed only viem's generic RPC short message. Included underlying details; browser now sees the simulated `PartialFill` reason and confirms no wallet send occurred. |
| Medium / accessibility | `web/src/App.tsx:587` (`.segmented`, role group) | Axe manual-review item identified `aria-label` on a generic div. Added `role="group"`; rerun removed the item, with zero violations. |
| Medium / typography | `web/src/style.css:343` and narrow-breakpoint caption rules | Initial source used 10–11px captions in several data/status roles. Raised the shared caption floor to 12px and rechecked desktop, 390px and 320px wrapping. |
| Medium / colors | `web/src/style.css:22`, `style.css:1070` | Form boundaries initially reused the light separator token. Added a dedicated control-boundary token; final contrast is 3.26:1 on page and 3.55:1 on form surface. Selected direction also has a visible boundary. |
| Medium / writing | `web/src/App.tsx:420` (connection handler) | Missing-provider error needed a next step. Added an explicit install-wallet-and-reload message; missing-wallet browser test passed. |
| Low / tooling | `web/vite.config.ts:10` | Dev server needed access to runtime deployment files without a second map. Added scoped middleware for the generated manifest/ABI files; fetch checks and typecheck passed. |

The remaining axe manual item concerns only the decorative `ⓘ` glyph in the testnet notice: automated contrast detection treats it as a non-text character. It is `aria-hidden`, repeats adjacent explanatory text, and uses the same foreground/background as the measured 13.28:1 body pair. This item is recorded rather than misrepresented as an automated pass.

Screenshots of the final production build were inspected, including live desktop/mobile, mock 320px and 820px reflow, and actual keyboard-visible focus. `keyboard-focus.jpg` shows the dark outline on Refresh state after Tab/Shift+Tab, not merely a computed CSS rule.

## Remaining limits

- Original-repository Git commit is blocked by read-only metadata; root design-document location is prohibited by scope.
- No real wallet signature, approval, swap, payout, receipt replacement, chain reorganization, mobile wallet, Safari, Firefox, screen reader, or native zoom session was performed. Simulations and mocks cannot certify those paths.
- PoolSwapTest lacks a minimum-output argument and onchain deadline. The implemented price cap and partial-fill revert are documented; UI quote expiry cannot cancel a transaction already submitted.
- Public RPC availability/rate limits and changing liquidity can make later reads or simulations fail. Failed prerequisites keep writes disabled, with retry controls.
- GitHub publication, IPFS pinning, named hosting and control-plane certification belong to the publisher. This is a worker evidence record, not an independent verifier's authority.
