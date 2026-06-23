# Slot Scaffold Extensibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** make a NEW slot stand up end-to-end with no hand-rolled plumbing — a game-declared mandatory normalizer the host invokes, plus headless `FreeSpinsSession`/`MultiplierAccumulator` primitives, additive game-spec hatches, and a CLI that scaffolds it all.

**Architecture:** thin typed core + open hatches (design B / contract A3). `platform-core` ships the renderer-agnostic result contract (`SlotSpinResultBase`, `SlotResultNormalizer<T>`, coercion helpers). The game-engine host wraps `platformSession.play()` in a normalized `play()` and injects it into the scene via `bindHost`. Slot primitives (`FreeSpinsSession`, `MultiplierAccumulator`) are headless and unit-tested. The CLI generates a scene + a `normalize.ts` stub that consume them.

**Tech Stack:** TypeScript, Vitest 2.x (node), Rollup multi-entry, the four `@energy8platform/*` packages.

## Global Constraints

- `platform-core` stays renderer-free: **no** pixi / game-engine import. `SlotSpinResultBase` must NOT reference `CascadeStepData` (that type lives in game-engine/slot). The richer per-game `SpinData` (with `steps`/`targetGrid`/`multiplier`) is defined in the game, extending `SlotSpinResultBase`.
- `normalize` is a **REQUIRED** option on `createSlotGame` — every game declares one. The host calls it inside a `play()` wrapper (contract option 2): `play → normalize → shell?.setWin(totalWin) → return T`. The scene calls the host's `play`, never `platformSession.play()` directly, via a `bindHost(api)` hook.
- `SlotSpinResultBase = { totalWin: number; freeSpins?: { awarded?: number; total?: number; remaining?: number } }`. `totalWin` is the **currency** win amount as `PlatformSession.play()` reports it (the engine already applied the bet to the Lua bet-multiplier).
- All `game-spec` additions are additive/optional (backward compatible): `SymbolSpec.value?`, `SymbolSpec.meta?`, `GameSpec.mechanic?`, `GameSpec.meta?`.
- Primitives are headless (no Pixi) and unit-tested. `createSlotGame` itself is not unit-tested (Pixi) — its new wiring is verified by typecheck + the extracted, tested `createSlotPlay` helper.
- Tests are renderer-free (Vitest node). Commit after each task. Branch: `feat/game-spec-define-game` (continuing). Commit messages end with the branch's `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- Out of scope (do NOT build): presentation event-stream, migrating existing games, math-CLI/Go-sim, asset-convention plugin, layout-manager, hold&spin/stage primitives, the `anywhere` mechanic.

## File Structure

```
packages/platform-core/src/slot-result/{types.ts, coerce.ts, index.ts}   ← NEW sub-path
packages/platform-core/tests/slot-result.test.ts
packages/game-engine/src/host/{slotPlay.ts(NEW), sceneController.ts, types.ts, createSlotGame.ts, index.ts}
packages/game-engine/tests/host/slotPlay.test.ts
packages/game-engine/src/slot/freeSpins/FreeSpinsSession.ts (NEW)
packages/game-engine/src/slot/multiplier/MultiplierAccumulator.ts (NEW)
packages/game-engine/src/slot/index.ts (export the two)
packages/game-engine/tests/slot/{freeSpinsSession.test.ts, multiplierAccumulator.test.ts}
packages/platform-core/src/game-spec/{types.ts, derive.ts}
packages/platform-core/tests/game-spec-hatches.test.ts
packages/create-slot/src/{answers.ts, generate.ts}
packages/create-slot/src/codegen/{gameScene.ts, normalize.ts(NEW), mainTs.ts}
packages/create-slot/test/{answers.test.ts, gameScene.test.ts, normalize.test.ts(NEW), generate.test.ts}
examples/spec-slot/{GameScene.ts, main.ts, normalize.ts(NEW)}
```

---

## Task 1: `platform-core/slot-result` — result contract + coercion helpers

**Files:**
- Create: `packages/platform-core/src/slot-result/types.ts`, `packages/platform-core/src/slot-result/coerce.ts`, `packages/platform-core/src/slot-result/index.ts`
- Modify: `packages/platform-core/package.json` (exports), `packages/platform-core/rollup.config.*` (entry) — mirror the existing `./game-spec` sub-path
- Test: `packages/platform-core/tests/slot-result.test.ts`

**Interfaces:**
- Produces: `SlotSpinResultBase`, `SlotResultNormalizer<T extends SlotSpinResultBase>`, `asArray<T>(v): T[]`, `coerceLuaArrays<T>(obj, fields): T`. Sub-path `@energy8platform/platform-core/slot-result`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-core/tests/slot-result.test.ts
import { describe, it, expect } from 'vitest';
import { asArray, coerceLuaArrays } from '../src/slot-result';

describe('asArray', () => {
  it('passes arrays through and turns the Lua empty-table {} into []', () => {
    expect(asArray([1, 2])).toEqual([1, 2]);
    expect(asArray({})).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });
});

