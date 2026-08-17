# Runtime and Session Providers (`@energy8engine/runtime`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the runtime layer that turns a resolved plugin plan into a live session, and prove the plugin model with the thing that is impossible today — a plugin living in a game's own `plugins/` folder contributing a fourth `session.provider`, selected by its matcher, with no edit to the engine and no edit to the game's source.

**Architecture:** A `session.provider` does not *return* a session. Every backend in this codebase — DevBridge, StakeBridge, ArtubeBridge — **installs itself on the same in-process SDK memory channel**, and then one `createPlatformSession()` handshake talks to whatever installed itself (`createSlotGame.ts:124` says this out loud). So the point's contract is `install(ctx)`, the runtime picks exactly one by matcher, installs it, and runs a single handshake. Points are declared by the plugin that owns them, never by the kernel.

**Tech Stack:** TypeScript ~5.6 (ESM, `strict`), Rollup, Vitest 2.0, Node 22. Depends on `@energy8engine/kernel` (workspace) and, as *optional peers*, `@energy8platform/platform-core` and `@energy8platform/stake-bridge`.

**Spec:** [docs/superpowers/specs/2026-08-13-slot-ide-v2-design.md](../specs/2026-08-13-slot-ide-v2-design.md) — §7 is what this plan implements, with §7.2's corrected make-or-break as its acceptance test.

## Scope

This is **phase 2a of 4** in Срез 0, and it is deliberately browser-free — every deliverable is provable headlessly in Node.

**In scope:** the runtime package, the point vocabulary, the `SessionProvider` contract, the `session-dev` and `session-stake` providers, the Vite plugin that gets `project.json` into a bundle, and the replay-plugin proof.

**Out of scope, and named so nobody drifts into it:** `renderer-pixi`, `loader`, `shell-html`, `reel-system`, the play loop, and the etalon game booting. Those are **phase 2b**, which needs a browser and a headless screenshot loop. `runGame` in this plan stops after the handshake and returns; 2b extends it to drive scenes.

**`session-artube` is also out of scope**, though §7.1's table lists it beside dev and stake. Artube's bridge needs a live backend and a `?sessionId=` launch to do anything observable, so wrapping it proves nothing a headless test can check — and the replay provider in Task 7 already exercises the `urlParam` matcher that Artube would use. It lands in 2b alongside the browser work.

## Global Constraints

- **The kernel owns no list of points.** Every point in this plan is declared by the plugin that owns it. The runtime declares `session.provider` and `build.target` because three plugins fill them and one owner must exist; `session-stake` declares `stake.adapter` because only it consumes that.
- **Errors are data, never exceptions** — the same contract the kernel holds. `runGame` returns diagnostics; it throws only if the caller asked for a session it cannot possibly build, and even then via a rejected promise carrying the diagnostics.
- **`@energy8platform/platform-core` and `@energy8platform/stake-bridge` are OPTIONAL peer dependencies**, reached only through dynamic `import()` inside a provider's `create()`. A game that never uses Stake must still build without `stake-bridge` installed. This is the same trap `createSlotGame` documents at length for Artube — a static specifier is resolved by every bundler, so esbuild fails the build and Vite silently substitutes an empty module.
- **Zero edits to `packages/kernel`.** If this plan seems to need one, stop and report it — that is a finding about the kernel, not a licence.
- **Zero edits to `packages/game-engine`, `packages/platform-core`, `packages/stake-bridge`.** Phase 2 wraps; it does not rewrite. Same rule.
- English identifiers and comments.
- **Test invocation:** `npm test --workspace @energy8engine/runtime`. Do NOT run `npx vitest run <path>` from the repo root — the workspace layout makes it report false failures.
- **Git hygiene:** the repo gitignores `node_modules/`, `dist/` and `package-lock.json`. Stage files BY NAME; never `git add packages/runtime` wholesale and never `git add -f`.
- Build one package at a time — parallel rollup runs saturate this machine.

---

## File Structure

```
packages/runtime/
├── package.json
├── tsconfig.json
├── rollup.config.mjs
├── vitest.config.ts
├── README.md
├── src/
│   ├── index.ts               public barrel
│   ├── points.ts              point ids, HOOK_IDS, and the host plugin that declares them
│   ├── session/
│   │   ├── types.ts           SessionProvider, SessionContext, InstalledSession
│   │   ├── dev.ts             session-dev — installs a DevBridge
│   │   └── stake.ts           session-stake — installs a StakeBridge, declares stake.adapter
│   ├── runGame.ts             resolve → gate on errors → activate → install → handshake
│   └── vite/
│       └── projectPlugin.ts   virtual:e8-project — project.json + statically imported manifests
└── tests/
    ├── skeleton.test.ts
    ├── points.test.ts
    ├── session-dev.test.ts
    ├── session-stake.test.ts
    ├── runGame.test.ts
    ├── projectPlugin.test.ts
    └── proof-replay-provider.test.ts   ← the acceptance test for the whole phase
```

Why this split: `points.ts` is the only file the IDE and phase 2b both read, `session/` is the part a third party imitates when writing their own provider, and `vite/` is node-only and must never enter a browser bundle.

---

## Task 1: Package skeleton and workspace wiring

**Files:**
- Create: `packages/runtime/package.json`, `tsconfig.json`, `rollup.config.mjs`, `vitest.config.ts`
- Create: `packages/runtime/src/index.ts`
- Test: `packages/runtime/tests/skeleton.test.ts`

**Interfaces:**
- Produces: workspace package `@energy8engine/runtime` exporting `RUNTIME_VERSION: string`, depending on `@energy8engine/kernel`.

- [ ] **Step 1: Branch off the kernel branch**

The kernel is on `feat/kernel` and is not yet merged to `main`. This work builds on it.

```bash
cd /Users/mrphelko/Documents/repo/game-engine
git checkout feat/kernel && git checkout -b feat/runtime
```

- [ ] **Step 2: Write `packages/runtime/package.json`**

```json
{
  "name": "@energy8engine/runtime",
  "version": "0.1.0",
  "description": "Runtime host for Energy8 games — turns a resolved plugin plan into a live session.",
  "type": "module",
  "main": "./dist/index.esm.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "import": "./dist/index.esm.js", "types": "./dist/index.d.ts" },
    "./vite": { "import": "./dist/vite.esm.js", "types": "./dist/vite.d.ts" }
  },
  "files": ["dist", "src", "README.md"],
  "scripts": {
    "build": "rollup -c rollup.config.mjs",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@energy8engine/kernel": "^0.1.0"
  },
  "peerDependencies": {
    "@energy8platform/platform-core": "*",
    "@energy8platform/stake-bridge": "*"
  },
  "peerDependenciesMeta": {
    "@energy8platform/platform-core": { "optional": true },
    "@energy8platform/stake-bridge": { "optional": true }
  },
  "devDependencies": {
    "@rollup/plugin-typescript": "^12.1.0",
    "rollup": "^4.24.0",
    "rollup-plugin-dts": "^6.1.0",
    "tslib": "^2.8.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "license": "MIT"
}
```

Unlike the kernel, this package HAS a dependency — the kernel itself — and two optional peers. That is the deliberate difference: the kernel is pure, the runtime is where the platform enters.

- [ ] **Step 3: Write `packages/runtime/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": []
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

`DOM` is deliberately absent, exactly as in the kernel. The obvious reason to want it is that a provider must know the launch URL — but `runGame` takes `url` as an input and passes it down on `SessionContext`, so no file here ever reads `location`. Keeping DOM out makes an accidental `document` or `window` a compile error, and it is what lets every test in this package run in Node.

- [ ] **Step 4: Write `packages/runtime/rollup.config.mjs`**

```js
import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = [
  '@energy8engine/kernel',
  '@energy8platform/platform-core',
  '@energy8platform/stake-bridge',
  'node:fs',
  'node:path',
];

export default defineConfig([
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/index.esm.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, sourceMap: true })],
  },
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/index.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
```

Only the two index entries for now. `src/vite/projectPlugin.ts` does not exist until Task 6, and a
rollup input that does not exist is a hard build error — Task 6 adds its two entries when it creates
the file. The `./vite` key stays in `package.json` because it names a build artifact, not a source
file, and npm does not check that it exists yet.

- [ ] **Step 5: Write `packages/runtime/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

