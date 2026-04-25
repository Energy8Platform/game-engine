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
│       └── src/{core/, ui/, react/, animation/, audio/, assets/, debug/FPSOverlay, viewport/, input/, loading/, types.ts, lua/, vite/}
└── examples/
```

### `@energy8platform/platform-core`

Renderer-agnostic. Contains everything platform-specific to Energy8 (Lua engine, DevBridge, RTP simulation, SDK session orchestration). Pair with PixiJS, Phaser, Three.js, DOM, or any custom engine.

Peer deps: `@energy8platform/game-sdk`, `fengari`, optional `vite`. **No pixi/react/DOM.**

Sub-paths:
- `@energy8platform/platform-core` — `createPlatformSession`, `LuaEngine`, `DevBridge`, types
- `@energy8platform/platform-core/lua` — Lua-specific exports
- `@energy8platform/platform-core/dev-bridge` — DevBridge isolated
- `@energy8platform/platform-core/vite` — `devBridgePlugin`, `luaPlugin`

### `@energy8platform/game-engine`

PixiJS v8-based casino game engine. Depends on `@energy8platform/platform-core`. Sub-paths re-export platform-core modules so existing import paths (`@energy8platform/game-engine/lua`, `/debug` for DevBridge, `/vite`) stay stable.

Peer deps: `@energy8platform/game-sdk`, `pixi.js`, optional `react`/`react-dom`/`react-reconciler`, optional `@pixi/sound`, `@esotericsoftware/spine-pixi-v8`.

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

**StateMachine** ([packages/game-engine/src/state/StateMachine.ts](packages/game-engine/src/state/StateMachine.ts)) is a generic typed FSM with transition guards, used for game flow control. States have `enter(ctx, data?)`, `exit(ctx)`, `update(ctx, dt)` hooks. Guards can block transitions conditionally.

**EventEmitter** is a minimal typed event emitter shipped in both packages — game-engine has [`src/core/EventEmitter.ts`](packages/game-engine/src/core/EventEmitter.ts), platform-core has its own copy at [`src/EventEmitter.ts`](packages/platform-core/src/EventEmitter.ts) (so platform-core has no upward dep on game-engine). Both implementations are byte-identical. GameApplication, SceneManager, AudioManager, ViewportManager, StateMachine, and PlatformSession all extend or use it.

### Animation

Tween/Timeline system (`packages/game-engine/src/animation/`) is promise-based and runs on the PixiJS Ticker. No external animation library (no GSAP). `Tween.to()`, `Tween.from()`, `Tween.fromTo()` all return Promises for easy composition.

### UI System

The engine has a **built-in UI system** (`packages/game-engine/src/ui/`) with zero external UI dependencies. No `@pixi/ui`, `@pixi/layout`, or `yoga-layout` — everything is implemented from scratch.

**FlexContainer** is the core layout primitive — a lightweight flexbox-like container:
- `direction`: `'row' | 'column'`
- `justifyContent`: `'start' | 'center' | 'end' | 'space-between' | 'space-around'`
- `alignItems`: `'start' | 'center' | 'end' | 'stretch'`
- `alignContent`: `'start' | 'center' | 'end' | 'space-between' | 'stretch'` (multi-line distribution with `flexWrap`)
- `gap`, `padding` (or `paddingTop`/`paddingRight`/`paddingBottom`/`paddingLeft`), `flexWrap`, `maxWidth`/`maxHeight`
- `width`/`height` accept `number | string` — string percentages (e.g. `"50%"`) resolve against parent content area
- **Auto-sizing**: without explicit `width`/`height`, container computes size from content (`_computedWidth`/`_computedHeight`)
- Children added via `addFlexChild(child, flexConfig?)`, supports `flexGrow`, `flexShrink`, `alignSelf`
- `flexExclude` children support absolute positioning via `top`/`right`/`bottom`/`left`
- `layoutWidth`/`layoutHeight` accept percentages: `{ layoutWidth: '50%' }`
- FlexContainer children are resized via `resize()` (not PixiJS scale setter) for correct internal relayout
- Call `updateLayout()` after adding children, or `resize(w, h)` to set explicit container size

**Layout** wraps FlexContainer with a higher-level API: direction presets (`horizontal`/`vertical`/`grid`/`wrap`), viewport anchor positioning (9-point), responsive breakpoints by viewport width. Items added via `addItem()`, positioned via `updateViewport(w, h)`.

**Components** — all extend PixiJS Container directly:
- **Button** — state management (default/hover/pressed/disabled), pointer events, Tween animations, `onPress` callback
- **Panel** — FlexContainer-based with Graphics or NineSliceSprite background
- **Label** — auto-fit text scaling, currency/number formatting
- **LabelValue** — two-row "caption / value" cell (BALANCE/€500, BET/€1 pattern). FlexContainer column subclass with `label`, `value`, `labelStyle`, `valueStyle`, `gap`, `align`, optional `maxWidth` for autoFit on the value
- **BalanceDisplay** — animated countup/countdown via Tween
- **WinDisplay** — dramatic countup with scale pop via Tween
- **ProgressBar** — track + fill with mask-based progress, optional animated interpolation
- **ScrollContainer** — touch/drag, mouse wheel, inertia via Ticker, mask viewport
- **Modal** — overlay with content centering, enter/exit Tween animations
- **Toast** — transient notifications with slide-in animation, auto-dismiss via Tween.delay

All components implement proper `destroy()` cleanup (kill tweens, remove listeners, clear references).

### Module Boundaries & Exports

`@energy8platform/game-engine` uses **sub-path exports** for tree-shaking — 11 entry points each produce separate ESM/CJS bundles via Rollup:
- `/core` — GameApplication, Scene, SceneManager
- `/animation` — Tween, Timeline, Easing
- `/ui` — FlexContainer, Button, Label, Panel, Modal, etc.
- `/lua` — re-exports `@energy8platform/platform-core/lua`
- `/debug` — re-exports DevBridge from platform-core; adds local FPSOverlay
- `/vite` — re-exports plugins from platform-core/vite; adds pixi-flavored `defineGameConfig`
- `/assets`, `/audio`, `/react`
- `/react-jsx` — JSX prop types. The engine **auto-augments** `react`'s `JSX.IntrinsicElements` via `declare module 'react'`, so any import from `/react` (e.g. `createPixiRoot`) activates fully-typed `<flexContainer>`, `<button>`, `<label>`, `<labelValue>`, etc. No user shim required.

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
