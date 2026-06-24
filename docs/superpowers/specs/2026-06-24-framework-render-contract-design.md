# Framework-owned play loop + single render contract — Design

**Date:** 2026-06-24
**Status:** Approved (pending written-spec review)

## Problem

A generated slot game today implements a fat scene contract — `spin()`, `buyBonus()`,
`drainRound()`, `setBet()`, `bindHost()`, `resume()` — and the scene itself calls
`host.play()` / `host.ack()` and drives the free-spins drain loop. That hands the play/ack
protocol to the game "just to call it", which the game author shouldn't have to think about.

Research confirmed both reference Stake games do the same thing we currently do:
- **kitsune-wrath** (`src/components/GameRoot.tsx`): the game calls `sdk.play({action, bet, roundId})`
  per segment, a React effect auto-triggers the next free spin, the game calls `sdk.playAck()`.
- **moon-spice-shop** (`src/main.ts`): the game runs `while (fsSpinsRemaining > 0) { session.play({action:'free_spin', roundId}); handleFsResult(); playAck() }`, with two handlers `handleBaseResult` / `handleFsResult`.

Neither game pushes the loop into a framework. This design goes further: the **framework owns the
entire `play → present → ack → drain` loop**, and the game implements only "render one result".

## Goal

The game implements **one required method plus two optional hooks**, knows nothing about
`play`/`ack`/`roundId`, and gets everything it needs to render through a single `RenderContext`.

## The contract

Lives in `packages/game-engine/src/host/sceneController.ts` (replaces the current
`SlotHostApi` + `SlotSceneController`).

```ts
export interface RenderContext {
  /** Bet for this round (major units). Stable for the whole round (a bonus is one round). */
  bet: number;
  /** Trigger action in the game's own vocabulary (gameSpec.actions keys):
   *  'spin' | 'ante' | 'buy_bonus' | 'buy_super_bonus' | … Stable for the whole round. */
  action: string;
  /** Stake bet-mode of the round (model.spec.modeMap[action]): 'BASE' | 'ANTE' | 'BONUS' | …
   *  Canonical per-round identifier of which bonus/feature this is. Stable for the whole round. */
  mode: string;
  /** Currency-aware money formatter from the host. win/totalWin get variable decimals
   *  (0.0041 does NOT round to 0.00); symbol/position/decimals already applied. */
  formatAmount(value: number): string;
  /** LIVE turbo level (0 = off, 1..3 = escalating speed), matching the shell's `state.turbo`.
   *  Read at the moment of access (getter under the hood) so a mid-round toggle is reflected. */
  readonly turbo: number;
}

export interface SlotSceneController<T extends SlotSpinResultBase = SlotSpinResultBase> {
  /** Render ONE segment (a spin, or one free spin). All pacing/pauses/overlays live here
   *  (await your own animations). The host calls this once per segment. */
  present(result: T, ctx: RenderContext): Promise<void>;
  /** Optional. Fires EXACTLY before the first free spin (bonus intro; spin counts in
   *  trigger.freeSpins). */
  onBonusEnter?(trigger: T, ctx: RenderContext): Promise<void>;
  /** Optional. Fires after the last free spin (bonus summary; last.totalWin = bonus total). */
  onBonusExit?(last: T, ctx: RenderContext): Promise<void>;
}
```

Removed from the game's surface entirely: `SlotHostApi`, `play`, `ack`, `roundId`, `bindHost`,
`spin`, `buyBonus`, `drainRound`, `setBet`, `resume`. The game physically cannot forget `ack()`
or hit "play while round active" — that code no longer exists in the game.

## The host loop

Lives in `packages/game-engine/src/host/createSlotGame.ts`. `createSlotPlay`
(`packages/game-engine/src/host/slotPlay.ts`) is unchanged — it still does play → normalize →
enrich (`roundId`/`nextActions`/`complete`) → ack — but its consumer is now the host, not the scene.

```ts
let currentBet = model.spec.defaultBet ?? model.spec.betLevels[0];
let currentTurbo = shell.state.turbo;
shell.on('turboChange', (level: number) => { currentTurbo = level; });
shell.on('betChange', (bet: number) => { currentBet = bet; });

const roleOf = (action: string) => model.spec.actions[action]?.role; // 'base'|'buy'|'feature'|'free'

function makeContext(action: string): RenderContext {
  return {
    bet: currentBet,
    action,
    mode: model.spec.modeMap[action] ?? action.toUpperCase(),
    formatAmount: (v) => formatCurrency(v, resolvedCurrency, /* variableDecimals */ true),
    get turbo() { return currentTurbo; },
  };
}

async function runRound(action: string): Promise<void> {
  const scene = gameScene();
  if (!scene) return;
  const ctx = makeContext(action);

  let r = await slotPlay.play(action, ctx.bet);
  await scene.present(r, ctx);
  slotPlay.ack();

  let inBonus = false;
  while (!r.complete && r.nextActions?.length) {
    const next = r.nextActions[0];
    if (!inBonus && roleOf(next) === 'free') {
      inBonus = true;
      await scene.onBonusEnter?.(r, ctx);   // r = trigger
    }
    r = await slotPlay.play(next, ctx.bet, r.roundId);
    await scene.present(r, ctx);
    slotPlay.ack();
  }
  if (inBonus) await scene.onBonusExit?.(r, ctx); // r = last free spin
}
```

