# @energy8engine/reels-features

Reel features as data-driven plan steps (slice 36). A feature step carries an OUTCOME the mechanic
already decided — which reel expands, which cells reveal to what — and its handler only animates it
and re-seats the board through the reels board's `refill`. Nothing here draws a random number or
reads a math knob.

Each kind is a play-loop `StepHandler` (`create<Kind>Handler(deps)`), built on `src/shared.ts`
(`checkCells`, `reseat`, `createPace`, `need`, `createFeatureHandler`); `src/layer.ts` is the
overlay layer for what outlives a run (sticky rings, giant symbols).

| kind | data | board after |
|---|---|---|
| `expandWild` | `reel`, `symbol`, `rows?` | those cells = `symbol` |
| `walkWild` | `path` (≥ 2 cells), `symbol` | `path`'s last cell = `symbol`, the cells it left = empty |
| `dropWilds` | `cells`, `symbol`, `multiplier?` | those cells = `symbol` (+ `multiplier`) |
| `reveal` | `cells`, `symbol` | those cells = `symbol` |
| `transform` | `cells`, `to` | those cells = `to` |
| `multipliers` | `cells: {col,row,value}[]`, `total?` | those cells carry `multiplier: value` |
| `sticky` | `cells`, `on` | unchanged (rings on the overlay layer until `on: false`) |
| `giant` | `col`, `row`, `width`, `height`, `symbol` — or `clear: true` alone | covered cells = `symbol` (the overlay stays until the next spin, or until a `giant { clear: true }` step) |
| `nudge` | `reel`, `by` (± rows), `settled` | that reel = `settled` |

The `features1` row (`src/runtime.ts` / `src/schema.ts`, where the `e8` block points) registers all
nine kinds into `playloop1`'s `steps` — composed in `e8-base` right after `cascade1`. One config
section per kind, each with its own `enabled` (default `true`), so a game can drop just `giant`
without dropping the row; a disabled kind's handler is not registered at all. The row also owns
the overlay layer above the cells (`src/layer.ts`) that `sticky` rings and the `giant` view live
on, cleared of any leftover giant at the start of every spin.
See `docs/superpowers/specs/2026-09-24-reel-features-design.md`.
