import { describe, it, expect, vi } from 'vitest';
import { runRound, type RunRoundDeps } from '@/host/runRound';
import type { RenderContext } from '@/host/sceneController';

interface R {
  totalWin: number;
  roundId?: string;
  nextActions?: string[];
  complete?: boolean;
}

/** Build deps over a scripted play() queue + spy scene. isBonusAction marks 'free_spin' as bonus. */
function harness(queue: R[], turbo = () => 0) {
  const playLog: Array<{ action: string; bet: number; roundId?: string }> = [];
  let i = 0;
  const onSpin = vi.fn(async (_r: R, _c: RenderContext) => {});
  const onModeEnter = vi.fn(
    async (_mode: string, _r: R, _c: RenderContext, _resumed: boolean) => {},
  );
  const onModeExit = vi.fn(async (_mode: string, _r: R, _c: RenderContext) => {});
  const ack = vi.fn();
  const afterPresent = vi.fn((_r: R) => {});
  const context = (action: string): Omit<RenderContext, 'signal'> => ({
    bet: 2,
    action,
    mode: action === 'buy_bonus' ? 'BONUS' : 'BASE',
    formatAmount: (v) => String(v),
    get turbo() {
      return turbo();
    },
  });
  const deps: RunRoundDeps<R> = {
    play: async (action, bet, roundId) => {
      playLog.push({ action, bet, roundId });
      return queue[i++]!;
    },
    ack,
    scene: { onSpin },
    context,
    modeOf: (a) => a.toUpperCase(),
    isBonusAction: (a) => a === 'free_spin',
    afterPresent,
    onModeEnter,
    onModeExit,
  };
  return { deps, playLog, onSpin, onModeEnter, onModeExit, ack, afterPresent };
}

describe('runRound', () => {
  it('a plain complete spin: onSpin once, ack once, afterPresent after onSpin, no mode hooks', async () => {
    const { deps, playLog, onSpin, onModeEnter, onModeExit, ack, afterPresent } = harness([
      { totalWin: 1, roundId: 'r1', nextActions: ['spin'], complete: true },
    ]);
    await runRound(deps, 'spin');
    expect(playLog).toEqual([{ action: 'spin', bet: 2, roundId: undefined }]);
    expect(onSpin).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(afterPresent).toHaveBeenCalledTimes(1);
    expect(afterPresent).toHaveBeenCalledWith({
      totalWin: 1,
      roundId: 'r1',
      nextActions: ['spin'],
      complete: true,
    });
    // HUD update fires AFTER the animation: onSpin's call order precedes afterPresent's.
    expect(onSpin.mock.invocationCallOrder[0]).toBeLessThan(
      afterPresent.mock.invocationCallOrder[0],
    );
    expect(onModeEnter).not.toHaveBeenCalled();
    expect(onModeExit).not.toHaveBeenCalled();
  });

  it('buy_bonus + 2 free spins: drains by roundId, fires onModeEnter before 1st FS and onModeExit after last', async () => {
    const { deps, playLog, onSpin, onModeEnter, onModeExit, ack, afterPresent } = harness([
      { totalWin: 0, roundId: 'r9', nextActions: ['free_spin'], complete: false }, // trigger
      { totalWin: 3, roundId: 'r9', nextActions: ['free_spin'], complete: false }, // fs1
      { totalWin: 7, roundId: 'r9', nextActions: ['spin'], complete: true }, // fs2 (last)
    ]);
    await runRound(deps, 'buy_bonus');
    expect(playLog).toEqual([
      { action: 'buy_bonus', bet: 2, roundId: undefined },
      { action: 'free_spin', bet: 2, roundId: 'r9' },
      { action: 'free_spin', bet: 2, roundId: 'r9' },
    ]);
    expect(onSpin).toHaveBeenCalledTimes(3);
    expect(ack).toHaveBeenCalledTimes(3);
    expect(afterPresent).toHaveBeenCalledTimes(3); // one HUD update per presented segment
    expect(onModeEnter).toHaveBeenCalledTimes(1);
    expect(onModeExit).toHaveBeenCalledTimes(1);
    // enter carries the free mode + TRIGGER result (fresh, not resumed); exit the LAST free spin.
    expect(onModeEnter.mock.calls[0][0]).toBe('FREE_SPIN'); // mode string
    expect((onModeEnter.mock.calls[0][1] as R).totalWin).toBe(0);
    expect(onModeEnter.mock.calls[0][3]).toBe(false); // resumed
    expect(onModeExit.mock.calls[0][0]).toBe('FREE_SPIN');
    expect((onModeExit.mock.calls[0][1] as R).totalWin).toBe(7);
  });

  it('ctx.turbo is live — reflects a mid-round toggle', async () => {
    let level = 0;
    const { deps, onSpin } = harness(
      [
        { totalWin: 0, roundId: 'r9', nextActions: ['free_spin'], complete: false },
        { totalWin: 1, roundId: 'r9', nextActions: ['spin'], complete: true },
      ],
      () => level,
    );
    (onSpin as ReturnType<typeof vi.fn>).mockImplementation(async (_r: R, c: RenderContext) => {
      level = c.turbo + 1;
    });
    await runRound(deps, 'buy_bonus');
    // first onSpin read turbo 0 then set 1; second onSpin's ctx.turbo getter now reads 1.
    const ctxSecond = onSpin.mock.calls[1][1] as RenderContext;
    expect(ctxSecond.turbo).toBe(1);
  });

  it('drain segments keep the TRIGGER action/mode in ctx (round identity stays the bonus)', async () => {
    const { deps, onSpin } = harness([
      { totalWin: 0, roundId: 'r9', nextActions: ['free_spin'], complete: false }, // buy_bonus trigger
      { totalWin: 5, roundId: 'r9', nextActions: ['spin'], complete: true }, // free spin (drain)
    ]);
    await runRound(deps, 'buy_bonus');
    const triggerCtx = onSpin.mock.calls[0][1] as RenderContext;
    const drainCtx = onSpin.mock.calls[1][1] as RenderContext;
    // The drain (free-spin) segment must still carry the buy_bonus round identity, not 'free_spin'/'BASE'.
    expect(triggerCtx.action).toBe('buy_bonus');
    expect(triggerCtx.mode).toBe('BONUS');
    expect(drainCtx.action).toBe('buy_bonus');
    expect(drainCtx.mode).toBe('BONUS');
  });
});
