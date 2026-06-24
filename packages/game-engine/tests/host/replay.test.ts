import { describe, it, expect } from 'vitest';
import { resolveReplayBonusId } from '../../src/host/replay';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const model = { modeMap: { spin: 'BASE', buy_bonus: 'BONUS' } } as unknown as GameModel;

describe('resolveReplayBonusId', () => {
  it('reverses modeMap (Stake mode → action key)', () => {
    expect(resolveReplayBonusId(model, 'BONUS')).toBe('buy_bonus');
  });
  it('returns the base action id for the base mode', () => {
    expect(resolveReplayBonusId(model, 'BASE')).toBe('spin');
  });
  it('falls back to the raw mode string when unmapped', () => {
    expect(resolveReplayBonusId(model, 'WAT')).toBe('WAT');
  });
});
