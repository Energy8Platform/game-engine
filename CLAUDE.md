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

### Module Boundaries & Exports

The engine uses **sub-path exports** for tree-shaking — 8 entry points each produce separate ESM/CJS bundles via Rollup:
- `@energy8platform/game-engine/core` — GameApplication, Scene, SceneManager
- `@energy8platform/game-engine/animation` — Tween, Timeline, Easing
- `@energy8platform/game-engine/ui` — Button, Label, Panel, Modal, etc. (requires `@pixi/ui` + `@pixi/layout`)
- `@energy8platform/game-engine/assets`, `/audio`, `/debug`, `/vite`

Core is kept slim via **optional peer dependencies**: `@pixi/ui`, `@pixi/layout`, `@pixi/sound`, and `@esotericsoftware/spine-pixi-v8` are all optional.

### SDK Integration

In development, **DevBridge** (`src/debug/DevBridge.ts`) emulates the game-sdk for offline testing without a real casino backend.

## Types

Shared types live in `src/types.ts` — config interfaces, enums (ScaleMode, Orientation, TransitionType), and re-exported SDK types (InitData, PlayParams, PlayResultData, etc.).

## Tests

- Framework: Vitest 2.0
- Test files: `tests/*.test.ts`
- Mocking: `vi.fn()` for spies
- Path alias `@/*` maps to `src/*` (configured in both tsconfig and vitest)
