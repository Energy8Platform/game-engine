# Scaffold/CLI + Host Composition & Scene Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CLI target-directory flag + scaffold the engine's hidden audio/Spine peer-deps, and re-architect the slot host onto pixi-shell with a richer, slot-aware scene lifecycle (audio, host overlay, safe-area, pause/skip).

**Architecture:** One plan, two phases. **Phase A** (Spec A) touches only `@energy8platform/create-slot` — independent, ship first. **Phase B** (Spec B) reworks the `@energy8platform/game-engine` host: the stage becomes one layered Pixi canvas (scene → transparent pixi-shell → overlay), the scene contract is renamed/extended (`present`→`onSpin`, bonus→mode, plus start/end/skip/pause/bet/turbo/autoplay hooks), the scene gets a `SceneApi` (audio playback, overlay, shell safe-area) injected once via `onCreate`, and the dead shell sound settings are wired to the engine's existing `AudioManager`.

**Tech Stack:** TypeScript, PixiJS v8, Vitest 2, Rollup, npm workspaces. No new runtime deps in the engine.

## Global Constraints

- Specs: [docs/superpowers/specs/2026-06-25-scaffold-cli-design.md](../specs/2026-06-25-scaffold-cli-design.md), [docs/superpowers/specs/2026-06-25-host-scene-lifecycle-design.md](../specs/2026-06-25-host-scene-lifecycle-design.md).
- Scene contract is a **clean break, no back-compat, no deprecated aliases**: `present`→`onSpin`, `onBonusEnter/onBonusExit`→`onEnterMode/onExitMode`. Every in-repo scene + the create-slot template are rewritten.
- The host owns no new `AudioManager` — it wraps the existing `game.audio` (`GameApplication` builds it from `config.audio`).
- Scene audio handle is **playback-only** (`play`/`playMusic`/`stopMusic`/`duck`/`unduck`). No volume/mute on the scene side — volume/mute is shell `settingChange` → host only.
- BGM switching is **scene-driven** (no host mode→track map).
- Pause = full auto-pause: stop ticker + pause music + don't start the next auto-round + `onPause/onResume`.
- Skip = **double-tap** on the game area during an active `onSpin`, gated by a `skipGesture` setting (default **on**).
- Overlay is a single host-owned layer above scene + shell; declarative `show({ build, autoCloseMs?, closeOn?: 'tap'|false, dim? }): Promise<void>`; single-tap dismiss; concurrent `show()` while open ⇒ reject + warn.
- Dep version pins (verbatim): `@pixi/sound: "^6.0.0"`, `@esotericsoftware/spine-pixi-v8: "~4.2.0"`.
- Run from repo root: `npm test`, `npm run typecheck`, `npm run build`, or workspace-scoped `--workspace @energy8platform/<pkg>`.
- The host (`createSlotGame`) is NOT unit-tested (Pixi init hangs headless) — integration tasks gate on `npm run typecheck` + `npm run build`; pure helpers get Vitest tests.

---

## File Structure

**Phase A** — `packages/create-slot/`:
- `src/answers.ts` (modify) — parse `--dir`; carry `dir?` on the seed.
- `src/cli.ts` (modify) — resolve target dir from `--dir` else `cwd/id`; non-empty guard.
- `src/codegen/packageJson.ts` (modify) — add the two peer-deps.
- `tests/*.test.ts` (modify/create) — flag parse, dir resolution, guard, generated deps.

**Phase B** — `packages/game-engine/` + `packages/pixi-shell/`:
- `game-engine/src/audio/AudioManager.ts` (modify) — add master gain.
- `game-engine/src/host/sceneController.ts` (rewrite) — new `SlotSceneController`, `RenderContext` (+`signal`), `SceneApi`.
- `game-engine/src/host/sceneAudio.ts` (create) — playback-only facade over `AudioManager`.
- `game-engine/src/host/overlayController.ts` (create) — host overlay layer.
- `game-engine/src/host/pauseController.ts` (create) — visibility → pause/resume.
- `game-engine/src/host/skipGesture.ts` (create) — double-tap detector.
- `game-engine/src/host/runRound.ts` (modify) — emit new hooks, per-segment `AbortController`, `onSpin`.
- `game-engine/src/host/createSlotGame.ts` (modify) — pixi-shell, settingChange→audio, scene hooks, `onCreate(api)`, overlay/pause/skip wiring, return type.
- `game-engine/src/host/shellConfig.ts` (modify) — shell-agnostic config (drop `mount`, host supplies target).
- `game-engine/src/host/types.ts`, `index.ts` (modify) — `SlotGameHandle.shell` type, re-exports.
- `pixi-shell/src/PixiGameShell.ts`, `src/types.ts` (modify) — `barHeight`/`safeArea` getter.
- `pixi-shell/src/components/Settings.ts` (modify) — `skipGesture` toggle.
- `examples/spec-slot/GameScene.ts`, `main.ts` (modify) — new hook names.
- `create-slot/src/codegen/gameScene.ts` (modify) — template scene to new hook names.

---

# Phase A — Scaffold & CLI

## Task A1: `--dir` target directory + non-empty guard

**Files:**
- Modify: `packages/create-slot/src/answers.ts` (parseFlags ~L36-46, VALUE_FLAGS L69, seedFromArgv)
- Modify: `packages/create-slot/src/cli.ts:14-21`
- Test: `packages/create-slot/tests/answers.test.ts` (create or extend)

**Interfaces:**
- Consumes: existing `parseFlags`, `seedFromArgv`, `applyDefaults`, `generate(a, dir, versions)`.
- Produces: `parseFlags` result may include `dir?: string`; `cli` resolves the target dir as `--dir` (resolved against cwd) else `cwd/id`; a non-empty target dir aborts.

- [ ] **Step 1: Write the failing test** — `packages/create-slot/tests/answers.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseFlags } from '../src/answers';

describe('parseFlags --dir', () => {
  it('parses --dir value', () => {
    expect(parseFlags(['my-game', '--dir', 'games/foo']).dir).toBe('games/foo');
  });
  it('parses --dir=value form', () => {
    expect(parseFlags(['my-game', '--dir=../foo']).dir).toBe('../foo');
  });
  it('omits dir when absent', () => {
    expect(parseFlags(['my-game']).dir).toBeUndefined();
  });
  it('does not treat the --dir value as the positional id', () => {
    // seedFromArgv must skip the --dir value when scanning for a positional id
    const { seedFromArgv } = require('../src/answers');
    const seed = seedFromArgv(['cosmic', '--dir', 'games/foo']);
    expect(seed.id).toBe('cosmic');
    expect(seed.dir).toBe('games/foo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/create-slot/tests/answers.test.ts -t "parseFlags --dir"`
Expected: FAIL — `dir` is `undefined` / property not on `Answers`.

- [ ] **Step 3: Add `dir` to the seed type and parser**

In `packages/create-slot/src/answers.ts`:

Add `dir` to the partial-only seed. `Answers` itself stays unchanged (dir is CLI-only, not a generated answer), so type the parser returns as `Partial<Answers> & { dir?: string }`. Change the two return types and add parsing:

```ts
// parseFlags: add inside the for-loop, alongside the other `--flag value` cases:
else if (a === '--dir') (out as { dir?: string }).dir = args[++i];
```

```ts
// VALUE_FLAGS: add '--dir' so its value isn't scanned as a positional id
const VALUE_FLAGS = new Set(['--id', '--title', '--mechanic', '--grid', '--dir']);
```

Change both function signatures so `dir` survives:

```ts
export function parseFlags(argv: string[]): Partial<Answers> & { dir?: string } {
export function seedFromArgv(argv: string[]): Partial<Answers> & { dir?: string } {
```