`environment: 'node'` is deliberate and is the whole point of phase 2a: every test in this package runs without a browser.

- [ ] **Step 6: Write `packages/runtime/src/index.ts`**

```ts
/**
 * @energy8engine/runtime — the host that turns a resolved plugin plan into a live session.
 *
 * The kernel knows how plugins compose. This package knows what a slot game needs composed:
 * which points exist, what a session provider is, and how a project's plan becomes a running game.
 */

/** Runtime version. Distinct from the kernel's — they version independently. */
export const RUNTIME_VERSION = '0.1.0';
```

- [ ] **Step 7: Write the failing test `packages/runtime/tests/skeleton.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { RUNTIME_VERSION } from '@/index';
import { KERNEL_VERSION } from '@energy8engine/kernel';

describe('runtime package', () => {
  it('exposes its version', () => {
    expect(RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('can reach the kernel', () => {
    expect(KERNEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

The second assertion is not filler — it proves the workspace link to the kernel resolves before any real code depends on it.

- [ ] **Step 8: Install and run**

```bash
npm install
npm test --workspace @energy8engine/runtime
```

Expected: PASS — 2 tests. If the kernel import fails, `npm install` did not link the workspace; do not work around it with a relative import.

- [ ] **Step 9: Typecheck and build**

```bash
npm run typecheck --workspace @energy8engine/runtime
npm run build --workspace @energy8engine/runtime
```

Expected: both succeed; `dist/index.esm.js` and `dist/index.d.ts` exist. The `dist/vite.*` pair arrives in Task 6.

- [ ] **Step 10: Commit**

Stage by name. Do NOT `git add packages/runtime` wholesale — `dist/` and `node_modules/` are gitignored and a force-add drags them in.

```bash
git add packages/runtime/package.json packages/runtime/tsconfig.json \
        packages/runtime/rollup.config.mjs packages/runtime/vitest.config.ts \
        packages/runtime/src/index.ts packages/runtime/tests/skeleton.test.ts
git status --short   # confirm nothing from dist/ or node_modules/ is staged
git commit -m "feat(runtime): package skeleton for @energy8engine/runtime"
```

---

## Task 2: The point vocabulary and the host plugin

**Files:**
- Create: `packages/runtime/src/points.ts`
- Test: `packages/runtime/tests/points.test.ts`

**Interfaces:**
- Consumes: `definePlugin`, `checkManifestShape`, `Schema`, `PluginManifest` from `@energy8engine/kernel`.
- Produces:
  - `POINT_SESSION_PROVIDER = 'session.provider'`, `POINT_BUILD_TARGET = 'build.target'`
  - `HOOK_IDS: readonly string[]` — `['bootstrap', 'dispose', 'beforeSpin', 'afterSpin', 'beforeRender']`
  - `hostPlugin: PluginManifest` — id `@e8/host`, declaring both points
  - `SESSION_PROVIDER_SCHEMA: Schema`

This is where the kernel's deliberate ignorance is paid for: `createHookBus` takes its id list from a caller, and this file is that caller. `beforeSpin` lives here, not in the kernel.

- [ ] **Step 1: Write the failing test `packages/runtime/tests/points.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { checkManifestShape } from '@energy8engine/kernel';
import { HOOK_IDS, POINT_BUILD_TARGET, POINT_SESSION_PROVIDER, hostPlugin } from '@/points';

