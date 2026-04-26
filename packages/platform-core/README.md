# @energy8platform/platform-core

Renderer-agnostic core for games on the Energy8 casino platform. Pair it with PixiJS, Phaser, Three.js, DOM, or your own engine — `platform-core` ships everything that is platform-specific (Energy8 SDK lifecycle, Lua game scripts, RTP simulation, mock host bridge for local dev, branded loading frame, Vite plugins) without dragging in a renderer.

If you want the full PixiJS engine on top of this, install [`@energy8platform/game-engine`](../game-engine/README.md) instead — it depends on `platform-core` and adds scenes, UI, animation, viewport, and React integration.

---

## Table of Contents

- [Why this package exists](#why-this-package-exists)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Public API](#public-api)
- [PlatformSession](#platformsession)
- [Lua Engine](#lua-engine)
- [DevBridge (mock casino host)](#devbridge-mock-casino-host)
- [RTP Simulation CLI](#rtp-simulation-cli)
- [Branded Loading Screen](#branded-loading-screen)
- [Vite Plugins](#vite-plugins)
- [Asset Manifest type](#asset-manifest-type)
- [Pairing with another renderer](#pairing-with-another-renderer)
- [Sub-path exports](#sub-path-exports)
- [License](#license)

---

## Why this package exists

The Energy8 casino platform has a contract every game must speak: an SDK handshake, a play-action lifecycle, a Lua execution model used both server-side and locally for development and RTP verification, and a host-side branded loading frame.

That contract is identical regardless of how you render. So it lives here, with **zero rendering or DOM-coupled code** in the bundle (the only DOM API used is `window` in the dev-mode `MemoryChannel` and `document` in the CSS preloader — neither touches a canvas/WebGL).

You bring the renderer; `platform-core` brings the platform.

---

## Installation

```bash
npm install @energy8platform/platform-core @energy8platform/game-sdk fengari
```

### Peer dependencies

| Package | Version | Required |
| --- | --- | --- |
| `@energy8platform/game-sdk` | `^2.7.0` | Yes |
| `fengari` | `^0.1.4` | Yes — Lua engine runtime |
| `vite` | `^5.0.0 \|\| ^6.0.0` | Optional — only if you import `/vite` |

No `pixi.js`, no `react`, no `phaser`, no DOM rendering library is required.

---

## Quick Start

```typescript
import { createPlatformSession, createCSSPreloader, removeCSSPreloader } from '@energy8platform/platform-core';
import luaScript from './game.lua?raw';
import { gameDefinition } from './gameDefinition';

const container = document.getElementById('app')!;

// 1. Show the Energy8 brand frame immediately.
createCSSPreloader(container);

// 2. Boot the platform session — DevBridge in dev, real SDK in prod.
const session = await createPlatformSession({
  dev: {
    luaScript,
    gameDefinition,
    balance: 10000,
    currency: 'EUR',
    networkDelay: 200,
  },
  sdk: { devMode: true },
});

session.on('balanceUpdate', ({ balance }) => updateHud(balance));

// 3. Initialize *your* renderer (Phaser, Three, custom). When ready,
//    pull session.initData.assetsUrl, load your assets, then…
removeCSSPreloader(container);

// 4. Drive plays through the SDK.
const result = await session.play({ action: 'spin', bet: 1 });
renderResult(result);
```

---

## Public API

```typescript
import {
  // Session lifecycle
  createPlatformSession, PlatformSession,
  type PlatformSessionConfig, type PlatformSessionEvents, type SDKOptions,

  // Lua engine + simulation
  LuaEngine, LuaEngineAPI, createSeededRng,
  ActionRouter, evaluateCondition,
  SessionManager, PersistentState,
  SimulationRunner, formatSimulationResult,
  ParallelSimulationRunner,
  NativeSimulationRunner, findNativeBinary, formatNativeResult,

  // DevBridge mock host
  DevBridge, type DevBridgeConfig,

  // Branded loading frame
  createCSSPreloader, removeCSSPreloader, buildLogoSVG, LOADER_BAR_MAX_WIDTH,

  // Internal utility
  EventEmitter,

  // Platform types (re-exported from @energy8platform/game-sdk + Lua module)
  type InitData, type GameConfigData, type SessionData,
  type PlayParams, type PlayResultData, type BalanceData,
  type GameDefinition, type ActionDefinition, type TransitionRule,
  type LuaEngineConfig, type LuaPlayResult, type SessionConfig,
  type BuyBonusConfig, type AnteBetConfig, type MaxWinConfig,
  type AssetManifest, type AssetBundle, type AssetEntry,
  type LoadingScreenConfig,
  // …more — see src/types.ts
} from '@energy8platform/platform-core';
```

---

## PlatformSession

`createPlatformSession(config)` is the entry point. It performs the SDK handshake (and optionally starts a local DevBridge mock host) and returns a typed event source.

```typescript
const session = await createPlatformSession({
  // Optional. When present, an in-process DevBridge is started so the
  // SDK connects to a local mock host without any real backend.
  dev: {
    balance: 10000,
    currency: 'EUR',
    luaScript: '<your lua source>',  // optional, runs locally via fengari
    gameDefinition: { /* … */ },
    networkDelay: 200,
  },

  // Optional. Pass `false` for offline / head-less use (no SDK at all).
  sdk: { devMode: true },
});

session.sdk;          // CasinoGameSDK | null
session.initData;     // InitData | null  — first handshake response
session.devBridge;    // DevBridge | null
session.balance;      // number   — proxied to SDK
session.currency;     // string
session.on('balanceUpdate', ({ balance }) => { /* … */ });
session.on('error', (err) => { /* … */ });

const result = await session.play({ action: 'spin', bet: 1 });
session.destroy();
```

Inside `game-engine`, `GameApplication` wraps this. For non-pixi consumers, this is the layer you talk to directly.

---

## Lua Engine

Run platform Lua scripts locally in Node or the browser via `fengari` (Lua 5.3, pure JS). This replicates server-side execution byte-for-byte, so the same script you ship to production also drives local development and RTP simulations.

```typescript
import { LuaEngine } from '@energy8platform/platform-core';

const engine = new LuaEngine({
  script: '<your lua source>',
  gameDefinition: { /* … */ },
  seed: 42,            // optional — deterministic RNG
});

const result = engine.execute({
  variables: { bet: 1, balance: 5000 },
  stage: 'base_game',
});
// → { total_win, data, next_actions, session, persistent_state }
```

Companion classes:
- `ActionRouter` — dispatch a play request to the matching action and evaluate transition conditions (`&&`, `||`, comparisons, `"always"`).
- `SessionManager` — track session lifecycle: creation, spin counting, retrigger, `_persist_` data roundtrip, completion. Supports both fixed-spin slot sessions and unlimited table sessions.
- `PersistentState` — cross-spin persistent vars (`persistent_state.vars` and `_persist_game_*` convention).

---

## DevBridge (mock casino host)

Mock the casino host for offline development. Uses the SDK's `Bridge` in `devMode` with an in-memory `MemoryChannel`, so there is no postMessage or iframe involved.

```typescript
import { DevBridge } from '@energy8platform/platform-core/dev-bridge';

const bridge = new DevBridge({
  balance: 10000,
  currency: 'USD',
  networkDelay: 200,
  debug: true,
  gameConfig: { id: 'my-slot', type: 'slot', betLevels: [0.1, 0.5, 1, 5, 10] },

  // Either: implement onPlay yourself
  onPlay: ({ action, bet }) => ({
    totalWin: Math.random() < 0.4 ? bet * 5 : 0,
  }),

  // Or: hand it your Lua game logic (preferred — same code as prod)
  // luaScript, gameDefinition, luaSeed,
});

bridge.start();
// later:
bridge.setBalance(5000);
bridge.destroy();
```

Most of the time you don't construct DevBridge yourself — `createPlatformSession({ dev: { … } })` does it for you.

---

## RTP Simulation CLI

`platform-core` ships a binary that runs your Lua script through millions of iterations to verify math and stage distributions. It picks up `luaScript` and `gameDefinition` from your `dev.config.ts` automatically.

```bash
# 1M spins (default)
npx platform-core-simulate

# Buy-bonus stage
npx platform-core-simulate --action buy_bonus

# Ante bet
npx platform-core-simulate --params '{"ante_bet":true}'

# Custom: 5M iterations, fixed seed, custom config path
npx platform-core-simulate --iterations 5000000 --bet 1 --seed 42 --config ./dev.config.ts

# Force the JS runner (skip native binary)
npx platform-core-simulate --js
```

Output matches the platform's server-side simulation format. A native Go binary is downloaded for your OS via postinstall (`packages/platform-core/bin/simulate-*`) for high-throughput runs; if it isn't available, the JS / worker-thread runner is used as a fallback.

Programmatic use:

```typescript
import { ParallelSimulationRunner, NativeSimulationRunner, formatSimulationResult } from '@energy8platform/platform-core';

const runner = new ParallelSimulationRunner({
  script, gameDefinition,
  iterations: 1_000_000,
  workers: 8,
});
const result = await runner.run();
console.log(formatSimulationResult(result));
```

---

## Branded Loading Screen

Every Energy8 game shows the same brand frame while it boots. The CSS-only preloader lives here so any renderer hosts the same frame without needing to render anything itself.

```typescript
import { createCSSPreloader, removeCSSPreloader } from '@energy8platform/platform-core/loading';

createCSSPreloader(document.getElementById('app')!, {
  backgroundColor: 0x0a0a1a,
  backgroundGradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 100%)',
  cssPreloaderHTML: '<custom HTML to override the default frame>',
});

// later, when your renderer has mounted and assets are loaded:
removeCSSPreloader(container);
```

The animated loader bar inside the SVG is purely CSS keyframes, so it works in offline / first-paint conditions before any JS module finishes parsing.

---

## Vite Plugins

```typescript
// vite.config.ts (Phaser/Three/custom — full control over your config)
import { defineConfig } from 'vite';
import { devBridgePlugin, luaPlugin } from '@energy8platform/platform-core/vite';

export default defineConfig({
  plugins: [
    devBridgePlugin('./dev.config'),
    luaPlugin('./dev.config'),
  ],
});
```

What they do:
- **`devBridgePlugin`** injects a virtual entry that boots `DevBridge` from your `./dev.config` *before* your real entry imports. Dev-only.
- **`luaPlugin`**:
  1. Lets you `import luaScript from './game.lua?raw'` — Vite returns the file contents.
  2. Spins up a server-side `LuaEngine` and exposes `POST /__lua-play`. `DevBridge` calls this endpoint, so `fengari` only ever runs in Node and never ships to the browser bundle.
  3. HMR-reloads the Lua engine when `*.lua` or `dev.config*` changes.

If you're building a Pixi game, prefer `defineGameConfig` from `@energy8platform/game-engine/vite` — it wires both plugins for you and adds Pixi-flavored Vite defaults (chunk splitting, dedupe, etc.).

---

## Asset Manifest type

`AssetManifest` describes "what to load and in which bundles", in a format both Pixi's `Assets`, `Phaser.Loader`, and your own loader can consume.

```typescript
import type { AssetManifest } from '@energy8platform/platform-core';

const manifest: AssetManifest = {
  bundles: [
    { name: 'preload', assets: [{ alias: 'logo', src: 'logo.png' }] },
    { name: 'game', assets: [
      { alias: 'background', src: 'background.png' },
      { alias: 'symbols', src: 'symbols.json' },
    ]},
  ],
};
```

`platform-core` does **not** load the assets itself — actual loading is renderer-specific. Pixi-side, `game-engine`'s `AssetManager` wraps `pixi.Assets` and consumes this format directly.

---

## Pairing with another renderer

A typical Phaser / Three / custom-engine bootstrap looks like:

```typescript
import {
  createPlatformSession,
  createCSSPreloader,
  removeCSSPreloader,
  type AssetManifest,
} from '@energy8platform/platform-core';

const container = document.getElementById('app')!;
createCSSPreloader(container);

const session = await createPlatformSession({
  dev: { luaScript, gameDefinition, balance: 10000, currency: 'EUR' },
  sdk: { devMode: true },
});

// 1. Read SDK init data for assetsUrl and config dimensions
const { assetsUrl } = session.initData ?? { assetsUrl: '/assets/' };

// 2. Boot YOUR renderer however it likes:
const game = new Phaser.Game({ /* … */ });
// 3. Load assets through Phaser's loader, treating `manifest` as
//    the source of truth for what's needed.
await loadBundles(game.loader, manifest, assetsUrl);

removeCSSPreloader(container);

// 4. Wire SDK events / play requests
session.on('balanceUpdate', ({ balance }) => game.events.emit('balance', balance));
const result = await session.play({ action: 'spin', bet: 1 });
```

Nothing in this code is Pixi-specific. The same pattern fits Three.js, Babylon, custom WebGL, or even a DOM-only game.

---

## Sub-path exports

| Path | What's there |
| --- | --- |
| `@energy8platform/platform-core` | Everything — re-exports from all sub-paths |
| `@energy8platform/platform-core/lua` | LuaEngine, ActionRouter, SessionManager, PersistentState, SimulationRunner family, types |
| `@energy8platform/platform-core/dev-bridge` | `DevBridge`, `DevBridgeConfig` |
| `@energy8platform/platform-core/vite` | `devBridgePlugin`, `luaPlugin` |
| `@energy8platform/platform-core/loading` | `createCSSPreloader`, `removeCSSPreloader`, `buildLogoSVG`, `LOADER_BAR_MAX_WIDTH` |

The sub-paths exist for tree-shaking — pulling only `/lua` doesn't drag in DevBridge or vite types. The main entry is convenient for app-level code where size hardly matters.

---

## License

MIT
