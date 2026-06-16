# Game Info redesign + keyboard spin + bet boundary disable

Date: 2026-06-16
Status: Approved (design)
Area: `@energy8platform/platform-core/shell`

## Summary

Three shell UX changes, shipped together:

1. **Game Info overlay redesign** — winning-line types, no-line cell highlighting,
   numbered captions, a card-based paytable, and a two-block Controls section.
2. **Spacebar → spin** — pressing Space triggers a spin, gated so it can't spam a
   running spin or fire while an overlay/modal is open.
3. **Bet boundary disable** — the `+`/`−` bet buttons disable when the stake is at
   the top/bottom of `availableBets`.

Touched files: `src/shell/types.ts`, `src/shell/components/GameInfo.ts`,
`src/shell/components/BottomBar.ts`, `src/shell/GameShell.ts`, `src/shell/shell.css.ts`,
`examples/shell-demo/src/main.ts`, and the affected tests under
`tests/shell/` (`gameinfo`, `bottombar`, plus new keyboard coverage).

## 1. Data model (`types.ts`)

### Paytable

The paytable renders as a grid of cards (image on top → name → win tiers). Each tier
reads `<count> x<multiplier>` (lowercase `x`, count may be a range like `4–5`). The
`wins[].label` field is renamed to `count` to match the new semantics:

```ts
export interface PaytableRow {
  symbol: { text?: string; image?: string }; // text = name shown under the image
  wins: Array<{ count?: string; multiplier: number }>;
}
```

### Win sections

The current `paylines` section is generalised to a `wins` section with a `kind`
sub-discriminator. One section = one win type ("type per section").

```ts
/** [col, row] — 0-based, row 0 = top. */
export type CellRef = [col: number, row: number];

export type WinSection = {
  type: 'wins';
  title?: string;
  order?: number;
  grid: { cols: number; rows: number };
  description?: string; // optional, applies to every kind
} & (
  | { kind: 'classic'; lines: Array<number[] | PaylineDef> }
  | { kind: 'cluster'; minCount: number; example?: CellRef[] }
  | { kind: 'anywhere'; minCount: number; example?: CellRef[] }
  | { kind: 'ways'; winExample?: CellRef[]; loseExample?: CellRef[] }
);
```

`GameInfoSection` replaces its `paylines` member with `WinSection`. `PaylineDef` is
unchanged.

`example` / `winExample` / `loseExample` are optional. When omitted, GameInfo draws a
default illustration:

- **cluster** — a connected blob of `minCount` cells near the grid's top-left.
- **anywhere** — `minCount` cells scattered across distinct columns.
- **ways** — `winExample`: one lit cell per column (a complete left-to-right chain);
  `loseExample`: the same with one middle column left empty (a broken chain).

All illustrations use the section's own `grid` dimensions (a game that is 1024-ways
passes `grid: { cols: 5, rows: 4 }`).

## 2. GameInfo rendering (`GameInfo.ts`)

A `wins` section dispatches on `kind`:

- **classic** — the existing mini-grid per line, with two changes: the `<polyline>` is
  removed (cells alone show the line, filled in the accent colour), and the caption is
  the line **number only**, placed **above** the grid (currently `Line N`, below).
- **cluster / anywhere** — a single grid. Off-pattern cells render dimmed (`dim`);
  example cells fill with the accent. A `min N` badge sits in the section header. The
  optional `description` renders beside/under the grid.
- **ways** — two grids side by side, tagged `✓ wins` and `✗ no win`.

Paytable rows render as cards (option B from the visual companion): symbol image on
top, `symbol.text` name below, then the win tiers as `<count> x<multiplier>`.

### Controls section — two blocks

The auto-generated Controls section splits into two labelled blocks:

- **Game controls** — Spin, Raise bet (`+`), Lower bet (`−`), Autoplay (if enabled),
  Turbo (if enabled), Buy bonus (if enabled). The previous single combined Bet row is
  split into two rows: one for raising, one for lowering.
- **Menu & info** — Menu, Sound (toggle), Info (`i`), Close (`×`).

Icons used (`soundOn`/`soundOff`, `info`, `close`, `plus`, `minus`) already exist in
`icons.ts`. Rows continue to honour the active-feature gating (`autoplay`, `turbo`,
`buyBonus`) for the gameplay block; the Menu & info block is always shown.

## 3. Spacebar → spin (`GameShell.ts`)

A `keydown` listener is added to `document` in the constructor and removed in
`destroy()`. It emits `spin` only when every condition holds:

- `event.code === 'Space'` and not `event.repeat`;
- the event target is not an editable element (`input`, `textarea`, `select`, or
  `contentEditable`) — protects the Settings sliders;
- `state.mode === 'base'`, `!state.busy`, `!state.autoplay.active`;
- no overlay/modal is open (`modalHost.childElementCount === 0`).

When the listener fires, it calls `event.preventDefault()` (stops page scroll) and
emits `spin` — the same path as clicking the spin disc. When any guard fails it does
nothing (no spam during a running spin, no fire under an open overlay).

## 4. Bet boundary disable (`BottomBar.ts`)

In `applyBusy`, after computing `lockBet`, also disable the steppers at the ends of the
bet range:

```ts
const i = state.availableBets.indexOf(state.bet);
disable('bet-up', lockBet || i >= state.availableBets.length - 1);
disable('bet-down', lockBet || i <= 0);
```

`stepBet` already clamps, so this only adds the disabled visual state at the bounds.

## Testing

- `gameinfo.test.ts` — extend for: paytable card rendering with `count`; each win
  `kind` (classic has no polyline + numbered caption above; cluster/anywhere `min N`
  badge + dimmed cells; ways renders two grids); two-block Controls with the split
  bet rows and the Sound/Info/Close rows.
- `bottombar.test.ts` — `bet-up` disabled at max stake, `bet-down` disabled at min
  stake, both enabled in the middle, and both disabled while busy/autoplay regardless.
- New keyboard coverage — Space emits `spin` in base/idle; does not emit while busy,
  while autoplay active, while a modal is open, on `repeat`, or when focus is in an
  input.
- `examples/shell-demo/src/main.ts` — migrate the `paylines` section to `wins`
  (`kind: 'classic'`), rename paytable `label` → `count`, and add one cluster/ways
  example section to exercise the new kinds.

## Out of scope

- No changes to the real bottom-bar control layout (the Controls "two blocks" is the
  Game Info documentation section, not the live bar).
- No new sound/info/close buttons on the live bar — those already exist via the menu /
  overlay chrome and are only being *documented* in the Controls section.
