import { describe, expect, it } from 'vitest';
import { KNOWN_STEP_KINDS, cellData, isPresentationStep } from '../src/index';

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
    // A bare string leaf is now a legal symbol NAME (not malformed — see
    // the widened-board tests below), so a genuinely bad leaf here is one
    // that is neither a number, a name, nor a `{ symbol }` record.
    expect(isPresentationStep({ kind: 'refill', board: [[1, true, 3]] })).toBe(false);
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

  // A real game's math emits symbol NAMES, not just numeric ids, and
  // sometimes a per-cell record carrying extras (a multiplier, a sticky
  // counter). `Board`'s leaves widened to match — a `spinTo`/`refill` must
  // still validate.
  it('accepts a spinTo/refill board whose cells are symbol names', () => {
    expect(isPresentationStep({ kind: 'spinTo', board: [['ROCK', 'PAPER', 'SCISSORS']] })).toBe(
      true,
    );
    expect(isPresentationStep({ kind: 'refill', board: [['ROCK']] })).toBe(true);
  });

  it('accepts a board whose cells are per-cell records', () => {
    expect(
      isPresentationStep({
        kind: 'spinTo',
        board: [[{ symbol: 'ORB', multiplier: 5 }, { symbol: 1 }, { symbol: null }]],
      }),
    ).toBe(true);
  });

  it('accepts a mix of numbers, names and records on the same board', () => {
    expect(
      isPresentationStep({
        kind: 'refill',
        board: [[1, 'ROCK', { symbol: 'ORB', bonus: 2 }]],
      }),
    ).toBe(true);
  });

  it('rejects a board whose record cell has a non-symbol-shaped `symbol`', () => {
    expect(isPresentationStep({ kind: 'spinTo', board: [[{ symbol: {} }]] })).toBe(false);
    expect(isPresentationStep({ kind: 'spinTo', board: [[{ symbol: [1] }]] })).toBe(false);
  });

  // Slice 25: `tumble` — the fifth known kind. One cascade round the reels
  // board plays through the legacy `TumbleController` in a single call,
  // instead of `remove` + `refill` (= `setBoard` twice, no gravity).
  const TUMBLE = () => ({
    kind: 'tumble',
    winning: [{ col: 0, row: 0 }],
    removed: [{ col: 0, row: 0 }],
    drops: [{ col: 0, fromRow: 1, toRow: 2 }],
    fresh: [{ col: 0, row: 0, symbol: 'ROCK' }],
    settled: [['ROCK', 'PAPER', 'SCISSORS']],
  });

  it('tumble is one of the known kinds', () => {
    expect(KNOWN_STEP_KINDS).toContain('tumble');
  });

  it('accepts a tumble step carrying every field', () => {
    expect(isPresentationStep(TUMBLE())).toBe(true);
  });

  it('accepts a tumble with no drops — the controller derives gravity', () => {
    const { drops: _drops, ...rest } = TUMBLE();
    expect(isPresentationStep(rest)).toBe(true);
  });

  it('accepts a tumble whose fresh symbols are numbers or per-cell records', () => {
    expect(
      isPresentationStep({
        ...TUMBLE(),
        fresh: [
          { col: 0, row: 0, symbol: 7 },
          { col: 0, row: 1, symbol: { symbol: 'ORB', multiplier: 5 } },
        ],
      }),
    ).toBe(true);
  });

  it('rejects a tumble missing settled, fresh, winning or removed', () => {
    for (const field of ['settled', 'fresh', 'winning', 'removed'] as const) {
      const step = TUMBLE() as Record<string, unknown>;
      delete step[field];
      expect(isPresentationStep(step), `a tumble with no ${field}`).toBe(false);
    }
  });

  it('rejects a tumble whose settled is not a board', () => {
    expect(isPresentationStep({ ...TUMBLE(), settled: [[1, true]] })).toBe(false);
  });

  it('rejects a tumble whose fresh cell has no position or no symbol', () => {
    expect(isPresentationStep({ ...TUMBLE(), fresh: [{ col: 0, symbol: 'ROCK' }] })).toBe(false);
    expect(isPresentationStep({ ...TUMBLE(), fresh: [{ col: 0, row: 0 }] })).toBe(false);
    expect(isPresentationStep({ ...TUMBLE(), fresh: [{ col: 0, row: 0, symbol: {} }] })).toBe(
      false,
    );
  });

  it('rejects a tumble whose drops are malformed', () => {
    expect(isPresentationStep({ ...TUMBLE(), drops: [{ col: 0, fromRow: 1 }] })).toBe(false);
    expect(isPresentationStep({ ...TUMBLE(), drops: 'gravity' })).toBe(false);
  });

  it('accepts a revealWins line whose symbol is a name, not just a number', () => {
    expect(
      isPresentationStep({
        kind: 'revealWins',
        total: 2,
        lines: [{ line: 0, symbol: 'ROCK', count: 3, win: 2, positions: [{ col: 0, row: 0 }] }],
      }),
    ).toBe(true);
  });
});

describe('cellData', () => {
  it('a bare number becomes a stringified symbol', () => {
    expect(cellData(7)).toEqual({ symbol: '7' });
  });

  it('a bare name passes through as the symbol', () => {
    expect(cellData('ROCK')).toEqual({ symbol: 'ROCK' });
  });

  it('a record: symbol normalized to a string, extras spread through', () => {
    expect(cellData({ symbol: 'ORB', multiplier: 5 })).toEqual({ symbol: 'ORB', multiplier: 5 });
    expect(cellData({ symbol: 3, bonus: 2 })).toEqual({ symbol: '3', bonus: 2 });
  });

  it('a record with a null symbol stays null, extras still spread', () => {
    expect(cellData({ symbol: null, sticky: { remaining: 2 } })).toEqual({
      symbol: null,
      sticky: { remaining: 2 },
    });
  });
});
