# Reel features as data-driven plan steps — design (slice 36)

Date: 2026-09-24. Branch: `feat/slot-webide-cordis` at `ef69af61` (slice 35).
Source: slice 35's debt 1 — the 13 legacy features (`packages/game-engine/src/
slot/features/`) were not forked.

## 0. What the legacy features are, and what this slice makes of them

The legacy features are DEMOS for the reel-lab playground, not a presentation
layer. Each `demo(ctx)` invents its own outcome — a random reel
(`ExpandingWild`), hard-coded values `[2, 3, 5]` on the first cells found
(`MultiplierSymbols`), the first three symbols (`StickySymbols`) — and their
config sections are mostly MATH: `chance`, `triggerThreshold`,
`respinsAwarded`, `jackpotTiers`, weighted `pool`s, `revealPool`,
`durationSpins`, `count: [min, max]`. Some animations do not even change the
board (`NudgeReels` shifts a reel and snaps it back).

In the engine the math lives in the Lua script and the mechanic, and a plan
carries its OUTCOME. So, decided with the user:

- **A feature is a plan step that carries data from the mechanic** — which
  reel expands, which cells reveal to what, which multiplier values land
  where — and the feature only ANIMATES it. Nothing here draws a random
  number or reads a math knob.
- **One step kind per feature**, registered in play-loop's existing `steps`
  registry (the way `reelStep` is). No new known kind, no second registry, no
  `feature { key }` dispatcher: a game's own feature is its own step handler,
  which the engine already supports.
- **Nine kinds, one slice.** `stacked` (board content of a `spinTo`),
  `reelModifier` (a math choice; its banner is a flow `show`), `holdAndSpin`
  (`sticky` + a counter in the flow) and `split` (a label with no mechanism in
  the legacy) are not features here.
- **No IDE preview generator** (`sample(board) → data`) in this slice.

## 1. Rules

- `packages/*` is not edited; the legacy `features/` is read as a reference
  for the animations only.
- Every fix carries a unit test in its package; the browser proof is §6's e2e.
- The row's config is presentation only (durations, easings, colours,
  `enabled`); every leaf has a default and a `.description()`, pinned by a
  walker test; the row fills its own defaults (the loader passes `{}`); `hot:
  true`.

## 2. Packages

| package | holds |
|---|---|
| `@energy8engine/reel-core` | new `src/fx/` — the animation primitives forked from `features/types.ts` (`cellCenter`, `rowStepOf`, `colStepOf`, `glowRing`, `pulseCell`, `floatLabel`, `morphSymbol`, `dropCell`, and a `moveCell` for `walkWild`), exported for game plugins too; `ReelSystem.onSpinStart(fn): () => void` (§4.3) |
| `@energy8engine/reels-features` (new) | row `features1`: the nine handlers, the persistent overlay layer, the schema |

`features1` goes into `e8-base` after `cascade1`. It `ctx.inject`s `reels`
and `steps` (the `reels-cascade` shape), so list order is not load-bearing.

## 3. The steps

Cells are `{ col, row }` (as in `playState`). A symbol is what `cellData()`
accepts (a number, a name, or a record — extras ride along).

| kind | data | what it shows | board after |
|---|---|---|---|
| `expandWild` | `reel: number`, `symbol`, `rows?: number[]` (default: the whole reel) | each row morphs to `symbol` top to bottom, a glow ring per cell, rings gone at the end | those cells = `symbol` |
| `walkWild` | `path: {col,row}[]` (≥ 2), `symbol` | `symbol` morphs in at `path[0]`, then moves cell to cell along the path; each cell it leaves is emptied | `path[last]` = `symbol`, the cells it left = empty |
| `dropWilds` | `cells`, `symbol`, `multiplier?: number` | `symbol` drops into each cell from above, staggered | those cells = `symbol` (+ `multiplier`) |
| `reveal` | `cells`, `symbol` | each cell flips/morphs to `symbol` together (mystery) | those cells = `symbol` |
| `transform` | `cells`, `to` | each cell morphs to `to` with a pulse | those cells = `to` |
| `multipliers` | `cells: {col,row,value}[]`, `total?: number` | each cell gets its multiplier badge and pulses, a `×value` label floats from it; `total` shown at the grid's centre | those cells carry `multiplier: value` |
| `sticky` | `cells`, `on: boolean` | `on`: a persistent ring on each cell; `off`: those rings go | unchanged |
| `giant` | `col`, `row`, `width`, `height`, `symbol` — or `clear: true` alone | one symbol view spanning `width×height` cells from `(col,row)`, the covered cells hidden, scale-in; `clear` re-shows them and drops the view, no animation | covered cells = `symbol`; the overlay persists until the next spin starts, or until a `giant { clear: true }` step (§4.3) |
| `nudge` | `reel`, `by: number` (±), `settled: Board column` | the reel's cells slide by `by` rows and land on `settled` | that reel = `settled` |

## 4. Behaviour

### 4.1 Data is checked

A handler checks its step against the live grid before animating anything: a
reel or cell outside the grid, an empty `cells`/`path`, a `giant` area that
does not fit, a `settled` column of the wrong length — each THROWS with a
message naming the step and the bad field. play-loop turns it into the
ordinary `step "<kind>" failed: …` diagnostic, and the board is untouched.

### 4.2 The board ends where the data says

Every handler ends by re-seating the board with the changed cells through
the reels board's `refill` path (cheap since F9: only changed cells rebuild),
so `ctx.board`, `__e8.symbols()` and the screen agree, and the symbols row's
`bind` sees the new cell data.

### 4.3 Persistent overlays

The core's `fx` layer is swept on the first skip of a run, so the rings of
`sticky` and the `giant` overlay live on the row's own layer above the cells.

- `sticky` rings persist across spins (free spins, hold-and-spin locks) until
  a `sticky { cells, on: false }` names them.
- A `giant` overlay persists until the next spin starts, or until a
  `giant { clear: true }` step names it: `reel-core`'s `ReelSystem` gains
  `onSpinStart(fn): () => void`, fired at the start of `spin()`; the row
  clears every giant on it and re-shows the covered cells — the same thing
  `giant { clear: true }` does mid-plan. A mechanic that plays `tumble`,
  `reelStep`, or `refill` over a giant's area later in the same plan emits
  the clear step first, so the screen never disagrees with the board.

### 4.4 Skip and turbo

- `skip()` jumps to the end state at once: board re-seated, persistent rings
  and giants in their final place, transient rings and labels gone.
- `turbo` halves every duration (the `tumble` rule).

## 5. The row

`features1` config: one section per kind — `enabled` (default `true`) and its
presentation knobs (durations, easings, ring/label colours) with the legacy
demos' values as defaults where they had one. A kind whose `enabled` is
`false` is not registered (a step of that kind is then the ordinary
unknown-kind diagnostic). The row registers inside `ctx.effect` under
`ctx.inject(['reels'])` / `ctx.inject(['steps'])`; dispose takes every
registration, the layer and the `onSpinStart` listener back.

## 6. Tests

- `reel-core`: the forked `fx` primitives keep the legacy behaviour (one test
  each where the legacy had none: `morphSymbol` ends at scale 1 with the new
  data, `glowRing`'s disposer removes the ring); `onSpinStart` fires at the
  start of `spin()`, and its disposer unhooks.
- `reels-features`, per kind: valid data → the board after matches §3's
  column; each invalid-data case throws its message and leaves the board;
  `skip()` mid-animation → the end state; `turbo` → half the duration. Plus:
  `sticky` survives a spin and `off` removes it; `giant` clears on the next
  spin start. Row: registration/dispose, `enabled: false`, `{}` → defaults,
  the schema walker.
- e2e: a fixture mechanic written into the spec's project copy emits all
  nine kinds with fixed data; the browser case asserts the board after each
  (`__e8.symbols()`), no diagnostics, a `sticky` ring still present after
  the next spin, and the `giant` gone after it — the overlays read through a
  new `__e8` hook over the row's layer (both `main.ts` copies byte-identical;
  no hook drives a play — `flow.spec`'s rule).

## 7. Not here

- `stacked`, `reelModifier`, `holdAndSpin`, `split`.
- A preview generator for the IDE.
- Wiring a feature into `first-slot`'s own math.