describe('the host plugin', () => {
  it('is a structurally valid manifest', () => {
    expect(checkManifestShape(hostPlugin)).toEqual([]);
  });

  it('declares session.provider as a single-winner runtime point', () => {
    const point = hostPlugin.points?.[POINT_SESSION_PROVIDER];
    expect(point).toBeDefined();
    expect(point!.phase).toBe('runtime');
    expect(point!.arity).toBe('one');
    expect(point!.doc.length).toBeGreaterThan(20);
  });

  it('declares build.target as a many-filler build point', () => {
    const point = hostPlugin.points?.[POINT_BUILD_TARGET];
    expect(point).toBeDefined();
    expect(point!.phase).toBe('build');
    expect(point!.arity).toBe('many');
  });

  it('contributes nothing itself — it only opens the doors', () => {
    expect(hostPlugin.contributes).toBeUndefined();
  });

  it('names the game-domain hooks the kernel refuses to name', () => {
    expect(HOOK_IDS).toContain('beforeSpin');
    expect(HOOK_IDS).toContain('afterSpin');
    expect(new Set(HOOK_IDS).size).toBe(HOOK_IDS.length);
  });

  it('does not put a field named "enabled" in any point schema', () => {
    // `enabled` is the structural contribution flag in project.json; the kernel warns about the
    // collision, and a point that trips its own engine's warning is a bad example to ship.
    for (const [id, point] of Object.entries(hostPlugin.points ?? {})) {
      expect(Object.keys(point.schema), `point ${id}`).not.toContain('enabled');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: FAIL — cannot resolve `@/points`.

- [ ] **Step 3: Write `packages/runtime/src/points.ts`**

```ts
import type { PluginManifest, PointDef, Schema } from '@energy8engine/kernel';

/** Where rounds come from. Exactly one provider is active per launch. */
export const POINT_SESSION_PROVIDER = 'session.provider';

/** Build-time targets — a Vite plugin, an output bundle, a deploy artifact. Several may apply. */
export const POINT_BUILD_TARGET = 'build.target';

/**
 * The game-domain hook vocabulary.
 *
 * The kernel takes this list from a caller rather than owning it, because naming `beforeSpin`
 * inside a package that must know nothing about slots would be exactly the leak it was built to
 * avoid. This file is that caller.
 */
export const HOOK_IDS = ['bootstrap', 'dispose', 'beforeSpin', 'afterSpin', 'beforeRender'] as const;

export type HookId = (typeof HOOK_IDS)[number];

/**
 * Settings every session provider shares. A provider adds its own fields on top; the kernel
 * merges the two into the effective schema the IDE renders.
 *
 * Note what is NOT here: `enabled`. That is the structural flag on the contribution in
 * project.json, and a schema field of the same name silently shadows it.
 */
export const SESSION_PROVIDER_SCHEMA: Schema = {
  label: {
    kind: 'text',
    label: 'Display name',
    doc: 'Shown in the IDE when this provider is the active one.',
    default: '',
  },
};

const SESSION_PROVIDER_POINT: PointDef = {
  phase: 'runtime',
  arity: 'one',
  schema: SESSION_PROVIDER_SCHEMA,
  doc:
    'A backend that installs itself on the in-process SDK channel before the handshake. ' +
    'DevBridge, Stake and a replay source are all providers. Exactly one wins per launch, ' +
    'chosen by its activateWhen matcher.',
};

const BUILD_TARGET_POINT: PointDef = {
  phase: 'build',
  arity: 'many',
  schema: {
    outDir: {
      kind: 'text',
      label: 'Output directory',
      doc: 'Where this target writes its bundle, relative to the project root.',
      default: 'dist',
    },
  },
  doc: 'A build-time target: a Vite plugin, an output bundle, a deployable artifact.',
};

/**
 * The built-in plugin. It declares the two points that more than one plugin fills — someone has
 * to own a shared door — and contributes nothing of its own. Points filled by exactly one plugin
 * (a renderer, a shell) are declared by that plugin instead, which is why they are absent here.
 */
export const hostPlugin: PluginManifest = {
  id: '@e8/host',
  version: '0.1.0',
  engine: '^0.1.0',
  points: {
    [POINT_SESSION_PROVIDER]: SESSION_PROVIDER_POINT,
    [POINT_BUILD_TARGET]: BUILD_TARGET_POINT,
  },
} satisfies PluginManifest;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: PASS — 6 new tests in `points.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/points.ts packages/runtime/tests/points.test.ts
git status --short
git commit -m "feat(runtime): the point vocabulary and the host plugin that declares it"
```

---

## Task 3: The `SessionProvider` contract and the dev provider

**Files:**
- Create: `packages/runtime/src/session/types.ts`
- Create: `packages/runtime/src/session/dev.ts`
- Test: `packages/runtime/tests/session-dev.test.ts`

**Interfaces:**
- Consumes: `definePlugin`, `PluginManifest`, `Schema` from the kernel.
- Produces:
  - `interface SessionContext { url; buildTarget?; settings; loadDevBridge?; loadStakeBridge?; plan? }`
  - `interface InstalledSession { dispose?: () => void | Promise<void> }`
  - `type SessionProvider = (ctx: SessionContext) => InstalledSession | Promise<InstalledSession>`
  - `provider(fn: SessionProvider): () => SessionProvider` — the kernel-factory bridge
  - `sessionDevPlugin: PluginManifest` (id `@e8/session-dev`) contributing `session.provider:dev` with `activateWhen: { default: true }`

`session-dev` wraps `DevBridge` from `@energy8platform/platform-core/dev-bridge`. Its `DevBridgeConfig` fields — `balance`, `currency`, `networkDelay`, `debug` — become the contribution's own schema, which is what makes them editable from the IDE later.

- [ ] **Step 1: Write `packages/runtime/src/session/types.ts`**

```ts
/**
 * What a session provider is, and — more importantly — what it is not.
 *
 * A provider does NOT return a session. Every backend in this codebase (DevBridge, StakeBridge,
 * ArtubeBridge) installs itself on the same in-process SDK memory channel, and then ONE
 * `createPlatformSession()` handshake talks to whatever installed itself. `createSlotGame` says
 * this out loud where it refuses to build two bridges at once: "both bridges install themselves
 * in-process on the SAME SDK memory channel".
 *
 * So the contract is: put your backend on the channel, and hand back a disposer. The runtime does
 * the handshake exactly once, afterwards, for whichever provider won.
 */
export interface SessionContext {
  /** The launch URL. Injected rather than read from `location` so tests need no DOM. */
  url: string;
  /** The build target this bundle was produced for, e.g. 'stake'. */
  buildTarget?: string;
  /** This contribution's validated settings — point schema plus the provider's own fields. */
  settings: Record<string, unknown>;
}

/** What a provider hands back after installing itself. */
export interface InstalledSession {
  /** Tear the backend down. Called when the game shuts down, or when installation is rolled back. */
  dispose?: () => void | Promise<void>;
}

/** A session provider: install a backend on the SDK channel, return a disposer. */
export type SessionProvider = (ctx: SessionContext) => InstalledSession | Promise<InstalledSession>;

/**
 * Wrap a provider for the kernel's factory contract.
 *
 * The kernel's `create()` resolves to a FACTORY — `(settings) => instance` — and `activatePoint`
 * calls it with the contribution's validated settings. Our instance IS the provider function, so
 * a bare `create: async () => install` would make the kernel call `install(settings)` and pass a
 * settings object where a SessionContext belongs. This wrapper is the one line that keeps the two
 * contracts straight, and every provider must use it.
 *
 *   create: async () => provider(install)
 *
 * Settings still reach the provider — `runGame` puts them on `ctx.settings`, where a provider can
 * read them alongside the launch url.
 */
export function provider(fn: SessionProvider): () => SessionProvider {
  return () => fn;
}
```

- [ ] **Step 2: Write the failing test `packages/runtime/tests/session-dev.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { checkManifestShape, resolvePlan, activateOne } from '@energy8engine/kernel';
import { hostPlugin, POINT_SESSION_PROVIDER } from '@/points';
import { sessionDevPlugin } from '@/session/dev';
import type { InstalledSession } from '@/session/types';

const LAUNCH = { url: 'https://game.example/play' };

function project(over: Record<string, { version: string }> = {}) {
  return {
    plugins: {
      '@e8/host': { version: '*' },
      '@e8/session-dev': { version: '*' },
      ...over,
    },
  };
}

describe('session-dev manifest', () => {
  it('is structurally valid', () => {
    expect(checkManifestShape(sessionDevPlugin)).toEqual([]);
  });

  it('contributes to session.provider as the default', () => {
    const list = sessionDevPlugin.contributes?.[POINT_SESSION_PROVIDER];
    expect(list).toHaveLength(1);
    expect(list![0].id).toBe('dev');
    expect(list![0].activateWhen).toEqual({ default: true });
  });

  it('exposes the DevBridge knobs as its own schema fields', () => {
    const own = sessionDevPlugin.contributes![POINT_SESSION_PROVIDER][0].schema!;
    expect(Object.keys(own)).toEqual(expect.arrayContaining(['balance', 'currency', 'networkDelay', 'debug']));
  });
});

describe('session-dev in a plan', () => {
  it('wins by default when nothing else matches', () => {
    const { plan, diagnostics } = resolvePlan({
      project: project(),
      manifests: [hostPlugin, sessionDevPlugin],
      launch: LAUNCH,
      kernelVersion: '0.1.0',
      hookIds: ['bootstrap', 'dispose', 'beforeSpin', 'afterSpin', 'beforeRender'],
    });
    expect(diagnostics).toEqual([]);
    const active = plan.contributions.filter((c) => c.active);
    expect(active.map((c) => c.id)).toEqual(['dev']);
  });

  it('fills its settings from the merged schema defaults', () => {
    const { plan } = resolvePlan({
      project: project(),
      manifests: [hostPlugin, sessionDevPlugin],
      launch: LAUNCH,
      kernelVersion: '0.1.0',
    });
    const dev = plan.contributions.find((c) => c.id === 'dev')!;
    expect(dev.settings.balance).toBe(100000);
    expect(dev.settings.currency).toBe('USD');
    expect(dev.settings.label).toBe('');
  });

  it('installs a DevBridge and hands back a disposer', async () => {
    const started = vi.fn();
    const stopped = vi.fn();
    // The provider reaches DevBridge through a dynamic import; the test injects a fake through the
    // documented `loadDevBridge` seam rather than mocking a module path.
    const { plan } = resolvePlan({
      project: project(),
      manifests: [hostPlugin, sessionDevPlugin],
      launch: LAUNCH,
      kernelVersion: '0.1.0',
    });
    const { instance, diagnostics } = await activateOne<import('@/session/types').SessionProvider>(
      plan,
      POINT_SESSION_PROVIDER,
    );
    expect(diagnostics).toEqual([]);
    expect(typeof instance!.value).toBe('function');

    const installed: InstalledSession = await instance!.value({
      url: LAUNCH.url,
      settings: { balance: 500, currency: 'EUR', networkDelay: 0, debug: false, label: '' },
      loadDevBridge: async () => class {
        constructor(public cfg: unknown) { started(cfg); }
        start() {}
        stop() { stopped(); }
      },
    } as never);
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ balance: 500, currency: 'EUR' }));

    await installed.dispose?.();
    expect(stopped).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: FAIL — cannot resolve `@/session/dev`.

- [ ] **Step 4: Extend `packages/runtime/src/session/types.ts` with the injection seam**

Add to the existing file, keeping everything already there:

```ts
/**
 * A constructor shaped like platform-core's `DevBridge`. Declared structurally so this package
 * never has to import platform-core's types — it is an optional peer, and a game that runs only
 * on Stake must build without it installed.
 */
export interface DevBridgeLike {
  start(): void;
  stop(): void;
}

export interface DevBridgeCtor {
  new (config: Record<string, unknown>): DevBridgeLike;
}
```

And widen `SessionContext` with the seam:

```ts
export interface SessionContext {
  url: string;
  buildTarget?: string;
  settings: Record<string, unknown>;
  /**
   * How `session-dev` reaches DevBridge. Defaults to a dynamic import of platform-core; a test
   * injects a fake. An injected seam beats module mocking here because the real specifier must
   * stay dynamic — a static one is resolved by every bundler, and a game without platform-core
   * installed would fail to build.
   */
  loadDevBridge?: () => Promise<DevBridgeCtor>;
}
```

- [ ] **Step 5: Write `packages/runtime/src/session/dev.ts`**

```ts
import { definePlugin, type PluginManifest, type Schema } from '@energy8engine/kernel';
import { POINT_SESSION_PROVIDER } from '../points';
import { provider, type DevBridgeCtor, type InstalledSession, type SessionContext, type SessionProvider } from './types';

/** The DevBridge knobs worth exposing in the IDE. */
const DEV_SCHEMA: Schema = {
  balance: {
    kind: 'number',
    label: 'Starting balance',
    doc: 'Mock balance in major units, handed to the game at handshake.',
    default: 100000,
    min: 0,
  },
  currency: { kind: 'text', label: 'Currency', doc: 'ISO code the mock host reports.', default: 'USD' },
  networkDelay: {
    kind: 'number',
    label: 'Simulated latency (ms)',
    doc: 'Delay added to every mock response, for testing slow links.',
    default: 0,
    min: 0,
    max: 5000,
  },
  debug: { kind: 'boolean', label: 'Debug logging', doc: 'Log every mock exchange to the console.', default: false },
};

async function defaultLoadDevBridge(): Promise<DevBridgeCtor> {
  // Dynamic on purpose: platform-core is an OPTIONAL peer. A static specifier would be resolved by
  // every bundler, so a game that never uses the dev provider would still have to install it.
  const mod = await import('@energy8platform/platform-core/dev-bridge');
  return (mod as unknown as { DevBridge: DevBridgeCtor }).DevBridge;
}

/**
 * Install a DevBridge on the in-process SDK channel. The runtime runs the handshake afterwards,
 * so nothing here builds or returns a session.
 */
const install: SessionProvider = async (ctx: SessionContext): Promise<InstalledSession> => {
  const load = ctx.loadDevBridge ?? defaultLoadDevBridge;
  const DevBridge = await load();
  const bridge = new DevBridge({
    balance: ctx.settings.balance,
    currency: ctx.settings.currency,
    networkDelay: ctx.settings.networkDelay,
    debug: ctx.settings.debug,
  });
  bridge.start();
  return { dispose: () => bridge.stop() };
};

export const sessionDevPlugin: PluginManifest = definePlugin({
  id: '@e8/session-dev',
  version: '0.1.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/host': '^0.1.0' },
  contributes: {
    [POINT_SESSION_PROVIDER]: [
      {
        id: 'dev',
        schema: DEV_SCHEMA,
        defaults: { label: 'Local mock host' },
        activateWhen: { default: true },
        doc: 'An in-process mock casino host. The fallback when no other provider matches.',
        create: async () => provider(install),
      },
    ],
  },
});
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: PASS — 6 new tests.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/session/types.ts packages/runtime/src/session/dev.ts \
        packages/runtime/tests/session-dev.test.ts
git status --short
git commit -m "feat(runtime): the SessionProvider contract and the dev provider"
```

---

## Task 4: `session-stake` and the `stake.adapter` point

**Files:**
- Create: `packages/runtime/src/session/stake.ts`
- Test: `packages/runtime/tests/session-stake.test.ts`

**Interfaces:**
- Produces:
  - `POINT_STAKE_ADAPTER = 'stake.adapter'`
  - `sessionStakePlugin: PluginManifest` (id `@e8/session-stake`), declaring `stake.adapter` and contributing `session.provider:stake`
  - `interface StakeAdapterBundle { adapter: unknown; modeMap: Record<string, string>; gameId: string }`

**Why a second point exists.** `StakeBridge` needs `adapter`, `modeMap` and `gameId` — the game's own code and spec data, which a generic plugin cannot invent. So `session-stake` declares a point (`stake.adapter`, `arity: 'one'`) and the game's own plugin fills it. This is the plugin model doing real work rather than being demonstrated: a plugin needing something from the project asks for it by opening a door.

- [ ] **Step 1: Write the failing test `packages/runtime/tests/session-stake.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { checkManifestShape, resolvePlan, activateOne } from '@energy8engine/kernel';
import { hostPlugin, POINT_SESSION_PROVIDER } from '@/points';
import { sessionDevPlugin } from '@/session/dev';
import { POINT_STAKE_ADAPTER, sessionStakePlugin } from '@/session/stake';
import type { SessionProvider } from '@/session/types';

const gamePlugin = {
  id: 'my-slot',
  version: '1.0.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/session-stake': '^0.1.0' },
  contributes: {
    [POINT_STAKE_ADAPTER]: [
      {
        id: 'book-adapter',
        doc: "This game's Stake book adapter.",
        create: async () => () => ({ adapter: { name: 'fake' }, modeMap: { base: 'BASE' }, gameId: 'my-slot' }),
      },
    ],
  },
};

const ALL = {
  plugins: {
    '@e8/host': { version: '*' },
    '@e8/session-dev': { version: '*' },
    '@e8/session-stake': { version: '*' },
    'my-slot': { version: '*' },
  },
};

const manifests = [hostPlugin, sessionDevPlugin, sessionStakePlugin, gamePlugin];

describe('session-stake manifest', () => {
  it('is structurally valid', () => {
    expect(checkManifestShape(sessionStakePlugin)).toEqual([]);
  });

  it('declares stake.adapter so the game can hand it its book adapter', () => {
    const point = sessionStakePlugin.points?.[POINT_STAKE_ADAPTER];
    expect(point).toBeDefined();
    expect(point!.arity).toBe('one');
    expect(point!.phase).toBe('runtime');
  });

  it('activates on a stake build target, not by default', () => {
    const c = sessionStakePlugin.contributes![POINT_SESSION_PROVIDER][0];
    expect(c.activateWhen).toEqual({ buildTarget: 'stake' });
  });
});

describe('session-stake selection', () => {
  it('loses to dev on an ordinary launch', () => {
    const { plan, diagnostics } = resolvePlan({
      project: ALL,
      manifests,
      launch: { url: 'https://game.example/play' },
      kernelVersion: '0.1.0',
    });
    expect(diagnostics).toEqual([]);
    expect(plan.contributions.filter((c) => c.pointId === POINT_SESSION_PROVIDER && c.active).map((c) => c.id))
      .toEqual(['dev']);
  });

  it('wins on a stake build', () => {
    const { plan, diagnostics } = resolvePlan({
      project: ALL,
      manifests,
      launch: { url: 'https://game.example/play', buildTarget: 'stake' },
      kernelVersion: '0.1.0',
    });
    expect(diagnostics).toEqual([]);
    expect(plan.contributions.filter((c) => c.pointId === POINT_SESSION_PROVIDER && c.active).map((c) => c.id))
      .toEqual(['stake']);
  });

  it('reports a stake launch with no adapter contributed', () => {
    const { diagnostics } = resolvePlan({
      project: {
        plugins: { '@e8/host': { version: '*' }, '@e8/session-stake': { version: '*' } },
      },
      manifests: [hostPlugin, sessionStakePlugin],
      launch: { url: 'https://game.example/play', buildTarget: 'stake' },
      kernelVersion: '0.1.0',
    });
    // stake.adapter is arity:'one' and nothing fills it — the kernel's no-activation error fires,
    // which is exactly the white-screen case it was added for.
    expect(diagnostics.some((d) => d.code === 'resolve/no-activation' && d.pointId === POINT_STAKE_ADAPTER))
      .toBe(true);
  });

  it('installs a StakeBridge built from the game-supplied adapter', async () => {
    const made = vi.fn();
    const { plan } = resolvePlan({
      project: ALL,
      manifests,
      launch: { url: 'https://game.example/play', buildTarget: 'stake' },
      kernelVersion: '0.1.0',
    });
    const { instance } = await activateOne<SessionProvider>(plan, POINT_SESSION_PROVIDER);
    const installed = await instance!.value({
      url: 'https://game.example/play?sessionID=abc',
      buildTarget: 'stake',
      settings: { label: '' },
      plan,
      loadStakeBridge: async () => class {
        constructor(public opts: unknown) { made(opts); }
        async ready() {}
        destroy() {}
      },
    } as never);
    expect(made).toHaveBeenCalledWith(
      expect.objectContaining({ devMode: true, gameId: 'my-slot', modeMap: { base: 'BASE' } }),
    );
    await installed.dispose?.();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: FAIL — cannot resolve `@/session/stake`.

- [ ] **Step 3: Extend `packages/runtime/src/session/types.ts` again**

Append, keeping everything already present:

```ts
/** What the game hands `session-stake` through the `stake.adapter` point. */
export interface StakeAdapterBundle {
  /** The game's `BookAdapter`. Typed as unknown so this package never imports stake-bridge. */
  adapter: unknown;
  /** Spec mode name → Stake mode name. */
  modeMap: Record<string, string>;
  /** The game id Stake knows this game by. */
  gameId: string;
}

/** A constructor shaped like stake-bridge's `StakeBridge`. Structural, for the same peer reason. */
export interface StakeBridgeLike {
  ready(): Promise<void>;
  destroy?(): void;
}

export interface StakeBridgeCtor {
  new (options: Record<string, unknown>): StakeBridgeLike;
}
```

And widen `SessionContext` once more:

```ts
export interface SessionContext {
  url: string;
  buildTarget?: string;
  settings: Record<string, unknown>;
  loadDevBridge?: () => Promise<DevBridgeCtor>;
  /** How `session-stake` reaches StakeBridge. Same optional-peer reasoning as `loadDevBridge`. */
  loadStakeBridge?: () => Promise<StakeBridgeCtor>;
  /**
   * The resolved plan, so a provider can activate a point of its own. `session-stake` needs it to
   * reach `stake.adapter`; `session-dev` ignores it.
   */
  plan?: import('@energy8engine/kernel').ResolvedPlan;
}
```

- [ ] **Step 4: Write `packages/runtime/src/session/stake.ts`**

```ts
import { activateOne, definePlugin, type PluginManifest, type PointDef } from '@energy8engine/kernel';
import { POINT_SESSION_PROVIDER } from '../points';
import {
  provider,
  type InstalledSession,
  type SessionContext,
  type SessionProvider,
  type StakeAdapterBundle,
  type StakeBridgeCtor,
} from './types';

/**
 * Where the GAME hands Stake its own book adapter.
 *
 * `StakeBridge` needs an adapter, a mode map and a game id — the game's own code and spec data,
 * which a generic plugin cannot invent. Rather than reaching into the game, this plugin opens a
 * door and lets the project's own plugin fill it.
 */
export const POINT_STAKE_ADAPTER = 'stake.adapter';

const STAKE_ADAPTER_POINT: PointDef = {
  phase: 'runtime',
  arity: 'one',
  schema: {},
  doc:
    "The game's Stake book adapter, mode map and game id. Contributed by the game's own plugin, " +
    'because only the game knows them.',
};

async function defaultLoadStakeBridge(): Promise<StakeBridgeCtor> {
  // Dynamic on purpose — stake-bridge is an OPTIONAL peer, and a game that never ships to Stake
  // must still build without it installed.
  const mod = await import('@energy8platform/stake-bridge');
  return (mod as unknown as { StakeBridge: StakeBridgeCtor }).StakeBridge;
}

const install: SessionProvider = async (ctx: SessionContext): Promise<InstalledSession> => {
  if (!ctx.plan) {
    throw new Error('session-stake needs the resolved plan to reach stake.adapter');
  }
  const { instance } = await activateOne<() => StakeAdapterBundle>(ctx.plan, POINT_STAKE_ADAPTER);
  if (!instance) {
    throw new Error(
      'session-stake: no plugin contributes to stake.adapter — the game must provide its book adapter',
    );
  }
  const bundle = instance.value();

  const load = ctx.loadStakeBridge ?? defaultLoadStakeBridge;
  const StakeBridge = await load();
  const bridge = new StakeBridge({
    devMode: true,
    protocol: ctx.url.startsWith('http://') ? 'http' : 'https',
    adapter: bundle.adapter,
    modeMap: bundle.modeMap,
    gameId: bundle.gameId,
    url: ctx.url,
  });
  await bridge.ready();
  return { dispose: () => bridge.destroy?.() };
};

export const sessionStakePlugin: PluginManifest = definePlugin({
  id: '@e8/session-stake',
  version: '0.1.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/host': '^0.1.0' },
  points: { [POINT_STAKE_ADAPTER]: STAKE_ADAPTER_POINT },
  contributes: {
    [POINT_SESSION_PROVIDER]: [
      {
        id: 'stake',
        defaults: { label: 'Stake RGS' },
        activateWhen: { buildTarget: 'stake' },
        doc: "Stake's RGS, reached through the game's book adapter. Active on a stake build.",
        create: async () => provider(install),
      },
    ],
  },
});
```

Note the two `throw`s. They are deliberate and they do not break the never-throws contract: this is a *provider's factory body*, which `activatePoint` already isolates into an `activate/factory-failed` diagnostic. The kernel's guarantee is that resolution and activation never throw — not that plugin code never does.

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: PASS — 7 new tests.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/src/session/types.ts packages/runtime/src/session/stake.ts \
        packages/runtime/tests/session-stake.test.ts
git status --short
git commit -m "feat(runtime): the stake provider and the stake.adapter point the game fills"
```

---

## Task 5: `runGame` — resolve, gate, install, handshake

**Files:**
- Create: `packages/runtime/src/runGame.ts`
- Test: `packages/runtime/tests/runGame.test.ts`

**Interfaces:**
- Produces:
  - `interface RunGameInput { project: ProjectDoc; manifests: readonly PluginManifest[]; url: string; buildTarget?: string; createSession?: (cfg: { sdk?: unknown }) => Promise<unknown>; loadDevBridge?; loadStakeBridge? }`
  - `interface RunGameResult { plan: ResolvedPlan; diagnostics: Diagnostic[]; session: unknown | null; hooks: HookBus; dispose: () => Promise<void> }`
  - `runGame(input: RunGameInput): Promise<RunGameResult>`

`runGame` is the replacement for `createSlotGame`'s composition half. In phase 2a it stops after the handshake; phase 2b extends it to drive scenes and the play loop.

- [ ] **Step 1: Write the failing test `packages/runtime/tests/runGame.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { hostPlugin } from '@/points';
import { sessionDevPlugin } from '@/session/dev';
import { runGame } from '@/runGame';

const fakeDevBridge = () =>
  class {
    started = false;
    start() { this.started = true; }
    stop() {}
  };

function base() {
  return {
    project: { plugins: { '@e8/host': { version: '*' }, '@e8/session-dev': { version: '*' } } },
    manifests: [hostPlugin, sessionDevPlugin],
    url: 'https://game.example/play',
    loadDevBridge: async () => fakeDevBridge(),
  };
}

describe('runGame', () => {
  it('resolves, installs the winning provider, then runs one handshake', async () => {
    const createSession = vi.fn(async () => ({ kind: 'session' }));
    const result = await runGame({ ...base(), createSession });
    expect(result.diagnostics).toEqual([]);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(result.session).toEqual({ kind: 'session' });
  });

  it('does not run the handshake when resolution reported an error', async () => {
    const createSession = vi.fn(async () => ({ kind: 'session' }));
    const result = await runGame({
      ...base(),
      // no provider contributes, so the arity:'one' point has nothing — the kernel errors
      project: { plugins: { '@e8/host': { version: '*' } } },
      manifests: [hostPlugin],
      createSession,
    });
    expect(result.diagnostics.some((d) => d.severity === 'error')).toBe(true);
    expect(createSession).not.toHaveBeenCalled();
    expect(result.session).toBeNull();
  });

  it('never rejects, whatever the project looks like', async () => {
    for (const project of [null, {}, { plugins: null }, { plugins: { ghost: { version: '*' } } }]) {
      await expect(runGame({ ...base(), project: project as never })).resolves.toBeDefined();
    }
  });

  it('builds a hook bus over the runtime hook vocabulary', async () => {
    const result = await runGame({ ...base(), createSession: async () => ({}) });
    expect(result.hooks.ids()).toContain('beforeSpin');
  });

  it('disposes the installed provider', async () => {
    const stop = vi.fn();
    const result = await runGame({
      ...base(),
      loadDevBridge: async () => class { start() {} stop() { stop(); } },
      createSession: async () => ({}),
    });
    await result.dispose();
    expect(stop).toHaveBeenCalled();
  });

  it('reports a provider whose installation failed, instead of throwing', async () => {
    const result = await runGame({
      ...base(),
      loadDevBridge: async () => { throw new Error('module gone'); },
      createSession: async () => ({}),
    });
    expect(result.session).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'activate/factory-failed')).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: FAIL — cannot resolve `@/runGame`.

- [ ] **Step 3: Write `packages/runtime/src/runGame.ts`**

```ts
import {
  activateOne,
  createHookBus,
  declaredFromPlan,
  hasErrors,
  KERNEL_VERSION,
  resolvePlan,
  type Diagnostic,
  type HookBus,
  type PluginManifest,
  type ProjectDoc,
  type ResolvedPlan,
} from '@energy8engine/kernel';
import { HOOK_IDS, POINT_SESSION_PROVIDER } from './points';
import type { DevBridgeCtor, InstalledSession, SessionProvider, StakeBridgeCtor } from './session/types';

export interface RunGameInput {
  project: ProjectDoc;
  manifests: readonly PluginManifest[];
  /** The launch URL. Injected so this package needs no DOM in tests. */
  url: string;
  buildTarget?: string;
  /**
   * The SDK handshake. Defaults to platform-core's `createPlatformSession`, reached dynamically
   * because platform-core is an optional peer.
   */
  createSession?: (cfg: Record<string, unknown>) => Promise<unknown>;
  loadDevBridge?: () => Promise<DevBridgeCtor>;
  loadStakeBridge?: () => Promise<StakeBridgeCtor>;
}

export interface RunGameResult {
  plan: ResolvedPlan;
  diagnostics: Diagnostic[];
  /** The handshake result, or null when resolution failed or installation did. */
  session: unknown | null;
  hooks: HookBus;
  dispose: () => Promise<void>;
}

async function defaultCreateSession(cfg: Record<string, unknown>): Promise<unknown> {
  const mod = await import('@energy8platform/platform-core');
  return (mod as unknown as { createPlatformSession: (c: Record<string, unknown>) => Promise<unknown> })
    .createPlatformSession(cfg);
}

/**
 * Compose a game from its project's plugins.
 *
 * The order is the whole design: resolve the plan as data, refuse to go further if it carries
 * errors, install exactly one session backend on the SDK channel, and only then run a single
 * handshake against whatever installed itself. `createSlotGame` did the same work with the
 * backends named in `if` branches; here they are contributions chosen by a matcher.
 *
 * Never rejects. A malformed project, a plugin that fails to load, a backend whose installation
 * throws — each becomes a diagnostic on the returned value.
 */
export async function runGame(input: RunGameInput): Promise<RunGameResult> {
  const { plan, diagnostics } = resolvePlan({
    project: input.project,
    manifests: input.manifests ?? [],
    launch: { url: input.url, buildTarget: input.buildTarget },
    kernelVersion: KERNEL_VERSION,
    hookIds: HOOK_IDS,
  });

  const all: Diagnostic[] = [...diagnostics];
  const hooks = createHookBus({ ids: HOOK_IDS, declared: declaredFromPlan(plan.hooks) });
  let installed: InstalledSession | null = null;

  const dispose = async (): Promise<void> => {
    await installed?.dispose?.();
    installed = null;
    await hooks.emit('dispose');
  };

  // A plan carrying errors is not a plan to run. Stopping here is what turns a white screen into
  // a list somebody can act on.
  if (hasErrors(all)) return { plan, diagnostics: all, session: null, hooks, dispose };

  const activation = await activateOne<SessionProvider>(plan, POINT_SESSION_PROVIDER);
  all.push(...activation.diagnostics);
  if (!activation.instance) return { plan, diagnostics: all, session: null, hooks, dispose };

  try {
    installed = await activation.instance.value({
      url: input.url,
      buildTarget: input.buildTarget,
      settings: plan.contributions.find((c) => c.key === activation.instance!.key)?.settings ?? {},
      plan,
      loadDevBridge: input.loadDevBridge,
      loadStakeBridge: input.loadStakeBridge,
    });
  } catch (err) {
    all.push({
      severity: 'error',
      code: 'activate/factory-failed',
      message: `Session provider "${activation.instance.contributionId}" failed to install: ${
        err instanceof Error ? err.message : String(err)
      }`,
      pluginId: activation.instance.pluginId,
      pointId: POINT_SESSION_PROVIDER,
      contributionId: activation.instance.contributionId,
    });
    return { plan, diagnostics: all, session: null, hooks, dispose };
  }

  const createSession = input.createSession ?? defaultCreateSession;
  const session = await createSession({});
  await hooks.emit('bootstrap', { session });

  return { plan, diagnostics: all, session, hooks, dispose };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: PASS — 6 new tests.

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/runGame.ts packages/runtime/tests/runGame.test.ts
git status --short
git commit -m "feat(runtime): runGame — resolve, gate on errors, install one provider, handshake once"
```

---

## Task 6: The Vite plugin that gets a project into a bundle

**Files:**
- Create: `packages/runtime/src/vite/projectPlugin.ts`
- Test: `packages/runtime/tests/projectPlugin.test.ts`

**Interfaces:**
- Produces: `projectPlugin(options?: { root?: string; projectFile?: string }): { name: string; resolveId(id: string): string | null; load(id: string): Promise<string | null> }`
- The virtual module `virtual:e8-project` exports `project` (the parsed `project.json`) and `manifests` (an array, statically imported).

**The problem this solves.** The kernel reads manifests as objects, but a browser bundle cannot read `project.json` off disk. This plugin turns the file into a module at build time: it parses the project, emits a static `import` for each listed plugin, and exports both. Static imports are the point — a bundler must see them to include the code.

- [ ] **Step 1: Write the failing test `packages/runtime/tests/projectPlugin.test.ts`**

```ts
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectPlugin } from '@/vite/projectPlugin';

function fixture(project: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'e8-project-'));
  writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2));
  mkdirSync(join(dir, 'plugins', 'my-plugin'), { recursive: true });
  writeFileSync(join(dir, 'plugins', 'my-plugin', 'plugin.ts'), 'export default {};');
  return dir;
}

describe('projectPlugin', () => {
  it('claims the virtual id and nothing else', () => {
    const p = projectPlugin({ root: fixture({ plugins: {} }) });
    expect(p.resolveId('virtual:e8-project')).toBe('\0virtual:e8-project');
    expect(p.resolveId('./something-else')).toBeNull();
  });

  it('emits a static import for each listed plugin', async () => {
    const root = fixture({
      plugins: {
        '@e8/host': { version: '*' },
        '@e8/session-dev': { version: '*' },
        './plugins/my-plugin/plugin.ts': { version: '*' },
      },
    });
    const code = await projectPlugin({ root }).load('\0virtual:e8-project');
    expect(code).toContain("import m0 from '@e8/host'");
    expect(code).toContain("import m2 from './plugins/my-plugin/plugin.ts'");
    expect(code).toContain('export const manifests = [m0, m1, m2]');
    expect(code).toContain('export const project =');
  });

  it('embeds the project verbatim so the runtime reads what the author wrote', async () => {
    const root = fixture({ plugins: { '@e8/host': { version: '^0.1.0', settings: { debug: true } } } });
    const code = await projectPlugin({ root }).load('\0virtual:e8-project');
    expect(code).toContain('"debug": true');
    expect(code).toContain('"version": "^0.1.0"');
  });

  it('returns null for any other id', async () => {
    const p = projectPlugin({ root: fixture({ plugins: {} }) });
    expect(await p.load('\0virtual:something')).toBeNull();
  });

  it('reports a missing project.json as a build error, not a crash', async () => {
    const p = projectPlugin({ root: join(tmpdir(), 'definitely-not-here-e8') });
    await expect(p.load('\0virtual:e8-project')).rejects.toThrow(/project\.json/);
  });

  it('reports malformed JSON with the file named', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e8-bad-'));
    writeFileSync(join(dir, 'project.json'), '{ not json');
    await expect(projectPlugin({ root: dir }).load('\0virtual:e8-project')).rejects.toThrow(/project\.json/);
  });
});
```

Note this is the one place in the package where throwing is right: a Vite plugin's `load` reports a build failure by throwing, and a build that cannot find its project must fail loudly rather than emit an empty module.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: FAIL — cannot resolve `@/vite/projectPlugin`.

- [ ] **Step 3: Add the vite entries to `packages/runtime/rollup.config.mjs`**

Task 1 deliberately left them out — the input file did not exist. Append these two configs to the
exported array, after the two index entries:

```js
  {
    input: 'src/vite/projectPlugin.ts',
    external,
    output: { file: 'dist/vite.esm.js', format: 'esm', sourcemap: true },
    plugins: [typescript({ tsconfig: './tsconfig.json', declaration: false, declarationMap: false, sourceMap: true })],
  },
  {
    input: 'src/vite/projectPlugin.ts',
    external,
    output: { file: 'dist/vite.d.ts', format: 'esm' },
    plugins: [dts()],
  },