Shell wiring (existing events; only handler bodies change):

```ts
shell.on('spin', () => {
  const action = activeFeature ?? 'spin';
  if (!ensureAffordable(action)) return;
  void runRound(action);
});
shell.on('buyBonusSelect', ({ id }) => {
  if (!ensureAffordable(id)) return;
  void runRound(id);
});
```

Resume (Continue/Finish modal): `await scene.present(snap, makeContext(resolveAction(snap)))`
then `ps.playAck(snap)` — same settle path as today; no `scene.resume`.

### Bonus detection

A base spin that *triggers* free spins is indistinguishable from a bought bonus at the loop level:
both enter the `while` with a `next` action whose role is `free`. So bonus-enter fires off the
**role of the next action** (`roleOf(next) === 'free'`), not off the game's data — it cannot be
missed even if a game's normalizer omits `freeSpins`. `trigger.freeSpins.total/awarded` still flows
into `onBonusEnter(trigger, ctx)` as render data (spin counts), and `mode`/`action` on `ctx` tell the
game *which* bonus.

## Overlay change

`BigWinOverlay` (and similar overlays) take a formatter per call: `overlay.show(value, ctx.formatAmount)`
instead of a hardcoded `formatMoney: (v) => v.toFixed(2)`.

## Generated scene (codegen)

`packages/create-slot/src/codegen/gameScene.ts` regenerates to the slim contract (ways + cascade
variants). The author sees one render method + two bonus hooks:

```ts
export class GameScene extends Scene implements SlotSceneController<SpinData> {
  private grid!: ReelGrid;
  private controller!: ReelSpinController;
  private overlay!: BigWinOverlay;

  async onEnter(): Promise<void> { /* build grid + overlay, layout */ }

  async present(result: SpinData, ctx: RenderContext): Promise<void> {
    const fast = ctx.turbo > 0;
    await this.controller.run({ targetGrid: result.targetGrid }, { turbo: fast });
    if (result.totalWin > 0) await this.overlay.show(result.totalWin, ctx.formatAmount);
  }

  async onBonusEnter(trigger: SpinData, _ctx: RenderContext): Promise<void> {
    // TODO: bonus intro; trigger.freeSpins?.total = spins awarded
  }
  async onBonusExit(last: SpinData, ctx: RenderContext): Promise<void> {
    // TODO: bonus summary; ctx.formatAmount(last.totalWin)
  }

  onResize(w: number, h: number): void { /* layout(w,h) */ }
  private layout(w: number, h: number): void { /* center + scale */ }
}
```

## Testing

- **NEW host-loop test** (`runRound`): a fake scene with `present`/`onBonusEnter`/`onBonusExit`
  spies + a fake play returning a multi-segment bonus. Assert: `present` once per segment;
  `onBonusEnter` fires exactly before the first `free`-role segment; `onBonusExit` after the last;
  `ack` once per segment; `roundId` threaded into continuation plays; `ctx.turbo` reads the live
  level (toggle mid-loop and see it change); `ctx.mode`/`ctx.action` correct.
- **Rewrite** the host shell→scene wiring test: shell `spin`/`buyBonusSelect`/ante now route to
  `runRound` → `slotPlay.play(action)`, no `scene.spin/buyBonus`.
- **Rewrite** `create-slot/test/gameScene.test.ts` to assert the slim shape (present + hooks; no
  `host`/`spin`/`buyBonus`/`drainRound`/`setBet`/`bindHost`/`FreeSpinsSession`).
- `create-slot/test/scaffold.test.ts` (anti-drift typecheck) must pass against the new contract.
- `slotPlay.test.ts` is essentially unchanged (createSlotPlay still enriches).
- **stake-kit unchanged**: the bridge/dev-RGS segment protocol is untouched — only *who* drives
  the loop on the game side changed (now the host). Multi-event books still stream as segments.

## Risks & notes

- **Breaking change** to `SlotSceneController`: demo-slot and any generated game must be
  regenerated. (Expected — codegen is the source of truth.)
- **Resume mid-bonus** stays "present one snapshot + settle" (parity with today). Draining the
  remaining segments on resume is a possible later enhancement.
- **No escape hatch** for custom loop control: a game does everything inside `present`/hooks (any
  awaited animation/pacing) but cannot reorder play calls. Acceptable for a scaffold framework.
- `turboChange` event and the currency formatter already exist in the host/shell — low risk.

## File-change summary

| File | Change |
|------|--------|
| `game-engine/src/host/sceneController.ts` | Replace contract: add `RenderContext`, slim `SlotSceneController`, delete `SlotHostApi` |
| `game-engine/src/host/createSlotGame.ts` | Add `runRound` host loop + `makeContext` + `turboChange` listener; rewire shell handlers; resume via `present` |
| `game-engine/src/host/slotPlay.ts` | Keep; reword docs (consumer is host, not scene) |
| `game-engine/src/slot/.../BigWinOverlay` | `show(value, formatAmount)` — accept a formatter |
| `create-slot/src/codegen/gameScene.ts` | Regenerate to slim contract (ways + cascade) |
| Tests | New host-loop test; rewrite wiring + gameScene tests; scaffold typecheck |
