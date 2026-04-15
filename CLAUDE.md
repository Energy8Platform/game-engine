# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # Production build (Rollup)
npm run dev            # Watch mode
npm run lint           # ESLint on src/
npm run format         # Prettier on src/
npm run typecheck      # tsc --noEmit
npm test               # Run all tests (vitest)
npm run test:watch     # Interactive test watch mode
npx vitest run tests/StateMachine.test.ts   # Run a single test file
```

## Architecture

This is `@energy8platform/game-engine` — a PixiJS v8-based casino game engine framework built on `@energy8platform/game-sdk`.

### Core Design

**GameApplication** (`src/core/GameApplication.ts`) is the central orchestrator. It owns all sub-managers and drives the boot sequence: CSS preloader → PixiJS init → SDK handshake → LoadingScene → asset loading → first scene.

**Scene system** uses stack semantics (push/pop/replace/goto) managed by **SceneManager**. Scenes extend the abstract `Scene` class and implement lifecycle hooks: `onEnter(data?)`, `onExit()`, `onUpdate(dt)`, `onResize(w,h)`, `onDestroy()`. Scene transitions are async with configurable transition types (FADE, SLIDE_LEFT, SLIDE_RIGHT).

**StateMachine** (`src/state/StateMachine.ts`) is a generic typed FSM with transition guards, used for game flow control. States have `enter(ctx, data?)`, `exit(ctx)`, `update(ctx, dt)` hooks. Guards can block transitions conditionally.

**EventEmitter** (`src/core/EventEmitter.ts`) is a minimal typed event emitter used throughout — GameApplication, SceneManager, AudioManager, ViewportManager, and StateMachine all extend or use it.

### Animation

Tween/Timeline system (`src/animation/`) is promise-based and runs on the PixiJS Ticker. No external animation library (no GSAP). `Tween.to()`, `Tween.from()`, `Tween.fromTo()` all return Promises for easy composition.

### UI System

The engine has a **built-in UI system** (`src/ui/`) with zero external UI dependencies. No `@pixi/ui`, `@pixi/layout`, or `yoga-layout` — everything is implemented from scratch.

**FlexContainer** (`src/ui/FlexContainer.ts`) is the core layout primitive — a lightweight flexbox-like container:
- `direction`: `'row' | 'column'`
- `justifyContent`: `'start' | 'center' | 'end' | 'space-between' | 'space-around'`
- `alignItems`: `'start' | 'center' | 'end' | 'stretch'`
- `gap`, `padding`, `flexWrap`, `maxWidth`/`maxHeight`
- Children added via `addFlexChild(child, flexConfig?)`, supports `flexGrow` for proportional sizing
- Call `updateLayout()` after adding children, or `resize(w, h)` to set explicit container size

**Layout** (`src/ui/Layout.ts`) wraps FlexContainer with a higher-level API: direction presets (`horizontal`/`vertical`/`grid`/`wrap`), viewport anchor positioning (9-point), responsive breakpoints by viewport width. Items added via `addItem()`, positioned via `updateViewport(w, h)`.

**Components** — all extend PixiJS Container directly:
- **Button** — state management (default/hover/pressed/disabled), pointer events, Tween animations, `onPress` callback
- **Panel** — FlexContainer-based with Graphics or NineSliceSprite background
- **Label** — auto-fit text scaling, currency/number formatting
- **BalanceDisplay** — animated countup/countdown via Tween
- **WinDisplay** — dramatic countup with scale pop via Tween
- **ProgressBar** — track + fill with mask-based progress, optional animated interpolation
- **ScrollContainer** — touch/drag, mouse wheel, inertia via Ticker, mask viewport
- **Modal** — overlay with content centering, enter/exit Tween animations
- **Toast** — transient notifications with slide-in animation, auto-dismiss via Tween.delay

All components implement proper `destroy()` cleanup (kill tweens, remove listeners, clear references).

### Module Boundaries & Exports

The engine uses **sub-path exports** for tree-shaking — 10 entry points each produce separate ESM/CJS bundles via Rollup:
- `@energy8platform/game-engine/core` — GameApplication, Scene, SceneManager
- `@energy8platform/game-engine/animation` — Tween, Timeline, Easing
- `@energy8platform/game-engine/ui` — FlexContainer, Button, Label, Panel, Modal, etc.
- `@energy8platform/game-engine/lua` — LuaEngine, ActionRouter, SessionManager, PersistentState (requires `fengari`)
- `@energy8platform/game-engine/assets`, `/audio`, `/debug`, `/vite`, `/react`

Core is kept slim via **optional peer dependencies**: `@pixi/sound`, `fengari`, and `@esotericsoftware/spine-pixi-v8` are all optional.

### Lua Engine

The `src/lua/` module runs platform Lua game scripts locally in the browser via `fengari` (Lua 5.3 pure JS). This replicates the server-side execution for development and simulation.

**LuaEngine** (`src/lua/LuaEngine.ts`) is the main class. It loads a Lua script, injects the platform's `engine.*` API (random, shuffle, random_weighted, etc.), and executes `execute(state)` on each play request. The full action/transition/session lifecycle is replicated locally via **ActionRouter**, **SessionManager**, and **PersistentState**.

**ActionRouter** (`src/lua/ActionRouter.ts`) dispatches play requests to action definitions and evaluates transition conditions (supports comparisons, `&&`, `||`, `"always"`).

**SessionManager** (`src/lua/SessionManager.ts`) tracks session lifecycle: creation, spin counting, retrigger, `_persist_` data roundtrip, and completion. Supports both slot sessions (fixed spins) and table game unlimited sessions.

**PersistentState** (`src/lua/PersistentState.ts`) manages cross-spin persistent state (`persistent_state.vars` and `_persist_game_*` convention).

**DevBridge integration**: When `DevBridgeConfig.luaScript` and `gameDefinition` are set, DevBridge automatically creates a LuaEngine and uses it instead of the `onPlay` callback. The Vite plugin auto-imports `.lua` files as raw strings with HMR reload.

### SDK Integration

In development, **DevBridge** (`src/debug/DevBridge.ts`) emulates the game-sdk for offline testing without a real casino backend. It supports both JS `onPlay` callbacks and Lua script execution via LuaEngine.

## Types

Shared types live in `src/types.ts` — config interfaces, enums (ScaleMode, Orientation, TransitionType), and re-exported SDK types (InitData, PlayParams, PlayResultData, etc.).

## Tests

- Framework: Vitest 2.0
- Test files: `tests/*.test.ts`
- Mocking: `vi.fn()` for spies
- Path alias `@/*` maps to `src/*` (configured in both tsconfig and vitest)
