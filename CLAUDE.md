# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

This is an **npm workspaces monorepo** that publishes two packages:

```
game-engine/                          ← repo root, not published
├── package.json                      ← { "private": true, "workspaces": ["packages/*"] }
├── tsconfig.base.json                ← shared TS compiler options
├── packages/
│   ├── platform-core/                ← @energy8platform/platform-core
│   │   ├── src/{PlatformSession.ts, EventEmitter.ts, lua/, dev-bridge/, vite/, types.ts}
│   │   ├── tests/
│   │   ├── bin/simulate.ts           ← RTP simulation CLI
│   │   └── scripts/install-simulate.mjs
│   └── game-engine/                  ← @energy8platform/game-engine
│       └── src/{core/, animation/, audio/, assets/, debug/FPSOverlay, viewport/, input/, loading/, host/, slot/, types.ts, lua/, vite/}
└── examples/
```

### `@energy8platform/platform-core`

Renderer-agnostic. Contains everything platform-specific to Energy8 (Lua engine, DevBridge, RTP simulation, SDK session orchestration). Pair with PixiJS, Phaser, Three.js, DOM, or any custom engine.

Peer deps: `@energy8platform/game-sdk`, `fengari`, optional `vite`. **No pixi/react/DOM.**

Sub-paths:
- `@energy8platform/platform-core` — `createPlatformSession`, `LuaEngine`, `DevBridge`, branded `createCSSPreloader`, types
- `@energy8platform/platform-core/lua` — Lua-specific exports
- `@energy8platform/platform-core/dev-bridge` — DevBridge isolated
- `@energy8platform/platform-core/vite` — `devBridgePlugin`, `luaPlugin`
- `@energy8platform/platform-core/loading` — `createCSSPreloader`, `removeCSSPreloader`, `buildLogoSVG` (the Energy8 brand frame, renderer-agnostic)
- `@energy8platform/platform-core/shell` — `createGameShell`, `removeGameShell`, branded renderer-agnostic DOM game shell (control bar, menu, settings, game info, buy bonus)

### `@energy8platform/game-engine`

PixiJS v8-based casino game engine. Depends on `@energy8platform/platform-core`. Sub-paths re-export platform-core modules so existing import paths (`@energy8platform/game-engine/lua`, `/debug` for DevBridge, `/vite`) stay stable.

Peer deps: `@energy8platform/game-sdk`, `pixi.js`, optional `@pixi/sound`, `@esotericsoftware/spine-pixi-v8`. (The generic UI component set, the React reconciler bindings, and the standalone `StateMachine` were removed when the engine narrowed to the host-driven slot path — see "Module Boundaries" below.)

## Commands

All commands run from the repo root and operate on both workspaces.

```bash
npm install            # Install + symlink workspace packages
npm run build          # Build both packages (Rollup)
npm run dev            # Watch mode for game-engine
npm run lint           # ESLint on both
npm run format         # Prettier on src of both
npm run typecheck      # tsc --noEmit on both
npm test               # Vitest run on both (game-engine + platform-core)
npm run test:watch     # Watch mode for game-engine

# Workspace-scoped
npm run build --workspace @energy8platform/platform-core
npm test --workspace @energy8platform/game-engine
npx vitest run packages/platform-core/tests/PlatformSession.test.ts

# RTP simulation (binary lives in platform-core)
npm run simulate --workspace @energy8platform/platform-core -- --config dev.config.ts --iterations 1000000
# Installs: bin/platform-core-simulate (was bin/game-engine-simulate before split)
```

## Architecture (game-engine)

### Core Design

**GameApplication** ([packages/game-engine/src/core/GameApplication.ts](packages/game-engine/src/core/GameApplication.ts)) is the central orchestrator. It owns all sub-managers and drives the boot sequence: CSS preloader → PixiJS init → SDK handshake (delegated to `createPlatformSession` from platform-core) → LoadingScene → asset loading → first scene.

The SDK handshake lives in [`platform-core/src/PlatformSession.ts`](packages/platform-core/src/PlatformSession.ts) — `createPlatformSession({ dev, sdk })` returns a `PlatformSession` exposing `sdk`, `initData`, `devBridge`, `play(params)`, and forwarded `error`/`balanceUpdate` events. `GameApplication.session` holds it; the legacy `game.sdk` / `game.initData` fields stay populated for backwards compatibility.

**Scene system** uses stack semantics (push/pop/replace/goto) managed by **SceneManager**. Scenes extend the abstract `Scene` class and implement lifecycle hooks: `onEnter(data?)`, `onExit()`, `onUpdate(dt)`, `onResize(w,h)`, `onDestroy()`. Scene transitions are async with configurable transition types (FADE, SLIDE_LEFT, SLIDE_RIGHT).

**EventEmitter** is a minimal typed event emitter shipped in both packages — game-engine has [`src/core/EventEmitter.ts`](packages/game-engine/src/core/EventEmitter.ts), platform-core has its own copy at [`src/EventEmitter.ts`](packages/platform-core/src/EventEmitter.ts) (so platform-core has no upward dep on game-engine). Both implementations are byte-identical. GameApplication, SceneManager, AudioManager, ViewportManager, and PlatformSession all extend or use it.

### Animation

