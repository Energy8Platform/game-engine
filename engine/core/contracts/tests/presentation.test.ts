import { describe, expect, it } from 'vitest';
import { isPresentationStep } from '../src/index';

describe('presentation steps', () => {
  it('accepts every step the two Slice-0 mechanics need', () => {
    const plan = [
      { kind: 'spinTo', board: [[1, 2, 3]] },
      { kind: 'revealWins', lines: [{ line: 0, symbols: 3, amount: 1.5 }] },
      { kind: 'remove', cells: [{ col: 0, row: 1 }] },
      { kind: 'refill', board: [[4, 5, 6]] },
      { kind: 'setMultiplier', value: 2 },
      { kind: 'wait', ms: 300 },
    ];
    for (const step of plan) expect(isPresentationStep(step)).toBe(true);
  });

  it('rejects a step with an unknown kind', () => {
    expect(isPresentationStep({ kind: 'explode', force: 9 })).toBe(false);
  });

  it('rejects a well-shaped kind whose payload is wrong', () => {
    expect(isPresentationStep({ kind: 'wait', ms: 'soon' })).toBe(false);
    expect(isPresentationStep({ kind: 'spinTo' })).toBe(false);
  });

  it('rejects non-objects instead of throwing', () => {
    for (const value of [null, undefined, 42, 'spinTo', []]) {
      expect(isPresentationStep(value)).toBe(false);
    }
  });
});
