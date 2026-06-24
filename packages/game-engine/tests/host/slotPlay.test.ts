import { describe, it, expect, vi } from 'vitest';
import { createSlotPlay, enrichRoundMeta } from '../../src/host/slotPlay';

describe('enrichRoundMeta', () => {
  it('copies roundId/nextActions and derives complete from the session', () => {
    const mid = enrichRoundMeta({ totalWin: 3 }, { roundId: 'r9', nextActions: ['free_spin'], session: { completed: false } });
    expect(mid).toEqual({ totalWin: 3, roundId: 'r9', nextActions: ['free_spin'], complete: false });
    const last = enrichRoundMeta({ totalWin: 7 }, { roundId: 'r9', nextActions: ['spin'], session: { completed: true } });
    expect(last.complete).toBe(true);
    // No session → complete (single-segment round).
    expect(enrichRoundMeta({ totalWin: 1 }, { roundId: 'r1' }).complete).toBe(true);
  });
});

describe('createSlotPlay', () => {
  it('plays, normalizes, fires onWin with totalWin, returns the normalized result', async () => {
    const play = vi.fn().mockResolvedValue({ raw: 7 });
    const normalize = vi.fn().mockReturnValue({ totalWin: 12 });
    const onWin = vi.fn();
    const slotPlay = createSlotPlay({ play, normalize, onWin });
    const out = await slotPlay.play('spin', 1);
    expect(play).toHaveBeenCalledWith({ action: 'spin', bet: 1, roundId: undefined });
    expect(normalize).toHaveBeenCalledWith({ raw: 7 });
    expect(onWin).toHaveBeenCalledWith(12);
    // A raw result with no session → the round is complete (single segment, no drain).
    expect(out).toEqual({ totalWin: 12, roundId: undefined, nextActions: undefined, complete: true });
  });

  it('works without onWin', async () => {
    const slotPlay = createSlotPlay({ play: async () => ({}), normalize: () => ({ totalWin: 0 }) });
    expect(await slotPlay.play('spin', 1)).toEqual({
      totalWin: 0,
      roundId: undefined,
      nextActions: undefined,
      complete: true,
    });
  });

  it('enriches the result with round-continuation metadata + threads roundId for a drain', async () => {
    // A mid-bonus segment: open session (not completed) + nextActions → not complete.
    const play = vi
      .fn()
      .mockResolvedValue({ roundId: 'r9', nextActions: ['free_spin'], session: { completed: false } });
    const slotPlay = createSlotPlay({ play, normalize: () => ({ totalWin: 3 }) });
    const seg = await slotPlay.play('spin', 2);
    expect(seg).toEqual({ totalWin: 3, roundId: 'r9', nextActions: ['free_spin'], complete: false });

    // The scene drains the next segment by replaying the SAME roundId.
    await slotPlay.play('free_spin', 2, 'r9');
    expect(play).toHaveBeenLastCalledWith({ action: 'free_spin', bet: 2, roundId: 'r9' });
  });

  it('marks a round complete when the session reports completed', async () => {
    const slotPlay = createSlotPlay({
      play: async () => ({ roundId: 'r9', nextActions: ['spin'], session: { completed: true } }),
      normalize: () => ({ totalWin: 50 }),
    });
    const last = await slotPlay.play('free_spin', 2, 'r9');
    expect(last.complete).toBe(true);
  });

  it('ack() forwards the most recent raw result to deps.ack', async () => {
    const ack = vi.fn();
    const slotPlay = createSlotPlay({
      play: async () => ({ roundId: 'r1' }),
      normalize: () => ({ totalWin: 0 }),
      ack,
    });
    // No play yet → ack is a no-op.
    slotPlay.ack();
    expect(ack).not.toHaveBeenCalled();

    await slotPlay.play('spin', 1);
    slotPlay.ack();
    expect(ack).toHaveBeenCalledWith({ roundId: 'r1' });
  });
});