describe('coerceLuaArrays', () => {
  it('coerces the named fields to arrays, leaving others intact', () => {
    const raw = { cascades: {}, jars: [{ x: 1 }], total_win: 5 };
    expect(coerceLuaArrays(raw, ['cascades', 'jars'])).toEqual({ cascades: [], jars: [{ x: 1 }], total_win: 5 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/slot-result.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// packages/platform-core/src/slot-result/types.ts
/** Minimal, renderer-agnostic base every normalized slot result satisfies. */
export interface SlotSpinResultBase {
  /** Currency win amount for this play (PlatformSession.play() already applied the bet). */
  totalWin: number;
  freeSpins?: { awarded?: number; total?: number; remaining?: number };
}

/** A game declares one of these; the host invokes it on every play. Generic over the game's result type. */
export type SlotResultNormalizer<T extends SlotSpinResultBase> = (raw: unknown) => T;
```

```ts
// packages/platform-core/src/slot-result/coerce.ts
/** Lua empty tables decode as {} — turn a possibly-{} value into a real array. */
export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Apply asArray() to the named fields of a record (Lua {} → []). Optional helper for a game's normalizer. */
export function coerceLuaArrays<T extends Record<string, unknown>>(obj: T, fields: string[]): T {
  const out: Record<string, unknown> = { ...obj };
  for (const f of fields) out[f] = asArray(out[f]);
  return out as T;
}
```

```ts
// packages/platform-core/src/slot-result/index.ts
export type { SlotSpinResultBase, SlotResultNormalizer } from './types';
export { asArray, coerceLuaArrays } from './coerce';
```

- [ ] **Step 4: Wire the sub-path export**

In `packages/platform-core/package.json`, mirror the existing `"./game-spec"` entry to add `"./slot-result"` (same `import`/`require`/`types` shape pointing at `dist/slot-result.*`). Add `src/slot-result/index.ts` to the rollup input list the same way `game-spec` is wired. (Read those files; copy the pattern exactly.)

- [ ] **Step 5: Run test + build**

Run: `npx vitest run packages/platform-core/tests/slot-result.test.ts`
Expected: PASS.
Run: `npm run build --workspace @energy8platform/platform-core`
Expected: clean; `dist/slot-result.js`, `dist/slot-result.cjs`, `dist/slot-result.d.ts` emitted (confirm with `ls packages/platform-core/dist/slot-result.*`).

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/slot-result packages/platform-core/tests/slot-result.test.ts \
        packages/platform-core/package.json packages/platform-core/rollup.config.*
git commit -m "feat(platform-core): slot-result contract (SlotResultNormalizer) + Lua array coercion"
```

---

## Task 2: host — normalized `play()` wrapper + `bindHost`

**Files:**
- Create: `packages/game-engine/src/host/slotPlay.ts`
- Modify: `packages/game-engine/src/host/sceneController.ts`, `packages/game-engine/src/host/types.ts`, `packages/game-engine/src/host/createSlotGame.ts`, `packages/game-engine/src/host/index.ts`
- Test: `packages/game-engine/tests/host/slotPlay.test.ts`

**Interfaces:**
- Consumes: `SlotSpinResultBase`, `SlotResultNormalizer` (Task 1).
- Produces: `createSlotPlay<T>(deps)`; `SlotHostApi<T>`; `SlotSceneController<T>` gains `bindHost?`; `CreateSlotGameOptions<T>` gains required `normalize`; `createSlotGame<T>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine/tests/host/slotPlay.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createSlotPlay } from '../../src/host/slotPlay';

describe('createSlotPlay', () => {
  it('plays, normalizes, fires onWin with totalWin, returns the normalized result', async () => {
    const play = vi.fn().mockResolvedValue({ raw: 7 });
    const normalize = vi.fn().mockReturnValue({ totalWin: 12 });
    const onWin = vi.fn();
    const slotPlay = createSlotPlay({ play, normalize, onWin });
    const out = await slotPlay('spin', 1);
    expect(play).toHaveBeenCalledWith({ action: 'spin', bet: 1 });
    expect(normalize).toHaveBeenCalledWith({ raw: 7 });
    expect(onWin).toHaveBeenCalledWith(12);
    expect(out).toEqual({ totalWin: 12 });
  });

  it('works without onWin', async () => {
    const slotPlay = createSlotPlay({ play: async () => ({}), normalize: () => ({ totalWin: 0 }) });
    expect(await slotPlay('spin', 1)).toEqual({ totalWin: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/host/slotPlay.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `slotPlay.ts`**

```ts
// packages/game-engine/src/host/slotPlay.ts
import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';

export interface SlotPlayDeps<T extends SlotSpinResultBase> {
  play(params: { action: string; bet: number }): Promise<unknown>;
  normalize: SlotResultNormalizer<T>;
  onWin?: (totalWin: number) => void;
}

/** play → normalize → onWin(totalWin) → return T. Host-agnostic wiring; unit-testable. */
export function createSlotPlay<T extends SlotSpinResultBase>(
  deps: SlotPlayDeps<T>,
): (action: string, bet: number) => Promise<T> {
  return async (action, bet) => {
    const raw = await deps.play({ action, bet });
    const result = deps.normalize(raw);
    deps.onWin?.(result.totalWin);
    return result;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/game-engine/tests/host/slotPlay.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `SlotHostApi` + `bindHost` to `sceneController.ts`**

```ts
// packages/game-engine/src/host/sceneController.ts
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

/** Host-provided, normalized play() injected into the scene via bindHost. */
export interface SlotHostApi<T extends SlotSpinResultBase = SlotSpinResultBase> {
  play(action: string, bet: number): Promise<T>;
}

/** Thin contract a slot scene implements; the host calls it on shell events. Duck-typed. */
export interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  spin(bet: number): Promise<void>;
  setBet(bet: number): void;
  buyBonus?(actionId: string, bet: number): Promise<void>;
  /** Host injects its normalized play() once, on mount. */
  bindHost?(api: SlotHostApi<T>): void;
}
```

- [ ] **Step 6: Add required `normalize` to `types.ts`**

In `packages/game-engine/src/host/types.ts`: add the import and make `CreateSlotGameOptions` generic with a required `normalize`:
```ts
import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';
```
Change `export interface CreateSlotGameOptions {` → `export interface CreateSlotGameOptions<T extends SlotSpinResultBase = SlotSpinResultBase> {` and add, after `model: GameModel;`:
```ts
  /** REQUIRED: maps the raw play result into the game's typed result. The host calls it on every play. */
  normalize: SlotResultNormalizer<T>;
```

- [ ] **Step 7: Wire the host (`createSlotGame.ts`)**

Make the function generic and inject the normalized play into the scene (works with or without the shell). Replace the body from `let shell …` to `return …` with:

```ts
  // Resolve the scene controller (duck-typed) up front; it gets a normalized play() regardless of shell.
  const sceneInst = game.scenes.current?.scene as
    | Partial<import('./sceneController').SlotSceneController<T>>
    | undefined;
  let currentBet = opts.model.spec.defaultBet ?? opts.model.spec.betLevels[0];

  let shell: SlotGameHandle['shell'] = null;
  if (opts.shell) {
    const { createGameShell } = await import('@energy8platform/platform-core/shell');
    const { buildShellConfig } = await import('./shellConfig');
    const { resolveReplayBonusId } = await import('./replay');

    const ps = game.platformSession;
    const balance = (game.initData?.balance as number | undefined) ?? 0;
    const isReplay = !!stakeBridge?.isReplay;
    const mode = isReplay ? 'replay' : 'base';
    shell = createGameShell(buildShellConfig(opts.shell, opts.model, balance, mode));
    ps?.on('balanceUpdate', (d: { balance: number }) => shell!.setBalance(d.balance));
    sceneInst?.setBet?.(currentBet);

    if (mode === 'base') {
      shell.on('spin', () => { void sceneInst?.spin?.(currentBet); });
      shell.on('betChange', (bet: number) => { currentBet = bet; sceneInst?.setBet?.(bet); });
      shell.on('buyBonusSelect', ({ id }: { id: string }) => { void sceneInst?.buyBonus?.(id, currentBet); });
    } else {
      const stakeMode = stakeBridge?.replayMode ?? 'BASE';
      const bonusId = resolveReplayBonusId(opts.model, stakeMode);
      shell.openReplay({
        bonusId, bet: currentBet, payoutMultiplier: 0,
        onReplay: () => sceneInst?.spin?.(currentBet),
      });
    }
  } else {
    sceneInst?.setBet?.(currentBet);
  }

  // Always give the scene a normalized play() (host owns play → normalize → shell-win sync).
  const { createSlotPlay } = await import('./slotPlay');
  const slotPlay = createSlotPlay<T>({
    play: (p) => game.platformSession!.play(p),
    normalize: opts.normalize,
    onWin: shell ? (w) => shell!.setWin(w) : undefined,
  });
  sceneInst?.bindHost?.({ play: slotPlay });

  return { game, stakeBridge, shell };
```
Also change the function signature to:
```ts
export async function createSlotGame<T extends SlotSpinResultBase = SlotSpinResultBase>(
  opts: CreateSlotGameOptions<T>,
): Promise<SlotGameHandle> {
```
and add the import `import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';` at the top.

- [ ] **Step 8: Export `SlotHostApi`**

In `packages/game-engine/src/host/index.ts`, ensure the sceneController export includes the new type:
```ts
export type { SlotSceneController, SlotHostApi } from './sceneController';
```

- [ ] **Step 9: Typecheck + host tests**

Run: `npm run build --workspace @energy8platform/platform-core` (so `/slot-result` types resolve)
Run: `npm run typecheck --workspace @energy8platform/game-engine`
Expected: clean.
Run: `npx vitest run packages/game-engine/tests/host/`
Expected: PASS (slotPlay + existing host tests).

- [ ] **Step 10: Commit**

```bash
git add packages/game-engine/src/host packages/game-engine/tests/host/slotPlay.test.ts
git commit -m "feat(game-engine): host play() wrapper invokes the game normalizer + bindHost"
```

---

## Task 3: `FreeSpinsSession` primitive (headless)

**Files:**
- Create: `packages/game-engine/src/slot/freeSpins/FreeSpinsSession.ts`
- Modify: `packages/game-engine/src/slot/index.ts` (export)
- Test: `packages/game-engine/tests/slot/freeSpinsSession.test.ts`

**Interfaces:**
- Consumes: `SlotSpinResultBase` (Task 1).
- Produces: `FreeSpinsSession`, `FreeSpinsSessionConfig`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine/tests/slot/freeSpinsSession.test.ts
import { describe, it, expect } from 'vitest';
import { FreeSpinsSession } from '../../src/slot/freeSpins/FreeSpinsSession';

describe('FreeSpinsSession', () => {
  it('starts with initialSpins and completes after consuming them', () => {
    const s = new FreeSpinsSession({ initialSpins: 3 });
    expect(s.remaining).toBe(3);
    expect(s.total).toBe(3);
    expect(s.isComplete).toBe(false);
    s.consume(); s.consume(); s.consume();
    expect(s.remaining).toBe(0);
    expect(s.isComplete).toBe(true);
  });

  it('award extends remaining and total (retrigger)', () => {
    const s = new FreeSpinsSession({ initialSpins: 2 });
    s.consume();        // 1 left
    s.award(5);
    expect(s.remaining).toBe(6);
    expect(s.total).toBe(7);
  });

  it('accumulates win and honors the isMaxWin exit', () => {
    let capped = false;
    const s = new FreeSpinsSession({ initialSpins: 10, isMaxWin: () => capped });
    s.addWin(2); s.addWin(3);
    expect(s.totalWin).toBe(5);
    expect(s.isComplete).toBe(false);
    capped = true;
    expect(s.isComplete).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/slot/freeSpinsSession.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `FreeSpinsSession.ts`**

```ts
// packages/game-engine/src/slot/freeSpins/FreeSpinsSession.ts
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

export interface FreeSpinsSessionConfig {
  initialSpins: number;
  /** Optional: extra spins to award from a result (retrigger). Default: none. */
  retrigger?: (result: SlotSpinResultBase) => number;
  /** Optional hard exit (e.g. max-win reached). */
  isMaxWin?: () => boolean;
}

/** Headless free-spins state machine. The scene drives it; rendering/HUD reflect it. */
export class FreeSpinsSession {
  remaining: number;
  total: number;
  totalWin = 0;
  private readonly cfg: FreeSpinsSessionConfig;

  constructor(cfg: FreeSpinsSessionConfig) {
    this.cfg = cfg;
    this.remaining = cfg.initialSpins;
    this.total = cfg.initialSpins;
  }

  award(extra: number): void {
    if (extra > 0) { this.remaining += extra; this.total += extra; }
  }

  /** Convenience: award using the configured retrigger rule. */
  applyRetrigger(result: SlotSpinResultBase): void {
    this.award(this.cfg.retrigger?.(result) ?? 0);
  }

  addWin(amount: number): void { this.totalWin += amount; }

  consume(): void { if (this.remaining > 0) this.remaining -= 1; }

  get isComplete(): boolean {
    return this.remaining <= 0 || (this.cfg.isMaxWin?.() ?? false);
  }
}
```

- [ ] **Step 4: Export + run test**

In `packages/game-engine/src/slot/index.ts` append:
```ts
export { FreeSpinsSession } from './freeSpins/FreeSpinsSession';
export type { FreeSpinsSessionConfig } from './freeSpins/FreeSpinsSession';
```
Run: `npx vitest run packages/game-engine/tests/slot/freeSpinsSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/slot/freeSpins packages/game-engine/src/slot/index.ts \
        packages/game-engine/tests/slot/freeSpinsSession.test.ts
git commit -m "feat(game-engine): FreeSpinsSession headless primitive"
```

---

## Task 4: `MultiplierAccumulator` primitive (headless)

**Files:**
- Create: `packages/game-engine/src/slot/multiplier/MultiplierAccumulator.ts`
- Modify: `packages/game-engine/src/slot/index.ts` (export)
- Test: `packages/game-engine/tests/slot/multiplierAccumulator.test.ts`

**Interfaces:**
- Produces: `MultiplierAccumulator`, `CarryPolicy`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/game-engine/tests/slot/multiplierAccumulator.test.ts
import { describe, it, expect } from 'vitest';
import { MultiplierAccumulator } from '../../src/slot/multiplier/MultiplierAccumulator';

describe('MultiplierAccumulator', () => {
  it('add/set adjust value; base defaults to 1', () => {
    const m = new MultiplierAccumulator({ policy: 'cascade' });
    expect(m.value).toBe(1);
    m.add(2); expect(m.value).toBe(3);
    m.set(10); expect(m.value).toBe(10);
  });

  it('session policy survives spin/cascade resets, clears on session boundary', () => {
    const m = new MultiplierAccumulator({ policy: 'session', base: 1 });
    m.set(8);
    m.reset('cascade'); expect(m.value).toBe(8);
    m.reset('spin');    expect(m.value).toBe(8);
    m.reset('session'); expect(m.value).toBe(1);
  });

  it('spin policy survives cascade but clears on spin', () => {
    const m = new MultiplierAccumulator({ policy: 'spin' });
    m.set(4);
    m.reset('cascade'); expect(m.value).toBe(4);
    m.reset('spin');    expect(m.value).toBe(1);
  });

  it('cascade policy clears on every boundary', () => {
    const m = new MultiplierAccumulator({ policy: 'cascade' });
    m.set(5); m.reset('cascade'); expect(m.value).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/game-engine/tests/slot/multiplierAccumulator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `MultiplierAccumulator.ts`**

```ts
// packages/game-engine/src/slot/multiplier/MultiplierAccumulator.ts
/** The boundary at which a collected multiplier resets. */
export type CarryPolicy = 'spin' | 'cascade' | 'session';

// How long each policy survives: cascade (shortest) < spin < session (longest).
const RANK: Record<CarryPolicy, number> = { cascade: 0, spin: 1, session: 2 };

/**
 * Headless sticky/collector multiplier — the unified abstraction behind
 * kitsunebi / recipe / orb / stage multipliers. reset(boundary) clears the
 * value only when the boundary is at or above the configured policy scope.
 */
export class MultiplierAccumulator {
  value: number;
  private readonly base: number;
  private readonly policy: CarryPolicy;

  constructor(cfg: { policy: CarryPolicy; base?: number }) {
    this.policy = cfg.policy;
    this.base = cfg.base ?? 1;
    this.value = this.base;
  }

  add(delta: number): void { this.value += delta; }
  set(value: number): void { this.value = value; }

  reset(boundary: CarryPolicy): void {
    if (RANK[boundary] >= RANK[this.policy]) this.value = this.base;
  }
}
```

- [ ] **Step 4: Export + run test**

In `packages/game-engine/src/slot/index.ts` append:
```ts
export { MultiplierAccumulator } from './multiplier/MultiplierAccumulator';
export type { CarryPolicy } from './multiplier/MultiplierAccumulator';
```
Run: `npx vitest run packages/game-engine/tests/slot/multiplierAccumulator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/game-engine/src/slot/multiplier packages/game-engine/src/slot/index.ts \
        packages/game-engine/tests/slot/multiplierAccumulator.test.ts
git commit -m "feat(game-engine): MultiplierAccumulator headless primitive (carry policy)"
```

---

## Task 5: game-spec hatches (`SymbolSpec.value/meta`, `GameSpec.mechanic/meta`) + prelude `VALUES`

**Files:**
- Modify: `packages/platform-core/src/game-spec/types.ts`, `packages/platform-core/src/game-spec/derive.ts`
- Test: `packages/platform-core/tests/game-spec-hatches.test.ts`

**Interfaces:**
- Produces: additive optional fields; `toLuaPrelude` emits a `VALUES` table for symbols carrying `value`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/platform-core/tests/game-spec-hatches.test.ts
import { describe, it, expect } from 'vitest';
import { toLuaPrelude } from '../src/game-spec/derive';
import type { GameSpec } from '../src/game-spec/types';

const spec: GameSpec = {
  id: 'g', type: 'slot', grid: { cols: 6, rows: 6 }, betLevels: [1], maxWin: 1000,
  symbols: [
    { id: 'H1', kind: 'high', pay: { 3: 10 } },
    { id: 'MULT', kind: 'multiplier', value: [2, 3, 5] },
    { id: 'COIN', kind: 'multiplier', value: 100, meta: { holdAndSpin: true } },
  ],
  actions: { spin: { role: 'base' } },
  mechanic: 'cluster',
  meta: { theme: 'space' },
};

describe('game-spec hatches', () => {
  it('surfaces symbol value(s) into a VALUES Lua table', () => {
    const p = toLuaPrelude(spec);
    expect(p).toContain('VALUES = {');
    expect(p).toContain('MULT = {2, 3, 5}');
    expect(p).toContain('COIN = 100');
  });

  it('omits VALUES when no symbol carries a value', () => {
    const p = toLuaPrelude({ ...spec, symbols: [{ id: 'H1', kind: 'high', pay: { 3: 10 } }] });
    expect(p).not.toContain('VALUES');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/platform-core/tests/game-spec-hatches.test.ts`
Expected: FAIL — `value`/`meta`/`mechanic` not on the types (compile error) and no `VALUES` emitted.

- [ ] **Step 3: Add the hatch fields (`types.ts`)**

In `packages/platform-core/src/game-spec/types.ts`, extend the interfaces (additive):
```ts
export interface SymbolSpec {
  id: string;
  name?: string;
  kind: SymbolKind;
  pay?: Record<number, number>;
  /** Multiplier-symbol x-value(s) (e.g. 100, or [2,3,5]). */
  value?: number | number[];
  /** Arbitrary per-symbol config (tier tables, behavior flags). */
  meta?: Record<string, unknown>;
}
```
and on `GameSpec`, after `actions`:
```ts
  /** Open hint for codegen/UI: 'cascade' | 'cluster' | 'ways' | 'lines' | … */
  mechanic?: string;
  /** Game-level escape hatch. */
  meta?: Record<string, unknown>;
```

- [ ] **Step 4: Emit `VALUES` in `toLuaPrelude` (`derive.ts`)**

In `packages/platform-core/src/game-spec/derive.ts`, inside `toLuaPrelude`, after the `PAYTABLE` block and before `return`:
```ts
  const valEntries = spec.symbols
    .filter((s) => s.value !== undefined)
    .map((s) => `  ${s.id} = ${Array.isArray(s.value) ? `{${s.value.join(', ')}}` : s.value}`);
  if (valEntries.length) lines.push(`VALUES = {\n${valEntries.join(',\n')}\n}`);
```

- [ ] **Step 5: Run test + full game-spec suite**

Run: `npx vitest run packages/platform-core/tests/game-spec-hatches.test.ts`
Expected: PASS.
Run: `npx vitest run packages/platform-core/tests/` (no regression in existing game-spec/derive tests)
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/platform-core/src/game-spec/types.ts packages/platform-core/src/game-spec/derive.ts \
        packages/platform-core/tests/game-spec-hatches.test.ts
git commit -m "feat(game-spec): symbol value/meta + game mechanic/meta hatches; prelude VALUES"
```

---

## Task 6: CLI — `cluster` mechanic + `cascades` flag

**Files:**
- Modify: `packages/create-slot/src/answers.ts`
- Test: `packages/create-slot/test/answers.test.ts`

**Interfaces:**
- Produces: `Mechanic` includes `'cluster'`; `Answers.cascades?: boolean`; `parseFlags` handles `--cascades`/`--no-cascades`; `applyDefaults` sets `cascades`.

- [ ] **Step 1: Write the failing test (append to `answers.test.ts`)**

```ts
// append to packages/create-slot/test/answers.test.ts
import { describe, it, expect } from 'vitest';
import { parseFlags, applyDefaults, validate } from '../src/answers';

describe('cluster mechanic + cascades flag', () => {
  it('cluster defaults to a 7x7 grid', () => {
    expect(applyDefaults({ id: 'g', mechanic: 'cluster' }).grid).toEqual({ cols: 7, rows: 7 });
  });
  it('cascades defaults true for cascade/cluster, false for ways/lines', () => {
    expect(applyDefaults({ id: 'g', mechanic: 'cascade' }).cascades).toBe(true);
    expect(applyDefaults({ id: 'g', mechanic: 'cluster' }).cascades).toBe(true);
    expect(applyDefaults({ id: 'g', mechanic: 'ways' }).cascades).toBe(false);
  });
  it('--cascades / --no-cascades override', () => {
    expect(parseFlags(['--no-cascades']).cascades).toBe(false);
    expect(parseFlags(['--cascades']).cascades).toBe(true);
  });
  it('validate accepts cluster', () => {
    expect(() => validate(applyDefaults({ id: 'g', mechanic: 'cluster' }))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/create-slot/test/answers.test.ts`
Expected: FAIL — `cluster` not a valid mechanic / `cascades` undefined.

- [ ] **Step 3: Update `answers.ts`**

- `export type Mechanic = 'cascade' | 'cluster' | 'lines' | 'ways';`
- Add `cascades?: boolean;` to `Answers`.
- `DEFAULT_GRID` add `cluster: { cols: 7, rows: 7 },`.
- In `parseFlags`, add to the loop (before the `--stake` cases):
```ts
    else if (a === '--cascades') out.cascades = true;
    else if (a === '--no-cascades') out.cascades = false;
```
- In `applyDefaults`, return object add:
```ts
    cascades: partial.cascades ?? (mechanic === 'cascade' || mechanic === 'cluster'),
```
- In `validate`, change the mechanic check list to `['cascade', 'cluster', 'lines', 'ways']`.

- [ ] **Step 4: Run test + full answers suite**

Run: `npx vitest run packages/create-slot/test/answers.test.ts`
Expected: PASS (new + existing cases).

- [ ] **Step 5: Commit**

```bash
git add packages/create-slot/src/answers.ts packages/create-slot/test/answers.test.ts
git commit -m "feat(create-slot): cluster mechanic (7x7) + cascades flag"
```

---

## Task 7: CLI codegen — normalizer-driven scene + `normalize.ts` stub

**Files:**
- Modify: `packages/create-slot/src/codegen/gameScene.ts`, `packages/create-slot/src/codegen/mainTs.ts`, `packages/create-slot/src/generate.ts`
- Create: `packages/create-slot/src/codegen/normalize.ts`
- Test: `packages/create-slot/test/gameScene.test.ts` (update), `packages/create-slot/test/normalize.test.ts` (new), `packages/create-slot/test/generate.test.ts` (update)

**Interfaces:**
- Consumes: Task 1 (`SlotResultNormalizer`), Task 2 (`SlotHostApi`/`bindHost`/`normalize` option), Task 3 (`FreeSpinsSession`), Task 4 (`MultiplierAccumulator`), Task 6 (`Mechanic`/`cascades`), existing `CascadeController`/`ReelSpinController`/`CascadeStepData`/`CellData`.
- Produces: `genNormalize(answers): string`; rewritten `genGameScene`; `genMainTs` passes `normalize`; `generate()` writes `src/game/normalize.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/create-slot/test/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { genNormalize } from '../src/codegen/normalize';

const base = { id: 'g', title: 'G', grid: { cols: 6, rows: 6 }, stake: true } as const;

describe('genNormalize', () => {
  it('cascade: declares SpinData with steps + a normalize that maps cascades', () => {
    const s = genNormalize({ ...base, mechanic: 'cluster', cascades: true });
    expect(s).toContain('export interface SpinData extends SlotSpinResultBase');
    expect(s).toContain('steps: CascadeStepData[]');
    expect(s).toContain('export const normalize: SlotResultNormalizer<SpinData>');
    expect(s).toContain('winningCells');
  });
  it('ways: maps a targetGrid instead of steps', () => {
    const s = genNormalize({ ...base, mechanic: 'ways', cascades: false });
    expect(s).toContain('targetGrid');
    expect(s).not.toContain('steps: CascadeStepData[]');
  });
});
```

```ts
// update packages/create-slot/test/gameScene.test.ts — replace the body with:
import { describe, it, expect } from 'vitest';
import { genGameScene } from '../src/codegen/gameScene';

describe('genGameScene', () => {
  it('cascade/cluster uses CascadeController + the normalizer-driven host play + primitives', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(s).toContain('implements SlotSceneController<SpinData>');
    expect(s).toContain('bindHost(');
    expect(s).toContain("this.host.play('spin', bet)");
    expect(s).toContain('FreeSpinsSession');
    expect(s).toContain('MultiplierAccumulator');
    expect(s).toContain('CascadeController');
    expect(s).not.toContain('platformSession');         // no direct SDK access
    expect(s).not.toContain('result.data.cascades');    // consumes the normalizer, not raw
  });
  it('ways/lines uses ReelSpinController', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'ways', grid: { cols: 5, rows: 3 }, stake: true, cascades: false });
    expect(s).toContain('ReelSpinController');
    expect(s).not.toContain('CascadeController');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/create-slot/test/normalize.test.ts packages/create-slot/test/gameScene.test.ts`
Expected: FAIL — `genNormalize` missing; new gameScene assertions unmet.

- [ ] **Step 3: Write `genNormalize` (`codegen/normalize.ts`)**

```ts
// packages/create-slot/src/codegen/normalize.ts
import type { Answers } from '../answers';

/** Generate src/game/normalize.ts: the game-declared SpinData + the mandatory normalizer the host calls. */
export function genNormalize(a: Answers): string {
  const cascade = a.mechanic === 'cascade' || a.mechanic === 'cluster' || a.cascades === true;

  const dataShape = cascade
    ? `  /** Cascade steps the scene animates via CascadeController. */
  steps: CascadeStepData[];
  /** Optional running multiplier the scene reflects. */
  multiplier?: number;`
    : `  /** Result grid by column for the reel spin. */
  targetGrid: CellData[][];`;

  const mapBody = cascade
    ? `    steps: (d.cascades ?? []).map((s: any) => ({
      winningCells: s.winning ?? [],
      removedCells: s.removed ?? [],
      newCells: s.new ?? [],
      settledGrid: s.grid ?? [],
    })),
    multiplier: d.multiplier,`
    : `    targetGrid: d.matrix ?? [],`;

  return `import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';
import type { ${cascade ? 'CascadeStepData' : 'CellData'} } from '@energy8platform/game-engine/slot';

/** The game's typed play result. Extend with any fields your script.logic.lua returns. */
export interface SpinData extends SlotSpinResultBase {
${dataShape}
}

/**
 * REQUIRED: map the raw play result into SpinData. The host calls this on every play.
 * The field names on the right (cascades/winning/removed/new/grid/${cascade ? 'multiplier' : 'matrix'}/free_spins)
 * are what your script.logic.lua must produce — edit both sides to match your math.
 */
export const normalize: SlotResultNormalizer<SpinData> = (raw) => {
  const r = (raw ?? {}) as { totalWin?: number; data?: any };
  const d = r.data ?? {};
  return {
    totalWin: r.totalWin ?? 0,
    freeSpins: d.free_spins
      ? { awarded: d.free_spins.awarded, total: d.free_spins.total }
      : undefined,
${mapBody}
  };
};
`;
}
```

- [ ] **Step 4: Rewrite `genGameScene` (`codegen/gameScene.ts`)**

```ts
// packages/create-slot/src/codegen/gameScene.ts
import type { Answers } from '../answers';

export function genGameScene(a: Answers): string {
  const cascade = a.mechanic === 'cascade' || a.mechanic === 'cluster' || a.cascades === true;
  const ctrl = cascade ? 'CascadeController' : 'ReelSpinController';

  const present = cascade
    ? `  /** Animate one normalized result. Tune MultiplierAccumulator policy/reset() to your mechanic. */
  private async present(result: SpinData, bet: number): Promise<void> {
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step);
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
  }`
    : `  private async present(result: SpinData, bet: number): Promise<void> {
    await this.controller.run({ targetGrid: result.targetGrid });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
  }`;

  return `import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, ${ctrl}, BigWinOverlay, FreeSpinsSession, MultiplierAccumulator } from '@energy8platform/game-engine/slot';
import type { SlotSceneController, SlotHostApi } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';
import type { SpinData } from './game/normalize';

export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: ${ctrl};
  private overlay!: BigWinOverlay;
  private readonly multiplier = new MultiplierAccumulator({ policy: 'session' });
  private host?: SlotHostApi<SpinData>;
  private bet = model.spec.defaultBet ?? model.spec.betLevels[0];

  bindHost(api: SlotHostApi<SpinData>): void { this.host = api; }
  setBet(bet: number): void { this.bet = bet; }

  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    this.grid = new ReelGrid({ cols, rows, cellSize: 110, gap: 6, resolve: resolveSymbol });
    this.container.addChild(this.grid);
    this.controller = new ${ctrl}(this.grid);
    this.overlay = new BigWinOverlay({
      tiers: [
        { id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a },
        { id: 'mega', minMultiplier: 50, title: 'MEGA WIN', accentColor: 0x7ad7ff },
      ],
      formatMoney: (v) => v.toFixed(2),
      width: 1920, height: 1080,
    });
    this.container.addChild(this.overlay);
  }

  async spin(bet: number): Promise<void> {
    if (!this.host) return;
    const result = await this.host.play('spin', bet);
    await this.present(result, bet);
    if ((result.freeSpins?.awarded ?? 0) > 0) await this.runFreeSpins(result, bet);
  }

  /** Drive the free-spins session: replay 'free_spin' until it completes. */
  private async runFreeSpins(trigger: SpinData, bet: number): Promise<void> {
    const fs = new FreeSpinsSession({ initialSpins: trigger.freeSpins?.total ?? trigger.freeSpins?.awarded ?? 0 });
    while (!fs.isComplete) {
      const r = await this.host!.play('free_spin', bet);
      await this.present(r, bet);
      fs.addWin(r.totalWin);
      fs.award(r.freeSpins?.awarded ?? 0); // retrigger
      fs.consume();
    }
  }

${present}
}
`;
}
```

- [ ] **Step 5: Pass `normalize` from `genMainTs` (`codegen/mainTs.ts`)**

In `packages/create-slot/src/codegen/mainTs.ts`: add the import line near the other generated imports:
```ts
import { normalize } from './game/normalize';
```
and inside the generated `createSlotGame({ … })` options object, add `normalize,` (right after `model,`). (Edit the emitted template string accordingly.)

- [ ] **Step 6: Write `src/game/normalize.ts` in `generate()`**

In `packages/create-slot/src/generate.ts`: import `genNormalize` and, alongside the existing `writeFileSync(join(targetDir, 'src/game/script.logic.lua'), …)` line (the `src/game` dir is already created there), add:
```ts
writeFileSync(join(targetDir, 'src/game/normalize.ts'), genNormalize(a));
```
Add `import { genNormalize } from './codegen/normalize';` to the imports.

- [ ] **Step 7: Update `generate.test.ts`**

In `packages/create-slot/test/generate.test.ts`, in the cascade case, add:
```ts
    expect(existsSync(join(dir, 'src/game/normalize.ts'))).toBe(true);
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toContain('normalize');
```

- [ ] **Step 8: Run create-slot tests (incl. anti-drift smoke)**

Run: `npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/stake-bridge && npm run build --workspace @energy8platform/stake-kit && npm run build --workspace @energy8platform/game-engine`
(So the smoke's generated game typechecks against the new `/slot-result`, `FreeSpinsSession`, `MultiplierAccumulator`, and the `normalize`-required host.)
Run: `npx vitest run packages/create-slot/test/`
Expected: PASS — answers, gameSpec, packageJson, gameScene, luaLogic, stakeAdapter, generate, normalize, **scaffold** (the anti-drift smoke now typechecks the normalizer-driven scene + primitives against the real packages — the load-bearing proof).
If the smoke surfaces a REAL type mismatch between the generated code and a package, fix the codegen (not the test). The `cluster` smoke path exercises `CascadeController` + `FreeSpinsSession` + `MultiplierAccumulator` + the `normalize` host option.

- [ ] **Step 9: Commit**

```bash
git add packages/create-slot/src/codegen/gameScene.ts packages/create-slot/src/codegen/normalize.ts \
        packages/create-slot/src/codegen/mainTs.ts packages/create-slot/src/generate.ts \
        packages/create-slot/test/gameScene.test.ts packages/create-slot/test/normalize.test.ts \
        packages/create-slot/test/generate.test.ts
git commit -m "feat(create-slot): normalizer-driven scene codegen + normalize.ts stub + primitives"
```

---

## Task 8: living proof — `spec-slot` adopts the new flow

**Files:**
- Create: `examples/spec-slot/normalize.ts`
- Modify: `examples/spec-slot/GameScene.ts`, `examples/spec-slot/main.ts`

**Interfaces:**
- Consumes: everything above — proves the hand-written path end-to-end.

- [ ] **Step 1: Write `examples/spec-slot/normalize.ts`**

```ts
// examples/spec-slot/normalize.ts
import type { SlotSpinResultBase, SlotResultNormalizer } from '@energy8platform/platform-core/slot-result';
import type { CascadeStepData } from '@energy8platform/game-engine/slot';

export interface SpinData extends SlotSpinResultBase {
  steps: CascadeStepData[];
  multiplier?: number;
}

export const normalize: SlotResultNormalizer<SpinData> = (raw) => {
  const r = (raw ?? {}) as { totalWin?: number; data?: any };
  const d = r.data ?? {};
  return {
    totalWin: r.totalWin ?? 0,
    freeSpins: d.free_spins ? { awarded: d.free_spins.awarded, total: d.free_spins.total } : undefined,
    steps: (d.cascades ?? []).map((s: any) => ({
      winningCells: s.winning ?? [],
      removedCells: s.removed ?? [],
      newCells: s.new ?? [],
      settledGrid: s.grid ?? [],
    })),
    multiplier: d.multiplier,
  };
};
```

- [ ] **Step 2: Update `examples/spec-slot/GameScene.ts`**

```ts
// examples/spec-slot/GameScene.ts
import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, CascadeController, BigWinOverlay, FreeSpinsSession, MultiplierAccumulator } from '@energy8platform/game-engine/slot';
import type { SlotSceneController, SlotHostApi } from '@energy8platform/game-engine/host';
import { model } from './game.spec';
import { resolveSymbol } from './slot/symbols';
import type { SpinData } from './normalize';

export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: CascadeController;
  private overlay!: BigWinOverlay;
  private readonly multiplier = new MultiplierAccumulator({ policy: 'session' });
  private host?: SlotHostApi<SpinData>;
  private bet = model.spec.defaultBet ?? model.spec.betLevels[0];

  bindHost(api: SlotHostApi<SpinData>): void { this.host = api; }
  setBet(bet: number): void { this.bet = bet; }

  async onEnter(): Promise<void> {
    const { cols, rows } = model.spec.grid;
    this.grid = new ReelGrid({ cols, rows, cellSize: 96, gap: 6, resolve: resolveSymbol });
    this.container.addChild(this.grid);
    this.controller = new CascadeController(this.grid);
    this.overlay = new BigWinOverlay({
      tiers: [{ id: 'big', minMultiplier: 10, title: 'BIG WIN', accentColor: 0xffd24a }],
      formatMoney: (v) => `€${v.toFixed(2)}`,
      width: 1920, height: 1080,
    });
    this.container.addChild(this.overlay);
  }

  async spin(bet: number): Promise<void> {
    if (!this.host) return;
    const result = await this.host.play('spin', bet);
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step);
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, bet);
    if ((result.freeSpins?.awarded ?? 0) > 0) {
      const fs = new FreeSpinsSession({ initialSpins: result.freeSpins?.total ?? result.freeSpins?.awarded ?? 0 });
      while (!fs.isComplete) {
        const r = await this.host.play('free_spin', bet);
        for (const step of r.steps) await this.controller.run(step);
        if (r.totalWin > 0) await this.overlay.show(r.totalWin, bet);
        fs.addWin(r.totalWin); fs.award(r.freeSpins?.awarded ?? 0); fs.consume();
      }
    }
  }
}
```

- [ ] **Step 3: Update `examples/spec-slot/main.ts` to pass `normalize`**

In `examples/spec-slot/main.ts`, add `import { normalize } from './normalize';` and add `normalize,` to the `createSlotGame({ … })` options (right after `model,`). Leave the rest unchanged.

- [ ] **Step 4: Build deps + typecheck the example + smoke**

Run: `npm run build --workspace @energy8platform/platform-core && npm run build --workspace @energy8platform/game-engine`
Run: `cd examples/spec-slot && npx tsc --noEmit && cd ../..`
Expected: clean — proves the hand-written normalizer + `bindHost` + primitives compose against the real types.
Run: `npm run smoke --workspace spec-slot-example`
Expected: `SMOKE PASS`.

- [ ] **Step 5: Commit**

```bash
git add examples/spec-slot/normalize.ts examples/spec-slot/GameScene.ts examples/spec-slot/main.ts
git commit -m "docs(examples): spec-slot adopts the declared normalizer + FreeSpinsSession/MultiplierAccumulator"
```

---

## Self-Review

**Spec coverage:** Piece 1 → Tasks 1 (contract/coercion) + 2 (host invocation). Piece 2 → Task 3. Piece 3 → Task 4. Piece 4 → Task 5. Piece 5 → Tasks 6 (mechanic/flag) + 7 (codegen). Proof → Tasks 7 (smoke) + 8 (spec-slot). ✓ The MultiplierMeter *view* (Pixi) is intentionally deferred — the design called it "optional"; the headless `MultiplierAccumulator` is the reusable substance and the scaffold renders the value via the author's HUD. The `cascades`+ways combo codegen is included via the `cascade` flag in `genNormalize`/`genGameScene`.

**Placeholder scan:** The only `// TODO`/"edit both sides" markers live inside the *generated* `normalize.ts` stub — author fill-in points by design (like the generated Lua/scene TODOs in prior slices), not plan gaps. The platform-core sub-path wiring (Task 1 Step 4) references "mirror `./game-spec`" rather than inlining package.json/rollup content the implementer must read in-place; that is a deliberate mirror instruction, not a vague placeholder.

**Type consistency:** `SlotSpinResultBase` (Task 1) has no `CascadeStepData` (boundary respected); the steps-bearing `SpinData` is game-side (Tasks 7/8). `SlotResultNormalizer<T>` / `SlotHostApi<T>` / `SlotSceneController<T>` / `CreateSlotGameOptions<T>` / `createSlotGame<T>` all carry the same `T extends SlotSpinResultBase` (Tasks 1/2). `createSlotPlay` (Task 2) signature matches its host call site. `CascadeController.run(step)` consumes `CascadeStepData` (existing) which `normalize` produces (Tasks 7/8). `FreeSpinsSession`/`MultiplierAccumulator` names match across definition (Tasks 3/4) and use (Tasks 7/8). `Answers.cascades` (Task 6) is read by `genNormalize`/`genGameScene` (Task 7). `normalize` is required on `CreateSlotGameOptions` (Task 2) and supplied by `genMainTs` (Task 7) + `spec-slot/main.ts` (Task 8). ✓
