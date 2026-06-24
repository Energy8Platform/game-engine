# createSlotGame() Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@energy8platform/game-engine/host` — `createSlotGame(opts)` that wraps `GameApplication` and absorbs the per-game bootstrap (Stake detect+bridge, font preload, texture defaults, config assembly, scene register/start, fatal-error modal, double-boot guard), plus `isStakeLaunch` in `@energy8platform/stake-bridge/detect`.

**Architecture:** A new `src/host/` sub-package in game-engine with pure, unit-tested helpers (`buildAppConfig`, `loadFonts`, `applyTextureDefaults`, `bootGuard`, `showFatalError`) and a thin orchestrator (`createSlotGame`) that sequences them around `GameApplication`. Stake detection moves to a new leaf module `packages/stake-bridge/src/detect.ts` exposed via a lightweight `/detect` sub-path so the heavy bridge stays lazy. The orchestrator is not unit-tested (Pixi `init()` hangs headless) — it is covered by the pure units + typecheck + the extended `examples/spec-slot`.

**Tech Stack:** TypeScript, Vitest (node env), Rollup (multi-entry), Pixi v8, npm workspaces. `stake-bridge` is an in-repo workspace (`packages/stake-bridge`), symlinked into `node_modules` — no cross-repo coordination.

## Global Constraints

- `stake-bridge` is an in-repo workspace at `packages/stake-bridge` (root `workspaces: ["packages/*","examples/*"]`); `node_modules/@energy8platform/stake-bridge` symlinks to it. Modify it in place; build it before typechecking game-engine.
- Host lives at `packages/game-engine/src/host/`; pixi-flavored (it wraps `GameApplication`).
- `isStakeLaunch(input): boolean` is non-throwing: `true` iff the URL has `rgs_url` AND (`sessionID` present OR `replay === 'true'`); any parse failure → `false`. It must NOT import `RGSClient`/`StakeBridge` (leaf module, kept out of the heavy bundle).
- All Stake code (including `/detect`) is imported **lazily inside `if (opts.stake)`** — games without Stake pull zero stake code.
- `sdk.devMode = isStakeNow || (opts.dev ?? false)` — the library cannot read the game's `import.meta.env.DEV`, so the game passes `dev`.
- On Stake bridge failure: show the fatal modal and **throw** (symmetric with a `start()` failure); no half-built handle. The game wraps `createSlotGame(...)` in `.catch()`.
- `betLevels`/`currency` are NOT placed in `GameApplicationConfig` — they flow via SDK/DevBridge from `dev.config` (built from `model`, slice 1). The host does not duplicate them.
- Tests are renderer-free. Vitest configs: game-engine `tests/**/*.test.ts`; stake-bridge `test/**/*.test.ts`. The orchestrator and Pixi boot are NOT unit-tested (headless hang) — verified by typecheck + example build.
- Reuse existing types verbatim: `GameApplicationConfig`, `ScaleMode`, `Orientation`, `SceneConstructor` from `packages/game-engine/src/types.ts`; `GameApplication` from `../core`; `GameModel` from `@energy8platform/platform-core/game-spec`; `BookAdapter`, `AdapterModule`, `StakeBridge` (type-only) from `@energy8platform/stake-bridge`.
- Commit after each task. Branch already exists: `feat/game-spec-define-game` (continuing slice 2 in it).

## File Structure

