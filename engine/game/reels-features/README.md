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
| `dropWilds` | `cells`, `symbol`, `multiplier?` | those cells = `symbol` (+ `multiplier`) |
| `reveal` | `cells`, `symbol` | those cells = `symbol` |
| `transform` | `cells`, `to` | those cells = `to` |

The `features1` row that registers them — `src/runtime.ts` / `src/schema.ts`, where the `e8` block
points — is still to come.
See `docs/superpowers/specs/2026-09-24-reel-features-design.md`.

**Build first on a fresh clone** — like reel-core, this imports `@energy8platform/game-engine/animation`,
which resolves to the BUILT `packages/game-engine/dist`:

```bash
npm run build --workspace @energy8platform/game-engine
```
