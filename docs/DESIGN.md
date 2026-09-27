# Threeway design record

## Overview

A single-page Sepolia experiment for people trading THRW or inspecting its fee split. The page leads with a short explanation, then pairs fee observability with the trade form. Payout actions and an event table follow in document order. Cream surfaces, restrained orange actions, three muted bucket colors and large plain typography keep the fee mechanism readable.

Implementation: `web/src/App.tsx` and `web/src/style.css`. This file is intentionally under `docs/`: the assignment's explicit write budget prohibits a root `DESIGN.md`, despite the later generic request for that location. No root file was created.

## Colors

CSS primitives feed semantic tokens in `style.css:1`; components use the semantic tier.

| Role | Token | Value |
| --- | --- | --- |
| Page | `--bg` / `--cream-50` | `#f6f4ed` |
| Form surface | `--surface` / `--paper` | `#fffefa` |
| Secondary surface / disabled | `--surface-soft` / `--cream-100` | `#edeae0` |
| Structural separators | `--border` / `--cream-200` | `#d6d2c5` |
| Input/button boundaries | `--control-border` / `--ink-400` | `#85897a` |
| Primary text / focus | `--text`, `--focus` / `--ink-900` | `#262a22` |
| Secondary text | `--muted` / `--ink-600` | `#626659` |
| Main action | `--accent` / `--orange-600` | `#b83e21` |
| Hover action | `--accent-hover` / `--orange-700` | `#98321a` |
| Error text and boundary | `--error` / `--red-700` | `#a32920` |
| Error surface | `--error-bg` / `--red-50` | `#fbe9e5` |
| Interface bucket | `--interface` / `--green-400` | `#b5c394` |
| LP bucket | `--liquidity` / `--sand-300` | `#e1d5b8` |
| Burn bucket | `--burn` / `--rose-300` | `#e5ab92` |

Bucket color supplements visible names and percentages. Enabled primary action uses orange fill; peer actions use neutral boundaries. Errors have text and a border. Disabled actions retain readable labels and nearby prerequisite explanations. This implementation has one light theme; no dark variant is claimed. Measured contrast and coverage are in `VALIDATION.md` and `evidence/contrast.json`.

## Typography

The stack is `Arial, Helvetica, sans-serif`, with browser monospace for compact identifiers. There are no font downloads. Root size 16px, body line height 1.55, heading line height 1.12. Weights 400/500/600/700 use the installed platform faces; precise font availability varies by system. The page does not claim a custom font loaded.

`--text-small: .8125rem`, `--text-body: .9375rem`, `--text-title: 1.75rem`. Captions and eyebrow labels are at least `.75rem` (12px at default size). Inputs stay at least 16px, with 32px for the amount. The hero uses `clamp(3.5rem, 6.5vw, 6rem)`, changes to 4.8rem at 53rem and 3.6rem at 34rem. The hero's two deliberate lines have `.99` line height. Section titles are 28px, with smaller trade-panel and mobile variants. Heading letter spacing ranges from −.025em to −.06em; eyebrows use .14em uppercase tracking.

Headings use balanced wrapping, short descriptions use pretty wrapping, and all dynamic numbers use tabular numerals. Intro copy is limited to 460px on desktop. Contract identifiers wrap anywhere in the disclosure. Table values preserve full amounts in native titles; transaction links expose full hashes through accessible labels. Visible numbers are truncated conservatively, with a less-than marker for positive dust.

## Layout

`.wrap` caps content at 1200px. Default viewport gutters are 40px, then 24px below 65rem and 16px below 34rem. Most grouping follows 8px steps: 8/16/24/32/48/64, with 12/20/28px adjustments inside controls and cards. The shared spacing token is `--space: 8px`; component-specific gaps are explicit in CSS.