```

- [ ] **Step 4: Write `packages/runtime/src/vite/projectPlugin.ts`**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const VIRTUAL_ID = 'virtual:e8-project';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

export interface ProjectPluginOptions {
  /** Project root holding `project.json`. Defaults to the Vite root at config time. */
  root?: string;
  /** Filename, if a project keeps several. Defaults to `project.json`. */
  projectFile?: string;
}

/**
 * Turn `project.json` into a module a bundler can see.
 *
 * The kernel reads plugin manifests as objects, but a browser bundle cannot read a file off disk.
 * So the project's plugin list becomes STATIC imports here — static because a bundler has to see
 * them to include the code. The emitted module exports `project` (verbatim) and `manifests`
 * (in the project's own key order, which is what makes the plan reproducible).
 *
 * Node-only. Never let this file into a browser bundle.
 */
export function projectPlugin(options: ProjectPluginOptions = {}) {
  let root = options.root ?? process.cwd();
  const file = options.projectFile ?? 'project.json';

  return {
    name: 'e8:project',

    configResolved(config: { root: string }): void {
      if (!options.root) root = config.root;
    },

    resolveId(id: string): string | null {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },

    async load(id: string): Promise<string | null> {
      if (id !== RESOLVED_ID) return null;

      const path = join(root, file);
      let raw: string;
      try {
        raw = readFileSync(path, 'utf8');
      } catch {
        throw new Error(`e8:project — could not read ${file} at ${path}`);
      }

      let project: { plugins?: Record<string, unknown> };
      try {
        project = JSON.parse(raw) as { plugins?: Record<string, unknown> };
      } catch (err) {
        throw new Error(
          `e8:project — ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const ids = Object.keys(project.plugins ?? {});
      const imports = ids.map((specifier, i) => `import m${i} from '${specifier}';`).join('\n');
      const list = ids.map((_, i) => `m${i}`).join(', ');

      return [
        '// Generated by e8:project — do not edit.',
        imports,
        `export const project = ${JSON.stringify(project, null, 2)};`,
        `export const manifests = [${list}];`,
        '',
      ].join('\n');
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: PASS — 6 new tests.

