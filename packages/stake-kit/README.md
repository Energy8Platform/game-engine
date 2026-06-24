# @energy8platform/stake-kit

The Stake-side toolkit for an Energy8 slot game: a generic **book adapter** that teaches
`@energy8platform/stake-bridge` how to slice a round-book into per-spin segments, plus a **dev
harness** (a Vite plugin) that runs the game against a local dev-RGS backed by the curated math
books — so you can play, buy bonuses, and replay rounds without a live Stake session.

## Sub-paths

- `@energy8platform/stake-kit` — the browser-safe adapter toolkit (`createGameAdapter`,
  `coerceLuaArrays`, `deriveArrayFields`, types). No Node/Vite.
- `@energy8platform/stake-kit/harness` — the Node-only dev harness Vite plugin (`stakeHarnessPlugin`).
  Dev-only (`apply: 'serve'`); never bundled into the browser build.

## Book adapter

```ts
import { createGameAdapter } from '@energy8platform/stake-kit';
import { model } from '../game.spec';
import { spinSchema } from '../game/schema';

export const adapter = createGameAdapter({
  model,
  schema: spinSchema,
  segmentOf: ({ event, payload, round }) => ({
    action: event.type === 'free_spin' ? 'free_spin' : round.triggerAction,
    winX: payload.total_win ?? 0,
    session: { roundId: round.roundId },
  }),
});
```

`splitRound` reads the canonical Stake book event shape (`{ type, spin }`), runs each payload through
the schema + `coerceLuaArrays` (Lua `{}` → `[]`), and emits one `BookSegment` per event so the
bridge can stream a bonus segment-by-segment. `resumeFrom` rewinds a mid-bonus reload to the first
free spin.

## Dev harness

`vite.config.ts` (in a scaffolded game):

```ts
import { defineGameConfig } from '@energy8platform/game-engine/vite';
import { stakeHarnessPlugin } from '@energy8platform/stake-kit/harness';

export default defineGameConfig({
  base: './',
  vite: { plugins: [stakeHarnessPlugin({ config: './math.config.ts', booksDir: 'stake-math' })] },
});
```

`npm run stake` then serves an iframe wrapper (control bar: social toggle, currency, screen presets,
replay) around the game, and mounts a **dev-RGS** at `/__rgs/*` implementing the Stake RGS contract
(`authenticate` / `play` / `end-round` / `event` / `replay`). Outcomes are picked from the curated
books (`stake-math/`); a mode with no books falls back to running the game's Lua (`LuaEngine`),
driving the full free-spins session so a bonus plays out as one multi-segment round.

## Related packages

- `@energy8platform/stake-bridge` — the host bridge that speaks Stake's RGS and consumes the adapter.
- `@energy8platform/stake-math-tools` — produces the `stake-math/` books the harness reads.
- `@energy8platform/create-slot` — scaffolds a game wired to all of the above.
