# Buy-bonus cards redesign + feature activation

**Date:** 2026-06-16
**Area:** `@energy8platform/platform-core` → `src/shell` (renderer-agnostic DOM game shell)
**Status:** approved, implementing directly (no separate plan)

## Goal

Replace the flat buy-bonus cards with a premium, art-forward "feature buy" menu in the
Hacksaw / Twist / Terminal idiom, and make buying flow through a confirmation step.
Distinguish two option kinds — **bonus** (buy into a bonus round) and **feature**
(a base-game modifier like Ante Bet) — with different button text/colour, and wire
feature activation into the control bar.

Reference: Hacksaw-style feature-buy grid (centered cards, transparent art, lightning
volatility, big price, full-bleed CTA, affordable vs. greyed states).

## Data model (`types.ts`)

```ts
export interface BonusOption {
  id: string;
  type?: 'feature' | 'bonus';     // default 'bonus' — drives button label + accent
  title: string;                  // RENAMED from `name`
  description: string;
  thumbnail?: string;             // transparent art image (no background plate)
  volatility?: 1 | 2 | 3 | 4 | 5; // rendered as ⚡ lightning, optional
  priceMultiplier: number;        // card price = priceMultiplier × current bet, in currency
  accentColor?: string;           // RE-ADDED — per-option accent override
}
```

**Accent resolution** (`colors.ts`): `effectiveAccent = accentColor ?? (type === 'feature' ? GOLD : PURPLE)`
where `PURPLE = #8b5cf6`, `GOLD = #f0b429`. Button text colour is derived from the accent's
luminance (`contrastText` → dark on light accents, white on dark). Non-hex accents → white text.

**State (`ShellState`):** add `activeFeature: BonusOption | null` (the currently activated feature).

**Events (`ShellEvents`):** add
- `featureActivate: { id: string }`
- `featureDeactivate: { id: string }`

`buyBonusSelect: { id }` stays — emitted for a **bonus** purchase after confirmation.

## Card anatomy & layout

Strict vertical order, **centered**, **flat colours only (no gradients)**:

```
TITLE            (accent colour, uppercase, 800)
THUMBNAIL        (transparent art; flat placeholder w/ gift icon if absent)
DESCRIPTION
── flex spacer ──   (description sits at top; the block below is pinned to the bottom)
VOLATILITY       (⚡ lightning, N filled in accent of 5, dim remainder)
PRICE            (white, bold, tabular; = priceMultiplier × bet)
BUTTON           (full-bleed, flush to card's bottom edge, rounded bottom corners)
```

- Grid: `repeat(auto-fit, minmax(240px, 1fr))` inside the 600px overlay body → ~2 per row.
- `volatility` + `price` are pinned to the bottom via a flex spacer so they align across
  cards of differing description length.
- **Price up to 1 000 000 000**: `white-space:nowrap`, tabular-nums, sized to fit a 2-col card;
  card `overflow:hidden` as a safety.
- Button label by type: **bonus → `Buy`**, **feature → `Activate`**.

### States

- **Affordable** (`price ≤ balance`, `buyBonusEnabled`, not busy): button in `effectiveAccent`,
  subtle accent glow on the card.
- **Unaffordable / disabled** (`price > balance`, or `!buyBonusEnabled`, or busy): grey button,
  card dimmed (`opacity:.62`), not clickable.

## Confirmation modal ("modals in card style")

Clicking an affordable card opens a confirmation rendered with the same card visual on the
shared frosted `.ge-sheet` backdrop:

- Shows the bonus card body (title / thumbnail / description / volatility / price).
- Footer = two buttons: **Cancel** (neutral) + **Buy/Activate** (`effectiveAccent`).
- Confirm:
  - `bonus` → `emit('buyBonusSelect', { id })`, close.
  - `feature` → activate (see below), `emit('featureActivate', { id })`, close.
- Cancel / backdrop click → close confirm, return to the overlay grid.

`data-ge` hooks: card `bonus-card-<id>`, CTA `bonus-cta-<id>`, confirm root `bonus-confirm`,
confirm buy `bonus-confirm-buy`, confirm cancel `bonus-confirm-cancel`.

## Feature activation (control bar)

When a **feature** is active (`state.activeFeature != null`):

1. **BET readout** shows the *effective* stake `bet × priceMultiplier`, tinted with the
   feature's `effectiveAccent` (gold by default). Base `state.bet` is unchanged; the displayed
   value reverts when the feature is disabled.
2. **BUY BONUS button → `DISABLE`**, tinted with the feature accent. Clicking it deactivates:
   `state.activeFeature = null`, `emit('featureDeactivate', { id })`, re-render (BET reverts,
   button returns to `BUY BONUS`). It no longer opens the overlay while a feature is active.

Activation/deactivation live on `GameShell` (`activateFeature(option)` / `deactivateFeature()`),
called from the confirm handler and the bar button respectively.

## Files touched

- `src/shell/types.ts` — model, state, events.
- `src/shell/colors.ts` — **new**: `effectiveAccent`, `contrastText`, accent constants.
- `src/shell/state.ts` — `activeFeature: null` in initial state.
- `src/shell/components/BuyBonus.ts` — new card renderer, confirm modal, activation.
- `src/shell/components/BottomBar.ts` — effective bet tint, BUY BONUS↔DISABLE toggle.
- `src/shell/GameShell.ts` — `activateFeature` / `deactivateFeature`.
- `src/shell/shell.css.ts` — rewrite `.ge-bonus-*` card CSS; confirm actions; bet-feature tint; disable button.
- `examples/shell-demo/src/main.ts` — `name`→`title`, add `type`, log feature events.
- `tests/shell/*` — `name`→`title`; new confirm-flow + feature-activation tests.

## Out of scope

- Multi-level bonuses (the reference's carousel/pagination on "Net Boost 1..5").
- Restyling Settings/GameInfo overlays beyond the bonus flow (the card idiom is applied to the
  buy-bonus confirm; broader modal unification can follow).
