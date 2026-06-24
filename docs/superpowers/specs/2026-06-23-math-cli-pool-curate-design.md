# Math-CLI (e8-math): go-native pool → curate from spec modes — Design (slice 8)

Date: 2026-06-23. Branch: `feat/game-spec-define-game` (continuing).

**Goal:** one shared, versioned CLI (`e8-math`) that, from a game's spec modes, runs go-native simulation (`sim` = aggregates only, `pool` = dump raw books) and curation (`curate` = compress books → Stake lookup tables) with full per-mode configuration and full reports — replacing the bespoke `sim.ts`/`stake-math.ts`/`stake-optimize.ts` each game hand-rolls. The scaffold emits `sim`/`pool`/`curate`/`math` scripts driven by the spec.

**Decisions (from brainstorming):**
- **go-native only — NO JS fallback** in the math path. Pool/sim use the Go binary (`NativeSimulationRunner`); if the native binary is absent → hard error with install instructions (never fall back to the fengari `SimulationRunner`).
- The Go binary already supports per-round book dumps via its `-dump <path>` flag (JSONL, `.gz` optional) — "raw input for outcome book transformers." We do NOT touch the Go source (it's a separate GitHub-Releases build); we surface `-dump` through `NativeSimulationRunner`.
- Curation already exists in `@energy8platform/stake-math-tools` (`optimizeLookupTable`, tiered/nnls, `transformJsonlZst`, `computeStakeReport`/`detectHitRateGaps`) — the CLI orchestrates it.
- The CLI is a **bin in `stake-math-tools`** (`e8-math`), which gains a `@energy8platform/platform-core` dependency (for `NativeSimulationRunner`) + a build.
- Subcommands: **`sim | pool | curate | all`**. `sim` = full aggregate math, NO books written. `pool` = `-dump` raw books (+ same aggregates). `curate` = books → lookup tables. `all` = pool + curate.
- **Full output**: sim/pool print the entire `GoSimulationOutput` (RTP, hit-freq, max-win + hits, per-stage stats, win-distribution, speed/workers); curate prints the entire stake report (`computeStakeReport`/`OptimizeResult`/`detectHitRateGaps`: achieved RTP/CV/hit-rate, tolerance, hit-rate buckets + gaps, top-K share, refinement stats, table size).
- **Full per-mode config for sim AND curate** via a generated `math.config.ts`: each mode has a `sim` block (iterations, bet, rng, seed?, params?) and a `curate` block (capMaxWin, algorithm, target RTP/volatility/hit-rate, tolerances, tableSize → `OptimizeParams`). The **mode list + action/cost come from the spec** (`model.mathModes` — single source); `math.config` holds the tuning, seeded from the spec (capMaxWin←spec.maxWin, action/cost←mathModes).

## Motivation

Every existing slot hand-rolls its math pipeline (`Stone-Rush/scripts/{sim,stake-math,stake-optimize}.ts`, kitsune, …) producing `books_<MODE>.jsonl.zst` + `lookUpTable_<MODE>_0.csv` + `index.json` — copy-pasted, drifting per game. The user's #6 feedback: "the scaffold has no pre-configured pool/curate scripts; they should come from one place, a math-CLI." The two engines already exist (platform-core sim with `-dump`; stake-math-tools curation); this slice is the **orchestration + spec-modes wiring + scaffold scripts**, go-native, fully configurable per mode.

## Principle

The spec is the single source of *which* modes exist (`model.mathModes`). `math.config.ts` is the math-team tuning of *how* each mode is simulated/curated (kept out of the game-design spec). The Go binary does the simulation (with `-dump` for books); `stake-math-tools` does the curation. `e8-math` is a thin orchestrator over both, go-native, with full reports.

## Piece 1 — platform-core: `NativeSimulationRunner` book dump + require-native

`packages/platform-core/src/simulation/NativeSimulationRunner.ts`:
- Add `dump?: string` (and `dumpGzip?: boolean`, or infer `.gz` from the path) to `NativeSimulationConfig`. When set, the args builder pushes `-dump <path>` so the binary writes per-round JSONL. The run still returns the full `GoSimulationOutput` (the binary dumps to the file AND prints aggregate JSON).
- Add an exported helper `requireNativeBinary(): string` — calls `findNativeBinary()`, throws a clear error ("native simulation binary not found; run `npm install` / it is fetched by platform-core's install-simulate postinstall") if null. The math path uses this — **no JS/`SimulationRunner` fallback**.
- No other behavior change; the existing JS `SimulationRunner` stays available for non-math uses but is never used by `e8-math`.

## Piece 2 — stake-math-tools: the `e8-math` CLI

`packages/stake-math-tools/`:
- `package.json`: add `"bin": { "e8-math": "dist/cli.js" }`, a `build` (rollup → `dist/cli.js` with `#!/usr/bin/env node` banner) + the `files: ["dist"]`, and `"dependencies": { "@energy8platform/platform-core": "<workspace>" }` (for `NativeSimulationRunner`).
- `src/cli.ts` + `src/pipeline/{sim.ts, pool.ts, curate.ts, loadConfig.ts, report.ts}`:
  - `sim` — for each mode (or `--mode <M>`): `requireNativeBinary()` → `new NativeSimulationRunner({ script, gameDefinition, action, bet, iterations, rng, seed, params }).run()` (NO `dump`) → print the full `GoSimulationOutput` report. No files written.
  - `pool` — same but with `dump: stake-math-pool/books_<MODE>.jsonl` (raw books) → print the same aggregates.
  - `curate` — read `stake-math-pool/books_<MODE>.jsonl` via a `LineMapper` → `LookupRow[]` (payout from the dumped round), `optimizeLookupTable(rows, modeCurateParams)` → write `stake-math/lookUpTable_<MODE>_0.csv` + `transformJsonlZst` → `stake-math/books_<MODE>.jsonl.zst` + update `index.json`; print the full `computeStakeReport` + `detectHitRateGaps`.
  - `all` — `pool` then `curate` per mode.
  - `loadConfig`: loads a single **node-only** `math.config.ts` (via `--config ./math.config.ts`) → `{ model, luaScript, modes }`. `gameDefinition` = `model.gameDefinition`; the mode list = `model.mathModes` (the spec SSOT); per-mode params = `modes` (seeded defaults for any mode missing a block). The CLI does **not** load the game's `dev.config.ts` — that file is browser-only (Vite `?raw`, slice 6) and won't load in node; `math.config.ts` is its node-side counterpart (reads the Lua via `node:fs` + `buildLuaScript`).

## Piece 3 — `math.config.ts` (per-mode sim + curate config)

A generated, **node-only** config the author tunes; the mode list derives from the spec:
```ts
import { readFileSync } from 'node:fs';
import { buildLuaScript } from '@energy8platform/platform-core/game-spec';
import { model } from './src/game.spec';
import type { MathConfig } from '@energy8platform/stake-math-tools';

// Runs in node (the CLI), so node:fs is fine — unlike the browser dev.config (Vite ?raw).
const logic = readFileSync(new URL('./src/game/script.logic.lua', import.meta.url), 'utf8');

const config: MathConfig = {
  model,                                   // gameDefinition + mathModes (the SSOT mode list)
  luaScript: buildLuaScript(model, logic), // node-built from the model + the logic Lua
  modes: {
    BASE: {
      sim:    { iterations: 1_000_000, bet: 1, rng: 'provably-fair' },
      curate: { capMaxWin: model.spec.maxWin, algorithm: 'tiered', targetRtp: 0.96 /* tolerances, tableSize … */ },
    },
    // one block per spec mode (ANTE, BUY_BONUS, …) — scaffold seeds defaults from the spec
  },
};
export default config;
```
`MathConfig = { model, luaScript, modes }`; `ModeMathConfig = { sim: NativeSimConfig, curate: OptimizeParams & { capMaxWin } }` — types live in `stake-math-tools`. Modes present in `model.mathModes` but missing a `modes` block fall back to seeded defaults (`action`/`cost` from `mathModes`, `capMaxWin` from `spec.maxWin`).

## Piece 4 — full reporting

`src/pipeline/report.ts` formats:
- **sim/pool**: the entire `GoSimulationOutput` per mode — total RTP, hit frequency, max-win + hits, `per_stage_stats`, `win_distribution`, speed, workers, duration.
- **curate**: the entire `OptimizeResult`/`StakeReport` per mode — achieved RTP/CV/hit-rate vs target, `toleranceMet`, hit-rate buckets + `detectHitRateGaps`, top-K weight share, refinement stats, final row count. (All already produced by `stake-math-tools`; the CLI surfaces them, doesn't recompute.)

## Piece 5 — scaffold

`packages/create-slot`:
- `codegen/mathConfig.ts` (new): `genMathConfig(answers)` emits `math.config.ts` with one `modes` block per spec action (sim defaults + curate `capMaxWin: maxWin`), importing the model.
- `generate.ts`: write `math.config.ts`.
- `codegen/packageJson.ts`: replace the single `simulate` script with `sim`/`pool`/`curate`/`math` scripts calling `e8-math` against the node-only math config — `"sim": "e8-math sim --config ./math.config.ts"`, `"pool": "e8-math pool --config ./math.config.ts"`, `"curate": "e8-math curate --config ./math.config.ts"`, `"math": "e8-math all --config ./math.config.ts"` — and add `@energy8platform/stake-math-tools` to devDependencies. The native binary arrives via platform-core's `install-simulate` postinstall (platform-core is already a dep).

## Artifacts / data flow

```
spec modes (model.mathModes)        math.config.ts (per-mode sim+curate)
        └──────────────┬───────────────────┘
                       ▼
   e8-math pool   →  NativeSimulationRunner({dump}) [go-native, -dump]  →  stake-math-pool/books_<MODE>.jsonl
   e8-math curate →  read books → optimizeLookupTable → stake-math/{lookUpTable_<MODE>_0.csv, books_<MODE>.jsonl.zst, index.json}
   e8-math sim    →  NativeSimulationRunner() [no dump]  →  full aggregate report (no files)
```

## Module boundaries

| Unit | Package | Change |
|------|---------|--------|
| `NativeSimulationRunner.dump?` + `requireNativeBinary()` | platform-core/simulation | small add |
| `e8-math` CLI (`sim/pool/curate/all`) + pipeline + `MathConfig` types + bin/build | stake-math-tools | new (+ dep platform-core) |
| `genMathConfig` + `math.config.ts` write + pool/curate/sim scripts in package.json | create-slot | new/change |

## Testing

- **platform-core:** `NativeSimulationRunner` builds `-dump <path>` into the args when `dump` is set (assert the arg vector — no binary needed); `requireNativeBinary()` throws when `findNativeBinary()` is null. A real dump-run is gated on the binary being present (skip-with-note otherwise; the binary is fetched in CI via postinstall).
- **stake-math-tools:** the curate glue on a **static sample-dump fixture** (binary-independent: a small `books.jsonl` → `LineMapper` → `optimizeLookupTable` → assert `lookUpTable.csv` + a valid `computeStakeReport`); `loadConfig`/mode-seeding from a fixture model; CLI arg-parsing (`sim/pool/curate/all`, `--mode`, `--config`, `--math`). A binary-gated `all` e2e on a trivial model (skip-with-note if absent).
- **create-slot:** `genMathConfig` emits a block per spec mode with `capMaxWin = maxWin`; `package.json` has `sim`/`pool`/`curate`/`math` scripts + the `stake-math-tools` devDep; `generate` writes `math.config.ts`; the anti-drift scaffold smoke stays green.

## Out of scope (YAGNI / separate)

- Touching the Go source (the binary already `-dump`s; it's a separate release).
- A parallel/JS pool (the Go binary is already multi-threaded; no JS fallback by decision).
- Game-specific book field-trimming/`criteria` beyond a default `LineMapper` + an optional hook (a game tunes its mapper later).
- Migrating the existing games' bespoke math scripts.

## Risks / open items

- **Dump row shape:** the exact JSONL shape the binary writes per round (the curate `LineMapper` input) must be pinned from a **real sample dump** in the curate task (run the binary `-dump` on a trivial model, inspect a line) — the design assumes a per-round object carrying the payout; the mapper extracts `payout_cents`/`sim_id`.
- **stake-math-tools gains a build + platform-core dep:** it's currently a pure, dep-free, no-build library (`main: src/index.ts`). Adding a `bin`/`dist` build + a platform-core dependency is a real package change; keep the curate *library* exports import-clean (the CLI is the only part that pulls platform-core).
- **CI needs the native binary** for the binary-gated tests; the binary-independent tests (arg vector, curate-on-fixture, config seeding) cover the logic without it.
- **Currency/units:** `payoutMultiplier`/`payout_cents` convention between the dump and `optimizeLookupTable` must match the games' (integer cents-of-base-bet, identity with the CSV payout column) — pin alongside the dump shape.
- **Loading the `.ts` math.config at runtime:** `math.config.ts` is TypeScript; `e8-math` must load it with a TS loader. The existing `platform-core-simulate` bin runs under `#!/usr/bin/env npx tsx` for exactly this. `e8-math` should do the same (run under tsx, or use `jiti`/esbuild-register to import the `.ts` config) — pin the mechanism in the plan. (`tsx` is already a devDep of generated games.)
