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
