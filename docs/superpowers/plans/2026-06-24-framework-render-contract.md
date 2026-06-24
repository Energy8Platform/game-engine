# Framework-owned play loop + single render contract — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the entire `play → present → ack → drain` loop into the host so a generated slot game implements only `present(result, ctx)` + optional `onBonusEnter`/`onBonusExit`, never touching `play`/`ack`/`roundId`.

**Architecture:** A new `RenderContext` (bet/action/mode/formatAmount/live-turbo) plus a slim `SlotSceneController` replace the old fat scene contract and `SlotHostApi`. An extracted, unit-testable `runRound(deps, action)` drives the loop; `createSlotGame` builds the deps (from the existing `createSlotPlay` pipeline + shell) and wires shell events to it. The codegen scene regenerates to the slim contract.

**Tech Stack:** TypeScript, npm workspaces monorepo, Vitest 2, Rollup. Packages touched: `@energy8platform/platform-core` (shell), `@energy8platform/game-engine` (host + slot overlay), `@energy8platform/create-slot` (codegen).

## Global Constraints

- Commit trailer on EVERY commit, verbatim: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- `git add` ONLY the exact files a task changed — NEVER `git add -A` / `git add .`
- Keep OUT of every commit: `examples/demo-slot/` (untracked manual test dir), `.claude/`, `.superpowers/`, `docs/superpowers/` is allowed to be committed.
- Work on the current branch `feat/game-spec-define-game` (not `main`).
- Tests run against package SOURCE (vitest `@/*` → `src/*`). But cross-package type resolution (e.g. `game-engine` importing `@energy8platform/platform-core/shell`) resolves through the dependency's **built dist** `.d.ts`. After changing a platform-core public type/method that game-engine consumes, REBUILD it: `npm run build --workspace @energy8platform/platform-core`. Likewise rebuild game-engine before the create-slot scaffold anti-drift typecheck: `npm run build --workspace @energy8platform/game-engine`.
- `SlotSpinResultBase` (in `packages/platform-core/src/slot-result/types.ts`) already carries `roundId?: string`, `nextActions?: string[]`, `complete?: boolean` (host-internal continuation fields set by `createSlotPlay`). Do NOT remove them; the host loop reads them.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/platform-core/src/shell/GameShell.ts` | Add public `formatWin(value)` so the host can format money currency-aware. |
| `packages/game-engine/src/slot/overlay/CountUpDisplay.ts` | Add `setFormat(fn)` so the count formatter can change per show. |
| `packages/game-engine/src/slot/overlay/BigWinOverlay.ts` | `show(win, bet, format?)` — optional per-show formatter. |
| `packages/game-engine/src/host/sceneController.ts` | New `RenderContext` + slim `SlotSceneController`; DELETE `SlotHostApi`. |
| `packages/game-engine/src/host/runRound.ts` (new) | Extracted, unit-testable host loop `runRound(deps, action)`. |
| `packages/game-engine/src/host/createSlotGame.ts` | Build runRound deps (`makeContext`, `roleOf`, live turbo) + rewire shell handlers + resume-via-present + replay-via-runRound. |
| `packages/create-slot/src/codegen/gameScene.ts` | Regenerate scene to the slim contract (ways + cascade). |

---

### Task 1: BigWinOverlay per-show formatter

Make the win count-up use a currency-aware formatter supplied at `show()` time (the host resolves currency at runtime), instead of the formatter baked in at construction. Backward compatible: the 3rd arg is optional.

**Files:**
- Modify: `packages/game-engine/src/slot/overlay/CountUpDisplay.ts`
- Modify: `packages/game-engine/src/slot/overlay/BigWinOverlay.ts:57` (the `show` method)
- Test: `packages/game-engine/tests/overlay-format.test.ts` (create)

**Interfaces:**
- Produces: `CountUpDisplay.setFormat(format: (v: number) => string): void`
- Produces: `BigWinOverlay.show(win: number, bet: number, format?: (v: number) => string): Promise<void>` — when `format` is passed, the count-up renders with it; tier selection still uses `bet`.

- [ ] **Step 1: Write the failing test**

Create `packages/game-engine/tests/overlay-format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CountUpDisplay } from '@/slot/overlay/CountUpDisplay';