- [ ] **Step 6: Commit**

```bash
git add packages/runtime/rollup.config.mjs packages/runtime/src/vite/projectPlugin.ts packages/runtime/tests/projectPlugin.test.ts
git status --short
git commit -m "feat(runtime): the vite plugin that turns project.json into a bundled module"
```

---

## Task 7: The proof — a fourth provider from the project's own `plugins/`

**Files:**
- Create: `packages/runtime/tests/proof-replay-provider.test.ts`
- Modify: `packages/runtime/src/index.ts` (the public barrel)
- Create: `packages/runtime/README.md`

**Interfaces:**
- Produces: the complete public API of `@energy8engine/runtime`.

**This task is the acceptance test for the whole phase.** Spec §7.2, corrected: a plugin living in the project's own `plugins/` folder contributes a new `session.provider` and is selected by its matcher — with no edit to the engine and no edit to the game's source. Today the session provider is a named branch inside `createSlotGame`, so a fourth kind of backend cannot be added without editing the host. If this test cannot be written without touching `src/`, the plugin model has not delivered what it was built for, and that is a finding to report rather than to work around.

- [ ] **Step 1: Write the proof test `packages/runtime/tests/proof-replay-provider.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { definePlugin, resolvePlan, type ResolvedPlan } from '@energy8engine/kernel';
import { hostPlugin, POINT_SESSION_PROVIDER } from '@/points';
import { sessionDevPlugin } from '@/session/dev';
import { sessionStakePlugin } from '@/session/stake';
import { runGame } from '@/runGame';
import { provider, type InstalledSession, type SessionContext } from '@/session/types';

/**
 * A plugin as a game author would write it, in their own project's plugins/ folder. Nothing below
 * imports anything private, and nothing in packages/ changes to accommodate it.
 */
const installed = vi.fn();

const replayPlugin = definePlugin({
  id: 'acme-session-replay',
  version: '1.0.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/host': '^0.1.0' },
  contributes: {
    [POINT_SESSION_PROVIDER]: [
      {
        id: 'replay',
        schema: {
          bookFile: {
            kind: 'asset',
            label: 'Recorded books',
            doc: 'A JSONL dump of recorded rounds to replay.',
            accept: 'any',
            default: 'books/recorded.jsonl',
          },
        },
        defaults: { label: 'Replay recorded books' },
        activateWhen: { urlParam: 'replay' },
        doc: 'Serves rounds from a recorded book dump instead of a live backend.',
        create: async () =>
          provider(async (ctx: SessionContext): Promise<InstalledSession> => {
            installed(ctx.settings);
            return { dispose: () => {} };
          }),
      },
    ],
  },
});

const project = {
  plugins: {
    '@e8/host': { version: '*' },
    '@e8/session-dev': { version: '*' },
    '@e8/session-stake': { version: '*' },
    'acme-session-replay': {
      version: '*',
      contributions: { 'session.provider:replay': { settings: { bookFile: 'books/session-42.jsonl' } } },
    },
  },
};

const manifests = [hostPlugin, sessionDevPlugin, sessionStakePlugin, replayPlugin];

describe('a fourth session provider, contributed by the project itself', () => {
  it('wins when its matcher fires, and nothing in the engine changed to allow it', async () => {
    installed.mockClear();
    const result = await runGame({
      project,
      manifests,
      url: 'https://game.example/play?replay=session-42',
      createSession: async () => ({ kind: 'session' }),
    });

    expect(result.diagnostics).toEqual([]);
    const active = result.plan.contributions.filter(
      (c) => c.pointId === POINT_SESSION_PROVIDER && c.active,
    );
    expect(active.map((c) => c.id)).toEqual(['replay']);
    expect(result.session).toEqual({ kind: 'session' });
  });

  it('receives the settings the project set for it', async () => {
    installed.mockClear();
    await runGame({
      project,
      manifests,
      url: 'https://game.example/play?replay=session-42',
      createSession: async () => ({}),
    });
    expect(installed).toHaveBeenCalledWith(expect.objectContaining({ bookFile: 'books/session-42.jsonl' }));
  });

  it('yields to dev when the replay parameter is absent', async () => {
    const result = await runGame({
      project,
      manifests,
      url: 'https://game.example/play',
      loadDevBridge: async () => class { start() {} stop() {} },
      createSession: async () => ({}),
    });
    expect(result.diagnostics).toEqual([]);
    expect(
      result.plan.contributions.filter((c) => c.pointId === POINT_SESSION_PROVIDER && c.active).map((c) => c.id),
    ).toEqual(['dev']);
  });

  it('the IDE can say when each provider takes over, without running any of them', () => {
    const { plan } = resolvePlan({
      project,
      manifests,
      launch: { url: 'https://game.example/play' },
      kernelVersion: '0.1.0',
    }) as { plan: ResolvedPlan };

    const labels = Object.fromEntries(
      plan.contributions
        .filter((c) => c.pointId === POINT_SESSION_PROVIDER)
        .map((c) => [c.id, c.activationLabel]),
    );
    expect(labels.replay).toBe('when ?replay is present');
    expect(labels.stake).toBe('when the build target is "stake"');
    expect(labels.dev).toBe('when nothing else matches');
  });

  it('reports a collision when two providers claim the same launch', async () => {
    const rival = definePlugin({
      id: 'acme-rival',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { '@e8/host': '^0.1.0' },
      contributes: {
        [POINT_SESSION_PROVIDER]: [
          {
            id: 'rival',
            activateWhen: { urlParam: 'replay' },
            doc: 'Also claims the replay launch.',
            create: async () => provider(async () => ({})),
          },
        ],
      },
    });
    const result = await runGame({
      project: { plugins: { ...project.plugins, 'acme-rival': { version: '*' } } },
      manifests: [...manifests, rival],
      url: 'https://game.example/play?replay=1',
      createSession: async () => ({}),
    });
    expect(result.session).toBeNull();
    const d = result.diagnostics.find((x) => x.code === 'resolve/ambiguous-activation');
    expect(d).toBeDefined();
    expect(d!.message).toContain('replay');
    expect(d!.message).toContain('rival');
  });
});
```

