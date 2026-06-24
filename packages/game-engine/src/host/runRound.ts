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
  /** Fires after each segment is presented + acked. The host updates HUD readouts (win/balance)
   *  here so they change WITH the animation, never eagerly when the play result arrives. */
  afterPresent?(result: T): void;
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
  deps.afterPresent?.(r); // HUD readouts update AFTER the animation, not before

  let inBonus = false;
  while (!r.complete && r.nextActions && r.nextActions.length > 0) {
    const next = r.nextActions[0];
    if (!inBonus && deps.roleOf(next) === 'free') {
      inBonus = true;
      await deps.scene.onBonusEnter?.(r, ctx);
    }
    // Build a fresh ctx for each drain segment — ctx.turbo is evaluated at segment start so a
    // mid-round turbo toggle is reflected on the NEXT segment (not mid-animation).
    const segCtx = { ...deps.context(next) } as RenderContext;
    r = await deps.play(next, ctx.bet, r.roundId);
    await deps.scene.present(r, segCtx);
    deps.ack();
    deps.afterPresent?.(r);
  }
  if (inBonus) await deps.scene.onBonusExit?.(r, ctx);
}