(`seedFromArgv` already starts from `parseFlags(argv)` and only sets `id`, so `dir` flows through unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/create-slot/tests/answers.test.ts -t "parseFlags --dir"`
Expected: PASS (all 4).

- [ ] **Step 5: Wire the target dir + non-empty guard in the CLI**

In `packages/create-slot/src/cli.ts`, replace lines 14-21 (`main`):

```ts
async function main(): Promise<void> {
  const seed = seedFromArgv(argv.slice(2));
  const yes = argv.includes('--yes');
  const answers = yes ? applyDefaults(seed) : await prompt(seed);
  // Target dir: explicit --dir (resolved against cwd) wins; else cwd/<id> (backward compatible).
  const dir = seed.dir ? resolve(process.cwd(), seed.dir) : resolve(process.cwd(), answers.id);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`Target directory ${dir} already exists and is not empty.`);
  }
  await generate(answers, dir, PUBLISHED);
  console.log(`\n✓ Created ${answers.id} at ${dir}\n  cd ${seed.dir ?? answers.id} && npm install && npm run dev\n`);
}
```

Add the imports at the top of `cli.ts`:

```ts
import { existsSync, readdirSync } from 'node:fs';
```

Note: `prompt(seed)` returns `Answers` and does not carry `dir`; read `dir` from `seed` (the raw flags), as above.

- [ ] **Step 6: Write the failing guard test** — `packages/create-slot/tests/generate.dir.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate';

const VERSIONS = {
  'platform-core': '^0.0.0', 'game-engine': '^0.0.0', 'stake-kit': '^0.0.0',
  'stake-bridge': '^0.0.0', 'stake-math-tools': '^0.0.0',
};
const ANSWERS = { id: 'demo', title: 'Demo', mechanic: 'cluster' as const, grid: { cols: 7, rows: 7 }, stake: false };

let made: string[] = [];
afterEach(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); made = []; });

describe('generate into an explicit dir', () => {
  it('writes a package.json into the chosen directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cs-'));
    made.push(root);
    const target = join(root, 'nested', 'demo');
    await generate(ANSWERS, target, VERSIONS);
    const pkg = require(join(target, 'package.json'));
    expect(pkg.name).toBe('demo');
  });
});
```

(The non-empty *guard* lives in `cli.ts`, not `generate`; it is covered by the unit test on `parseFlags`/resolution plus this generate-into-nested-dir test. A full CLI e2e is out of scope — `generate` already accepts an arbitrary `targetDir`, so `--dir` only needs the resolution + guard, both unit-covered.)

- [ ] **Step 7: Run the test**

Run: `npx vitest run packages/create-slot/tests/generate.dir.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + commit**

Run: `npm run typecheck --workspace @energy8platform/create-slot`
Expected: no errors.

```bash
git add packages/create-slot/src/answers.ts packages/create-slot/src/cli.ts packages/create-slot/tests/answers.test.ts packages/create-slot/tests/generate.dir.test.ts
git commit -m "feat(create-slot): --dir target directory flag + non-empty guard"
```

## Task A2: Scaffold the hidden audio/Spine peer-deps

**Files:**
- Modify: `packages/create-slot/src/codegen/packageJson.ts:32-38`
- Test: `packages/create-slot/tests/packageJson.test.ts` (create or extend)

**Interfaces:**
- Consumes: `genPackageJson(a, v)`.
- Produces: generated `dependencies` always include `@pixi/sound` and `@esotericsoftware/spine-pixi-v8`.

- [ ] **Step 1: Write the failing test** — `packages/create-slot/tests/packageJson.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { genPackageJson } from '../src/codegen/packageJson';

const V = {
  'platform-core': '^0.25.0', 'game-engine': '^0.18.0', 'stake-kit': '^0.2.0',
  'stake-bridge': '^0.3.0', 'stake-math-tools': '^0.8.0',
};
const A = { id: 'demo', title: 'Demo', mechanic: 'cluster' as const, grid: { cols: 7, rows: 7 }, stake: true };

describe('genPackageJson peer-deps', () => {
  it('always includes @pixi/sound and spine-pixi-v8', () => {
    const pkg = JSON.parse(genPackageJson(A, V));
    expect(pkg.dependencies['@pixi/sound']).toBe('^6.0.0');
    expect(pkg.dependencies['@esotericsoftware/spine-pixi-v8']).toBe('~4.2.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/create-slot/tests/packageJson.test.ts`
Expected: FAIL — keys are `undefined`.

- [ ] **Step 3: Add the deps**

In `packages/create-slot/src/codegen/packageJson.ts`, within the `dependencies` object (after the `'pixi.js'` line, before `zod`):

```ts
      'pixi.js': '^8.16.0',
      '@pixi/sound': '^6.0.0',
      '@esotericsoftware/spine-pixi-v8': '~4.2.0',
      zod: '^3.23.0',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/create-slot/tests/packageJson.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full create-slot suite (catch any version-assertion snapshot)**

Run: `npm test --workspace @energy8platform/create-slot`
Expected: PASS. If a snapshot/version test enumerates the full dependency set, update its expectation to include the two new keys; the workspace-version assertion is unaffected (these are third-party, not `@energy8platform/*`).

- [ ] **Step 6: Commit**

```bash
git add packages/create-slot/src/codegen/packageJson.ts packages/create-slot/tests/packageJson.test.ts
git commit -m "feat(create-slot): scaffold @pixi/sound + spine-pixi-v8 peer-deps"
```

---

# Phase B — Host composition + scene lifecycle

## Task B1: AudioManager master gain

**Files:**
- Modify: `packages/game-engine/src/audio/AudioManager.ts`
- Test: `packages/game-engine/tests/audioManager.master.test.ts` (create)

**Interfaces:**
- Produces: `AudioManager.setMasterVolume(v: number): void`, `AudioManager.getMasterVolume(): number`. Master is a 0..1 multiplier folded into the effective volume of every `play`/`playMusic` and applied via `applyVolumes`.

- [ ] **Step 1: Write the failing test** — `packages/game-engine/tests/audioManager.master.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { AudioManager } from '@/audio/AudioManager';

describe('AudioManager master volume', () => {
  it('defaults to 1 and clamps 0..1', () => {
    const a = new AudioManager();
    expect(a.getMasterVolume()).toBe(1);
    a.setMasterVolume(0.5);
    expect(a.getMasterVolume()).toBe(0.5);
    a.setMasterVolume(2);
    expect(a.getMasterVolume()).toBe(1);
    a.setMasterVolume(-1);
    expect(a.getMasterVolume()).toBe(0);
  });
  it('is a no-op-safe call before init (no @pixi/sound)', () => {
    const a = new AudioManager();
    expect(() => a.setMasterVolume(0.3)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/audioManager.master.test.ts`
Expected: FAIL — `setMasterVolume` is not a function.

- [ ] **Step 3: Implement master gain**

In `packages/game-engine/src/audio/AudioManager.ts`:

Add a field near the other private state (alongside `_categories`):

```ts
private _masterGain = 1.0;
```

Add the public methods (place near `setVolume`):

```ts
/** Global gain (0..1) folded into every category's effective volume. Driven by the shell's
 *  'master' settingChange. Does not affect the persisted per-category volumes. */
setMasterVolume(volume: number): void {
  this._masterGain = Math.max(0, Math.min(1, volume));
  this.applyVolumes();
}

getMasterVolume(): number {
  return this._masterGain;
}
```

In `applyVolumes()` (currently sets `sound.volumeAll = 1` unconditionally, ~L348-354) apply the master gain:

```ts
private applyVolumes(): void {
  if (!this._sound) return;
  this._sound.volumeAll = this._masterGain; // master multiplies the global bus
}
```

In `play()` and `playMusic()`, where the per-sound effective volume is computed (category volume × option volume), multiply by `this._masterGain` so a sound started while master < 1 is already attenuated (don't rely only on `volumeAll`). Concretely, find the `volume:` passed to `this._sound.play(alias, { volume: ... })` / the music volume assignment and multiply the existing expression by `this._masterGain`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/audioManager.master.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck --workspace @energy8platform/game-engine`

```bash
git add packages/game-engine/src/audio/AudioManager.ts packages/game-engine/tests/audioManager.master.test.ts
git commit -m "feat(audio): AudioManager master volume gain"
```

## Task B2: New scene contract types (`SlotSceneController`, `RenderContext`, `SceneApi`)

