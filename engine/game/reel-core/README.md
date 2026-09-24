# @energy8engine/reel-core

The engine's reel system: the grid, the forked motion/anticipation/cascade controllers and the
pluggable `ReelSystem` facade the `reels1`/`motion1`/`anticipation1`/`cascade1` rows register into.

**Build first on a fresh clone.** reel-core imports `@energy8platform/game-engine/animation`
(`Tween`, `Easing`), which resolves to the BUILT `packages/game-engine/dist` — not its `src`. Before
testing or typechecking reel-core (or any row that uses it), run:

```bash
npm run build --workspace @energy8platform/game-engine
```
