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
    ];
    for (const step of plan) expect(isPresentationStep(step)).toBe(true);
  });

  it('accepts a revealWins step with an empty breakdown, when the math gives none', () => {
    expect(isPresentationStep({ kind: 'revealWins', total: 4, lines: [] })).toBe(true);
  });

  // Task 7: the vocabulary stopped being closed — a kind outside the four
  // is a plugin's to define, not this function's to reject. Whether
  // anything can actually RUN it is a different question, answered by a
  // `BoardStepRegistry` (`@energy8engine/play-loop`), not by this check.
  it('accepts a step whose kind is not one of the four', () => {
    expect(isPresentationStep({ kind: 'explode', force: 9 })).toBe(true);
  });

  it('rejects a step whose kind is not even a string', () => {
    expect(isPresentationStep({ kind: 123 })).toBe(false);
    expect(isPresentationStep({})).toBe(false);
  });

  it('rejects a well-shaped kind whose payload is wrong', () => {
    expect(isPresentationStep({ kind: 'spinTo' })).toBe(false);
    expect(isPresentationStep({ kind: 'spinTo', board: 'nope' })).toBe(false);
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
        lines: [{ line: 0, symbol: 3, count: 3, win: 1.5, positions: [{ col: 0 }] }],
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

  // `setMultiplier` and `wait` were two of the six known kinds and are
  // gone (see `KNOWN_STEP_KINDS`). They are not rejected now — they are
  // simply not KNOWN, so a step naming either reads as any other plugin
  // kind would: shaped like a step, with nothing here that can run it.
  it('treats the two removed kinds as any other unknown kind, not as errors', () => {
    expect(isPresentationStep({ kind: 'setMultiplier', value: 2 })).toBe(true);
    expect(isPresentationStep({ kind: 'wait', ms: 'soon' })).toBe(true);
  });

  it('rejects non-objects instead of throwing', () => {
    for (const value of [null, undefined, 42, 'spinTo', []]) {
      expect(isPresentationStep(value)).toBe(false);
    }
  });
});