**Files:**
- Rewrite: `packages/game-engine/src/host/sceneController.ts`
- Modify: `packages/game-engine/src/host/index.ts` (export `SceneApi`)
- Test: `packages/game-engine/tests/sceneContract.types.test.ts` (create — compile-time shape assertions)

**Interfaces:**
- Produces (consumed by B3-B11):
  - `RenderContext { bet, action, mode, readonly turbo, formatAmount, signal: AbortSignal }`
  - `SlotSceneController<T>` with required `onSpin(result, ctx)` and optional `onCreate(api)`, `onSpinStart()`, `onEnterMode(result, ctx)`, `onExitMode(result, ctx)`, `onSpinEnd(result, ctx)`, `onBetChanged(bet)`, `onTurboChanged(level)`, `onAutoplayChanged(state)`, `onSkip()`, `onPause()`, `onResume()`.
  - `SceneApi { audio, overlay, shell, formatAmount, readonly bet, readonly mode, readonly turbo }`
  - `SceneAudio`, `SceneOverlay`, `SceneShell`, `AutoplaySceneState`, `OverlayShowOptions` types.

- [ ] **Step 1: Write the failing compile test** — `packages/game-engine/tests/sceneContract.types.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import type { SlotSceneController, SceneApi } from '@/host/sceneController';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

describe('scene contract shape', () => {
  it('a minimal scene implements onSpin and compiles', () => {
    const scene: SlotSceneController<SlotSpinResultBase> = {
      async onSpin(result, ctx) { void result; void ctx.bet; void ctx.signal; },
    };
    expect(typeof scene.onSpin).toBe('function');
  });
  it('SceneApi exposes playback-only audio (no setVolume)', () => {
    // @ts-expect-error setVolume must NOT exist on the scene's audio handle
    const bad: SceneApi['audio']['setVolume'] = undefined;
    void bad;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/sceneContract.types.test.ts`
Expected: FAIL — `onSpin` not on the (old `present`) interface; `SceneApi` not exported.

- [ ] **Step 3: Rewrite `sceneController.ts`**

Replace the whole file with:

```ts
import type { Container } from 'pixi.js';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

/** Everything a scene needs to render one segment. The host builds it per segment. */
export interface RenderContext {
  /** Bet for this round (major units). Stable for the whole round. */
  bet: number;
  /** Trigger action in the game's own vocabulary ('spin' | 'ante' | 'buy_bonus' | …). */
  action: string;
  /** Stake bet-mode of the round ('BASE' | 'ANTE' | 'BONUS' | …). */
  mode: string;
  /** Currency-aware money formatter. */
  formatAmount(value: number): string;
  /** LIVE turbo level (0 = off, 1..3 = escalating speed). Read at access. */
  readonly turbo: number;
  /** Aborted when the player skips this segment (double-tap). The scene's async pacing can race or
   *  cancel on it; on abort the scene must collapse to the segment's final visual state. */
  signal: AbortSignal;
}

/** Playback-only audio handle. Volume/mute are shell settings → host, never the scene. */
export interface SceneAudio {
  play(alias: string, opts?: { volume?: number; loop?: boolean; speed?: number }): void;
  playMusic(alias: string, fadeMs?: number): void;
  stopMusic(): void;
  duck(factor: number): void;
  unduck(): void;
}

export interface OverlayShowOptions {
  /** Draw the overlay content into `container` (sized to the canvas). */
  build(container: Container, size: { width: number; height: number }): void;
  /** Auto-close after N ms (combine with closeOn — whichever fires first). */
  autoCloseMs?: number;
  /** Dismiss on a single tap. Default 'tap'. Set false to require an explicit close(). */
  closeOn?: 'tap' | false;
  /** Optional host-drawn backdrop alpha (0..1). Default: none (game draws its own). */
  dim?: number;
}

/** Single host-owned layer above scene + shell. Eats pointer events so shell controls are
 *  unreachable while open. */
export interface SceneOverlay {
  /** Resolves when the overlay closes. Rejects if one is already open. */
  show(opts: OverlayShowOptions): Promise<void>;
  close(): void;
}

export interface SceneShell {
  /** Live insets (px). `bottom` = the shell bar height; read inside onResize. */
  readonly safeArea: { top: number; right: number; bottom: number; left: number };
}

export interface AutoplaySceneState {
  running: boolean;
  remaining: number;
}

/** Stable capabilities injected once via onCreate. */
export interface SceneApi {
  audio: SceneAudio;
  overlay: SceneOverlay;
  shell: SceneShell;
  formatAmount(value: number): string;
  readonly bet: number;
  readonly mode: string;
  readonly turbo: number;
}

/** The contract a slot scene implements. The HOST owns the play→present→ack→drain loop and the
 *  shell; the scene only renders + reacts. Only `onSpin` is required. */
export interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  /** Injected ONCE before the first round — capabilities, subscriptions, one-time setup. */
  onCreate?(api: SceneApi): void;
  /** Fires once per round when the player presses spin (before the network result). */
  onSpinStart?(): void;
  /** Render ONE segment (a spin or one free spin). Required. Await your own pacing. */
  onSpin(result: T, ctx: RenderContext): Promise<void>;
  /** Fires when ctx.mode changes between segments (entering a non-BASE mode/bonus). */
  onEnterMode?(result: T, ctx: RenderContext): Promise<void>;
  /** Fires when leaving a mode (back toward BASE). */
  onExitMode?(result: T, ctx: RenderContext): Promise<void>;
  /** Fires once per round after the full drain (controls unlocked). */
  onSpinEnd?(result: T, ctx: RenderContext): void;
  /** Shell events (may fire while idle). */
  onBetChanged?(bet: number): void;
  onTurboChanged?(level: number): void;
  onAutoplayChanged?(state: AutoplaySceneState): void;
  /** Double-tap skip during an active onSpin (gated by the skipGesture setting). */
  onSkip?(): void;
  /** Tab focus lost / regained. */
  onPause?(): void;
  onResume?(): void;
}
```

In `packages/game-engine/src/host/index.ts`, extend the existing scene-controller re-export:

```ts
export type {
  SlotSceneController, RenderContext, SceneApi, SceneAudio, SceneOverlay, SceneShell,
  OverlayShowOptions, AutoplaySceneState,
} from './sceneController';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/sceneContract.types.test.ts`
Expected: PASS. (Other files referencing `present`/`onBonusEnter` will now fail typecheck — fixed in B7/B10/B11. Do NOT run a full typecheck yet.)

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/host/sceneController.ts packages/game-engine/src/host/index.ts packages/game-engine/tests/sceneContract.types.test.ts
git commit -m "feat(host): new slot scene contract (onSpin/onEnterMode/SceneApi)"
```

## Task B3: `SceneAudio` facade over `AudioManager`

**Files:**
- Create: `packages/game-engine/src/host/sceneAudio.ts`
- Test: `packages/game-engine/tests/sceneAudio.test.ts` (create)

**Interfaces:**
- Consumes: `AudioManager` (`play(alias, category, opts)`, `playMusic`, `stopMusic`, `duckMusic`, `unduckMusic`).
- Produces: `createSceneAudio(audio: AudioManager): SceneAudio` — maps the playback subset, hard-coding `play` to the `'sfx'` category and exposing nothing else.

- [ ] **Step 1: Write the failing test** — `packages/game-engine/tests/sceneAudio.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { createSceneAudio } from '@/host/sceneAudio';

function fakeManager() {
  return {
    play: vi.fn(), playMusic: vi.fn(), stopMusic: vi.fn(),
    duckMusic: vi.fn(), unduckMusic: vi.fn(),
  };
}