describe('CountUpDisplay.setFormat', () => {
  it('re-renders the current value with the new formatter', () => {
    const d = new CountUpDisplay({ format: (v) => v.toFixed(2) });
    d.setValue(5);
    expect(d.text).toBe('5.00');
    d.setFormat((v) => `€${v.toFixed(1)}`);
    expect(d.text).toBe('€5.0'); // re-rendered immediately with the live value
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run --root packages/game-engine tests/overlay-format.test.ts`
Expected: FAIL — `d.setFormat is not a function`.

- [ ] **Step 3: Add `setFormat` to CountUpDisplay**

In `packages/game-engine/src/slot/overlay/CountUpDisplay.ts`, add this method after `setValue` (after line 37):

```ts
  /** Swap the value formatter and immediately re-render the current value. */
  setFormat(format: (v: number) => string): void {
    this._format = format;
    this._text.text = this._format(this._value);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run --root packages/game-engine tests/overlay-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread an optional formatter through `BigWinOverlay.show`**

In `packages/game-engine/src/slot/overlay/BigWinOverlay.ts`, change the `show` signature (line 57) and apply the formatter before the count-up. Replace:

```ts
  async show(win: number, bet: number): Promise<void> {
    const tier = pickTier(this._cfg.tiers, win, bet);
    if (!tier) return;
    this.visible = true;
```

with:

```ts
  async show(win: number, bet: number, format?: (v: number) => string): Promise<void> {
    const tier = pickTier(this._cfg.tiers, win, bet);
    if (!tier) return;
    if (format) this._count.setFormat(format);
    this.visible = true;
```

- [ ] **Step 6: Run the slot/overlay tests to confirm nothing regressed**

Run: `npx vitest run --root packages/game-engine tests/overlay-format.test.ts && npx tsc --noEmit -p packages/game-engine`
Expected: PASS, and typecheck clean (the new 3rd param is optional, so existing `show(win, bet)` callers still compile).

- [ ] **Step 7: Commit**

```bash
git add packages/game-engine/src/slot/overlay/CountUpDisplay.ts packages/game-engine/src/slot/overlay/BigWinOverlay.ts packages/game-engine/tests/overlay-format.test.ts
git commit -m "$(printf 'feat(overlay): BigWinOverlay.show accepts a per-show money formatter\n\nCountUpDisplay.setFormat lets the win count-up re-render with a currency-aware formatter\nsupplied at show() time (the host resolves currency at runtime). Optional + backward compatible.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: RenderContext + slim contract + extracted host loop

Replace the fat scene contract with `present` + bonus hooks, delete `SlotHostApi`, extract the loop into a unit-testable `runRound`, expose `GameShell.formatWin`, and rewire `createSlotGame` (base + replay + resume) to drive `runRound`. The contract and its sole consumer move together so the package stays green.

**Files:**
- Modify: `packages/platform-core/src/shell/GameShell.ts` (add `formatWin`)
- Modify: `packages/game-engine/src/host/sceneController.ts` (replace contents)
- Create: `packages/game-engine/src/host/runRound.ts`
- Modify: `packages/game-engine/src/host/createSlotGame.ts:100-271` (deps + wiring)
- Test: `packages/game-engine/tests/host/runRound.test.ts` (create)
- Test: `packages/game-engine/tests/host/shellWiring.test.ts` (rewrite)

**Interfaces:**
- Consumes (from `createSlotPlay`, unchanged): `slotPlay.play(action, bet, roundId?) → Promise<T>` (T enriched with `roundId`/`nextActions`/`complete`), `slotPlay.ack(): void`.
- Consumes: `GameShell.state.turbo: number`, shell event `turboChange: number`, `model.spec.modeMap: Record<string,string>`, `model.spec.actions[a].role: 'base'|'buy'|'feature'|'free'`.
- Produces: `RenderContext { bet:number; action:string; mode:string; formatAmount(v:number):string; readonly turbo:number }`.
- Produces: `SlotSceneController<T> { present(result:T, ctx:RenderContext):Promise<void>; onBonusEnter?(trigger:T, ctx):Promise<void>; onBonusExit?(last:T, ctx):Promise<void> }`.
- Produces: `runRound<T>(deps: RunRoundDeps<T>, action: string): Promise<void>` where `RunRoundDeps<T> = { play(action,bet,roundId?):Promise<T>; ack():void; scene: Pick<SlotSceneController<T>,'present'|'onBonusEnter'|'onBonusExit'>; context(action:string):RenderContext; roleOf(action:string):string|undefined }`.
- Produces: `GameShell.formatWin(value: number): string`.

- [ ] **Step 1: Add `formatWin` to GameShell**

In `packages/platform-core/src/shell/GameShell.ts`, add a public method near the other setters (e.g. right after `setTurbo` at line 207). `formatCurrency` is already imported at line 25.

```ts
  /** Currency-aware money formatter for WIN amounts (variable decimals: 0.0041 stays 0.0041, not
   *  0.00). The host hands this to a scene so games format money without knowing the currency. */
  formatWin(value: number): string { return formatCurrency(value, this.config.currency, true); }
```

- [ ] **Step 2: Rebuild platform-core so game-engine sees the new method**

Run: `npm run build --workspace @energy8platform/platform-core`
Expected: build succeeds; `dist/shell.d.ts` now declares `formatWin`.

- [ ] **Step 3: Write the failing host-loop test**

Create `packages/game-engine/tests/host/runRound.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runRound, type RunRoundDeps } from '@/host/runRound';
import type { RenderContext } from '@/host/sceneController';

interface R { totalWin: number; roundId?: string; nextActions?: string[]; complete?: boolean }

/** Build deps over a scripted play() queue + spy scene. roleOf marks 'free_spin' as the free role. */
function harness(queue: R[], turbo = () => 0) {
  const playLog: Array<{ action: string; bet: number; roundId?: string }> = [];
  let i = 0;
  const present = vi.fn(async (_r: R, _c: RenderContext) => {});
  const onBonusEnter = vi.fn(async (_r: R, _c: RenderContext) => {});
  const onBonusExit = vi.fn(async (_r: R, _c: RenderContext) => {});
  const ack = vi.fn();
  const context = (action: string): RenderContext => ({
    bet: 2, action, mode: action === 'buy_bonus' ? 'BONUS' : 'BASE',
    formatAmount: (v) => String(v), get turbo() { return turbo(); },
  });
  const deps: RunRoundDeps<R> = {
    play: async (action, bet, roundId) => { playLog.push({ action, bet, roundId }); return queue[i++]!; },
    ack,
    scene: { present, onBonusEnter, onBonusExit },
    context,
    roleOf: (a) => (a === 'free_spin' ? 'free' : a === 'buy_bonus' ? 'buy' : 'base'),
  };
  return { deps, playLog, present, onBonusEnter, onBonusExit, ack };
}

describe('runRound', () => {
  it('a plain complete spin: present once, ack once, no bonus hooks, no drain', async () => {
    const { deps, playLog, present, onBonusEnter, onBonusExit, ack } = harness([
      { totalWin: 1, roundId: 'r1', nextActions: ['spin'], complete: true },
    ]);
    await runRound(deps, 'spin');
    expect(playLog).toEqual([{ action: 'spin', bet: 2, roundId: undefined }]);
    expect(present).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(onBonusEnter).not.toHaveBeenCalled();
    expect(onBonusExit).not.toHaveBeenCalled();
  });

  it('buy_bonus + 2 free spins: drains by roundId, fires enter before 1st FS and exit after last', async () => {
    const { deps, playLog, present, onBonusEnter, onBonusExit, ack } = harness([
      { totalWin: 0, roundId: 'r9', nextActions: ['free_spin'], complete: false }, // trigger
      { totalWin: 3, roundId: 'r9', nextActions: ['free_spin'], complete: false }, // fs1
      { totalWin: 7, roundId: 'r9', nextActions: ['spin'], complete: true },        // fs2 (last)
    ]);
    await runRound(deps, 'buy_bonus');
    expect(playLog).toEqual([
      { action: 'buy_bonus', bet: 2, roundId: undefined },
      { action: 'free_spin', bet: 2, roundId: 'r9' },
      { action: 'free_spin', bet: 2, roundId: 'r9' },
    ]);
    expect(present).toHaveBeenCalledTimes(3);
    expect(ack).toHaveBeenCalledTimes(3);
    expect(onBonusEnter).toHaveBeenCalledTimes(1);
    expect(onBonusExit).toHaveBeenCalledTimes(1);
    // enter fires with the TRIGGER result, exit with the LAST free spin.
    expect((onBonusEnter.mock.calls[0][0] as R).totalWin).toBe(0);
    expect((onBonusExit.mock.calls[0][0] as R).totalWin).toBe(7);
  });

  it('ctx.turbo is live — reflects a mid-round toggle', async () => {
    let level = 0;
    const { deps, present } = harness(
      [
        { totalWin: 0, roundId: 'r9', nextActions: ['free_spin'], complete: false },
        { totalWin: 1, roundId: 'r9', nextActions: ['spin'], complete: true },
      ],
      () => level,
    );
    (present as ReturnType<typeof vi.fn>).mockImplementation(async (_r: R, c: RenderContext) => { level = c.turbo + 1; });
    await runRound(deps, 'buy_bonus');
    // first present read turbo 0 then set 1; second present's ctx.turbo getter now reads 1.
    const ctxSecond = present.mock.calls[1][1] as RenderContext;
    expect(ctxSecond.turbo).toBe(1);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run --root packages/game-engine tests/host/runRound.test.ts`
Expected: FAIL — cannot import `runRound` (module missing) and/or `RenderContext`.

- [ ] **Step 5: Replace the scene contract**

Replace the ENTIRE contents of `packages/game-engine/src/host/sceneController.ts` with:

```ts
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

/** Everything a scene needs to render one result. The host builds it once per round. */
export interface RenderContext {
  /** Bet for this round (major units). Stable for the whole round (a bonus is one round). */
  bet: number;
  /** Trigger action in the game's own vocabulary (gameSpec.actions keys): 'spin' | 'ante' |
   *  'buy_bonus' | … Stable for the whole round. */
  action: string;
  /** Stake bet-mode of the round (model.spec.modeMap[action]): 'BASE' | 'ANTE' | 'BONUS' | …
   *  Canonical per-round identifier of WHICH bonus/feature this is. Stable for the whole round. */
  mode: string;
  /** Currency-aware money formatter. win/totalWin get variable decimals (0.0041 stays 0.0041). */
  formatAmount(value: number): string;
  /** LIVE turbo level (0 = off, 1..3 = escalating speed), matching the shell's state.turbo. Read at
   *  the moment of access (getter) so a mid-round toggle is reflected. */
  readonly turbo: number;
}

/** The contract a slot scene implements. The HOST owns the play→present→ack→drain loop and calls
 *  these; the scene only renders. The game never sees play/ack/roundId. */
export interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  /** Render ONE segment (a spin, or one free spin). All pacing/pauses/overlays live here
   *  (await your own animations). The host calls this once per segment. */
  present(result: T, ctx: RenderContext): Promise<void>;
  /** Optional. Fires EXACTLY before the first free spin of a bonus (intro; spin counts in
   *  trigger.freeSpins). */
  onBonusEnter?(trigger: T, ctx: RenderContext): Promise<void>;
  /** Optional. Fires after the last free spin of a bonus (summary; last.totalWin = bonus total). */
  onBonusExit?(last: T, ctx: RenderContext): Promise<void>;
}
```

(This DELETES `SlotHostApi`.)

- [ ] **Step 6: Create the extracted host loop**

Create `packages/game-engine/src/host/runRound.ts`:

```ts
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';
import type { RenderContext, SlotSceneController } from './sceneController';

/** Injected dependencies for one round. All host-agnostic + unit-testable. */
export interface RunRoundDeps<T extends SlotSpinResultBase> {
  /** play → normalize → enrich (roundId/nextActions/complete). From createSlotPlay. */
  play(action: string, bet: number, roundId?: string): Promise<T>;
  /** Settle the most recent result (post-animation). From createSlotPlay. */
  ack(): void;
  /** The scene to render into (resolved by the caller at call time — it can change between rounds). */
  scene: Pick<SlotSceneController<T>, 'present' | 'onBonusEnter' | 'onBonusExit'>;
  /** Build the per-round render context for the trigger action. */
  context(action: string): RenderContext;
  /** Role of an action from the spec ('base'|'buy'|'feature'|'free'); drives bonus detection. */
  roleOf(action: string): string | undefined;
}

/**
 * Drive ONE round end-to-end: play the trigger, present it, ack; then drain the remaining segments
 * (a bonus's free spins) by replaying nextActions[0] with the SAME roundId until the round reports
 * `complete`. Fires `onBonusEnter` EXACTLY before the first free-role segment and `onBonusExit`
 * after the last. A plain spin with no bonus is already `complete`, so the while-loop is a no-op.
 *
 * `ctx.bet` is captured once (bet can't change mid-round); `ctx.turbo` is a live getter so a
 * mid-round toggle is honoured on the next segment.
 */
export async function runRound<T extends SlotSpinResultBase>(
  deps: RunRoundDeps<T>,
  action: string,
): Promise<void> {
  const ctx = deps.context(action);
  let r = await deps.play(action, ctx.bet);
  await deps.scene.present(r, ctx);
  deps.ack();

  let inBonus = false;
  while (!r.complete && r.nextActions && r.nextActions.length > 0) {
    const next = r.nextActions[0];
    if (!inBonus && deps.roleOf(next) === 'free') {
      inBonus = true;
      await deps.scene.onBonusEnter?.(r, ctx);
    }
    r = await deps.play(next, ctx.bet, r.roundId);
    await deps.scene.present(r, ctx);
    deps.ack();
  }
  if (inBonus) await deps.scene.onBonusExit?.(r, ctx);
}
```

- [ ] **Step 7: Run the host-loop test to verify it passes**

Run: `npx vitest run --root packages/game-engine tests/host/runRound.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 8: Rewire `createSlotGame` to drive `runRound`**

In `packages/game-engine/src/host/createSlotGame.ts`:

(a) Update the `gameScene()` duck-type (lines 105-112) to test `present` instead of `bindHost`:

```ts
  /** The current scene IFF it implements the SlotSceneController contract (duck-typed on
   *  `present`). The host drives the play loop against whichever scene is current. */
  const gameScene = () => {
    const s = game.scenes.current?.scene as
      | Partial<import('./sceneController').SlotSceneController<T>>
      | undefined;
    return typeof s?.present === 'function' ? s : undefined;
  };
```

(b) DELETE the `bindGameScene` block (lines 126-136 — the `bindHost`/`setBet` injection and the two `game.scenes.on('change', bindGameScene)` / `bindGameScene()` calls). `slotPlay` (lines 116-124) stays as-is.

(c) Add the loop import near the other host imports at the top of the function body (after `const { createSlotPlay } = await import('./slotPlay');` on line 103):

```ts
  const { runRound } = await import('./runRound');
```

(d) Inside `if (opts.shell) { … }`, AFTER `shell = createGameShell(...)` (line 190) and the `currentBalance`/`balanceUpdate` lines (192-193), add the live-turbo tracker + context/role helpers:

```ts
    // Live turbo level (0..3) — read fresh on each ctx.turbo access so a mid-round toggle is honoured.
    let currentTurbo = shell.state.turbo;
    shell.on('turboChange', (level: number) => { currentTurbo = level; });

    const roleOf = (action: string) => opts.model.spec.actions[action]?.role;
    const makeContext = (action: string): import('./sceneController').RenderContext => ({
      bet: currentBet,
      action,
      mode: opts.model.spec.modeMap[action] ?? action.toUpperCase(),
      formatAmount: (v) => shell!.formatWin(v),
      get turbo() { return currentTurbo; },
    });
    /** Drive a full round (trigger + drain) against the current scene. */
    const playRound = (action: string) => {
      const scene = gameScene();
      if (!scene) return;
      void runRound<T>(
        { play: slotPlay.play, ack: slotPlay.ack, scene, context: makeContext, roleOf },
        action,
      );
    };
```

(e) Replace the base-mode `spin` + `buyBonusSelect` handlers (lines 213-227) with:

```ts
      shell.on('spin', () => {
        const action = activeFeature ?? 'spin';
        if (!ensureAffordable(action)) return;
        playRound(action);
      });
      shell.on('betChange', (bet: number) => { currentBet = bet; });
      shell.on('buyBonusSelect', ({ id }: { id: string }) => {
        if (!ensureAffordable(id)) return;
        playRound(id);
      });
```

(f) Replace the resume `Continue` handler body (lines 245-248) so it presents via `present` (the scene no longer has `resume`):

```ts
            { title: shell.t('Continue'), on: () => { void (async () => {
              await gameScene()?.present?.(result, makeContext((snap as { action?: string }).action ?? 'spin'));
              ps?.playAck(snap!);
            })(); } },
```

(g) Replace the replay branch's `setBet`/`onReplay` (lines 262-269) so replay also uses the unified loop:

```ts
      currentBet = replayBet;
      // onReplay only spins — the shell reopens the modal after it resolves; never call openReplay inside onReplay (double-open).
      shell.openReplay({
        bonusId,
        bet: replayBet,
        payoutMultiplier: stakeBridge?.replayPayoutMultiplier ?? 0,
        onReplay: () => playRound(bonusId),
      });
```

- [ ] **Step 9: Rewrite the shell-wiring test for the new loop**

Replace the ENTIRE contents of `packages/game-engine/tests/host/shellWiring.test.ts` with:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@energy8platform/platform-core/shell';
import type { ShellConfig, BonusOption, GameShell } from '@energy8platform/platform-core/shell';
import { createSlotPlay } from '@/host/slotPlay';
import { runRound } from '@/host/runRound';
import type { RenderContext, SlotSceneController } from '@/host/sceneController';

/**
 * End-to-end wiring proof for ANTE + BUY BONUS, WITHOUT booting Pixi.
 *
 * Drives a REAL GameShell (its buy-bonus overlay + confirm DOM) and replicates the EXACT base-mode
 * `playRound` wiring from createSlotGame against the real runRound + createSlotPlay, over a stub
 * scene that only implements `present`. Asserts the chain reaches play({ action, bet }).
 *
 * createSlotGame() itself can't be unit-tested (GameApplication.init() drives Pixi, which hangs
 * headless); this pins the wiring + the host loop it contains.
 */

interface SpinResult { totalWin: number; roundId?: string; nextActions?: string[]; complete?: boolean }

/** Stub scene = the generated GameScene contract: present only (host owns the loop). */
function makeScene(): SlotSceneController<SpinResult> {
  return { async present() {} };
}

/** The verbatim base-mode wiring from createSlotGame.ts (playRound + handlers). */
function wireBaseMode(
  shell: GameShell,
  slotPlay: { play: (a: string, b: number, r?: string) => Promise<SpinResult>; ack: () => void },
  gameScene: () => SlotSceneController<SpinResult> | undefined,
  getBet: () => number,
) {
  let activeFeature: string | null = null;
  const ctx = (action: string): RenderContext => ({
    bet: getBet(), action, mode: 'BASE', formatAmount: String, get turbo() { return 0; },
  });
  const playRound = (action: string) => {
    const scene = gameScene();
    if (!scene) return;
    void runRound<SpinResult>(
      { play: slotPlay.play, ack: slotPlay.ack, scene, context: ctx, roleOf: () => 'base' },
      action,
    );
  };
  shell.on('featureActivate', ({ id }) => { activeFeature = id; });
  shell.on('featureDeactivate', () => { activeFeature = null; });
  shell.on('spin', () => { playRound(activeFeature ?? 'spin'); });
  shell.on('buyBonusSelect', ({ id }) => { playRound(id); });
}

const cfg = (buyBonus: BonusOption[]): ShellConfig => ({
  mount: document.body,
  gameInfo: { sections: [] },
  language: 'en',
  currency: { symbol: '€', position: 'left' },
  availableBets: [1],
  defaultBet: 1,
  currentBet: 1,
  balance: 100000,
  win: 0,
  mode: 'base',
  features: { turbo: 0, buyBonus },
});

const ANTE: BonusOption = { id: 'ante', type: 'feature', title: 'ANTE BET', description: 'boost', priceMultiplier: 1.5 };
const BUY: BonusOption = { id: 'buy_bonus', type: 'bonus', title: 'BUY BONUS', description: 'buy', priceMultiplier: 100 };

/** Stand up shell + scene + the real createSlotPlay, recording every play({action,bet}). */
function harness(options: BonusOption[]) {
  const plays: Array<{ action: string; bet: number }> = [];
  const slotPlay = createSlotPlay<SpinResult>({
    play: (p) => { plays.push({ action: p.action, bet: p.bet }); return Promise.resolve({ totalWin: 0, complete: true }); },
    normalize: () => ({ totalWin: 0 }),
  });
  const scene = makeScene();
  const shell = createGameShell(cfg(options));
  wireBaseMode(shell, slotPlay, () => scene, () => 1);
  return { shell, plays };
}

const card = (id: string) => document.querySelector(`[data-ge="bonus-card-${id}"]`) as HTMLElement;
const confirmBuy = () => document.querySelector('[data-ge="bonus-confirm-buy"]') as HTMLElement;

describe('createSlotGame shell → host loop wiring (ANTE + BUY BONUS)', () => {
  beforeEach(async () => { await removeGameShell(); document.body.innerHTML = ''; });

  it('bar BUY BONUS button opens the overlay (button → openBuyBonus link)', () => {
    harness([BUY]);
    const barBtn = document.querySelector('[data-ge="buybonus"]') as HTMLElement;
    expect(barBtn).toBeTruthy();
    barBtn.click();
    expect(document.querySelector('[data-ge="buybonus-overlay"]')).toBeTruthy();
  });

  it('BUY BONUS card → confirm → play({ action: "buy_bonus", bet })', async () => {
    const { shell, plays } = harness([BUY]);
    shell.openBuyBonus();
    card('buy_bonus').click();
    confirmBuy().click();
    await Promise.resolve(); await Promise.resolve();
    expect(plays).toEqual([{ action: 'buy_bonus', bet: 1 }]);
  });

  it('ANTE card → Activate → featureActivate, then SPIN routes to play({ action: "ante", bet })', async () => {
    const { shell, plays } = harness([ANTE]);
    shell.openBuyBonus();
    card('ante').click();
    confirmBuy().click();
    await Promise.resolve();
    expect(plays).toEqual([]);
    shell.emit('spin');
    await Promise.resolve(); await Promise.resolve();
    expect(plays).toEqual([{ action: 'ante', bet: 1 }]);
  });

  it('without an active feature, SPIN routes to play({ action: "spin", bet })', async () => {
    const { shell, plays } = harness([BUY]);
    shell.emit('spin');
    await Promise.resolve(); await Promise.resolve();
    expect(plays).toEqual([{ action: 'spin', bet: 1 }]);
  });

  it('deactivating the ante reverts SPIN back to the base action', async () => {
    const { shell, plays } = harness([ANTE]);
    shell.openBuyBonus();
    card('ante').click();
    confirmBuy().click();
    shell.deactivateFeature();
    shell.emit('spin');
    await Promise.resolve(); await Promise.resolve();
    expect(plays).toEqual([{ action: 'spin', bet: 1 }]);
  });
});
```

- [ ] **Step 10: Run the host tests + typecheck the package**

Run: `npx vitest run --root packages/game-engine tests/host/ && npx tsc --noEmit -p packages/game-engine`
Expected: PASS. Typecheck clean — no remaining references to `SlotHostApi`, `bindHost`, `scene.spin`, `scene.buyBonus`, `scene.setBet`, `scene.resume` in `createSlotGame.ts`. If typecheck flags any, fix them in `createSlotGame.ts` per Step 8.

- [ ] **Step 11: Rebuild game-engine (so create-slot's anti-drift typecheck in Task 3 sees the new contract)**

Run: `npm run build --workspace @energy8platform/game-engine`
Expected: build succeeds.

- [ ] **Step 12: Commit**

```bash
git add packages/platform-core/src/shell/GameShell.ts packages/game-engine/src/host/sceneController.ts packages/game-engine/src/host/runRound.ts packages/game-engine/src/host/createSlotGame.ts packages/game-engine/tests/host/runRound.test.ts packages/game-engine/tests/host/shellWiring.test.ts
git commit -m "$(printf 'feat(host): framework owns the play loop; scene implements only present()\n\nNew RenderContext (bet/action/mode/formatAmount/live-turbo) + slim SlotSceneController replace the\nfat scene contract and SlotHostApi. Extracted runRound(deps, action) drives play->present->ack->drain;\ncreateSlotGame builds the deps and wires shell spin/buyBonus/replay/resume to it. GameShell.formatWin\nexposes currency-aware win formatting. The game no longer sees play/ack/roundId.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Regenerate the codegen scene + tests

Regenerate `GameScene` (ways + cascade variants) to the slim contract — `present` + `onBonusEnter`/`onBonusExit`, no `host`/`spin`/`buyBonus`/`drainRound`/`setBet`/`bindHost`/`resume`/`FreeSpinsSession` — using `ctx.formatAmount` and `ctx.turbo`. Update the generator's unit test and confirm the scaffold anti-drift typecheck passes against the new contract.

**Files:**
- Modify: `packages/create-slot/src/codegen/gameScene.ts` (replace `genGameScene`)
- Test: `packages/create-slot/test/gameScene.test.ts` (rewrite assertions)
- Test (existing gate): `packages/create-slot/test/scaffold.test.ts` (anti-drift typecheck — must pass)

**Interfaces:**
- Consumes (from Task 2): `SlotSceneController<T>`, `RenderContext` from `@energy8platform/game-engine/host`; `BigWinOverlay.show(win, bet, format?)` from `@energy8platform/game-engine/slot`.

- [ ] **Step 1: Write the failing generator test**

Replace the FIRST test in `packages/create-slot/test/gameScene.test.ts` (the `cascade/cluster …` case, lines 5-17) with the new shape, and keep the other tests (layout/resize) intact:

```ts
  it('cascade/cluster: slim render contract (present + bonus hooks), no play/ack/host', () => {
    const s = genGameScene({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(s).toContain('implements SlotSceneController<SpinData>');
    expect(s).toContain('async present(result: SpinData, ctx: RenderContext)');
    expect(s).toContain('async onBonusEnter(');
    expect(s).toContain('async onBonusExit(');
    expect(s).toContain('ctx.formatAmount');
    expect(s).toContain('ctx.turbo');
    expect(s).toContain('MultiplierAccumulator');
    expect(s).toContain('CascadeController');
    // The game no longer touches the play protocol:
    expect(s).not.toContain('bindHost');
    expect(s).not.toContain('SlotHostApi');
    expect(s).not.toContain('this.host');
    expect(s).not.toContain('drainRound');
    expect(s).not.toContain('FreeSpinsSession');
    expect(s).not.toContain('async spin(');
    expect(s).not.toContain('async buyBonus(');
    expect(s).not.toContain('platformSession');
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --root packages/create-slot test/gameScene.test.ts`
Expected: FAIL — current output still contains `bindHost`/`spin`/`buyBonus`/`drainRound`.

- [ ] **Step 3: Replace the generator**

Replace the ENTIRE contents of `packages/create-slot/src/codegen/gameScene.ts` with:

```ts
import type { Answers } from '../answers';

export function genGameScene(a: Answers): string {
  const cascade = a.cascades === true;
  const ctrl = cascade ? 'CascadeController' : 'ReelSpinController';

  const present = cascade
    ? `  /** Render one normalized result. Tune MultiplierAccumulator policy/reset() to your mechanic. */
  async present(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    if (typeof result.multiplier === 'number') this.multiplier.set(result.multiplier);
    for (const step of result.steps) await this.controller.run(step, { turbo });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, ctx.bet, ctx.formatAmount);
  }`
    : `  /** Render one normalized result (one spin, or one free spin of a bonus). */
  async present(result: SpinData, ctx: RenderContext): Promise<void> {
    const turbo = ctx.turbo > 0;
    await this.controller.run({ targetGrid: result.targetGrid }, { turbo });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, ctx.bet, ctx.formatAmount);
  }`;

  const multiplierImport = cascade ? ', MultiplierAccumulator' : '';
  const multiplierField = cascade
    ? `  private readonly multiplier = new MultiplierAccumulator({ policy: 'session' });\n` : '';

  return `import { Scene } from '@energy8platform/game-engine/core';
import { ReelGrid, ${ctrl}, BigWinOverlay${multiplierImport} } from '@energy8platform/game-engine/slot';
import type { SlotSceneController, RenderContext } from '@energy8platform/game-engine/host';
import { model } from '../game.spec';
import { resolveSymbol } from '../slot/symbols';
import type { SpinData } from '../game/normalize';

/**
 * The host owns the play loop (play -> present -> ack -> drain). This scene only RENDERS:
 *  - present(result, ctx): draw ONE segment (a spin, or one free spin). Put all pacing here.
 *  - onBonusEnter(trigger, ctx): fires right before the first free spin (bonus intro).
 *  - onBonusExit(last, ctx): fires after the last free spin (bonus summary).
 * ctx gives you { bet, action, mode, formatAmount(value), turbo } — turbo is live (0..3).
 */
export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: ${ctrl};
  private overlay!: BigWinOverlay;
${multiplierField}
  private _vw = 1920;
  private _vh = 1080;

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
    this.layout(this._vw, this._vh);
  }

${present}

  /** Bonus starting — show an intro. trigger.freeSpins?.total = how many free spins were awarded. */
  async onBonusEnter(trigger: SpinData, _ctx: RenderContext): Promise<void> {
    // TODO: show a bonus intro (e.g. "10 FREE SPINS"). Defaults to nothing.
    void trigger;
  }

  /** Bonus finished — show a summary. ctx.formatAmount(last.totalWin) = the bonus total win. */
  async onBonusExit(last: SpinData, ctx: RenderContext): Promise<void> {
    // TODO: show a bonus summary. Defaults to nothing.
    void last; void ctx;
  }

  onResize(width: number, height: number): void {
    this._vw = width;
    this._vh = height;
    this.layout(width, height);
  }

  private layout(w: number, h: number): void {
    this._vw = w; this._vh = h;
    if (!this.grid) return;
    const cols = model.spec.grid.cols, rows = model.spec.grid.rows;
    const cellSize = 110, gap = 6;            // must match the ReelGrid constructor above
    const gridW = cols * cellSize + (cols - 1) * gap;
    const gridH = rows * cellSize + (rows - 1) * gap;
    const fit = Math.min((w * 0.92) / gridW, (h * 0.78) / gridH);
    this.grid.scale.set(fit);
    this.grid.x = Math.round((w - gridW * fit) / 2);
    this.grid.y = Math.round((h - gridH * fit) / 2);
    this.overlay?.resize?.(w, h);
  }
}
`;
}
```

- [ ] **Step 4: Run the generator test to verify it passes**

Run: `npx vitest run --root packages/create-slot test/gameScene.test.ts`
Expected: PASS (the rewritten case + the untouched layout/resize cases).

- [ ] **Step 5: Run the scaffold anti-drift typecheck (the real gate)**

Run: `npx vitest run --root packages/create-slot test/scaffold.test.ts`
Expected: PASS — a freshly generated game typechecks against the just-built `@energy8platform/game-engine` (new contract) and `@energy8platform/platform-core`. If it fails on `GameScene.ts`, read the `tsc` error and reconcile the generated code with the Task 2 contract (signature names must match `present(result, ctx)` / `RenderContext` / `BigWinOverlay.show(win, bet, format?)`).

- [ ] **Step 6: Run the full create-slot + game-engine suites**

Run: `npx vitest run --root packages/create-slot && npx vitest run --root packages/game-engine`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/create-slot/src/codegen/gameScene.ts packages/create-slot/test/gameScene.test.ts
git commit -m "$(printf 'feat(create-slot): regenerate GameScene to the slim render contract\n\nGenerated scene implements present(result, ctx) + onBonusEnter/onBonusExit only; no host/spin/\nbuyBonus/drainRound/setBet/bindHost/FreeSpinsSession. Uses ctx.formatAmount + live ctx.turbo and\nBigWinOverlay.show(win, bet, formatAmount).\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Self-Review

**1. Spec coverage:**
- RenderContext (bet/action/mode/formatAmount/live-turbo) → Task 2 Step 5. ✓
- Slim SlotSceneController + delete SlotHostApi → Task 2 Step 5. ✓
- runRound loop + bonus detection by role → Task 2 Step 6, tested Step 3. ✓
- createSlotGame rewiring (spin/buyBonus/betChange/resume/replay) → Task 2 Step 8. ✓
- formatAmount source (GameShell.formatWin) → Task 2 Step 1. ✓
- BigWinOverlay formatter → Task 1. ✓
- Codegen scene (ways + cascade) + tests → Task 3. ✓
- stake-kit unchanged → no task (correct; the bridge protocol is untouched). ✓
- Resume mid-bonus parity (present one snapshot + settle) → Task 2 Step 8(f). ✓

**2. Placeholder scan:** The only `TODO`s are inside the GENERATED scene body (author hooks `onBonusEnter`/`onBonusExit`), which are intentional scaffold guidance, not plan placeholders. All plan steps carry complete code/commands. ✓

**3. Type consistency:** `RenderContext` fields (`bet`/`action`/`mode`/`formatAmount`/`turbo`) are identical across sceneController.ts (Step 5), runRound.ts (Step 6), createSlotGame `makeContext` (Step 8d), both tests (Step 3, Step 9), and the codegen (Task 3 Step 3). `runRound(deps, action)` + `RunRoundDeps<T>` shape match between definition (Step 6) and all callers/tests. `BigWinOverlay.show(win, bet, format?)` matches between Task 1 Step 5 and codegen Task 3. `GameShell.formatWin(value)` defined Task 2 Step 1, consumed Step 8d. ✓