Tween/Timeline system (`packages/game-engine/src/animation/`) is promise-based and runs on the PixiJS Ticker. No external animation library (no GSAP). `Tween.to()`, `Tween.from()`, `Tween.fromTo()` all return Promises for easy composition.

### UI / shell

Slot games get their chrome (control bar, balance/bet/win, menu, settings, buy-bonus) from the **DOM shell** in `@energy8platform/pixi-shell` (re-exported via `@energy8platform/game-engine/shell`), driven by the host. In-canvas slot visuals come from the **slot module** (`/slot`: ReelGrid, controllers, `BigWinOverlay`, …) and above-shell modals from the host `SceneApi.overlay`.

> The engine previously shipped a generic from-scratch UI component set (`/ui`: FlexContainer, Button, Modal, Toast, ScrollContainer, …), a React reconciler (`/react`, `/react-jsx`), and a standalone `StateMachine` (`/state`). These were **removed** when the engine narrowed to the host-driven slot path — nothing in `host`/`slot`/`core` consumed them. If you need them back, recover from git history.

### Module Boundaries & Exports

`@energy8platform/game-engine` uses **sub-path exports** for tree-shaking — each entry produces separate ESM/CJS bundles via Rollup:
- `/core` — GameApplication, Scene, SceneManager
- `/host` — `createSlotGame`, the host-driven play loop, `SceneApi` (audio/overlay/shell), `SlotSceneController`
- `/slot` — ReelGrid, ReelSpinController/CascadeController, BigWinOverlay, MultiplierAccumulator, reel system
- `/animation` — Tween, Timeline, Easing
- `/lua` — re-exports `@energy8platform/platform-core/lua`
- `/debug` — re-exports DevBridge from platform-core; adds local FPSOverlay
- `/vite` — re-exports plugins from platform-core/vite; adds pixi-flavored `defineGameConfig`
- `/shell` — re-exports the DOM game shell from `@energy8platform/pixi-shell`
- `/assets`, `/audio`, `/game-spec`

## Architecture (platform-core)

### Lua Engine

The `packages/platform-core/src/lua/` module runs platform Lua game scripts locally via `fengari` (Lua 5.3 pure JS). This replicates the server-side execution for development and simulation.

**LuaEngine** is the main class. It loads a Lua script, injects the platform's `engine.*` API (random, shuffle, random_weighted, etc.), and executes `execute(state)` on each play request. The full action/transition/session lifecycle is replicated locally via **ActionRouter**, **SessionManager**, and **PersistentState**.

- **ActionRouter** dispatches play requests to action definitions and evaluates transition conditions (supports comparisons, `&&`, `||`, `"always"`).
- **SessionManager** tracks session lifecycle: creation, spin counting, retrigger, `_persist_` data roundtrip, and completion. Supports both slot sessions (fixed spins) and table game unlimited sessions.
- **PersistentState** manages cross-spin persistent state (`persistent_state.vars` and `_persist_game_*` convention).
- **NativeSimulationRunner** runs a Go-built native binary for high-throughput RTP simulation. Falls back to JS (`SimulationRunner` / `ParallelSimulationRunner`) when the native binary isn't available.

### DevBridge & SDK integration

[`packages/platform-core/src/dev-bridge/DevBridge.ts`](packages/platform-core/src/dev-bridge/DevBridge.ts) emulates the game-sdk for offline testing without a real casino backend. It supports both JS `onPlay` callbacks and Lua script execution via LuaEngine.

`createPlatformSession({ dev, sdk })` is the renderer-agnostic factory: starts an in-process DevBridge if `dev` is set, runs the SDK handshake, forwards SDK events. `GameApplication` uses it internally; non-pixi consumers (Phaser, Three, custom) call it directly.

### Vite plugin

Two Vite plugins live in `packages/platform-core/src/vite/`:
- **devBridgePlugin** — virtual module that boots DevBridge in dev HTML
- **luaPlugin** — `.lua` files imported as raw strings, plus `POST /__lua-play` endpoint that runs LuaEngine in Node.js (no fengari in browser)

`@energy8platform/game-engine/vite` re-exports both plugins and adds the pixi-flavored `defineGameConfig` helper layered on top.

## Types

- `packages/platform-core/src/types.ts` — re-exports SDK types (`InitData`, `PlayParams`, `PlayResultData`, `SessionData`, `BalanceData`, etc.) and Lua/game-definition types (`GameDefinition`, `ActionDefinition`, `TransitionRule`, `LuaEngineConfig`, etc.) for renderer-agnostic consumers.
- `packages/game-engine/src/types.ts` — pixi-specific config types (`GameApplicationConfig`, `LoadingScreenConfig`, `AudioConfig`, scale/orientation enums, scene/transition types, tween types) plus convenience SDK re-exports.

## Tests

- Framework: Vitest 2.0
- Each package owns its own test suite + vitest config:
  - `packages/game-engine/tests/*.test.ts` — UI, animation, state, audio, applyProps, etc.
  - `packages/platform-core/tests/*.test.ts` — LuaEngine, ActionRouter, SimulationRunner, plus a **renderer-agnostic smoke test** (`PlatformSession.test.ts`) that verifies the public API works without any pixi import.
- Path alias `@/*` maps to that package's `src/*` (configured per-package).