The fourth test is the one that matters for phase 4: the IDE renders that composition screen from `activationLabel` alone, without running a single provider.

- [ ] **Step 2: Run the test**

```bash
npm test --workspace @energy8engine/runtime
```

Expected: PASS — 5 new tests. **If any of them cannot be made to pass without editing a file under `packages/runtime/src/` to accommodate the replay plugin specifically, stop and report it.** That would mean the model requires the engine to know about each provider, which is the thing this phase exists to disprove.

- [ ] **Step 3: Write the public barrel `packages/runtime/src/index.ts`**

Replace the file's contents entirely. Derive the list from what the source actually exports — do not transcribe blindly, and check each name resolves.

```ts
/**
 * @energy8engine/runtime — the host that turns a resolved plugin plan into a live session.
 *
 * The kernel knows how plugins compose. This package knows what a slot game needs composed:
 * which points exist, what a session provider is, and how a project's plan becomes a running game.
 */

/** Runtime version. Distinct from the kernel's — they version independently. */
export const RUNTIME_VERSION = '0.1.0';

// The vocabulary
export {
  HOOK_IDS,
  hostPlugin,
  POINT_BUILD_TARGET,
  POINT_SESSION_PROVIDER,
  SESSION_PROVIDER_SCHEMA,
} from './points';
export type { HookId } from './points';

// The session contract and the built-in providers
export type {
  DevBridgeCtor,
  DevBridgeLike,
  InstalledSession,
  SessionContext,
  SessionProvider,
  StakeAdapterBundle,
  StakeBridgeCtor,
  StakeBridgeLike,
} from './session/types';
export { provider } from './session/types';
export { sessionDevPlugin } from './session/dev';
export { POINT_STAKE_ADAPTER, sessionStakePlugin } from './session/stake';

// The host
export { runGame } from './runGame';
export type { RunGameInput, RunGameResult } from './runGame';
```

