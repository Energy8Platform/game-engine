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
- [Writing your game (config + Lua)](#writing-your-game-config--lua)
- [Lua Engine](#lua-engine)
- [DevBridge (mock casino host)](#devbridge-mock-casino-host)
- [RTP Simulation CLI](#rtp-simulation-cli)
- [Branded Loading Screen](#branded-loading-screen)
- [Vite Plugins](#vite-plugins)
- [Asset Manifest type](#asset-manifest-type)
- [Pairing with another renderer](#pairing-with-another-renderer)
- [Branded Game Shell](#branded-game-shell)
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
  type ReplayConfig, type ReplayLaunch,

  // Branded loading frame (lifecycle API)
  createCSSPreloader, setCSSPreloaderProgress, waitCSSPreloaderTap, removeCSSPreloader,
  buildLogoSVG, LOADER_BAR_MAX_WIDTH,

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
session.isReplay;     // boolean  — true on a historical-round replay launch
session.on('balanceUpdate', ({ balance }) => { /* … */ });
session.on('error', (err) => { /* … */ });

const result = await session.play({ action: 'spin', bet: 1 });
session.destroy();
```

Inside `game-engine`, `GameApplication` wraps this. For non-pixi consumers, this is the layer you talk to directly.

**Historical-round replay.** `session.isReplay` is `true` when the host launched the game to re-watch a recorded round (`config.replayMode`). The same `session.play(...)` flow then returns the recorded results instead of live ones. Each game decides what replay means for its UI:

```typescript
if (session.isReplay) {
  hideBalanceUI();
  hideBetSelector();
  showPlayAgainButton();   // the only CTA in replay
}
```

In dev, set up the recorded rounds via [`DevBridge` replay mode](#replay-mode-historical-rounds).

**Session continuations: pass the triggering bet, not zero.** When the previous result returns `nextActions: ['free_spin']` (or any other in-session action with `debit: 'none'`), pass the same bet that triggered the session:

```typescript
const fs = await session.play({ action: 'free_spin', bet: triggeringBet, roundId: result.roundId });
```

The platform validates `bet` against `bet_levels` and rejects `bet: 0`. No double debit happens — the action's `debit: 'none'` keeps the wallet still, and LuaEngine reads the actual session bet from server-side session state regardless of what the client sends. See [Game Development Guide §13.16](https://github.com/energy8platform/game-engine/blob/main/game_development_guide.md#13-conventions-and-best-practices) for the full conventions list.

---

## Writing your game (config + Lua)

Each game on the Energy8 platform consists of two artefacts:

1. A **`GameDefinition`** (JSON-shaped) — platform metadata: id, type, bet levels, max-win cap, action map with stage transitions, optional buy-bonus / ante-bet config. **No game math here.**
2. A **Lua script** — exports a single `execute(state)` function that owns *all* game math (reels, paylines, payouts, cascades, free spins, multipliers).

The same pair runs server-side in production and locally in dev / RTP simulations.

### Minimal slot — `dev.config.ts`

```typescript
import luaScript from './script.lua?raw';
import type { GameDefinition } from '@energy8platform/platform-core';

const gameDefinition: GameDefinition = {
  id: 'my-slot',
  type: 'SLOT',
  script_path: 'games/my-slot/script.lua',          // S3 key in production
  bet_levels: [0.20, 0.50, 1.00, 2.00, 5.00],
  max_win: { multiplier: 10000 },                    // cap = bet × 10000

  actions: {
    spin: {
      stage: 'base_game',
      debit: 'bet',                                  // deducts the bet
      credit: 'win',                                 // credits total_win
      transitions: [
        // Could branch into a free-spins session here. See full guide.
        { condition: 'always', next_actions: ['spin'] },
      ],
    },
  },
};

export default {
  balance: 10_000,
  currency: 'EUR',
  networkDelay: 200,
  luaScript,
  gameDefinition,
};
```

### Minimal slot — `script.lua`

```lua
local SYMBOLS = { 'A', 'K', 'Q', 'J', '10', '9' }
-- Payouts are *bet multipliers*. The platform scales by the player's
-- actual bet on the way out — never multiply by bet inside the script.
local PAYOUT  = { A = 50, K = 30, Q = 20, J = 10, ['10'] = 5, ['9'] = 2 }

function execute(state)
    -- 3 columns × 3 rows of random symbols
    local matrix = {}
    for col = 1, 3 do
        matrix[col] = {}
        for row = 1, 3 do
            matrix[col][row] = SYMBOLS[engine.random(1, #SYMBOLS)]
        end
    end

    -- Pay out if all 3 symbols on the middle row match
    local center = { matrix[1][2], matrix[2][2], matrix[3][2] }
    local total_win = 0
    if center[1] == center[2] and center[2] == center[3] then
        total_win = PAYOUT[center[1]]
    end

    return {
        total_win = total_win,
        data = { matrix = matrix, win_lines = total_win > 0 and { 2 } or {} },
    }
end
```

That's the entire contract: a stage to dispatch on (here just `base_game`) plus a `total_win` (a **bet multiplier**, not absolute currency) and an arbitrary `data` payload. The platform handles the rest — debit/credit (`real_win = bet × total_win`), balance updates, session lifecycle, cap enforcement. See [Game Development Guide §13.2](https://github.com/energy8platform/game-engine/blob/main/game_development_guide.md#13-conventions-and-best-practices) for the full convention.

### Full reference

The mini-example above covers a base-game spin only. For everything else — free spins via `creates_session` + `next_actions`, retrigger logic, persistent meters across spins (`_persist_*`), buy-bonus and ante-bet configuration, table-game session models, the full `engine.*` Lua API, JSON-Schema input/output validation, deployment and S3 layout — see the comprehensive guide:

- **[Game Development Guide](https://github.com/energy8platform/game-engine/blob/main/game_development_guide.md)** (1100+ lines)

Key sections to start with: §2 (`GameDefinition` shape), §7 (Lua script), §8 (`engine.*` API), §15 (table games), §16 (persistent state).

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

### Platform-parity behavior (Lua mode)

In Lua mode (`luaScript` + `gameDefinition`), DevBridge mirrors the server's `PlayRound` contract so error-handling code written against dev runs unchanged in prod. Invalid requests come back as `PLAY_ERROR` and the SDK's `play()` rejects with `SDKError(code, message)`:

| code                    | when                                                     |
|-------------------------|----------------------------------------------------------|
| `INVALID_INPUT`         | unknown action                                           |
| `INVALID_AMOUNT`        | `bet` not in `bet_levels` (list or `{min, max}` range)   |
| `INSUFFICIENT_FUNDS`    | computed debit > balance (no wallet movement, no fetch)  |
| `ACTIVE_SESSION_EXISTS` | non-session action while a session is in progress        |
| `NO_ACTIVE_SESSION`     | session-required action without an active session        |
| `SESSION_EXPIRED`       | session past `gameDefinition.session_ttl` (default 24h)  |
| `ENGINE_ERROR`          | Lua execution failed (debit is rolled back)              |

Other contract details DevBridge enforces:

- **Round IDs are server-generated** (`crypto.randomUUID`). The client value in `PlayParams.roundId` is ignored for non-session actions and replaced with the active session's id for session-based ones — matches the platform's `playRound` UUID rules.
- **`STATE_RESPONSE`** returns the last `PlayResultData` (with `session.history` populated) while a session is active and not yet completed, mirroring `GET /api/games/{id}/session`.
- **`creditPending`** is `false` in the normal path. The wire flag means "wallet credit failed, queued for retry" — never "credit deferred until session completes".
- **`session.history`** is appended on every session round (`{spinIndex, win, data}`), so the client can rebuild the screen after reload.
- **`MapState` parity** — `multiplier`, `global_multiplier`, `free_spins_total`, `max_win_reached` are auto-injected into `result.data` from engine variables when the Lua script doesn't set them explicitly.

### Replay mode (historical rounds)

A game can be launched to **replay a previously-played round** move-by-move instead of placing live bets — the SDK 2.7.3 historical-round replay. No new protocol: the same `play()` / `PLAY_RESULT` flow is reused, only the data source and one config flag differ.

In production the casino backend is the replay host. In dev, **DevBridge is the host**, so it gains an opt-in `replay` config. You supply a `resolve(mode, roundId)` callback that returns the recorded rounds — DevBridge stays agnostic about where they come from (fetch, static fixtures, `localStorage`, …):

```typescript
const bridge = new DevBridge({
  // … balance / gameConfig as usual …
  replay: {
    // Called once on a replay launch. May be async.
    resolve: (mode, roundId) => fetchRecordedRound(mode, roundId),
    // Optional. Defaults to reading ?replay=1&mode=…&event=… from the URL.
    // Return null for a normal (live) launch.
    detect: () => /* … */ null,
  },
});
```

Open the game with `?replay=1&mode=BONUS&event=<roundId>` and DevBridge switches into replay automatically. In replay it:

- flips `config.replayMode = true` in `INIT` (so `sdk.isReplay` / `session.isReplay` is `true`);
- takes `balance` / `currency` from the recorded results — **the wallet is never touched**;
- serves `results[cursor]` on each `PLAY_REQUEST`, with no bet/session validation;
- resets the cursor to `0` on the first spin past the end ("Play Again");
- returns `PLAY_ERROR NO_ACTIVE_SESSION` when the record list is empty.

The game reacts via a single flag — see [`session.isReplay`](#platformsession). Each game decides what that means (hide balance/bet/autoplay/buy-bonus, show a "Play Again" CTA); the engine never imposes UI.

---

## RTP Simulation CLI

`platform-core` ships a binary that runs your Lua script through millions of iterations to verify math and stage distributions. It picks up `luaScript` and `gameDefinition` from your `dev.config.ts` automatically.

```bash
# 1M spins (default)
npx platform-core-simulate

# Buy-bonus action (v5: just simulate the action by name)
npx platform-core-simulate --action buy_bonus

# Ante bet — also a regular action in v5
npx platform-core-simulate --action ante_spin

# Custom: 5M iterations, custom config path
npx platform-core-simulate --iterations 5000000 --bet 1 --config ./dev.config.ts

# Force the JS runner (skip native binary)
npx platform-core-simulate --js
```

### Reproducibility: seeds, RNG backend, and replay

The native binary supports the same provably-fair seeding contract as the casino platform's `cmd/simulation` tool. Pass `--seed=<hex>` to reproduce a previous run bit-for-bit; if you omit it, the binary generates one and reports it in the output (`Master seed: …`) so you can rerun the exact distribution later.

```bash
# Reproducible run — supply the master seed yourself
npx platform-core-simulate \
  --iterations 1000000 \
  --seed 00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff

# Fast PCG RNG — ~50× faster but diverges from production. Local iteration only;
# do NOT publish RTP numbers from --rng=fast.
npx platform-core-simulate --rng fast

# Replay a single round captured in `provably_fair_rounds`. Forces single-worker
# deterministic execution. All three flags are required and require provably-fair RNG.
npx platform-core-simulate \
  --iterations 1 \
  --replay-server-seed <hex> \
  --replay-client-seed <client_seed> \
  --replay-nonce-start 42
```

The result echoes `masterSeed`, `rngKind`, `workerSeeds[]` (per-worker server_seed sequence), and `replay` when in replay mode — all also surface on `NativeSimulationResult` for programmatic use. Hex seeds only apply to the native binary; the JS fallback uses an integer RNG seed (decimal `--seed=42`) and ignores hex strings with a warning.

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

// Native runner with the full provably-fair contract:
const native = new NativeSimulationRunner({
  binaryPath, script, gameDefinition,
  iterations: 1_000_000, bet: 1,
  rng: 'provably-fair',                // default; use 'fast' for local iteration only
  seed: '00112233...eeff',             // hex master seed; omit to auto-generate
  // replay: { serverSeed, clientSeed, nonceStart },  // single-round reproduction
});
const r = await native.run();
console.log(`Reproduce with seed=${r.masterSeed}, RTP=${r.totalRtp.toFixed(4)}%`);
```

---

## Branded Loading Screen

Every Energy8 game shows the same brand frame while it boots. The CSS-only preloader lives here so any renderer hosts the same frame without needing to render anything itself.

```typescript
import {
  createCSSPreloader,
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
  removeCSSPreloader,
} from '@energy8platform/platform-core/loading';

createCSSPreloader(document.getElementById('app')!, {
  backgroundColor: 0x0a0a1a,
  backgroundGradient: 'linear-gradient(135deg, #0a0a1a 0%, #1a1a3e 100%)',
  showPercentage: true,        // SVG text becomes "42%" once you push progress
  tapToStart: true,             // default — set false to skip the tap gate
  tapToStartText: 'PLAY',       // default 'TAP TO START'
});

// Drive progress while assets load — the bar switches from CSS-shimmer to
// JS-driven on the first call.
for await (const p of myAssetLoader.load()) {
  setCSSPreloaderProgress(p);  // p ∈ [0, 1] — clamped, NaN treated as 0
}

// Optional tap-to-start gate (useful for mobile audio unlock —
// the click satisfies the browser's user-gesture requirement).
await waitCSSPreloaderTap();   // resolves immediately if tapToStart: false

// Fade out and clean up. Returns a Promise that resolves after the
// 0.4s CSS fade completes (or after a 600ms safety timeout if
// `transitionend` doesn't fire — e.g. in jsdom).
await removeCSSPreloader(container);
```

### Lifecycle contract (one preloader per page)

- **`createCSSPreloader(container, config?)`** — mounts the overlay. Idempotent: a second call while a preloader exists is a no-op.
- **`setCSSPreloaderProgress(p)`** — silent no-op if called before `create` or after `remove`. Clamps `p` to `[0, 1]`; `NaN`/`±Infinity` become `0`. The first call switches the loader bar from CSS shimmer to JS-driven width. If `showPercentage: true`, the SVG text updates to `${Math.round(p * 100)}%`. Calls during `waitCSSPreloaderTap` are ignored — the text reads `'TAP TO START'` and we don't flash percentages over it.
- **`waitCSSPreloaderTap()`** — returns `Promise<void>`. Throws if called before `createCSSPreloader` (programmer error). Resolves immediately if `tapToStart: false`. Otherwise: swaps the SVG text to `tapToStartText`, adds a CSS pulse class, sets `cursor: pointer`, attaches a `pointerdown` listener, and resolves on first tap. Subsequent calls return the same memoized Promise.
- **`removeCSSPreloader(container)`** — returns `Promise<void>`. Idempotent. If a `waitCSSPreloaderTap` Promise is still pending, it resolves first; then the overlay fades out and the Promise resolves. Was `void` in earlier versions; the wider return type is backwards-compatible (callers who don't `await` keep working).

The animated shimmer inside the SVG is pure CSS keyframes, so it appears in offline / first-paint conditions before any JS module finishes parsing. Once you start reporting real progress, JS takes over.

> Mobile audio unlock: pair `waitCSSPreloaderTap()` with your audio system's resume/unlock call inside the same await chain. The user's tap is a valid gesture that satisfies iOS Safari and Chrome on Android.

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
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
  removeCSSPreloader,
  type AssetManifest,
} from '@energy8platform/platform-core';

const container = document.getElementById('app')!;
createCSSPreloader(container, { showPercentage: true, tapToStart: true });

const session = await createPlatformSession({
  dev: { luaScript, gameDefinition, balance: 10000, currency: 'EUR' },
  sdk: { devMode: true },
});

// 1. Read SDK init data for assetsUrl and config dimensions
const { assetsUrl } = session.initData ?? { assetsUrl: '/assets/' };

// 2. Boot YOUR renderer however it likes:
const game = new Phaser.Game({ /* … */ });

// 3. Load assets through your renderer's loader, treating `manifest`
//    as the source of truth, and pipe progress into the preloader.
await loadBundles(game.loader, manifest, assetsUrl, (p) => {
  setCSSPreloaderProgress(p);
});

// 4. Wait for the user's tap (resolves immediately if tapToStart: false)
await waitCSSPreloaderTap();
await removeCSSPreloader(container);

// 5. Wire SDK events / play requests
session.on('balanceUpdate', ({ balance }) => game.events.emit('balance', balance));
const result = await session.play({ action: 'spin', bet: 1 });
```

Nothing in this code is Pixi-specific. The same pattern fits Three.js, Babylon, custom WebGL, or even a DOM-only game.

---

## Branded Game Shell

`@energy8platform/platform-core/shell` is a **vanilla-DOM UI overlay** you layer over the game
canvas — no Pixi, no React, no framework. It owns the control bar (3 modes: base / freeSpins /
replay), the menu, settings, the game-info panel, and a buy-bonus selection overlay, plus generic
modals and a replay summary. Branded Energy8 chrome, fully renderer-agnostic — pair it with Pixi,
Phaser, Three.js, or a custom engine.

> Also re-exported from `@energy8platform/game-engine/shell` — same module, no extra install for
> Pixi consumers.

### Mental model

The shell is **fully driven by the game** (single source of truth). It does **not** subscribe to
the SDK/session and holds no game logic. You:

1. **Feed state in** — once via the config object, then over time via `set*` methods.
2. **React to player intent out** — subscribe to typed events (`spin`, `betChange`, …) and run
   your game logic, then push the resulting state back via setters.

This keeps replay and mid-spin restore deterministic: the shell never decides anything, it only
renders what you tell it and reports what the player tapped.

### Quick start

```typescript
import { createGameShell, removeGameShell } from '@energy8platform/platform-core/shell';

const shell = createGameShell({
  mount: document.getElementById('game')!,   // shell appends its DOM here (position it relative)
  language: 'en',
  currency: { symbol: '€', position: 'left' },
  availableBets: [0.2, 0.5, 1, 2, 5],
  defaultBet: 1,
  currentBet: null,        // null → start at defaultBet; or restore a saved bet
  balance: 1000,
  win: 0,
  mode: 'base',
  gameInfo: { sections: [{ type: 'controls' }] },   // see "Game info" below
  features: {
    turbo: 3,              // 0 = no turbo button, 1–3 = number of turbo levels
    spacebar: true,        // default true; set false to disable the Spacebar → spin shortcut
    autoplay: {},          // null / omitted = off; {} = on; { maxCount: 100 } caps the picker
    buyBonus: [
      { id: 'fs', type: 'bonus', title: 'Buy Free Spins', description: '10 free spins',
        priceMultiplier: 100, volatility: 5 },
    ],
  },
});

// ── player intent  (shell → game) ──
shell.on('spin', () => runSpin(shell.state.bet));
shell.on('betChange', (bet) => { myState.bet = bet; });
shell.on('buyBonusSelect', ({ id }) => buyFeature(id));

// ── game state  (game → shell) ──
shell.setBusy(true);                 // disable controls during an active spin
shell.setBalance(980);
shell.setWin(20);                    // both readouts count up automatically
shell.setBusy(false);

// teardown (single shell per page; fades out, resolves when removed)
await removeGameShell();
```

`createGameShell` is a **singleton** — calling it twice returns the existing shell. Use
`removeGameShell()` to dispose before creating another.

### Config reference (`ShellConfig`)

| Field | Type | Notes |
| --- | --- | --- |
| `mount` | `HTMLElement` | Container the shell DOM is appended into. Give it `position: relative`. |
| `theme` | `ThemeConfig?` | `{ scheme?: 'dark' \| 'light', accent? }`. Defaults to dark. `accent` also tints the BUY BONUS button; per-card accents are `BonusOption.accentColor`. |
| `language` | `string` | Currently `'en'` is the source language. |
| `isSocial` | `boolean?` | Swap built-in text to social-casino vocabulary (bet → play, win → …). Game-supplied strings are untouched. |
| `currency` | `CurrencyConfig` | `{ symbol, position: 'left'\|'right', decimals?, minDecimals?, separator? }`. |
| `availableBets` | `number[]` | Bet ladder shown in the bet picker. |
| `defaultBet` / `currentBet` | `number` / `number \| null` | `currentBet` restores a saved bet; `null` falls back to `defaultBet`. |
| `balance` / `win` | `number` | Initial readouts. |
| `mode` | `'base' \| 'freeSpins' \| 'replay'` | Drives which bottom-bar variant renders. |
| `gameInfo` | `GameInfoContent` | Sections for the game-info overlay (see below). |
| `features` | `ShellFeatures` | `{ turbo: 0–3, spacebar?, autoplay, buyBonus }`. `spacebar?: boolean` (default `true`) — `false` disables the Spacebar → spin shortcut. `autoplay: AutoplayConfig \| null` — `null`/omitted disables it; `{}` enables it; `{ maxCount }` caps the picker (drops ∞). `buyBonus: BonusOption[] \| false`. |
| `onBonusBuy` | `(() => void)?` | Override the BUY BONUS button action — opens your own UI instead of the built-in overlay (also shows the button without a `buyBonus` array). See [Buy bonus](#buy-bonus--features). |

### Events (`shell.on(name, handler)`)

| Event | Payload | When |
| --- | --- | --- |
| `spin` | — | Spin disc tapped (or Spacebar in base mode). |
| `betChange` | `number` | Player confirmed a new bet. |
| `autoplayStart` / `autoplayStop` | `{ active, remaining }` / — | Autoplay picker confirmed / stopped. |
| `turboChange` | `number` | Turbo level cycled. |
| `buyBonusSelect` | `{ id }` | A `type: 'bonus'` card was bought. |
| `featureActivate` / `featureDeactivate` | `{ id }` | A `type: 'feature'` option (e.g. Ante) toggled. |
| `menuOpen` / `settingsOpen` / `infoOpen` | — | Overlay opened. |
| `settingChange` | `{ key, value }` | Settings control changed. Keys: `sound` (bool), `master` / `music` / `sfx` (0–100). |

### State setters (`game → shell`)

Each setter updates `shell.state` and re-renders. `setBalance` / `setWin` animate a count-up from
the previous value.

```typescript
shell.setBalance(n); shell.setWin(n); shell.setBet(n);
shell.setBusy(true);                 // disables controls mid-spin
shell.setMode('freeSpins');
shell.setFreeSpins({ current: 1, total: 10, totalWin: 0 });   // Free Spins + Total Win bar readout
shell.setAutoplay({ active: true, remaining: 25 });
shell.setTurbo(2);
shell.setBuyBonusEnabled(false);     // grey out BUY BONUS (e.g. insufficient balance)
shell.setTheme({ scheme: 'light' }); // recolour at runtime
shell.setSocial(true);               // swap vocabulary at runtime (reopen overlays to refresh them)
```

Read current state any time via `shell.state` (`ShellState`: `mode`, `balance`, `win`, `bet`,
`busy`, `autoplay`, `turbo`, `freeSpins`, `activeFeature`, …).

### Buy bonus & features

`features.buyBonus` is an array of cards. `type: 'bonus'` buys into a round (emits
`buyBonusSelect`); `type: 'feature'` toggles a base-game modifier like Ante. For features, drive
the bar readout with:

```typescript
shell.activateFeature(option);    // bar shows the effective bet, BUY BONUS → DISABLE
shell.deactivateFeature();        // revert
```

Each card price renders as `priceMultiplier × current bet` in the shell currency.

**Customisation.** Two override hooks let a game replace the built-in UI while keeping the
shell's buy flow:

```typescript
// 1) Per-card UI — render your own card; the shell keeps the grid wrapper, accent vars and live
//    re-pricing, and runs the normal confirm → buy flow when you call ctx.select().
{ id: 'fs', title: 'Free Spins', description: '…', priceMultiplier: 100,
  custom: ({ priceText, disabled, accent, select }) => {
    const el = document.createElement('button');
    el.textContent = priceText; el.disabled = disabled;
    el.style.background = accent; el.addEventListener('click', select); // select() = internal flow
    return el;                                                          // ctx also has { bonus, bet, price }
  } }

// 2) Bar button action — open your OWN bonus UI instead of the built-in overlay.
createGameShell({ /* … */, onBonusBuy: () => myGame.openBonusScreen() });
```

`onBonusBuy` also makes the BUY BONUS button appear without a `features.buyBonus` array.

### Game info (`gameInfo.sections`)

The game-info overlay is composed from typed sections — declare what your game has and the shell
draws the rest:

- `{ type: 'modes', modes: GameMode[] }` — comparison table (title / price / rtp / maxWin).
- `{ type: 'controls' }` — auto-generated control legend.
- `{ type: 'paytable', rows: PaytableRow[] }` — symbol → win tiers (`"<count> x<multiplier>"`).
- `{ type: 'wins', kind, grid, … }` — auto-drawn win illustration. `kind` is `'classic'` (paylines),
  `'cluster'`, `'anywhere'`, or `'ways'`.
- `{ type: 'custom', title, html | node }` — your own rules markup.

```typescript
gameInfo: {
  sections: [
    { type: 'modes', modes: [{ title: 'Base game', price: '1× bet', rtp: 96.5, maxWin: '5,000×' }] },
    { type: 'controls' },
    { type: 'paytable', rows: [
      { symbol: { text: 'Wild' }, wins: [{ count: '5', multiplier: 250 }, { count: '3', multiplier: 50 }] },
    ] },
    { type: 'wins', kind: 'classic', grid: { cols: 5, rows: 3 },
      lines: [[1,1,1,1,1], [0,0,0,0,0], [2,2,2,2,2]] },
    { type: 'custom', title: 'Rules', html: '<p>Match left to right on adjacent reels.</p>' },
  ],
}
```

### Opening overlays & modals programmatically

```typescript
shell.openSettings();  shell.openInfo();  shell.openBuyBonus();
shell.openBetPicker(); shell.openAutoplayPicker();

// generic card modal
shell.openModal({
  availableClose: true,
  title: 'Connection lost',
  body: 'Reconnecting…',
  actions: [{ title: 'Retry', color: '#e11', on: () => reconnect() }],
});

// non-dismissable replay summary (START REPLAY → onReplay → reopen)
shell.openReplay({ bonusId: 'fs', bet: shell.state.bet, payoutMultiplier: 87.5,
  onReplay: () => playRecordedRound() });
```

### Layout & visual system

Transparent neutral chrome that doesn't compete with the game — brand colour appears only on the
BUY BONUS control and a duotone icon set. The bottom bar **adapts by viewport** automatically (a
`ResizeObserver` on the mount): landscape → one row scaled to fit, portrait → stacked mobile
layout; Settings / Game info / Buy bonus open as full-screen overlays. Motion is minimal (press
feedback, money count-up, overlay fades) and respects `prefers-reduced-motion`. Spacebar triggers
a spin in base mode (ignored while busy, in autoplay, when a modal/input is focused, or when
`features.spacebar` is `false`).

### Live demo

[`examples/shell-demo`](../../examples/shell-demo) is a full reference integration: every config
section, all three bar modes, theme/social toggles, viewport presets, and event wiring. QA params:
`?screen=<id>&kiosk=1&open=settings|info|buybonus`.

---

## Sub-path exports

| Path | What's there |
| --- | --- |
| `@energy8platform/platform-core` | Everything — re-exports from all sub-paths |
| `@energy8platform/platform-core/lua` | Browser-safe Lua engine surface: LuaEngine, ActionRouter, SessionManager, PersistentState, JS `SimulationRunner`, types |
| `@energy8platform/platform-core/simulation` | **Node-only.** `NativeSimulationRunner` (Go binary) and `ParallelSimulationRunner` (worker_threads). Don't import from a browser bundle — the main entry and `/lua` deliberately exclude these so they can't be tree-shake-leaked. |
| `@energy8platform/platform-core/dev-bridge` | `DevBridge`, `DevBridgeConfig`, `ReplayConfig`, `ReplayLaunch` |
| `@energy8platform/platform-core/vite` | `devBridgePlugin`, `luaPlugin` |
| `@energy8platform/platform-core/loading` | `createCSSPreloader`, `setCSSPreloaderProgress`, `waitCSSPreloaderTap`, `removeCSSPreloader`, `buildLogoSVG`, `LOADER_BAR_MAX_WIDTH` |
| `@energy8platform/platform-core/shell` | `createGameShell`, `removeGameShell` — branded renderer-agnostic DOM game shell (control bar, menu, settings, game info, buy bonus) |

The sub-paths exist for tree-shaking — pulling only `/lua` doesn't drag in DevBridge or vite types. The main entry is convenient for app-level code where size hardly matters.

---

## License

MIT
