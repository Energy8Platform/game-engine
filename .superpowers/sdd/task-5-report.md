# Task 5 Report: spec-slot end-to-end via createSlotGame

## What was added

- `examples/spec-slot/GameScene.ts` (new) — trivial `Scene` subclass extending `@energy8platform/game-engine/core`, empty `onEnter`.
- `examples/spec-slot/main.ts` (new) — calls `createSlotGame` from `@energy8platform/game-engine/host` with `{ model, scene, manifest, design, fonts, textureDefaults, dev }`.
- `examples/spec-slot/package.json` (modified) — added `"@energy8platform/game-engine": "*"` and `"pixi.js": "^8.16.0"` to `devDependencies`.
- `examples/spec-slot/tsconfig.json` (modified) — added `"exclude": ["dev.config.ts"]` (see below).

## tsc --noEmit result

PASS (exit 0, no output).

## smoke result

PASS — `npm run smoke --workspace spec-slot-example` ended with `SMOKE PASS`.

## import.meta cast needed?

Yes. The tsconfig does not include Vite's `ImportMetaEnv` augmentation (plain `moduleResolution: Bundler` with `"types": ["node"]`), so `import.meta.env` doesn't typecheck as-is. Applied the brief's documented minimal fix: `(import.meta as any).env?.DEV ?? false`.

## dev.config.ts exclusion

A pre-existing TS4082 error was present in `dev.config.ts` (confirmed by stashing our changes and re-running tsc):

```
dev.config.ts(12,1): error TS4082: Default export of the module has or is using private name 'GameDefinition'.
```

`GameDefinition` is defined in `platform-core/src/lua/types.ts` and used as a property type on `GameModel` in `game-spec/types.ts`, but is NOT re-exported from `@energy8platform/platform-core/game-spec`. When `dev.config.ts` exports `{ gameDefinition: model.gameDefinition }`, TypeScript sees a private name leak.

`dev.config.ts` is a Node runtime DevBridge config (imports `node:fs`, `node:path`, `node:url`) — not a bundled browser file. Excluding it from tsconfig is the correct scope fix.

Note: this was NOT caused by Task 5 changes.

## Concerns

- `GameDefinition` should ideally be re-exported from `@energy8platform/platform-core/game-spec` so `dev.config.ts` can be typechecked too. Minor platform-core cleanup, not a Task 5 issue.
- No real type mismatches found between `createSlotGame`'s `CreateSlotGameOptions` and `GameModel`/`SceneConstructor` — integration is clean.

## Commit

`d9ab5b7` — docs(examples): spec-slot boots via createSlotGame host

---

## Fix note: TS4082 resolved — GameDefinition types re-exported from game-spec

**Root cause:** `GameDefinition`, `ActionDefinition`, `TransitionRule`, and `MaxWinConfig` were defined in `packages/platform-core/src/lua/types.ts` but not re-exported from the `@energy8platform/platform-core/game-spec` public entry. When `dev.config.ts` default-exports `{ gameDefinition: model.gameDefinition }`, TypeScript's declaration emit sees a private name leak (TS4082).

**Fix applied:**

Added to `packages/platform-core/src/game-spec/index.ts`:
```ts
export type { GameDefinition, ActionDefinition, TransitionRule, MaxWinConfig } from '../lua/types';
```

Removed the `"exclude": ["dev.config.ts"]` workaround from `examples/spec-slot/tsconfig.json` — dev.config.ts is now fully typechecked.

**Types re-exported:** `GameDefinition`, `ActionDefinition`, `TransitionRule`, `MaxWinConfig`

**Evidence:**
- `cd examples/spec-slot && npx tsc --noEmit` → exit 0, no output (dev.config.ts included)
- `npx vitest run packages/platform-core/tests/game-spec/` → 25 tests passed (5 files)
- `npm run smoke --workspace spec-slot-example` → SMOKE PASS

**Commit:** `fix(platform-core): re-export GameDefinition types from game-spec so dev.config typechecks`