`projectPlugin` is deliberately absent — it is node-only and lives behind the `/vite` sub-path, so importing the barrel in a browser can never drag `node:fs` in.

- [ ] **Step 4: Write `packages/runtime/README.md`**

````markdown
# @energy8engine/runtime

Turns a game's plugin plan into a live session. Built on [`@energy8engine/kernel`](../kernel),
which knows how plugins compose; this package knows what a slot game needs composed.

## The one idea

A **session provider does not return a session.** Every backend here — the dev mock host, Stake,
a replay source — installs itself on the same in-process SDK channel, and then ONE handshake talks
to whatever installed itself. So a provider's job is: put your backend on the channel, hand back a
disposer.

```ts
import { runGame } from '@energy8engine/runtime';
import { project, manifests } from 'virtual:e8-project';

const { session, diagnostics, dispose } = await runGame({
  project,
  manifests,
  url: location.href,
  buildTarget: import.meta.env.BUILD_TARGET,
});

if (diagnostics.some((d) => d.severity === 'error')) showErrorScreen(diagnostics);
```

`runGame` never rejects. A malformed project, a plugin that will not load, a backend whose
installation throws — each arrives as a diagnostic on the returned value.

## Writing your own provider

Put it in your project's `plugins/` folder and list it in `project.json`. Nothing in the engine
changes.