```
packages/stake-bridge/
  src/detect.ts              isStakeLaunch(input): boolean
  src/index.ts               + re-export { isStakeLaunch }
  rollup.config.ts           + detect entry (esm + umd + d.ts)
  package.json               + exports './detect'
  test/detect.test.ts
packages/game-engine/src/host/
  types.ts                   CreateSlotGameOptions, SlotGameHandle, StakeIntegration, SceneEntry
  buildConfig.ts             buildAppConfig(opts, isStakeNow): GameApplicationConfig
  preboot.ts                 loadFonts(specs), applyTextureDefaults(), bootGuard(flag)
  fatalError.ts              showFatalError(container, message)
  createSlotGame.ts          createSlotGame(opts): Promise<SlotGameHandle>
  index.ts                   public surface
packages/game-engine/
  package.json               + exports './host'; + stake-bridge optional peer + dev dep
  rollup.config.mjs          + bundle 'src/host/index.ts' 'host'; + stake-bridge externals
packages/game-engine/tests/host/
  buildConfig.test.ts
  preboot.test.ts
  fatalError.test.ts
examples/spec-slot/
  GameScene.ts               trivial Scene
  main.ts                    createSlotGame({ model, scene, manifest, ... })
  package.json               + @energy8platform/game-engine, pixi.js (dev)
  tsconfig.json              include main.ts/GameScene.ts
```

---

### Task 1: `isStakeLaunch` + `/detect` sub-path in stake-bridge

**Files:**
- Create: `packages/stake-bridge/src/detect.ts`
- Modify: `packages/stake-bridge/src/index.ts` (re-export)
- Modify: `packages/stake-bridge/rollup.config.ts` (detect entries)
- Modify: `packages/stake-bridge/package.json` (`./detect` export)
- Test: `packages/stake-bridge/test/detect.test.ts`

**Interfaces:**
- Produces: `isStakeLaunch(input: string | URL | Location): boolean`, importable from `@energy8platform/stake-bridge` and `@energy8platform/stake-bridge/detect`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/stake-bridge/test/detect.test.ts
import { describe, it, expect } from 'vitest';
import { isStakeLaunch } from '../src/detect';

const RGS = 'rgs_url=https%3A%2F%2Fx.stake-engine.com';