describe('createSceneAudio', () => {
  it('routes play through the sfx category', () => {
    const m = fakeManager();
    const a = createSceneAudio(m as any);
    a.play('coin', { volume: 0.5 });
    expect(m.play).toHaveBeenCalledWith('coin', 'sfx', { volume: 0.5 });
  });
  it('maps music + duck verbs', () => {
    const m = fakeManager();
    const a = createSceneAudio(m as any);
    a.playMusic('bgm_free', 800); a.stopMusic(); a.duck(0.3); a.unduck();
    expect(m.playMusic).toHaveBeenCalledWith('bgm_free', 800);
    expect(m.stopMusic).toHaveBeenCalled();
    expect(m.duckMusic).toHaveBeenCalledWith(0.3);
    expect(m.unduckMusic).toHaveBeenCalled();
  });
  it('does not expose volume/mute', () => {
    const a = createSceneAudio(fakeManager() as any);
    expect((a as Record<string, unknown>).setVolume).toBeUndefined();
    expect((a as Record<string, unknown>).muteAll).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/sceneAudio.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `sceneAudio.ts`**

```ts
import type { AudioManager } from '../audio/AudioManager';
import type { SceneAudio } from './sceneController';

/** Wrap the engine's AudioManager into the playback-only handle a scene receives. Volume/mute are
 *  deliberately omitted — those are driven by the shell's settingChange → host. */
export function createSceneAudio(audio: AudioManager): SceneAudio {
  return {
    play: (alias, opts) => audio.play(alias, 'sfx', opts),
    playMusic: (alias, fadeMs) => audio.playMusic(alias, fadeMs),
    stopMusic: () => audio.stopMusic(),
    duck: (factor) => audio.duckMusic(factor),
    unduck: () => audio.unduckMusic(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/sceneAudio.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/host/sceneAudio.ts packages/game-engine/tests/sceneAudio.test.ts
git commit -m "feat(host): SceneAudio playback-only facade over AudioManager"
```

## Task B4: `OverlayController` host overlay layer

**Files:**
- Create: `packages/game-engine/src/host/overlayController.ts`
- Test: `packages/game-engine/tests/overlayController.test.ts` (create)

**Interfaces:**
- Consumes: a Pixi `Container` parent (added to the stage above the shell by B10), a live `() => { width, height }` size getter.
- Produces: `createOverlayController(deps): { overlay: SceneOverlay; resize(w, h): void; destroy(): void }`. `overlay.show()` builds content into a child container, installs a full-screen pointer-eating hit area, resolves on close (tap / autoClose / `close()`), and rejects if one is already open.

- [ ] **Step 1: Write the failing test** — `packages/game-engine/tests/overlayController.test.ts`

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Container } from 'pixi.js';
import { createOverlayController } from '@/host/overlayController';

function setup() {
  const parent = new Container();
  const ctl = createOverlayController({ parent, size: () => ({ width: 800, height: 600 }) });
  return { parent, ctl };
}

describe('OverlayController', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves on autoClose and tears down the layer', async () => {
    const { parent, ctl } = setup();
    let built = false;
    const p = ctl.overlay.show({ build: () => { built = true; }, autoCloseMs: 100, closeOn: false });
    expect(built).toBe(true);
    expect(parent.children.length).toBe(1);
    vi.advanceTimersByTime(100);
    await p;
    expect(parent.children.length).toBe(0);
  });

  it('resolves on manual close()', async () => {
    const { ctl } = setup();
    const p = ctl.overlay.show({ build: () => {}, closeOn: false });
    ctl.overlay.close();
    await expect(p).resolves.toBeUndefined();
  });

  it('rejects a concurrent show()', async () => {
    const { ctl } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p1 = ctl.overlay.show({ build: () => {}, closeOn: false });
    await expect(ctl.overlay.show({ build: () => {} })).rejects.toThrow(/already open/i);
    expect(warn).toHaveBeenCalled();
    ctl.overlay.close();
    await p1;
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/overlayController.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `overlayController.ts`**

```ts
import { Container, Graphics } from 'pixi.js';
import type { SceneOverlay, OverlayShowOptions } from './sceneController';

interface OverlayDeps {
  /** Container mounted above the shell on the stage. */
  parent: Container;
  /** Live canvas size getter (for the hit area + build size). */
  size(): { width: number; height: number };
}

interface ActiveOverlay {
  layer: Container;
  resolve(): void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createOverlayController(deps: OverlayDeps): {
  overlay: SceneOverlay;
  resize(w: number, h: number): void;
  destroy(): void;
} {
  let current: ActiveOverlay | null = null;

  const teardown = (): void => {
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    const { layer, resolve } = current;
    current = null;
    layer.removeFromParent();
    layer.destroy({ children: true });
    resolve();
  };

  const overlay: SceneOverlay = {
    show(opts: OverlayShowOptions): Promise<void> {
      if (current) {
        console.warn('[overlay] show() ignored — an overlay is already open');
        return Promise.reject(new Error('Overlay already open'));
      }
      const { width, height } = deps.size();
      const layer = new Container();
      layer.eventMode = 'static';

      // Pointer-eating + (optional) dim backdrop sized to the canvas.
      const hit = new Graphics().rect(0, 0, width, height).fill({
        color: 0x000000,
        alpha: opts.dim ?? 0.0001, // ~0 keeps it transparent but hit-testable
      });
      hit.eventMode = 'static';
      layer.addChild(hit);

      const content = new Container();
      layer.addChild(content);
      opts.build(content, { width, height });

      deps.parent.addChild(layer);

      return new Promise<void>((resolve) => {
        current = { layer, resolve, timer: null };
        const closeOn = opts.closeOn ?? 'tap';
        if (closeOn === 'tap') hit.on('pointertap', teardown);
        if (typeof opts.autoCloseMs === 'number') {
          current.timer = setTimeout(teardown, opts.autoCloseMs);
        }
      });
    },
    close(): void { teardown(); },
  };

  return {
    overlay,
    resize(w: number, h: number): void {
      if (!current) return;
      const hit = current.layer.getChildAt(0) as Graphics;
      hit.clear().rect(0, 0, w, h).fill({ color: 0x000000, alpha: hit.alpha });
    },
    destroy(): void { teardown(); },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/overlayController.test.ts`
Expected: PASS. If Pixi `Graphics` construction fails under the test env, fall back to a `Container`-only hit area (`eventMode='static'`, `hitArea = new Rectangle(...)`) — keep the same public behavior and update the test's child-count expectations accordingly.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/host/overlayController.ts packages/game-engine/tests/overlayController.test.ts
git commit -m "feat(host): OverlayController — single host overlay layer above scene+shell"
```

## Task B5: pixi-shell `safeArea` / bar-height getter

**Files:**
- Modify: `packages/pixi-shell/src/PixiGameShell.ts` (add getters; compute bar height in `syncLayout`/`render`)
- Modify: `packages/pixi-shell/src/types.ts` (if a public interface enumerates shell methods)

**Interfaces:**
- Produces: `PixiGameShell.barHeight: number` (getter) and `PixiGameShell.safeArea: { top, right, bottom, left }` (getter; only `bottom` is non-zero = bar height). Consumed by B10 to build `api.shell`.

- [ ] **Step 1: Locate the bar height**

Read `packages/pixi-shell/src/components/BottomBar.ts` to find where the bar's pixel height is computed (it sizes itself in `resize(screenW, screenH)`/`syncLayout`). If `BottomBar` exposes a height, read it; if not, add a `get height(): number` to `BottomBar` returning its laid-out bar height (the value it already uses to position itself from the bottom).

- [ ] **Step 2: Add the getters to `PixiGameShell`**

In `PixiGameShell.ts`, add public getters (near the other accessors). The shell already holds `private bar?: BottomBar;`:

```ts
/** Height of the bottom control bar in px (0 before first layout, or in replay-only chrome). */
get barHeight(): number {
  return this.bar?.height ?? 0;
}

/** Insets a scene should avoid. Only the bottom bar is reserved; the rest is full-bleed. */
get safeArea(): { top: number; right: number; bottom: number; left: number } {
  return { top: 0, right: 0, bottom: this.barHeight, left: 0 };
}
```

Ensure `bar.height` reflects the current `'wide' | 'mobile'` layout (it is recomputed in `onResize` → `render`). If `BottomBar` height depends on a value computed during `render()`, make `height` derive from the same constants the bar uses so it is correct immediately after `syncLayout()`.

- [ ] **Step 3: Typecheck the package**

Run: `npm run typecheck --workspace @energy8platform/pixi-shell`
Expected: no errors.

- [ ] **Step 4: Smoke the getter (optional unit test)**

If `packages/pixi-shell` has a Vitest config, add `packages/pixi-shell/tests/safeArea.test.ts` constructing a shell with a stub `app` (a minimal object exposing `stage`, `renderer.on`, `ticker`, `canvas`, `screen`) and asserting `shell.safeArea.bottom === shell.barHeight`. If the package has no test harness, skip — the getter is exercised end-to-end by the example in B10. Note the skip in the commit message.

- [ ] **Step 5: Commit**

```bash
git add packages/pixi-shell/src/PixiGameShell.ts packages/pixi-shell/src/components/BottomBar.ts
git commit -m "feat(pixi-shell): expose barHeight + safeArea getters"
```

## Task B6: pixi-shell `skipGesture` settings toggle

**Files:**
- Modify: `packages/pixi-shell/src/components/Settings.ts` (add a toggle row following the Sound on/off pattern at L20-28)

**Interfaces:**
- Produces: a Settings toggle that emits `settingChange { key: 'skipGesture', value: boolean }`. Default visual state ON. Consumed by B10 (host gates the double-tap on it).

- [ ] **Step 1: Add the toggle**

In `Settings.ts` `buildBody`, after the Sound on/off row (the `col.add(glassRow(...speaker...))` block) and before the volume sliders, add:

```ts
// Skip animations (double-tap) on/off — default ON. The host gates the double-tap skip on this.
let skipOn = true;
const skipToggle = new IconButton('skip', {
  size: 36,
  glyph: 24,
  color: host.tokens.plaqueLabel,
  hover: host.tokens.accent,
  activeColor: '#ffffff',
  active: true,
  onTap: () => {
    skipOn = !skipOn;
    skipToggle.active = skipOn;
    host.emit('settingChange', { key: 'skipGesture', value: skipOn });
  },
});
col.add(glassRow(host, [textNode(host, host.t('Quick skip (double-tap)')), new Spacer(), skipToggle]));
```

If `'skip'` is not a registered `IconButton` glyph, reuse an existing on/off glyph (e.g. the same one the sound toggle uses) or a neutral icon — the host only consumes the emitted `value`, not the icon. Confirm the glyph name against the icon registry used by `IconButton`.

- [ ] **Step 2: Typecheck + build the package**

Run: `npm run typecheck --workspace @energy8platform/pixi-shell`
Run: `npm run build --workspace @energy8platform/pixi-shell`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/pixi-shell/src/components/Settings.ts
git commit -m "feat(pixi-shell): Settings 'quick skip (double-tap)' toggle"
```

## Task B7: `runRound` — new hooks, per-segment AbortController, `onSpin`

**Files:**
- Modify: `packages/game-engine/src/host/runRound.ts`
- Test: `packages/game-engine/tests/runRound.test.ts` (create or extend)

**Interfaces:**
- Consumes: `RenderContext` (now with `signal`), `SlotSceneController` (now `onSpin`/`onEnterMode`/`onExitMode`).
- Produces: `RunRoundDeps<T>` gains `onSpinStart?(): void`, `onSpinEnd?(last: T, ctx): void`, `beforeSegment?(ac: AbortController): void`; `scene` is now `Pick<SlotSceneController<T>, 'onSpin'>`; `onBonusEnter/onBonusExit` deps renamed to `onEnterMode/onExitMode`; each segment runs under a fresh `AbortController` whose `signal` is injected into that segment's `ctx`.

- [ ] **Step 1: Write the failing test** — `packages/game-engine/tests/runRound.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { runRound } from '@/host/runRound';

type R = { totalWin: number; complete: boolean; roundId?: string; nextActions?: string[]; freeSpins?: { awarded?: number } };

function baseCtx() {
  return { bet: 1, action: 'spin', mode: 'BASE', formatAmount: (v: number) => String(v), turbo: 0 } as any;
}

describe('runRound lifecycle', () => {
  it('fires onSpinStart once, onSpin per segment, onSpinEnd once', async () => {
    const order: string[] = [];
    const results: R[] = [
      { totalWin: 0, complete: false, roundId: 'r1', nextActions: ['free'], freeSpins: { awarded: 1 } },
      { totalWin: 5, complete: true, roundId: 'r1' },
    ];
    let i = 0;
    await runRound<any>({
      play: async () => results[i++],
      ack: () => order.push('ack'),
      scene: { onSpin: async (r: R) => order.push(`spin:${r.complete}`) },
      context: () => baseCtx(),
      roleOf: (a) => (a === 'free' ? 'free' : 'base'),
      onSpinStart: () => order.push('start'),
      onSpinEnd: () => order.push('end'),
      onEnterMode: async () => order.push('enterMode'),
      onExitMode: async () => order.push('exitMode'),
    }, 'spin');
    expect(order[0]).toBe('start');
    expect(order.filter((o) => o === 'start')).toHaveLength(1);
    expect(order.filter((o) => o === 'end')).toHaveLength(1);
    expect(order).toContain('enterMode');
    expect(order).toContain('exitMode');
    expect(order[order.length - 1]).toBe('end');
  });

  it('injects an AbortSignal into each segment ctx and exposes the controller via beforeSegment', async () => {
    let sawSignal = false;
    let controller: AbortController | null = null;
    await runRound<any>({
      play: async () => ({ totalWin: 0, complete: true, roundId: 'r1' }),
      ack: () => {},
      scene: { onSpin: async (_r, ctx) => { sawSignal = ctx.signal instanceof AbortSignal; } },
      context: () => baseCtx(),
      roleOf: () => 'base',
      beforeSegment: (ac) => { controller = ac; },
    }, 'spin');
    expect(sawSignal).toBe(true);
    expect(controller).toBeInstanceOf(AbortController);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/runRound.test.ts`
Expected: FAIL — `onSpin`/`onSpinStart`/`beforeSegment` not honored (old `present`/`onBonusEnter`).

- [ ] **Step 3: Rewrite `runRound.ts`**

```ts
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';
import type { RenderContext, SlotSceneController } from './sceneController';

export interface RunRoundDeps<T extends SlotSpinResultBase> {
  play(action: string, bet: number, roundId?: string): Promise<T>;
  ack(): void;
  scene: Pick<SlotSceneController<T>, 'onSpin'>;
  /** Build the per-round render context (without signal — runRound injects it per segment). */
  context(action: string): Omit<RenderContext, 'signal'> & { signal?: AbortSignal };
  roleOf(action: string): string | undefined;
  afterPresent?(result: T): void;
  /** Once, before the first segment is played (player pressed spin). */
  onSpinStart?(): void;
  /** Once, after the full drain. */
  onSpinEnd?(last: T, ctx: RenderContext): void;
  /** Fires when entering a non-BASE mode (first free segment). */
  onEnterMode?(trigger: T, ctx: RenderContext): Promise<void>;
  /** Fires after the last segment of a mode. */
  onExitMode?(last: T, ctx: RenderContext): Promise<void>;
  /** Hands the host the AbortController for the segment about to present (for skip). */
  beforeSegment?(ac: AbortController): void;
}

export async function runRound<T extends SlotSpinResultBase>(
  deps: RunRoundDeps<T>,
  action: string,
): Promise<void> {
  deps.onSpinStart?.();

  const segment = async (a: string, roundId: string | undefined): Promise<{ r: T; ctx: RenderContext }> => {
    const ac = new AbortController();
    deps.beforeSegment?.(ac);
    const r = await deps.play(a, ctxBet, roundId);
    const ctx = { ...deps.context(action), signal: ac.signal } as RenderContext;
    await deps.scene.onSpin(r, ctx);
    deps.ack();
    deps.afterPresent?.(r);
    return { r, ctx };
  };

  const ctxBet = deps.context(action).bet;
  let { r, ctx } = await segment(action, undefined);

  let inMode = false;
  while (!r.complete && r.nextActions && r.nextActions.length > 0) {
    const next = r.nextActions[0];
    if (!inMode && deps.roleOf(next) === 'free') {
      inMode = true;
      await deps.onEnterMode?.(r, ctx);
    }
    ({ r, ctx } = await segment(next, r.roundId));
  }
  if (inMode) await deps.onExitMode?.(r, ctx);
  deps.onSpinEnd?.(r, ctx);
}
```

(Note: `ctxBet` is read once — bet is stable for the round; `context(action)` returns the trigger's identity each call, matching the old "freeze the live turbo getter per segment" behavior since the spread copies `turbo` into a data property.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/runRound.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/host/runRound.ts packages/game-engine/tests/runRound.test.ts
git commit -m "feat(host): runRound emits onSpinStart/onSpinEnd/onEnterMode + per-segment AbortSignal"
```

## Task B8: `PauseController` (visibility → pause/resume)

**Files:**
- Create: `packages/game-engine/src/host/pauseController.ts`
- Test: `packages/game-engine/tests/pauseController.test.ts` (create)

**Interfaces:**
- Produces: `createPauseController(deps): { destroy(): void }` where `deps = { isHidden(): boolean, onHidden(): void, onVisible(): void, subscribe(cb): () => void }`. On hidden it calls `onHidden`; on visible, `onVisible`. The host (B10) supplies the visibility source + the actual effects (ticker stop/start, music pause/resume, autoplay hold, scene.onPause/onResume).

- [ ] **Step 1: Write the failing test** — `packages/game-engine/tests/pauseController.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { createPauseController } from '@/host/pauseController';

describe('PauseController', () => {
  it('calls onHidden/onVisible on visibility changes and unsubscribes on destroy', () => {
    let hidden = false;
    let cb: () => void = () => {};
    const onHidden = vi.fn();
    const onVisible = vi.fn();
    const unsub = vi.fn();
    const ctl = createPauseController({
      isHidden: () => hidden,
      onHidden, onVisible,
      subscribe: (fn) => { cb = fn; return unsub; },
    });
    hidden = true; cb();
    expect(onHidden).toHaveBeenCalledTimes(1);
    hidden = false; cb();
    expect(onVisible).toHaveBeenCalledTimes(1);
    // no double-fire when state doesn't change
    cb();
    expect(onVisible).toHaveBeenCalledTimes(1);
    ctl.destroy();
    expect(unsub).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/pauseController.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pauseController.ts`**

```ts
interface PauseDeps {
  isHidden(): boolean;
  onHidden(): void;
  onVisible(): void;
  /** Register a change listener; return an unsubscribe fn. */
  subscribe(cb: () => void): () => void;
}

/** Edge-triggers onHidden/onVisible from a visibility source. Effects (ticker/music/autoplay/scene)
 *  are supplied by the host so this stays pure + testable. */
export function createPauseController(deps: PauseDeps): { destroy(): void } {
  let paused = deps.isHidden();
  const unsub = deps.subscribe(() => {
    const hidden = deps.isHidden();
    if (hidden === paused) return;
    paused = hidden;
    if (hidden) deps.onHidden();
    else deps.onVisible();
  });
  return { destroy: () => unsub() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/pauseController.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/host/pauseController.ts packages/game-engine/tests/pauseController.test.ts
git commit -m "feat(host): PauseController edge-triggers onHidden/onVisible"
```

## Task B9: `skipGesture` double-tap detector

**Files:**
- Create: `packages/game-engine/src/host/skipGesture.ts`
- Test: `packages/game-engine/tests/skipGesture.test.ts` (create)

**Interfaces:**
- Produces: `createDoubleTapSkip(deps): { tap(now: number): void; destroy(): void }` where `deps = { enabled(): boolean, active(): boolean, thresholdMs?: number, onSkip(): void }`. Two `tap()`s within `thresholdMs` (default 300) fire `onSkip` only when `enabled()` (the `skipGesture` setting) and `active()` (an onSpin is presenting) are both true.

- [ ] **Step 1: Write the failing test** — `packages/game-engine/tests/skipGesture.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { createDoubleTapSkip } from '@/host/skipGesture';

describe('double-tap skip', () => {
  it('fires onSkip on two quick taps when enabled+active', () => {
    const onSkip = vi.fn();
    const d = createDoubleTapSkip({ enabled: () => true, active: () => true, onSkip, thresholdMs: 300 });
    d.tap(1000); d.tap(1200);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
  it('does not fire when taps are too far apart', () => {
    const onSkip = vi.fn();
    const d = createDoubleTapSkip({ enabled: () => true, active: () => true, onSkip });
    d.tap(1000); d.tap(2000);
    expect(onSkip).not.toHaveBeenCalled();
  });
  it('respects enabled() and active() gates', () => {
    const onSkip = vi.fn();
    let on = false, act = true;
    const d = createDoubleTapSkip({ enabled: () => on, active: () => act, onSkip });
    d.tap(1000); d.tap(1100);
    expect(onSkip).not.toHaveBeenCalled(); // disabled
    on = true; act = false;
    d.tap(1200); d.tap(1300);
    expect(onSkip).not.toHaveBeenCalled(); // not presenting
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/skipGesture.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `skipGesture.ts`**

```ts
interface SkipDeps {
  /** The skipGesture setting is on. */
  enabled(): boolean;
  /** An onSpin is currently presenting (skippable window). */
  active(): boolean;
  onSkip(): void;
  /** Max ms between the two taps. Default 300. */
  thresholdMs?: number;
}

/** Pure double-tap recognizer. The host feeds it pointer `tap(now)` (e.g. performance.now()) and
 *  supplies the enabled/active gates + the onSkip effect. */
export function createDoubleTapSkip(deps: SkipDeps): { tap(now: number): void; destroy(): void } {
  const threshold = deps.thresholdMs ?? 300;
  let last = -Infinity;
  return {
    tap(now: number): void {
      const isDouble = now - last <= threshold;
      last = isDouble ? -Infinity : now; // consume the pair so a 3rd tap starts fresh
      if (isDouble && deps.enabled() && deps.active()) deps.onSkip();
    },
    destroy(): void { last = -Infinity; },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/skipGesture.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/host/skipGesture.ts packages/game-engine/tests/skipGesture.test.ts
git commit -m "feat(host): double-tap skip recognizer"
```

## Task B10: Integrate the host — pixi-shell, audio wiring, scene hooks, overlay/pause/skip, `onCreate(api)`

This is the integration task. It is **not** unit-tested (Pixi init hangs headless); the gate is `npm run typecheck` + `npm run build` + the example running (Task B11 ships the example). Work in small commits; run typecheck after each sub-step.

**Files:**
- Modify: `packages/game-engine/src/host/shellConfig.ts` — make `buildShellConfig` shell-agnostic.
- Modify: `packages/game-engine/src/host/createSlotGame.ts` — the wiring.
- Modify: `packages/game-engine/src/host/types.ts` — `SlotGameHandle.shell` type.

**Interfaces:**
- Consumes: `createPixiShell`/`PixiGameShell` + `PixiShellConfig` from `@energy8platform/pixi-shell`; `createSceneAudio` (B3); `createOverlayController` (B4); `createPauseController` (B8); `createDoubleTapSkip` (B9); `runRound` new deps (B7); `SceneApi` (B2); `game.audio` (existing); `shell.safeArea` (B5).
- Produces: `SlotGameHandle.shell: PixiGameShell | null`; the running game wires everything below.

- [ ] **Step 1: Make `buildShellConfig` shell-agnostic**

In `shellConfig.ts`: change the imports from `@energy8platform/platform-core/shell` to `@energy8platform/pixi-shell` (pixi-shell now owns these types: `ShellConfig`→`PixiShellConfig`, `ShellMode`, `CurrencyConfig`, `GameInfoContent`, `GameInfoSection`, `PaytableRow`, `BonusOption`, `ShellFeatures`, `GameMode`, and `socialize`). Confirm each symbol is exported from pixi-shell; for any that is not, keep importing it from platform-core/shell (the two packages share structurally-identical shapes).

Change the return type and the `mount` line. `buildShellConfig` should return everything **except** the mount/app target, typed as `Omit<PixiShellConfig, 'app' | 'parent'>`:

```ts
export function buildShellConfig(
  opts: SlotShellOptions, model: GameModel, runtime: ShellRuntime,
): Omit<PixiShellConfig, 'app' | 'parent'> {
  // ... unchanged body ...
  return {
    // DROP the `mount` line entirely.
    language: runtime.language ?? 'en',
    isSocial,
    currency,
    gameInfo,
    availableBets: [...betLevels],
    defaultBet,
    currentBet: defaultBet,
    balance: runtime.balance,
    win: 0,
    mode: runtime.mode,
    features,
  };
}
```

Remove `mount?` from `SlotShellOptions` (pixi-shell mounts to `app.stage`/`parent`, never a DOM element). Update `ShellRuntime`/other references if `mount` was read elsewhere.

Run: `npm run typecheck --workspace @energy8platform/game-engine` — expect errors ONLY in `createSlotGame.ts` (fixed next). Commit shellConfig alone:

```bash
git add packages/game-engine/src/host/shellConfig.ts
git commit -m "refactor(host): buildShellConfig returns shell-agnostic config (no mount)"
```

- [ ] **Step 2: Swap the shell creation to pixi-shell**

In `createSlotGame.ts`:

- Top import: replace `import type { ShellMode } from '@energy8platform/platform-core/shell';` with `import type { ShellMode } from '@energy8platform/pixi-shell';`.
- `let shell: SlotGameHandle['shell'] = null;` stays (the type is changed in `types.ts`, Step 8).
- Replace L132-134:

```ts
  if (opts.shell) {
    const { createPixiShell } = await import('@energy8platform/pixi-shell');
    const { buildShellConfig } = await import('./shellConfig');
    const { resolveReplayBonusId } = await import('./replay');
```

- Replace L193 (`shell = createGameShell(...)`):

```ts
    shell = createPixiShell({ ...buildShellConfig(opts.shell, opts.model, runtime), app: game.app });
```

(`game.app` is the Pixi `Application` owned by `GameApplication`. Confirm the public accessor name — it is `game.app` per `GameApplication`. The pixi-shell mounts its root onto `app.stage`, above the scene container.)

- `shell.state.turbo` (L202) — confirm `PixiGameShell` exposes `state.turbo`; per the shell's `createInitialState(config)` it does. If the public field differs, read it from the equivalent getter.

Run typecheck (still expect downstream errors for renamed hooks). Commit.

- [ ] **Step 3: Build the overlay layer + SceneApi, inject via `onCreate`**

After `shell = createPixiShell(...)`, create the overlay layer mounted **above** the shell, then assemble `SceneApi`:

```ts
    const { createSceneAudio } = await import('./sceneAudio');
    const { createOverlayController } = await import('./overlayController');

    // Overlay layer sits above the shell (shell mounted its root onto app.stage already; adding ours
    // after keeps it on top). It eats pointer events while open so shell controls are unreachable.
    const overlayLayer = new Container();
    overlayLayer.label = 'overlay';
    game.app.stage.addChild(overlayLayer);
    const overlayCtl = createOverlayController({
      parent: overlayLayer,
      size: () => ({ width: game.app.renderer.width, height: game.app.renderer.height }),
    });

    const sceneApi: SceneApi = {
      audio: createSceneAudio(game.audio),
      overlay: overlayCtl.overlay,
      shell: { get safeArea() { return shell!.safeArea; } },
      formatAmount: (v) => shell!.formatWin(v),
      get bet() { return currentBet; },
      get mode() { return opts.model.modeMap['spin'] ?? 'BASE'; },
      get turbo() { return currentTurbo; },
    };
```

Add imports at the top of the file: `import { Container } from 'pixi.js';` and `import type { SceneApi } from './sceneController';`.

`onCreate` injection — the scene is instantiated by `SceneManager`; call `onCreate` the first time a controller scene becomes current. Extend the `gameScene()` resolver to inject once:

```ts
    const createdScenes = new WeakSet<object>();
    const ensureCreated = (s: SlotSceneController<T>) => {
      if (createdScenes.has(s)) return;
      createdScenes.add(s);
      s.onCreate?.(sceneApi);
    };
```

Update `gameScene()` to duck-type on `onSpin` (not `present`) and call `ensureCreated` before returning:

```ts
    const gameScene = () => {
      const s = game.scenes.current?.scene as Partial<SlotSceneController<T>> | undefined;
      if (typeof s?.onSpin !== 'function') return undefined;
      const scene = s as SlotSceneController<T>;
      ensureCreated(scene);
      return scene;
    };
```

Resize relay for the overlay (so an open overlay tracks viewport): in `game.scenes`/viewport resize path, or simply subscribe to the app's resize via `game.on('resize', ...)` (GameApplication emits `resize`):

```ts
    game.on('resize', ({ width, height }) => overlayCtl.resize(width, height));
```

Commit.

- [ ] **Step 4: Wire `settingChange` → audio (closes idea #3)**

After the shell is created, add:

```ts
    shell.on('settingChange', ({ key, value }: { key: string; value: unknown }) => {
      switch (key) {
        case 'sound': value ? game.audio.unmuteAll() : game.audio.muteAll(); break;
        case 'master': game.audio.setMasterVolume(Number(value)); break;
        case 'music': game.audio.setVolume('music', Number(value)); break;
        case 'sfx': game.audio.setVolume('sfx', Number(value)); break;
        case 'skipGesture': skipEnabled = Boolean(value); break;
      }
    });
```

Declare `let skipEnabled = true;` above (default on). Commit.

- [ ] **Step 5: Wire scene notification hooks (bet/turbo/autoplay)**

The scene should hear shell events. Extend the existing handlers (call the scene's optional hooks):

```ts
    shell.on('turboChange', (level: number) => { currentTurbo = level; gameScene()?.onTurboChanged?.(level); });
    shell.on('betChange', (bet: number) => { currentBet = bet; gameScene()?.onBetChanged?.(bet); });
```

For autoplay, the loop's `onState` already pushes `{ active, remaining }` to the shell — also notify the scene mapping `active`→`running`:

```ts
      onState: (s) => { shell!.setAutoplay(s); gameScene()?.onAutoplayChanged?.({ running: s.active, remaining: s.remaining }); },
```

Commit.

- [ ] **Step 6: Update `playRound` to the new runRound deps + skip wiring**

In `playRound`, replace the `runRound` deps block:
- `scene` is the same object, but runRound now calls `scene.onSpin`.
- Add `onSpinStart: () => scene.onSpinStart?.()`.
- Add `onSpinEnd: (last, ctx) => scene.onSpinEnd?.(last, ctx)`.
- Rename `onBonusEnter`→`onEnterMode` and `onBonusExit`→`onExitMode`; inside them call `scene.onEnterMode?.` / `scene.onExitMode?.` (the shell `setMode('freeSpins')`/`setMode('base')` + free-spins counter logic stays).
- Add `beforeSegment: (ac) => { currentSegmentAbort = ac; }` and a presenting flag for skip:

```ts
    let currentSegmentAbort: AbortController | null = null;
    let presenting = false;
```

Set `presenting = true` at the start of `playRound` (after `setBusy(true)`) and `presenting = false` in the `.finally`. The `context` dep now returns the signal-less context (runRound injects `signal`), so `makeContext` is unchanged except its type: keep returning `{ bet, action, mode, formatAmount, get turbo() }` (no `signal`).

Wire the double-tap skip detector once (outside `playRound`):

```ts
    const { createDoubleTapSkip } = await import('./skipGesture');
    const skip = createDoubleTapSkip({
      enabled: () => skipEnabled,
      active: () => presenting,
      onSkip: () => { currentSegmentAbort?.abort(); gameScene()?.onSkip?.(); },
    });
    // Listen for taps on the game area (the scene container, BELOW the shell bar). The shell bar
    // eats its own pointer events, so taps reaching the scene root are in the play area.
    game.scenes.root.eventMode = 'static';
    game.scenes.root.on('pointertap', () => skip.tap(performance.now()));
```

Confirm the scene root container accessor (`game.scenes.root` or equivalent — the container `SceneManager` adds scenes into). If the manager doesn't expose a public root, add a `pointertap` listener on `game.app.stage` and ignore taps whose `global.y` is within `shell.safeArea.bottom` of the bottom (so a tap on the bar doesn't skip).

Commit.

- [ ] **Step 7: Wire full auto-pause**

After the shell + autoplay are set up:

```ts
    const { createPauseController } = await import('./pauseController');
    createPauseController({
      isHidden: () => typeof document !== 'undefined' && document.hidden,
      subscribe: (cb) => {
        if (typeof document === 'undefined') return () => {};
        document.addEventListener('visibilitychange', cb);
        return () => document.removeEventListener('visibilitychange', cb);
      },
      onHidden: () => {
        game.app.ticker.stop();          // freezes tweens, onUpdate, in-flight onSpin animation
        game.audio.duckMusic(0);         // pause music (duck to 0; restored on resume)
        stopAutoplay();                  // hold autoplay — current round already finished/awaits resume
        gameScene()?.onPause?.();
      },
      onVisible: () => {
        game.app.ticker.start();
        game.audio.unduckMusic();
        gameScene()?.onResume?.();
      },
    });
```

(Confirm `game.app.ticker` is the running ticker — `GameApplication` drives `scenes.update` off `app.ticker`. `duckMusic(0)`/`unduckMusic` is the simplest "pause/restore music" given the AudioManager API; if a true pause is preferred, add `pauseMusic/resumeMusic` to AudioManager in a follow-up. `stopAutoplay` matches the spec's "don't start the next auto-round".)

Commit.

- [ ] **Step 8: Update the handle type + typecheck the package**

In `packages/game-engine/src/host/types.ts`, change the shell field:

```ts
import type { PixiGameShell } from '@energy8platform/pixi-shell';
export interface SlotGameHandle {
  game: GameApplication;
  stakeBridge: StakeBridge | null;
  shell: PixiGameShell | null;
}
```

Run: `npm run typecheck --workspace @energy8platform/game-engine`
Expected: errors now ONLY in `examples/` and the create-slot template (fixed in B11). Resolve any remaining host-internal type errors (e.g. `shell.openModal`/`shell.t`/`shell.openReplay`/`shell.state`/`shell.setMode` — confirm `PixiGameShell` exposes each method used in the file; per B-analysis it exposes `openModal`, `closeModal`, `setMode`, `setBusy`, `setWin`, `setBalance`, `setFreeSpins`, `setAutoplay`, `formatWin`, `openReplay`, `state`, and `t`/`socialize` — if `t` is not a method on PixiGameShell, import `socialize` and translate via it, or add a `t` passthrough to PixiGameShell).

- [ ] **Step 9: Build the package**

Run: `npm run build --workspace @energy8platform/game-engine`
Expected: builds (host bundle inlines dynamic imports). Fix any bundler complaints.

- [ ] **Step 10: Commit the integration**

```bash
git add packages/game-engine/src/host/createSlotGame.ts packages/game-engine/src/host/types.ts
git commit -m "feat(host): pixi-shell composition, audio wiring, scene hooks, overlay/pause/skip"
```

## Task B11: Migrate the example + create-slot template to the new contract

**Files:**
- Modify: `examples/spec-slot/GameScene.ts` (rename `present`→`onSpin`, `onBonusEnter`→`onEnterMode`, `onBonusExit`→`onExitMode`)
- Modify: `examples/spec-slot/main.ts` (no API change to `createSlotGame` call, but verify it still type-checks)
- Modify: `packages/create-slot/src/codegen/gameScene.ts` (template scene to new hook names)
- Test: `npm run typecheck` (root) + `npm test --workspace @energy8platform/create-slot`

**Interfaces:**
- Consumes: the new `SlotSceneController` (B2).
- Produces: a compiling example + template proving the new contract end-to-end.

- [ ] **Step 1: Rewrite the example scene hooks**

In `examples/spec-slot/GameScene.ts`, rename the methods (bodies unchanged):

```ts
  async onSpin(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step, { turbo });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, ctx.bet, ctx.formatAmount);
  }

  async onEnterMode(trigger: SpinData, _ctx: RenderContext): Promise<void> { void trigger; }

  async onExitMode(last: SpinData, ctx: RenderContext): Promise<void> { void last; void ctx; }
```

Update the `implements SlotSceneController<SpinData>` import if its path changed (it stays `@energy8platform/game-engine/host`).

- [ ] **Step 2: Rewrite the template codegen**

In `packages/create-slot/src/codegen/gameScene.ts`, change the generated method names from `present`/`onBonusEnter`/`onBonusExit` to `onSpin`/`onEnterMode`/`onExitMode` (mirror the example). Keep the generated bodies identical otherwise.

- [ ] **Step 3: Typecheck the whole repo**

Run: `npm run typecheck`
Expected: PASS (no remaining references to `present`/`onBonusEnter`/`onBonusExit`).

- [ ] **Step 4: Run the create-slot tests (template codegen)**

Run: `npm test --workspace @energy8platform/create-slot`
Expected: PASS. If a codegen snapshot pins the scene file, update it to the new method names.

- [ ] **Step 5: Full test + build gate**

Run: `npm test`
Run: `npm run build`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add examples/spec-slot/GameScene.ts examples/spec-slot/main.ts packages/create-slot/src/codegen/gameScene.ts
git commit -m "refactor: migrate example + scaffold template to onSpin/onEnterMode contract"
```

- [ ] **Step 7: Manual verification (Pixi runtime)**

Per the memory note ([pixi-headless-init-hang]), use puppeteer's Chromium (not system headless) to load the example with `vite --force`. Verify: shell renders transparent over the scene; a spin runs `onSpinStart`→`onSpin`→`onSpinEnd`; the Settings sound toggle/sliders actually change audio; the `skipGesture` toggle gates double-tap skip; an overlay (`api.overlay.show`) draws above the bar and blocks its buttons; backgrounding the tab freezes animation and pauses music. Record the result.

---

## Self-Review

**Spec coverage:**
- Spec A item 1 (target dir) → A1. Item 2 (peer-deps) → A2. ✓
- Spec B #3 (audio dead UI) → B1 (master gain), B3 (facade), B10 Step 4 (settingChange wiring). ✓
- Spec B #4 (pixi-shell in host) → B5/B6 (shell getters/toggle), B10 Steps 1-2 (swap + config). ✓
- Spec B #5 lifecycle → B2 (contract), B7 (runRound hooks), B10 Steps 3/5/6/7 (onCreate, bet/turbo/autoplay, skip, pause). ✓
- SceneApi audio/overlay/shell-bounds → B3/B4/B5 + B10 Step 3. ✓
- Overlay above scene+shell, single-tap, autoclose, dim, reject-concurrent → B4. ✓
- Safe-area model (full canvas + api.shell.safeArea) → B5 + B10 Step 3. ✓
- Skip double-tap + setting gate → B6, B9, B10 Step 6. ✓
- Pause full auto-pause → B8, B10 Step 7. ✓
- Clean rename, no back-compat, example+template migrated → B2, B7, B11. ✓

**Open integration risks (flagged inline, resolved during execution):**
- pixi-shell vs platform-core type reconciliation in `buildShellConfig` (B10 Step 1) — structurally identical shapes; fall back to platform-core imports per-symbol if a type isn't re-exported.
- `PixiGameShell` method parity (`t`, `state.turbo`, `openReplay`) — verified present in analysis; B10 Step 8 confirms and adds a passthrough if any is missing.
- Scene-root tap source for skip (B10 Step 6) — `game.scenes.root` vs a stage listener with a bottom-bar y-guard.
- Music pause via `duckMusic(0)` vs a dedicated `pauseMusic` (B10 Step 7) — start with duck; add a real pause in a follow-up if needed.
