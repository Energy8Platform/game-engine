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
  const afterPresent = vi.fn((_r: R) => {});
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
    afterPresent,
  };
  return { deps, playLog, present, onBonusEnter, onBonusExit, ack, afterPresent };
}

describe('runRound', () => {
  it('a plain complete spin: present once, ack once, afterPresent after present, no bonus hooks', async () => {
    const { deps, playLog, present, onBonusEnter, onBonusExit, ack, afterPresent } = harness([
      { totalWin: 1, roundId: 'r1', nextActions: ['spin'], complete: true },
    ]);
    await runRound(deps, 'spin');
    expect(playLog).toEqual([{ action: 'spin', bet: 2, roundId: undefined }]);
    expect(present).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
    expect(afterPresent).toHaveBeenCalledTimes(1);
    expect(afterPresent).toHaveBeenCalledWith({ totalWin: 1, roundId: 'r1', nextActions: ['spin'], complete: true });
    // HUD update fires AFTER the animation: present's call order precedes afterPresent's.
    expect(present.mock.invocationCallOrder[0]).toBeLessThan(afterPresent.mock.invocationCallOrder[0]);
    expect(onBonusEnter).not.toHaveBeenCalled();
    expect(onBonusExit).not.toHaveBeenCalled();
  });

  it('buy_bonus + 2 free spins: drains by roundId, fires enter before 1st FS and exit after last', async () => {
    const { deps, playLog, present, onBonusEnter, onBonusExit, ack, afterPresent } = harness([
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
    expect(afterPresent).toHaveBeenCalledTimes(3); // one HUD update per presented segment
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

  it('drain segments keep the TRIGGER action/mode in ctx (round identity stays the bonus)', async () => {
    const { deps, present } = harness([
      { totalWin: 0, roundId: 'r9', nextActions: ['free_spin'], complete: false }, // buy_bonus trigger
      { totalWin: 5, roundId: 'r9', nextActions: ['spin'], complete: true },        // free spin (drain)
    ]);
    await runRound(deps, 'buy_bonus');
    const triggerCtx = present.mock.calls[0][1] as RenderContext;
    const drainCtx = present.mock.calls[1][1] as RenderContext;
    // The drain (free-spin) segment must still carry the buy_bonus round identity, not 'free_spin'/'BASE'.
    expect(triggerCtx.action).toBe('buy_bonus');
    expect(triggerCtx.mode).toBe('BONUS');
    expect(drainCtx.action).toBe('buy_bonus');
    expect(drainCtx.mode).toBe('BONUS');
  });
});