```ts
import { definePlugin } from '@energy8engine/kernel';
import { POINT_SESSION_PROVIDER, provider } from '@energy8engine/runtime';
import { install } from './install';

export default definePlugin({
  id: 'acme-session-replay',
  version: '1.0.0',
  engine: '^0.1.0',
  dependsOn: { '@e8/host': '^0.1.0' },
  contributes: {
    'session.provider': [
      {
        id: 'replay',
        schema: { bookFile: { kind: 'asset', label: 'Recorded books', default: 'books/rounds.jsonl' } },
        activateWhen: { urlParam: 'replay' },
        doc: 'Serves rounds from a recorded dump instead of a live backend.',
        // `provider(...)` bridges two contracts: the kernel's create() resolves to a FACTORY
        // (settings -> instance), and our instance is the installer function itself.
        create: async () => provider(install),
      },
    ],
  },
});
```

`activateWhen` is declarative on purpose: the IDE reads `activationLabel` off the resolved plan and
tells a person *when* each provider takes over, without running any of them.

## Getting `project.json` into a bundle

A browser bundle cannot read a file off disk, so the Vite plugin turns the project into a module
with static imports a bundler can see:

```ts
// vite.config.ts
import { projectPlugin } from '@energy8engine/runtime/vite';
export default { plugins: [projectPlugin()] };
```

## Optional peers

`@energy8platform/platform-core` and `@energy8platform/stake-bridge` are **optional** peer
dependencies, reached only through dynamic `import()` inside a provider. A game that never ships to
Stake builds fine without `stake-bridge` installed.

## Tests

```bash
npm test --workspace @energy8engine/runtime
```

Run it with that exact command — `npx vitest run <path>` from the repo root reports false failures
under this workspace layout. Every test in this package runs in Node; nothing here needs a browser.
````

- [ ] **Step 5: Run everything**

```bash
npm test --workspace @energy8engine/runtime
npm run typecheck --workspace @energy8engine/runtime
npm run build --workspace @energy8engine/runtime
npm test --workspaces --if-present
```

Expected: the runtime suite green, typecheck clean, both bundles emitted, and the whole monorepo still green.

- [ ] **Step 6: Confirm the browser bundle carries no node builtins**

```bash
grep -c "node:fs\|node:path" packages/runtime/dist/index.esm.js || echo "0 — correct"
```

Expected: `0 — correct`. A hit means `projectPlugin` leaked into the main entry.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/index.ts packages/runtime/README.md \
        packages/runtime/tests/proof-replay-provider.test.ts
git status --short
git commit -m "feat(runtime): public API, README, and the fourth-provider proof"
```

- [ ] **Step 8: Push the branch**

```bash
git push -u origin feat/runtime
```

---

## Definition of Done

- `npm test --workspace @energy8engine/runtime` green.
- `npm run typecheck --workspace @energy8engine/runtime` clean.
- `npm run build --workspace @energy8engine/runtime` emits `dist/index.esm.js`, `dist/index.d.ts`, `dist/vite.esm.js`, `dist/vite.d.ts`, and the main entry contains no `node:` specifier.
- `npm test --workspaces --if-present` — the whole monorepo still green.
- No file under `packages/kernel`, `packages/game-engine`, `packages/platform-core` or `packages/stake-bridge` was modified.
- **The proof test passes without any provider-specific code in `packages/runtime/src/`.**

## What phase 2b will need from this

`runGame` (extended to drive scenes rather than returning after the handshake), `POINT_SESSION_PROVIDER`, `HOOK_IDS`, `hostPlugin`, `SessionContext`, and `projectPlugin`. Phase 2b adds the points its own plugins own — `renderer` declared by `renderer-pixi`, `boot.overlay` by `loader`, `ui.shell` by `shell-html`, `scene.node` by `reel-system` — which is why they are absent here.

Carry forward the kernel's first residual: a `build`-phase `arity:'one'` point with nothing contributing hard-errors during a runtime resolve. `build.target` is `arity:'many'`, so phase 2a does not trip it — but phase 2b's `renderer` is `arity:'one'`, and a project resolved in a build context will need either a phase filter on `resolvePlan` or a documented rule that build-phase points are resolved separately.
