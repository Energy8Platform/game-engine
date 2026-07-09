import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';
import type { RenderContext, SlotSceneController } from './sceneController';

export interface RunRoundDeps<T extends SlotSpinResultBase> {
  play(action: string, bet: number, roundId?: string): Promise<T>;
  ack(): void;
  scene: Pick<SlotSceneController<T>, 'onSpin'>;
  /** Build the render context (without signal — runRound injects it per segment). Called with the
   *  ROUND action, so `ctx.action`/`ctx.mode` carry the round identity across every drained segment
   *  (a buy_bonus round's free spins still read as BONUS). Nested-bonus detection uses `modeOf`, not
   *  `ctx.mode`, and the scene learns level changes via onModeEnter/onModeExit. */
  context(action: string): Omit<RenderContext, 'signal'> & { signal?: AbortSignal };
  /** Bonus mode string for a segment action (FREESPINS / ADVENTURE / …) — drives nested-bonus
   *  transition detection. Defaults to `action.toUpperCase()`. */
  modeOf?(action: string): string;
  /** True when an action is a bonus (free-play) segment, false for base/trigger segments.
   *  Omit for base-only games (no bonus transitions ever fire). */
  isBonusAction?(action: string): boolean;
  afterPresent?(result: T): void;
  /** Once, before the first segment is played (player pressed spin). */
  onSpinStart?(): void;
  /** Once, after the full drain. */
  onSpinEnd?(last: T, ctx: RenderContext): void;
  /** Fires when a bonus LEVEL becomes active — a fresh push (`resumed=false`) or a return to a
   *  suspended parent after a nested sub-bonus popped (`resumed=true`). Fires per boundary, so a
   *  round may enter several levels. `trigger`/`ctx` are the segment that caused the transition. */
  onModeEnter?(mode: string, trigger: T, ctx: RenderContext, resumed: boolean): Promise<void>;
  /** Fires when a bonus LEVEL ends (pop) — either descending past it into base, or unwinding at
   *  round end. Fires once per popped level, top-first. */
  onModeExit?(mode: string, last: T, ctx: RenderContext): Promise<void>;
  /** Hands the host the AbortController for the segment about to present (for skip). */
  beforeSegment?(ac: AbortController): void;
}

/** A planned move of the mode stack toward a target (or to base when `target` is null). Pure. */
export interface TransitionPlan {
  /** Modes to exit, top-first (each is popped). */
  exit: string[];
  /** The level that becomes active after the exits, or null when none (same level, or unwind to
   *  base). `resumed` distinguishes returning to an existing parent from a fresh push. */
  enter: { mode: string; resumed: boolean } | null;
}

/**
 * Pure: given the CURRENT bonus-mode stack (bottom→top) and the next segment's target mode
 * (null = a base segment / round end), decide which levels to exit and whether a level enters.
 *
 *  - target null            → unwind everything (exit all, top-first).
 *  - target === top          → same level, no transition.
 *  - target already deeper   → RESUME: exit the levels above it; it re-activates (resumed).
 *  - target not on the stack → PUSH: a fresh level enters.
 *
 * The caller owns the actual stack array and applies the plan (pop per `exit`, push when
 * `enter && !resumed`).
 */
export function planTransition(stack: readonly string[], target: string | null): TransitionPlan {
  if (target == null) return { exit: [...stack].reverse(), enter: null };
  if (stack.length > 0 && stack[stack.length - 1] === target) return { exit: [], enter: null };
  const depth = stack.lastIndexOf(target);
  if (depth >= 0)
    return { exit: stack.slice(depth + 1).reverse(), enter: { mode: target, resumed: true } };
  return { exit: [], enter: { mode: target, resumed: false } };
}

export async function runRound<T extends SlotSpinResultBase>(
  deps: RunRoundDeps<T>,
  action: string,
): Promise<void> {
  deps.onSpinStart?.();

  const ctxBet = deps.context(action).bet;
  const modeOf = deps.modeOf ?? ((a: string) => a.toUpperCase());
  const isBonus = deps.isBonusAction ?? (() => false);

  const segment = async (
    a: string,
    roundId: string | undefined,
  ): Promise<{ r: T; ctx: RenderContext }> => {
    const ac = new AbortController();
    deps.beforeSegment?.(ac);
    const r = await deps.play(a, ctxBet, roundId);
    // ctx carries the ROUND identity (built from the round action), stable across drained segments.
    const ctx = { ...deps.context(action), signal: ac.signal } as RenderContext;
    await deps.scene.onSpin(r, ctx);
    deps.ack();
    deps.afterPresent?.(r);
    return { r, ctx };
  };

  // Active bonus-mode levels (bottom→top). Empty in the base game.
  const stack: string[] = [];
  // Emit the exits/enter to move the stack toward `nextAction` (null → unwind to base). Called
  // BEFORE the target segment presents, with the CURRENT (triggering) r/ctx — mirrors the classic
  // onEnterMode(trigger) timing so the host reads awarded spins off the segment that granted them.
  const transition = async (nextAction: string | null, r: T, ctx: RenderContext): Promise<void> => {
    const target = nextAction != null && isBonus(nextAction) ? modeOf(nextAction) : null;
    const plan = planTransition(stack, target);
    for (const mode of plan.exit) {
      stack.pop();
      await deps.onModeExit?.(mode, r, ctx);
    }
    if (plan.enter) {
      if (!plan.enter.resumed) stack.push(plan.enter.mode);
      await deps.onModeEnter?.(plan.enter.mode, r, ctx, plan.enter.resumed);
    }
  };

  let { r, ctx } = await segment(action, undefined);
  while (!r.complete && r.nextActions && r.nextActions.length > 0) {
    const next = r.nextActions[0];
    await transition(next, r, ctx);
    ({ r, ctx } = await segment(next, r.roundId));
  }
  await transition(null, r, ctx); // round end: unwind any remaining levels to base
  deps.onSpinEnd?.(r, ctx);
}