describe('isStakeLaunch', () => {
  it('true for a live wallet launch (rgs_url + sessionID)', () => {
    expect(isStakeLaunch(`https://game.example/?${RGS}&sessionID=abc`)).toBe(true);
  });
  it('true for a replay launch (rgs_url + replay=true)', () => {
    expect(isStakeLaunch(`https://game.example/?${RGS}&replay=true&game=g&version=1&mode=BASE&event=1`)).toBe(true);
  });
  it('false when rgs_url is missing', () => {
    expect(isStakeLaunch('https://game.example/?sessionID=abc')).toBe(false);
  });
  it('false when rgs_url present but no sessionID and no replay', () => {
    expect(isStakeLaunch(`https://game.example/?${RGS}`)).toBe(false);
  });
  it('false for replay flag that is not exactly "true"', () => {
    expect(isStakeLaunch(`https://game.example/?${RGS}&replay=1`)).toBe(false);
  });
  it('false for a malformed url', () => {
    expect(isStakeLaunch('::::not a url::::')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/stake-bridge/test/detect.test.ts`
Expected: FAIL — cannot resolve `../src/detect`.

- [ ] **Step 3: Write `detect.ts`**

```ts
// packages/stake-bridge/src/detect.ts
/**
 * Lightweight, non-throwing detector for a Stake Engine launch.
 *
 * Lives in a leaf module (no RGSClient / StakeBridge imports) so it can be
 * imported to gate whether to lazy-load the heavy bridge, without pulling
 * the bridge into the bundle.
 *
 * Returns true iff the URL carries `rgs_url` AND either a live `sessionID`
 * or `replay=true`. Any parse failure → false.
 */
export function isStakeLaunch(input: string | URL | Location): boolean {
  try {
    const href =
      typeof input === 'string' ? input : 'href' in input ? input.href : String(input);
    const params = new URL(href).searchParams;
    if (!params.get('rgs_url')) return false;
    return params.get('sessionID') != null || params.get('replay') === 'true';
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Re-export from `index.ts`**

Add to `packages/stake-bridge/src/index.ts` (near the other named exports):

```ts
export { isStakeLaunch } from './detect';
```

- [ ] **Step 5: Add the `/detect` rollup entries**

In `packages/stake-bridge/rollup.config.ts`, append three config objects to the exported array (mirroring the existing index entries, input `src/detect.ts`):

```ts
  // detect ESM
  {
    input: 'src/detect.ts',
    external,
    output: { file: 'dist/detect.esm.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },
  // detect UMD
  {
    input: 'src/detect.ts',
    external,
    output: {
      file: 'dist/detect.umd.js',
      format: 'umd',
      name: 'StakeBridgeDetect',
      sourcemap: true,
      exports: 'named',
      globals: {
        '@energy8platform/game-sdk': 'CasinoGameSDK',
        '@energy8platform/game-sdk/protocol': 'CasinoGameSDKProtocol',
      },
    },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false })],
  },
  // detect type declarations
  {
    input: 'src/detect.ts',
    external,
    output: { file: 'dist/detect.d.ts', format: 'esm' },
    plugins: [dts()],
  },
```

- [ ] **Step 6: Add the `./detect` package export**

In `packages/stake-bridge/package.json`, change `exports` from a single `"."` to include `./detect`:

```json
  "exports": {
    ".": {
      "import": "./dist/stake-bridge.esm.js",
      "require": "./dist/stake-bridge.umd.js",
      "types": "./dist/index.d.ts"
    },
    "./detect": {
      "import": "./dist/detect.esm.js",
      "require": "./dist/detect.umd.js",
      "types": "./dist/detect.d.ts"
    }
  },
```

- [ ] **Step 7: Run test + build to verify**

Run: `npx vitest run packages/stake-bridge/test/detect.test.ts`
Expected: PASS (6 tests).
Run: `npm run build --workspace @energy8platform/stake-bridge`
Expected: emits `dist/detect.esm.js`, `dist/detect.umd.js`, `dist/detect.d.ts` (alongside the existing stake-bridge bundles).

- [ ] **Step 8: Commit**

```bash
git add packages/stake-bridge/src/detect.ts packages/stake-bridge/src/index.ts \
        packages/stake-bridge/rollup.config.ts packages/stake-bridge/package.json \
        packages/stake-bridge/test/detect.test.ts
git commit -m "feat(stake-bridge): isStakeLaunch detector + /detect sub-path"
```

---

### Task 2: Host types + `buildAppConfig`

**Files:**
- Create: `packages/game-engine/src/host/types.ts`
- Create: `packages/game-engine/src/host/buildConfig.ts`
- Test: `packages/game-engine/tests/host/buildConfig.test.ts`

**Interfaces:**
- Consumes: `GameApplicationConfig`, `ScaleMode`, `Orientation`, `SceneConstructor` from `../types`; `GameModel` from `@energy8platform/platform-core/game-spec`; `AssetManifest`, `AudioConfig`, `LoadingScreenConfig` from `@energy8platform/platform-core`; `BookAdapter`, `AdapterModule`, `StakeBridge` (type-only) from `@energy8platform/stake-bridge`; `ApplicationOptions` from `pixi.js`.
- Produces:
  - The option/handle types in `types.ts` (see code).
  - `buildAppConfig(opts: CreateSlotGameOptions, isStakeNow: boolean): GameApplicationConfig`.

- [ ] **Step 1: Write `types.ts`**

```ts
// packages/game-engine/src/host/types.ts
import type { ApplicationOptions } from 'pixi.js';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { AssetManifest, AudioConfig, LoadingScreenConfig } from '@energy8platform/platform-core';
import type { BookAdapter, AdapterModule, StakeBridge } from '@energy8platform/stake-bridge';
import type { GameApplication } from '../core';
import type { ScaleMode, Orientation, SceneConstructor } from '../types';

export interface StakeIntegration {
  /** The game's BookAdapter (or its module). modeMap + gameId come from the model. */
  adapter: BookAdapter | AdapterModule;
}

export interface SceneEntry {
  key: string;
  scene: SceneConstructor;
}

export interface CreateSlotGameOptions {
  model: GameModel;
  scene: SceneEntry;
  manifest: AssetManifest;
  container?: HTMLElement | string;
  design?: { width: number; height: number };
  scaleMode?: ScaleMode;
  orientation?: Orientation;
  loading?: LoadingScreenConfig;
  audio?: AudioConfig;
  pixi?: Partial<ApplicationOptions>;
  fonts?: string[];
  textureDefaults?: boolean;
  dev?: boolean;
  stake?: StakeIntegration;
  onFatalError?: (message: string) => void;
}

export interface SlotGameHandle {
  game: GameApplication;
  stakeBridge: StakeBridge | null;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/game-engine/tests/host/buildConfig.test.ts
import { describe, it, expect } from 'vitest';
import { buildAppConfig } from '../../src/host/buildConfig';
import { ScaleMode, Orientation } from '../../src/types';
import type { CreateSlotGameOptions } from '../../src/host/types';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const minimal = (over: Partial<CreateSlotGameOptions> = {}): CreateSlotGameOptions => ({
  model: {} as GameModel,
  scene: { key: 'game', scene: class {} as never },
  manifest: { bundles: [] },
  ...over,
});

describe('buildAppConfig', () => {
  it('applies defaults (container, design, scale, orientation)', () => {
    const c = buildAppConfig(minimal(), false);
    expect(c.container).toBe('#game');
    expect(c.designWidth).toBe(1920);
    expect(c.designHeight).toBe(1080);
    expect(c.scaleMode).toBe(ScaleMode.FILL);
    expect(c.orientation).toBe(Orientation.ANY);
  });
  it('passes through manifest/loading/audio/pixi/design overrides', () => {
    const loading = { backgroundColor: 0x010203 };
    const audio = { music: 0.5 };
    const pixi = { antialias: true };
    const c = buildAppConfig(
      minimal({ design: { width: 1080, height: 1920 }, loading, audio, pixi }),
      false,
    );
    expect(c.designWidth).toBe(1080);
    expect(c.designHeight).toBe(1920);
    expect(c.loading).toBe(loading);
    expect(c.audio).toBe(audio);
    expect(c.pixi).toBe(pixi);
  });
  it('computes sdk.devMode across all isStakeNow/dev combinations', () => {
    const dm = (isStakeNow: boolean, dev?: boolean) =>
      (buildAppConfig(minimal({ dev }), isStakeNow).sdk as { devMode: boolean }).devMode;
    expect(dm(false, false)).toBe(false);
    expect(dm(false, undefined)).toBe(false);
    expect(dm(true, false)).toBe(true);
    expect(dm(false, true)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/host/buildConfig.test.ts`
Expected: FAIL — cannot resolve `../../src/host/buildConfig`.

- [ ] **Step 4: Write `buildConfig.ts`**

```ts
// packages/game-engine/src/host/buildConfig.ts
import type { GameApplicationConfig } from '../types';
import { ScaleMode, Orientation } from '../types';
import type { CreateSlotGameOptions } from './types';

/**
 * Pure: map host options to a GameApplicationConfig with sane defaults.
 * `isStakeNow` is computed by the orchestrator (kept out of here so this
 * stays a pure, renderer-free function).
 */
export function buildAppConfig(
  opts: CreateSlotGameOptions,
  isStakeNow: boolean,
): GameApplicationConfig {
  return {
    container: opts.container ?? '#game',
    designWidth: opts.design?.width ?? 1920,
    designHeight: opts.design?.height ?? 1080,
    scaleMode: opts.scaleMode ?? ScaleMode.FILL,
    orientation: opts.orientation ?? Orientation.ANY,
    loading: opts.loading,
    manifest: opts.manifest,
    audio: opts.audio,
    pixi: opts.pixi,
    sdk: { devMode: isStakeNow || (opts.dev ?? false) },
    debug: opts.dev ?? false,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/host/buildConfig.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/game-engine/src/host/types.ts packages/game-engine/src/host/buildConfig.ts \
        packages/game-engine/tests/host/buildConfig.test.ts
git commit -m "feat(game-engine): host types + buildAppConfig"
```

---

### Task 3: Preboot helpers + fatal-error modal

**Files:**
- Create: `packages/game-engine/src/host/preboot.ts`
- Create: `packages/game-engine/src/host/fatalError.ts`
- Test: `packages/game-engine/tests/host/preboot.test.ts`
- Test: `packages/game-engine/tests/host/fatalError.test.ts`

**Interfaces:**
- Produces:
  - `loadFonts(specs?: string[]): Promise<void>` — awaits `document.fonts.load` for each spec; never throws.
  - `applyTextureDefaults(): void` — sets `TextureSource.defaultOptions.autoGenerateMipmaps = true`.
  - `bootGuard(flag?: string): boolean` — `true` on first call, `false` if already booted (keyed on `window[flag]`). Default flag `'__e8SlotBooted__'`.
  - `showFatalError(container: HTMLElement | string, message: string): void` — appends a fixed-position overlay with the message.

- [ ] **Step 1: Write the failing preboot test**

```ts
// packages/game-engine/tests/host/preboot.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFonts, bootGuard } from '../../src/host/preboot';

describe('loadFonts', () => {
  beforeEach(() => {
    (globalThis as any).document = { fonts: { load: vi.fn().mockResolvedValue([]), ready: Promise.resolve() } };
  });
  it('awaits each spec without throwing', async () => {
    await expect(loadFonts(['400 16px "Inter"', '700 16px "Inter"'])).resolves.toBeUndefined();
    expect((document as any).fonts.load).toHaveBeenCalledTimes(2);
  });
  it('swallows font CDN failures', async () => {
    (document as any).fonts.load = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(loadFonts(['400 16px "Inter"'])).resolves.toBeUndefined();
  });
  it('no-ops when specs is empty/undefined', async () => {
    await expect(loadFonts()).resolves.toBeUndefined();
  });
});

describe('bootGuard', () => {
  beforeEach(() => { (globalThis as any).window = {}; });
  it('returns true once then false', () => {
    expect(bootGuard('__test_boot__')).toBe(true);
    expect(bootGuard('__test_boot__')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/host/preboot.test.ts`
Expected: FAIL — cannot resolve `../../src/host/preboot`.

- [ ] **Step 3: Write `preboot.ts`**

```ts
// packages/game-engine/src/host/preboot.ts
import { TextureSource } from 'pixi.js';

/** Preload web fonts so Pixi text rasterizes with the right glyphs. Never throws. */
export async function loadFonts(specs?: string[]): Promise<void> {
  if (!specs || specs.length === 0) return;
  try {
    await Promise.all(specs.map((s) => document.fonts.load(s)));
    await document.fonts.ready;
  } catch {
    /* font CDN unreachable → fall back to system fonts */
  }
}

/** Smoother default downscaling for art-heavy slots. Pixel-art games omit this. */
export function applyTextureDefaults(): void {
  TextureSource.defaultOptions.autoGenerateMipmaps = true;
}

/** Idempotent double-boot guard. Returns true the first time, false thereafter. */
export function bootGuard(flag = '__e8SlotBooted__'): boolean {
  const w = window as unknown as Record<string, boolean>;
  if (w[flag]) return false;
  w[flag] = true;
  return true;
}
```

- [ ] **Step 4: Write the failing fatalError test**

```ts
// packages/game-engine/tests/host/fatalError.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { showFatalError } from '../../src/host/fatalError';

describe('showFatalError', () => {
  beforeEach(() => { document.body.innerHTML = '<div id="game"></div>'; });
  it('appends an overlay carrying the message into the container selector', () => {
    showFatalError('#game', 'Boom happened');
    const host = document.querySelector('#game')!;
    expect(host.textContent).toContain('Boom happened');
    expect(host.querySelector('div')).not.toBeNull();
  });
  it('accepts an element container', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    showFatalError(el, 'Direct element');
    expect(el.textContent).toContain('Direct element');
  });
});
```

This test needs a DOM. Add `// @vitest-environment jsdom` as the first line of `fatalError.test.ts` (game-engine vitest runs node by default; this pragma switches just this file).

- [ ] **Step 5: Run both tests to verify they fail**

Run: `npx vitest run packages/game-engine/tests/host/preboot.test.ts packages/game-engine/tests/host/fatalError.test.ts`
Expected: FAIL — modules not found. (If jsdom is not installed, install it: `npm i -D jsdom -w @energy8platform/game-engine`, then re-run.)

- [ ] **Step 6: Write `fatalError.ts`**

```ts
// packages/game-engine/src/host/fatalError.ts
/** Render a blocking, full-screen message instead of an infinite loading screen. */
export function showFatalError(container: HTMLElement | string, message: string): void {
  const host =
    typeof container === 'string'
      ? document.querySelector<HTMLElement>(container) ?? document.body
      : container;
  const overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;' +
    'color:#f0c98a;background:#0a0504;font:600 18px system-ui;text-align:center;padding:24px;z-index:99999';
  overlay.textContent = message;
  host.appendChild(overlay);
}
```

- [ ] **Step 7: Run both tests to verify they pass**

Run: `npx vitest run packages/game-engine/tests/host/preboot.test.ts packages/game-engine/tests/host/fatalError.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/game-engine/src/host/preboot.ts packages/game-engine/src/host/fatalError.ts \
        packages/game-engine/tests/host/preboot.test.ts packages/game-engine/tests/host/fatalError.test.ts
git commit -m "feat(game-engine): host preboot helpers + fatal-error modal"
```

---

### Task 4: `createSlotGame` orchestrator + sub-path wiring

**Files:**
- Create: `packages/game-engine/src/host/createSlotGame.ts`
- Create: `packages/game-engine/src/host/index.ts`
- Modify: `packages/game-engine/package.json` (`./host` export; stake-bridge optional peer + dev dep)
- Modify: `packages/game-engine/rollup.config.mjs` (host bundle + stake-bridge externals)

**Interfaces:**
- Consumes: Tasks 2–3 helpers; `isStakeLaunch` from `@energy8platform/stake-bridge/detect` (lazy); `StakeBridge` from `@energy8platform/stake-bridge` (lazy); `GameApplication` from `../core`.
- Produces: `createSlotGame(opts: CreateSlotGameOptions): Promise<SlotGameHandle>`; the `@energy8platform/game-engine/host` entry re-exporting `createSlotGame` and the host types.

No unit test (Pixi `init()` hangs headless). Verified by typecheck + build + Task 5's example.

- [ ] **Step 1: Write `createSlotGame.ts`**

```ts
// packages/game-engine/src/host/createSlotGame.ts
import { GameApplication } from '../core';
import { buildAppConfig } from './buildConfig';
import { loadFonts, applyTextureDefaults, bootGuard } from './preboot';
import { showFatalError } from './fatalError';
import type { CreateSlotGameOptions, SlotGameHandle } from './types';

/**
 * One-call slot bootstrap: preboot → (optional Stake bridge) → GameApplication
 * → register scene → start. Collapses the per-game main.ts boilerplate.
 *
 * Not unit-tested: GameApplication.init() drives Pixi, which hangs in headless
 * environments. The pure helpers it sequences are unit-tested individually.
 */
export async function createSlotGame(opts: CreateSlotGameOptions): Promise<SlotGameHandle> {
  if (!bootGuard()) throw new Error('createSlotGame() called more than once');

  if (opts.textureDefaults) applyTextureDefaults();
  await loadFonts(opts.fonts);

  const fatal = (message: string) =>
    opts.onFatalError ? opts.onFatalError(message) : showFatalError(opts.container ?? '#game', message);

  let stakeBridge: SlotGameHandle['stakeBridge'] = null;
  let isStakeNow = false;
  if (opts.stake) {
    const { isStakeLaunch } = await import('@energy8platform/stake-bridge/detect');
    isStakeNow = isStakeLaunch(location.href);
    if (isStakeNow) {
      try {
        const { StakeBridge } = await import('@energy8platform/stake-bridge');
        stakeBridge = new StakeBridge({
          devMode: true,
          adapter: opts.stake.adapter,
          modeMap: opts.model.modeMap,
          gameId: opts.model.spec.id,
          url: location.href,
        });
        await stakeBridge.ready();
      } catch (err) {
        fatal('Could not connect to the game server. Please reload.');
        throw err;
      }
    }
  }

  const game = new GameApplication(buildAppConfig(opts, isStakeNow));
  game.scenes.register(opts.scene.key, opts.scene.scene);
  try {
    await game.start(opts.scene.key);
  } catch (err) {
    fatal('Could not start the game.');
    throw err;
  }

  return { game, stakeBridge };
}
```

- [ ] **Step 2: Write `index.ts`**

```ts
// packages/game-engine/src/host/index.ts
export { createSlotGame } from './createSlotGame';
export type {
  CreateSlotGameOptions,
  SlotGameHandle,
  StakeIntegration,
  SceneEntry,
} from './types';
```

- [ ] **Step 3: Wire the `./host` package export + stake-bridge dep**

In `packages/game-engine/package.json`:
- Add to `exports` (mirroring `./core`):
```json
    "./host": {
      "import": "./dist/host.esm.js",
      "require": "./dist/host.cjs.js",
      "types": "./dist/host.d.ts"
    }
```
- Add `@energy8platform/stake-bridge` to `peerDependencies` as `">=0.2.1"`, to `peerDependenciesMeta` as `{ "optional": true }`, and to `devDependencies` as `"*"` (the in-repo workspace).

- [ ] **Step 4: Wire the rollup bundle + externals**

In `packages/game-engine/rollup.config.mjs`:
- Add to the `external` array: `'@energy8platform/stake-bridge'` and `'@energy8platform/stake-bridge/detect'`.
- Add the bundle (after the `game-spec` line): `...createBundle('src/host/index.ts', 'host'),`

- [ ] **Step 5: Build stake-bridge, then build + typecheck game-engine**

Run: `npm run build --workspace @energy8platform/stake-bridge && npm run build --workspace @energy8platform/game-engine`
Expected: game-engine emits `dist/host.esm.js`, `dist/host.cjs.js`, `dist/host.d.ts`; no unresolved `@energy8platform/stake-bridge` / `/detect`.
Run: `npm run typecheck --workspace @energy8platform/game-engine`
Expected: passes (host code typechecks against stake-bridge's `dist/*.d.ts` and `/detect`).

- [ ] **Step 6: Run the full game-engine host test dir (no regression)**

Run: `npx vitest run packages/game-engine/tests/host/`
Expected: buildConfig + preboot + fatalError all pass (createSlotGame has no unit test by design).

- [ ] **Step 7: Commit**

```bash
git add packages/game-engine/src/host/createSlotGame.ts packages/game-engine/src/host/index.ts \
        packages/game-engine/package.json packages/game-engine/rollup.config.mjs
git commit -m "feat(game-engine): createSlotGame orchestrator + /host sub-path"
```

---

### Task 5: Prove it end-to-end in `examples/spec-slot`

**Files:**
- Create: `examples/spec-slot/GameScene.ts`
- Create: `examples/spec-slot/main.ts`
- Modify: `examples/spec-slot/package.json` (add game-engine + pixi dev deps)
- Modify: `examples/spec-slot/tsconfig.json` (already `include: ["*.ts"]` — confirm new files are covered)

**Interfaces:**
- Consumes: `createSlotGame` from `@energy8platform/game-engine/host`; `Scene` from `@energy8platform/game-engine/core`; `model` from `./game.spec` (slice 1).
- Demonstrates: one `game.spec.ts` drives the host boot. Verified by `tsc --noEmit` (the Pixi boot itself is not run — headless hang). The existing node `smoke.ts` is unchanged and still green.

- [ ] **Step 1: Write a trivial scene + host entry**

```ts
// examples/spec-slot/GameScene.ts
import { Scene } from '@energy8platform/game-engine/core';

export class GameScene extends Scene {
  async onEnter(): Promise<void> {
    // A real game builds its reels/HUD here. Empty for the host demo.
  }
}
```

```ts
// examples/spec-slot/main.ts
// Demonstrates: one game.spec.ts → createSlotGame host boot.
// Not run headless (Pixi init hangs); verified via `tsc --noEmit`.
import { createSlotGame } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { GameScene } from './GameScene';

createSlotGame({
  model,
  scene: { key: 'game', scene: GameScene },
  manifest: { bundles: [] },
  design: { width: 1920, height: 1080 },
  fonts: ['400 24px "Inter"'],
  textureDefaults: true,
  dev: import.meta.env?.DEV ?? false,
}).catch((err) => {
  console.error('[spec-slot] failed to start', err);
});
```

- [ ] **Step 2: Add the example dev deps**

In `examples/spec-slot/package.json` add to `devDependencies`:
```json
    "@energy8platform/game-engine": "*",
    "pixi.js": "^8.16.0"
```
(`@energy8platform/game-engine` is the in-repo workspace; `pixi.js` is its peer, needed for the host types to resolve.)

- [ ] **Step 3: Install + build deps so types resolve**

Run: `npm install`
Then: `npm run build --workspace @energy8platform/stake-bridge && npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/game-engine`
Expected: all three build; `@energy8platform/game-engine/host` + `/core` `.d.ts` present.

- [ ] **Step 4: Typecheck the example**

Run: `cd examples/spec-slot && npx tsc --noEmit && cd ../..`
Expected: passes — proving `createSlotGame({ model, scene, ... })` wires against the real `GameModel` and host types with no errors.

- [ ] **Step 5: Confirm the node smoke still passes (no regression)**

Run: `npm run smoke --workspace spec-slot-example`
Expected: ends with `SMOKE PASS` (unchanged from slice 1).

- [ ] **Step 6: Commit**

```bash
git add examples/spec-slot/GameScene.ts examples/spec-slot/main.ts examples/spec-slot/package.json
git commit -m "docs(examples): spec-slot boots via createSlotGame host"
```

---

## Self-Review

**Spec coverage:**
- `isStakeLaunch` in stake-bridge `/detect` (non-throwing, leaf, no bridge imports) → Task 1. ✓
- Host sub-package (types, buildConfig, preboot, fatalError, createSlotGame, index) → Tasks 2–4. ✓
- `sdk.devMode = isStakeNow || (opts.dev ?? false)` → Task 2 buildConfig + test. ✓
- Lazy stake import inside `if (opts.stake)` → Task 4 orchestrator. ✓
- Stake failure → modal + throw → Task 4. ✓
- modeMap/gameId from model, adapter from caller → Task 4. ✓
- `/host` sub-path wiring + stake-bridge optional peer + externals → Task 4. ✓
- Renderer-free tests; orchestrator/Pixi not unit-tested → Tasks 2–4 (pure tests) + Task 5 (typecheck). ✓
- No new example; extend spec-slot with main.ts + GameScene.ts; node smoke untouched → Task 5. ✓
- Out-of-scope (shell, Lua normalization, adapter generation, migrations) → absent. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete; commands carry expected output. The jsdom-install fallback (Task 3 Step 5) is conditional-but-explicit, not a placeholder. ✓

**Type consistency:** `CreateSlotGameOptions`/`SlotGameHandle`/`StakeIntegration`/`SceneEntry` defined in Task 2 `types.ts` and used unchanged in Tasks 4–5. `buildAppConfig(opts, isStakeNow)` signature identical across Task 2 (def), Task 4 (call). `loadFonts`/`applyTextureDefaults`/`bootGuard`/`showFatalError` signatures identical across Task 3 (def) and Task 4 (use). `isStakeLaunch` signature identical across Task 1 (def) and Task 4 (lazy import). ✓

**Risks flagged:**
- jsdom may be absent for the fatalError test — Task 3 Step 5 names the install command.
- Build order matters: stake-bridge → platform-core → game-engine before example typecheck — Tasks 4–5 sequence the builds explicitly.
- `class {} as never` stub scene in the buildConfig test avoids needing a real Scene; the real `SceneConstructor` is exercised by Task 5's `GameScene`.
