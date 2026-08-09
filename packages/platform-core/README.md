# @energy8platform/platform-core

Renderer-agnostic core for games on the Energy8 casino platform. Pair it with PixiJS, Phaser, Three.js, DOM, or your own engine — `platform-core` ships everything that is platform-specific (Energy8 SDK lifecycle, the SpinML math runtime, RTP simulation, mock host bridge for local dev, branded loading frame, Vite plugins) without dragging in a renderer.

If you want the full PixiJS engine on top of this, install [`@energy8platform/game-engine`](../game-engine/README.md) instead — it depends on `platform-core` and adds scenes, UI, animation, viewport, and React integration.

---

## Table of Contents

- [Why this package exists](#why-this-package-exists)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Public API](#public-api)
- [PlatformSession](#platformsession)
- [Writing your game (spec + SpinML)](#writing-your-game-spec--spinml)
- [SpinML Runtime (e8)](#spinml-runtime-e8)
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

The Energy8 casino platform has a contract every game must speak: an SDK handshake, a play-action lifecycle, a SpinML execution model used both server-side and locally for development and RTP verification, and a host-side branded loading frame.

That contract is identical regardless of how you render. So it lives here, with **zero rendering or DOM-coupled code** in the bundle (the only DOM API used is `window` in the dev-mode `MemoryChannel` and `document` in the CSS preloader — neither touches a canvas/WebGL).

You bring the renderer; `platform-core` brings the platform.

---

## Installation

```bash
npm install @energy8platform/platform-core @energy8platform/game-sdk
```

Postinstall downloads the `e8` / `e8-server` engine binaries for your
platform from the game-engine repo's GitHub Releases (tag `e8-v<version>`)
into `platform-core/bin`. Overrides: `E8_BINARY` / `E8_SERVER_BINARY` (local
build), `E8_RELEASE_REPO` / `E8_DOWNLOAD_BASE` (mirror). The download is
non-fatal — without it, spin games need one of the overrides.

### Peer dependencies

| Package | Version | Required |
| --- | --- | --- |
| `@energy8platform/game-sdk` | `^2.7.0` | Yes |
| `vite` | `^5.0.0 \|\| ^6.0.0` | Optional — only if you import `/vite` |

No `pixi.js`, no `react`, no `phaser`, no DOM rendering library is required.

---

## Quick Start

```typescript
import { createPlatformSession, createCSSPreloader, removeCSSPreloader } from '@energy8platform/platform-core';
// The .spin math source. The DevBridge field is still called `luaScript` —
// for the client it is only the "play via POST /__lua-play" marker; the
// route is served by e8-server through the `spinPlugin` vite plugin.
import mathScript from './game/script.spin?raw';
import { gameDefinition } from './gameDefinition';

const container = document.getElementById('app')!;

// 1. Show the Energy8 brand frame immediately.
createCSSPreloader(container);

// 2. Boot the platform session — DevBridge in dev, real SDK in prod.
const session = await createPlatformSession({
  dev: {
    luaScript: mathScript,
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

  // Simulation types (runtime classes live in the Node-only /simulation
  // sub-path: NativeSimulationRunner, findE8Binary, formatNativeResult)
  type NativeSimulationConfig, type NativeSimulationResult,
  type StageStats, type DistributionBucket,

  // DevBridge mock host
  DevBridge, type DevBridgeConfig,
  type ReplayConfig, type ReplayLaunch,

  // Branded loading frame (lifecycle API)
  createCSSPreloader, setCSSPreloaderProgress, waitCSSPreloaderTap, removeCSSPreloader,
  buildLogoSVG, LOADER_BAR_MAX_WIDTH,

  // Internal utility
  EventEmitter,

  // Platform types (re-exported from @energy8platform/game-sdk + legacy /lua types)
  type InitData, type GameConfigData, type SessionData,
  type PlayParams, type PlayResultData, type BalanceData,
  type GameDefinition, type ActionDefinition, type TransitionRule,
  type SessionConfig,
  type BuyBonusConfig, type AnteBetConfig, type MaxWinConfig,
  type AssetManifest, type AssetBundle, type AssetEntry,
  type LoadingScreenConfig,
  // …more — see src/types.ts
} from '@energy8platform/platform-core';

// Game-spec derivation (spec → SpinML prelude → platform bundle):
import {
  defineGame, buildSpinScript, exportGameSpin,
} from '@energy8platform/platform-core/game-spec';
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

The platform validates `bet` against `bet_levels` and rejects `bet: 0`. No double debit happens — session actions don't debit, and the engine reads the actual session bet from server-side session state regardless of what the client sends. See [Game Development Guide §13.16](https://github.com/energy8platform/game-engine/blob/main/game_development_guide.md#13-conventions-and-best-practices) for the full conventions list.

---

## Writing your game (spec + SpinML)

Each game on the Energy8 platform consists of two sources:

1. A **game spec** (`src/game.spec.ts`, for scaffolded games) — symbols, paytable, bet levels, max win, modes, RTP targets. One source of truth; `GameDefinition`, the SpinML prelude, and the math-pipeline mode map are all derived from it via `/game-spec`.
2. A **SpinML script** (`.spin`) — a statically-typed, Lua-flavored DSL that owns *all* game math **and** declares its actions, costs, and session transitions. JIT-compiled to native code by the `e8` engine.

The same `.spin` runs in dev (e8-server behind the Vite plugin), in RTP simulation (`e8 simulate`), and in production (the platform's `engine_mode: "spin"`).

### Minimal slot — `script.spin`

```spin
record Vars { free_spins_awarded: int }

enum SpinData tag stage {
  base_game { matrix: [[int]]  win_line: int }
}

game "my-slot" {
  bet_levels = [0.20, 0.50, 1.00, 2.00, 5.00]
  max_win = 10000.0
  vars = Vars
  data = SpinData
}

action spin { stage = base_game  cost = 1.0 }

-- Payouts are *bet multipliers*. The platform scales by the player's
-- actual bet on the way out — never multiply by bet inside the script.
const PAYS: [float; 6] = [50.0, 30.0, 20.0, 10.0, 5.0, 2.0]

fn execute(c: ctx, v: Vars) -> outcome {
  let matrix: [[int]] = list()
  for col in 0..3 {
    let rows: [int] = list()
    for row in 0..3 { push(rows, rng(c, 0, 5)) }
    push(matrix, rows)
  }

  -- pay if all 3 middle-row symbols match
  let a = matrix[0][1]
  let win = 0.0
  let line = 0
  if a == matrix[1][1] && a == matrix[2][1] {
    win = PAYS[a]
    line = 1
  }

  return outcome {
    win: win,
    vars: Vars { free_spins_awarded: 0 },
    data: SpinData.base_game { matrix: matrix, win_line: line },
  }
}
```

That's the entire contract: `outcome { win, vars, data }` — a bet-multiplier
win, the typed persisted state, and a stage-tagged payload. The platform
handles the rest — debit/credit (`real_win = bet × win`), balance updates,
session lifecycle (from the `opens`/`extends`/`ends when` action
declarations), cap enforcement.

In dev, `dev.config.ts` carries the script source and the (spec-derived)
`GameDefinition` — see [Quick Start](#quick-start).

### Full reference

- **[SpinML language guide](../../docs/spinml.md)** — declarations, types, const groups, builtins, limits, simulation dialect.
- **[Lua → SpinML migration](../../docs/lua-to-spin-migration.md)** — porting an existing game.
- **[Game Development Guide](../../game_development_guide.md)** — the platform contract: `GameDefinition` shape, actions, deployment, S3 layout, table games.

---

## SpinML Runtime (e8)

The math runtime is the Rust `e8` engine (SpinML → Cranelift JIT → native
code), delivered as per-platform binaries by postinstall:

- **`e8`** — CLI: `check` (compile + type-check a `.spin`) and `simulate`
  (Go-CLI-compatible dialect — same flags, JSON shape, and statistics as the
  old simulate binary; ~4M rounds/sec per core).
- **`e8-server`** — the round server. In dev the Vite `spinPlugin` spawns it
  (`--sessions memory --watch`: hot-reloads the `.spin` on save, open rounds
  finish on the old version). In production the platform talks to the same
  domain API over gRPC — dev exercises the exact prod contract.

The old in-process classes (`LuaEngine`, `ActionRouter`, `SessionManager`,
`SimulationRunner`) were removed with the fengari runtime — the engine now
owns rounds, sessions, idempotency, and RNG. Legacy Lua games stay on
platform-core ≤ 0.28.x; see the migration guide to move.

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

  // Or: hand it your .spin game math (preferred — same code as prod;
  // served by e8-server via spinPlugin, the field name is legacy)
  // luaScript, gameDefinition, luaSeed,
});

bridge.start();
// later:
bridge.setBalance(5000);
bridge.destroy();
```

Most of the time you don't construct DevBridge yourself — `createPlatformSession({ dev: { … } })` does it for you.

### Platform-parity behavior (server mode)

With `luaScript` + `gameDefinition` set (the field name is legacy — it carries the `.spin` source and marks "play via `POST /__lua-play`", served by e8-server through `spinPlugin`), DevBridge mirrors the server's `PlayRound` contract so error-handling code written against dev runs unchanged in prod. Invalid requests come back as `PLAY_ERROR` and the SDK's `play()` rejects with `SDKError(code, message)`:

| code                    | when                                                     |
|-------------------------|----------------------------------------------------------|
| `INVALID_INPUT`         | unknown action                                           |
| `INVALID_AMOUNT`        | `bet` not in `bet_levels` (list or `{min, max}` range)   |
| `INSUFFICIENT_FUNDS`    | computed debit > balance (no wallet movement, no fetch)  |
| `ACTIVE_SESSION_EXISTS` | non-session action while a session is in progress        |
| `NO_ACTIVE_SESSION`     | session-required action without an active session        |
| `SESSION_EXPIRED`       | session past `gameDefinition.session_ttl` (default 24h)  |
| `ENGINE_ERROR`          | script execution failed (debit is rolled back)           |

Other contract details DevBridge enforces:

- **Round IDs are server-generated** (`crypto.randomUUID`). The client value in `PlayParams.roundId` is ignored for non-session actions and replaced with the active session's id for session-based ones — matches the platform's `playRound` UUID rules.
- **`STATE_RESPONSE`** returns the last `PlayResultData` (with `session.history` populated) while a session is active and not yet completed, mirroring `GET /api/games/{id}/session`.
- **`creditPending`** is `false` in the normal path. The wire flag means "wallet credit failed, queued for retry" — never "credit deferred until session completes".
- **`session.history`** is appended on every session round (`{spinIndex, win, data}`), so the client can rebuild the screen after reload.
- **`MapState` parity** — `multiplier`, `global_multiplier`, `free_spins_total`, `max_win_reached` are auto-injected into `result.data` from engine variables when the script doesn't set them explicitly.

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

`platform-core` ships a dev CLI that runs your `.spin` through millions of iterations via `e8 simulate` to verify math and stage distributions. It picks up the script and `gameDefinition` from your `dev.config.ts` automatically. (For the full book-bundle pipeline — pool/curate/publish — use `e8-math` from `@energy8platform/stake-math-tools`.)

```bash
# 1M spins (default)
npx platform-core-simulate

# Buy-bonus action (just simulate the action by name)
npx platform-core-simulate --action buy_bonus

# Ante bet — also a regular action
npx platform-core-simulate --action ante_spin

# Custom: 5M iterations, custom config path
npx platform-core-simulate --iterations 5000000 --bet 1 --config ./dev.config.ts
```

### Reproducibility: seeds, RNG backend, and replay

The engine keeps the provably-fair seeding contract of the old Go simulate tool. Pass `--seed=<hex>` to reproduce a previous run bit-for-bit (results are also **core-count independent** — the master seed derives 64 RNG lanes, `round % 64`); if you omit it, a seed is generated and reported (`Master seed: …`) so you can rerun the exact distribution later.

```bash
# Reproducible run — supply the master seed yourself
npx platform-core-simulate \
  --iterations 1000000 \
  --seed 00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff

# Fast PCG RNG — faster but diverges from production. Local iteration only;
# do NOT publish RTP numbers from --rng=fast.
npx platform-core-simulate --rng fast

# Replay a single round captured in `provably_fair_rounds`. All three flags
# are required and require provably-fair RNG.
npx platform-core-simulate \
  --iterations 1 \
  --replay-server-seed <hex> \
  --replay-client-seed <client_seed> \
  --replay-nonce-start 42
```

The result echoes `masterSeed`, `rngKind`, `workerSeeds[]`, and `replay` when in replay mode — all also surface on `NativeSimulationResult` for programmatic use. Output matches the old server-side simulation format field-for-field, plus stddev/CV, the 0–10 volatility score, and the win-distribution buckets.

Programmatic use (Node-only sub-path):

```typescript
import { NativeSimulationRunner, findE8Binary, formatNativeResult } from '@energy8platform/platform-core/simulation';

const native = new NativeSimulationRunner({
  binaryPath: findE8Binary() ?? process.env.E8_BINARY!,
  argsPrefix: ['simulate'],
  script, scriptExt: 'spin', gameDefinition,
  iterations: 1_000_000, bet: 1,
  rng: 'provably-fair',                // default; use 'fast' for local iteration only
  seed: '00112233...eeff',             // hex master seed; omit to auto-generate
  // replay: { serverSeed, clientSeed, nonceStart },  // single-round reproduction
});
const r = await native.run();
console.log(formatNativeResult(r));
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
import { devBridgePlugin, spinPlugin } from '@energy8platform/platform-core/vite';

export default defineConfig({
  plugins: [
    devBridgePlugin('./dev.config'),
    spinPlugin({ spinPath: './src/game/script.spin', gameId: 'my-slot' }),
  ],
});
```

What they do:
- **`devBridgePlugin`** injects a virtual entry that boots `DevBridge` from your `./dev.config` *before* your real entry imports. Dev-only.
- **`spinPlugin`** spawns `e8-server` (`--sessions memory --watch`) and exposes `POST /__lua-play` (the route name is the frozen DevBridge contract). The server owns rounds/sessions/idempotency — dev exercises the exact production domain API. Saving the `.spin` hot-reloads the math; open rounds finish on the old version. Binary resolution: `binPath` option → `E8_SERVER_BINARY` → `platform-core/bin` (postinstall) → `PATH`.

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
replay), the bar menu, the game-info panel, and a buy-bonus selection overlay, plus generic
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
| `currency` | `CurrencyConfig` | `{ symbol, position: 'left'\|'right', maxDecimals?, minDecimals?, separator? }`. `maxDecimals` (default 2) / `minDecimals` (default `maxDecimals`): **win & total-win** show up to `maxDecimals`, trimming trailing zeros down to `minDecimals`; **balance / bet / prices** stay fixed at `minDecimals`. `separator` defaults to `{ thousands: ',', decimal: '.' }` → `€1,234.50`. |
| `availableBets` | `number[]` | Bet ladder shown in the bet picker. |
| `defaultBet` / `currentBet` | `number` / `number \| null` | `currentBet` restores a saved bet; `null` falls back to `defaultBet`. |
| `balance` / `win` | `number` | Initial readouts. |
| `mode` | `'base' \| 'freeSpins' \| 'replay'` | Drives which bottom-bar variant renders. |
| `gameInfo` | `GameInfoContent` | Sections for the game-info overlay (see below). |
| `menu` | `MenuItem[]?` | Bar-menu popover items, in order (see below). Omit for the default list. |
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
| `menuOpen` | — | The bar-menu popover opened. A second burger tap closes it and emits nothing. |
| `settingsOpen` | — | **Deprecated** — only emitted by the deprecated `openSettings()` alias (which still opens the menu). New code should call `openMenu()` and listen for `menuOpen`. |
| `infoOpen` | — | Game-info overlay opened. |
| `settingChange` | `{ key, value }` | A bar-menu item's value changed (preset or custom). `key` is the item's id. Built-in: `sound` (bool), `music` / `sfx` (0–1). A custom item reports its own id and value type. |

### State setters (`game → shell`)

Each setter updates `shell.state` and re-renders. `setBalance` / `setWin` animate a count-up from
the previous value.

```typescript
shell.setBalance(n); shell.setWin(n); shell.setBet(n);
shell.setBusy(true);                 // disables controls mid-spin
shell.setMode('freeSpins');
shell.setFreeSpins({ current: 1, total: 10, totalWin: 0 });   // counter shows "1 / 10"
shell.setFreeSpins({ total: 9, totalWin: 0 });                // current omitted/null → single number "9" (decrement it for a countdown)
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
  `'cluster'`, `'anywhere'`, `'ways'`, or `'shapes'` — `{ kind: 'shapes', shapes: ShapeDef[] }` lists
  named cell patterns (`{ cells: CellRef[], name, description? }`) as a grid-illustration row each.
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

### Bar menu (`ShellConfig.menu`)

The burger button opens a compact popover anchored to itself — not a full-screen overlay. Its
content is declared as a list: a built-in `id` selects a preset, otherwise `type` says how to draw
a custom row.

- `{ id: 'sound' }` — sound on/off toggle.
- `{ id: 'music' }` / `{ id: 'sfx' }` — volume sliders (0–1, percent readout).
- `{ id: 'gameInfo' }` — opens the game-info overlay.
- `{ type: 'toggle', value?, onChange? }` — a custom on/off row; `onChange` fires when it's toggled.
- `{ type: 'range', min?, max?, step?, value?, format?, onChange? }` — a custom slider. Omitted
  bounds default to `min: 0, max: 1, step: (max-min)/20` (exactly a volume slider); `format`
  defaults to a percent readout for a 0..1 range, else the raw number.
- `{ type: 'button', chevron?, onSelect? }` — a row that runs a callback (e.g. opens your own UI).
- `{ type: 'separator' }` — a divider line.

Every kind (preset or custom) also takes `label?` (translated override), `icon?` (a name from the
shell's built-in glyph set) and `disabled?` (dims the row and blocks interaction).

```typescript
createGameShell({
  // …
  menu: [
    { id: 'sound' }, { id: 'music' }, { id: 'sfx' },
    { type: 'separator' },
    { id: 'gameInfo' },
    { id: 'lefty', type: 'toggle', label: 'Left-hand mode',
      value: false, onChange: (v) => layout.mirror(v) },
    { id: 'speed', type: 'range', label: 'Reel speed', min: 1, max: 5, step: 1,
      value: 2, format: (v) => `×${v}`, onChange: (v) => reels.setSpeed(v) },
    { id: 'paytable', type: 'button', label: 'Paytable', icon: 'ticket',
      chevron: true, onSelect: () => openPaytable() },
  ],
});
```

Omit `menu` for the default list: `sound`, `music`, `sfx`, a separator, `gameInfo`.

| Method | Behaviour |
| --- | --- |
| `shell.setMenu(items)` | Replaces the list; an open popover rebuilds. Values already in state are kept; new ids are seeded from their `value`. |
| `shell.getMenuValue(id)` | Reads a preset or custom item's current value (`boolean \| number \| undefined`; `undefined` for unknown ids and for `button` / `separator`). |
| `shell.setMenuValue(id, v)` | Writes a value — clamps a range to its declared bounds, stores it, emits `settingChange`, and live-updates an open popover. |
| `shell.openMenu()` | Opens the popover; called again while it's open, closes it (the burger toggles). |

`shell.setSound(on)` / `shell.getVolume(key)` / `shell.setVolume(key, v)` stay as thin aliases over
the same state for the `sound` / `music` / `sfx` presets — existing code keeps working.

`shell.openSettings()` is a **deprecated** alias for `openMenu()`, kept for compatibility; it also
still emits the deprecated `settingsOpen` event (see Events above). New code should call
`openMenu()` and listen for `menuOpen`.

### Opening overlays & modals programmatically

```typescript
shell.openMenu();      shell.openInfo();     shell.openBuyBonus();
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

> **⚠️ Keep `features.buyBonus` populated in replay mode.** The replay summary resolves the
> mode title and **cost multiplier** by matching `bonusId` against `features.buyBonus`. If you set
> `features.buyBonus: false` (or drop the matching option) while replaying, the modal can't find the
> bonus and falls back to a `1×` cost and the raw `bonusId` as the title. The BUY BONUS button only
> renders in `base` mode, so leaving the options populated during replay has no UI downside — it
> just gives the replay window the data it needs.

### Layout & visual system

Transparent neutral chrome that doesn't compete with the game — brand colour appears only on the
BUY BONUS control and a duotone icon set. The bottom bar **adapts by viewport** automatically (a
`ResizeObserver` on the mount): landscape → one row scaled to fit, portrait → stacked mobile
layout; Game info / Buy bonus open as full-screen overlays, while the bar menu opens as a compact,
light-dismiss popover anchored to the burger button. Motion is minimal (press
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
| `@energy8platform/platform-core/game-spec` | `defineGame`, `validateSpec`, `toGameDefinition`, `toSpinPrelude`, `buildSpinScript`, `exportGameSpin` — the one-source-of-truth spec layer |
| `@energy8platform/platform-core/lua` | **Types only** (GameDefinition, ActionDefinition, …). The fengari runtime was removed in 0.29 — legacy Lua games stay on ≤ 0.28.x |
| `@energy8platform/platform-core/simulation` | **Node-only.** `NativeSimulationRunner` / `findE8Binary` / `formatNativeResult` (wraps `e8 simulate`). Don't import from a browser bundle |
| `@energy8platform/platform-core/dev-bridge` | `DevBridge`, `DevBridgeConfig`, `ReplayConfig`, `ReplayLaunch` |
| `@energy8platform/platform-core/vite` | `devBridgePlugin`, `spinPlugin` |
| `@energy8platform/platform-core/loading` | `createCSSPreloader`, `setCSSPreloaderProgress`, `waitCSSPreloaderTap`, `removeCSSPreloader`, `buildLogoSVG`, `LOADER_BAR_MAX_WIDTH` |
| `@energy8platform/platform-core/slot-result` | Slot result normalization helpers shared by scaffolded games |
| `@energy8platform/platform-core/shell` | Moved to `@energy8platform/shell` (subpaths `/html`, `/pixi`) |

The sub-paths exist for tree-shaking — pulling only `/game-spec` doesn't drag in DevBridge or vite types. The main entry is convenient for app-level code where size hardly matters.

---

## License

MIT
