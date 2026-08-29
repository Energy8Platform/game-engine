import { describe, expect, it } from 'vitest';
import { isPresentationStep } from '../src/index';

describe('presentation steps', () => {
  it('accepts every step the two Slice-0 mechanics need', () => {
    const plan = [
      { kind: 'spinTo', board: [[1, 2, 3]] },
      {
        kind: 'revealWins',
        total: 1.5,
        lines: [{ line: 0, symbol: 3, count: 3, win: 1.5, positions: [{ col: 0, row: 0 }] }],
      },
      { kind: 'remove', cells: [{ col: 0, row: 1 }] },
      { kind: 'refill', board: [[4, 5, 6]] },
      { kind: 'setMultiplier', value: 2 },
      { kind: 'wait', ms: 300 },
    ];
    for (const step of plan) expect(isPresentationStep(step)).toBe(true);
  });

  it('accepts a revealWins step with an empty breakdown, when the math gives none', () => {
    expect(isPresentationStep({ kind: 'revealWins', total: 4, lines: [] })).toBe(true);
  });

  it('rejects a step with an unknown kind', () => {
    expect(isPresentationStep({ kind: 'explode', force: 9 })).toBe(false);
  });

  it('rejects a well-shaped kind whose payload is wrong', () => {
    expect(isPresentationStep({ kind: 'wait', ms: 'soon' })).toBe(false);
    expect(isPresentationStep({ kind: 'spinTo' })).toBe(false);
  });

  it('rejects a revealWins step missing the reveal total', () => {
    expect(
      isPresentationStep({
        kind: 'revealWins',
        lines: [{ line: 0, symbol: 3, count: 3, win: 1.5, positions: [{ col: 0, row: 0 }] }],
      }),
    ).toBe(false);
  });

  it('rejects a revealWins line missing positions', () => {
    expect(
      isPresentationStep({
        kind: 'revealWins',
        total: 1.5,
        lines: [{ line: 0, symbol: 3, count: 3, win: 1.5 }],
      }),
    ).toBe(false);
  });

  it('rejects a revealWins line whose positions contain a malformed cell', () => {
    expect(
      isPresentationStep({
        kind: 'revealWins',
        total: 1.5,
        lines: [
          { line: 0, symbol: 3, count: 3, win: 1.5, positions: [{ col: 0 }] },
        ],
      }),
    ).toBe(false);
  });

  it('rejects a remove step whose cells are malformed', () => {
    expect(isPresentationStep({ kind: 'remove', cells: [{ col: 0 }] })).toBe(false);
    expect(isPresentationStep({ kind: 'remove', cells: 'all' })).toBe(false);
  });

  it('rejects a refill step with no board or a malformed one', () => {
    expect(isPresentationStep({ kind: 'refill' })).toBe(false);
    expect(isPresentationStep({ kind: 'refill', board: [[1, 'x', 3]] })).toBe(false);
  });

  it('rejects a setMultiplier step with a missing or non-numeric value', () => {
    expect(isPresentationStep({ kind: 'setMultiplier' })).toBe(false);
    expect(isPresentationStep({ kind: 'setMultiplier', value: '2x' })).toBe(false);
  });

  it('rejects non-objects instead of throwing', () => {
    for (const value of [null, undefined, 42, 'spinTo', []]) {
      expect(isPresentationStep(value)).toBe(false);
    }
  });
});
