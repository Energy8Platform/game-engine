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
