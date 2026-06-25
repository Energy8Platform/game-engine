# Spec A — Scaffold & CLI

**Date:** 2026-06-25
**Status:** Approved (brainstorm), pending implementation plan
**Package:** `@energy8platform/create-slot`

## Goal

Two small, independent improvements to the game scaffolder:

1. Let the user choose the **target directory** independently of the game id.
2. Scaffold the engine's **hidden optional peer-deps** (`@pixi/sound`, `@esotericsoftware/spine-pixi-v8`) so audio and Spine work out of the box.

These are mechanical and have no dependency on Spec B.

## Current state

- [`packages/create-slot/src/cli.ts:18`](../../../packages/create-slot/src/cli.ts) computes the target as `resolve(process.cwd(), answers.id)`. The destination folder **is** the game id, in the current working directory. There is no way to scaffold into a differently-named or nested path.
- The generated `package.json` ([`packages/create-slot/src/codegen/packageJson.ts:32`](../../../packages/create-slot/src/codegen/packageJson.ts)) ships `platform-core`, `game-engine`, `stake-kit` (+ `stake-bridge` when `--stake`), `pixi.js`, `zod`. It does **not** include `@pixi/sound` or `@esotericsoftware/spine-pixi-v8`. Both are declared `optional` in the engine's `peerDependenciesMeta`, with no version range in `peerDependencies` — the engine's own `devDependencies` pin `@pixi/sound: ^6.0.0` and `@esotericsoftware/spine-pixi-v8: ~4.2.0`.

## Design

### 1. Target directory (`--dir`)

- Keep the positional argument as the **game id** (unchanged, still kebab-case validated, still promptable).
- Add a `--dir <path>` flag for the **target directory**. It accepts a relative or absolute path and resolves against `process.cwd()`.
- Default (no `--dir`) stays `resolve(process.cwd(), answers.id)` — fully backward compatible.
- The `--id` override flag (if present today) keeps working orthogonally.

Examples:

| Command | id | target dir |
|---|---|---|
| `create-slot my-game` | `my-game` | `./my-game` (unchanged) |
| `create-slot my-game --dir games/cosmic` | `my-game` | `./games/cosmic` |
| `create-slot my-game --dir /tmp/foo` | `my-game` | `/tmp/foo` |

**Guard:** before generating, if the resolved target directory exists **and is non-empty**, abort with a clear error (e.g. `Target directory <path> already exists and is not empty.`) and a non-zero exit. Today there is no such check — a scaffold can silently write over existing files.

`--dir` is parsed in the `seedFromArgv`/argv layer alongside the other flags. The final `dir` passed to `generate()` becomes the resolved `--dir` value when supplied, else `cwd/id`. The CLI success message echoes the actual directory (it already prints `at ${dir}`) and the `cd` hint uses that path.

### 2. Scaffold hidden peer-deps

Add to the generated `package.json` `dependencies`, **always** (not gated behind a flag):

```json
"@pixi/sound": "^6.0.0",
"@esotericsoftware/spine-pixi-v8": "~4.2.0"
```

Versions match the engine's own `devDependencies` ranges so a scaffolded game resolves the same major as the engine was built against. Rationale for always-include: it removes the "why is there no sound / why does Spine throw" first-run friction; the size cost is acceptable for a starter game.

There is a create-slot test that asserts the scaffolded `@energy8platform/*` versions match the workspace. These two are third-party, not workspace packages, so that test is unaffected; if a test pins the full dependency set, update its expectation to include the two new keys.

## Out of scope

- Auto-running `npm install` (still left to the user, unchanged).
- Gating Spine behind a `--spine` flag (considered and rejected — always-include chosen).

## Testing

- Unit: `seedFromArgv` parses `--dir` (relative, absolute, absent).
- Unit: target-dir resolution (`cwd/id` default vs explicit `--dir`).
- Unit: non-empty-directory guard rejects and the empty/new case proceeds.
- Unit: generated `package.json` contains both new deps with the pinned ranges.
- Snapshot/codegen test for `packageJson.ts` updated to include the two keys.