`.workspace` uses `minmax(0,1.32fr) minmax(0,1fr)` and a 48px gap. It tightens below 65rem and becomes one column below 53rem. The split stays in three columns, while payout cards become a vertical stack with paired headings and balances. The decorative hero note hides below 53rem. At 34rem, headings, gutters and card padding shrink; footer and event controls wrap. No fixed navigation obscures the page.

The event table has its own keyboard-focusable horizontal scroll region. It can exceed the phone width without causing whole-page scrolling. Long addresses and errors wrap. Desktop 1440px, intermediate 820px, mobile 390px and 320px were rendered and checked for page overflow. The 390px live browser image shows actual RPC state. 200% text enlargement was tested separately from native browser zoom.

## Elevation & Depth

The trade panel has a subtle `0 6px 24px #262a2207` shadow. Other content is flat, grouped by spacing, neutral surfaces and borders. The active trade-direction button uses a 1px inset control-boundary shadow. No modal overlays, floating balances, tooltip dependencies or sticky chrome exist.

## Shapes

Shared panel radius `--radius: 12px`. Trade panel is 20px with 28px padding, reducing to 16px/20px on narrow screens. Fields use 7px; buttons 8px; segmented container 10px with 7px children. Badges are pill-shaped. The 20/30/50 split is a three-column CSS bar with outer end radii; it is explicitly labeled as the nominal split with a supplied interface address.

## Components

The page is composed as patterns in `App.tsx`, not an exported component library.

| Pattern | Purpose and states |
| --- | --- |
| `.site-header`, `.wallet-controls` | Brand, testnet badge, provider selection, connect/disconnect; wrong-chain switch sits beside the trade prerequisites. |
| `.flow-panel`, `.split-columns` | Immutable split explanation, live lifetime totals, spot price and last-read block; loading, error and retry states. |
| `.trade-panel`, `.segmented` | Native buttons with `aria-pressed` select buy/sell. Form fields have visible labels, specific hints, invalid state and focus-to-error behavior. |
| `.advanced` | Native details/summary exposes the optional fee recipient, with browser keyboard behavior. |
| `.quote-box` | Estimated output, block, expiry, router limitation, exact approval step or confirm action. Quotes disappear when inputs change. |
| `.transaction-region`, `.error` | Stable polite status plus persistent error alert; submitted transaction links stay visible if receipt waiting fails. |
| `.action-card` | Claim/donate/burn with current bucket, consequences and disabled eligibility state. |
| `.table-scroll` | Latest FeeSplit events, meaningful column headers, explicit scan progress/error/empty state, explorer links. |
| `.deployment-details` | Native disclosure for full addresses, ABIs, supply, pool ID and runtime manifest. |

Buttons have at least 44px height. A 2px focus perimeter with 4px offset is applied to keyboard focus; forced colors uses `Highlight`. The skip link reveals itself on keyboard focus and targets the main landmark. Error announcements and dynamic wallet/transaction state use appropriate alert/status roles. No custom keyboard widget or focus trap is needed.

Pointer hover is gated by `(hover: hover)`. The only motion is a 120ms button background/transform transition and `.96` press scale, inside `prefers-reduced-motion: no-preference`. Reduced motion removes the transitions. No entrance animation, theme animation, autoplay or animated fee numbers.

## Do's and Don'ts

- Reuse `.wrap`, `.section-heading`, semantic color tokens and native form controls for another section. Keep headings in the existing h1/h2/h3 hierarchy.
- Keep one filled primary action in the active trade step. Use neutral controls for refresh and payout actions.
- Load deployment data through `src/config.ts`. Never introduce a second address or ABI map in a component.
- Show unknown values as a dash and failed reads as unavailable. Do not present fabricated balances or an incomplete scan as complete history.
- Keep consequences and prerequisites next to their action. Never label a PoolSwapTest estimate as a guaranteed minimum output.

This documentation follows the pinned Better Interface/Impeccable method; see `ATTRIBUTION.md` for provenance and retained licenses. Unperformed assistive-technology/native-device checks are recorded in `VALIDATION.md`, not inferred from screenshots.
