# @energy8platform/create-slot

Scaffolder for a new PixiJS slot game on the Energy8 `@energy8platform/game-engine` framework,
ready to run locally, test in the Stake dev harness, generate its math, and build for Stake Engine.

```bash
npm create @energy8platform/slot@latest my-game
# or
npx @energy8platform/create-slot my-game
```

It asks a few questions (id, title, mechanic, grid, …) and writes a complete, type-checking project.

## What it generates

| File | Role |
|---|---|
| `src/game.spec.ts` | **Single source of truth.** `defineGame(spec)` derives the Lua game definition, the `modeMap`, the math modes, the paytable, the shell's buy-bonus cards AND the Game Info per-mode table. Edit modes / symbols / bet levels / `rtp` / `maxWin` here. |
| `src/scenes/GameScene.ts` | The render-only scene: `present(result, ctx)` + optional `onBonusEnter`/`onBonusExit`. The host owns the play loop; the scene never calls play/ack. |
| `src/scenes/IntroScene.ts` | Tap-to-start splash (skipped on replay). |
| `src/game/script.logic.lua` | The game's math logic (returns a bet-multiplier `total_win`). |
| `src/game/normalize.ts` + `schema.ts` | Map the raw play result → the scene's typed `SpinData`. |
| `src/stake/adapter.ts` | The Stake book adapter (`createGameAdapter`) — slices a round-book into segments. |
| `math.config.ts` | Per-mode sim + curate tuning for the math pipeline (independent of the spec's declared rtp/maxWin). |
| `CLAUDE.md` | Guidance for Claude Code on how the project is wired and what the framework already handles. |
| `vite.config.ts` | Dev (DevBridge), the Stake harness, and the `build:stake` frontend target. |

## Workflow

```bash
npm install
npm run dev          # local dev via Energy8 DevBridge (config + Lua)
npm run stake        # Stake dev harness: iframe wrapper + dev-RGS backed by curated books
npm run math:pool    # Stage A — honest large simulation (the pool)
npm run math:curate  # Stage B — compress into the publishable stake-math/ bundle
npm run build:stake  # the Stake frontend build → dist-stake/
```

The framework handles the Stake integration end-to-end (RGS bridge, shell, play loop, bonus
segment-drain, resume, autoplay, social mode, jurisdiction, money formatting, the math pipeline).
You write the spec, the Lua math, and the rendering — see the generated `CLAUDE.md` for the full map.

## Related packages

- `@energy8platform/game-engine` — the PixiJS engine + host the game runs on.
- `@energy8platform/platform-core` — renderer-agnostic platform (Lua engine, shell, SDK session).
- `@energy8platform/stake-kit` — the Stake book adapter + dev harness used by the scaffold.
- `@energy8platform/stake-math-tools` — the `e8-math` simulation + curation pipeline.
