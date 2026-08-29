import { describe, expect, it } from 'vitest';
import { expects, plan } from '../src/index';

const WON = {
  grid: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [1, 2, 3], [4, 5, 6]],
  win: 1.5,
  base_win: 0.5,
  lines: [{ line: 0, symbol: 1, count: 3, win: 0.5, positions: [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }] }],
  cascade_history: [{ grid: [[1]], removed: [{ col: 0, row: 0 }], win: 0.5 }],
};

const LOST = { ...WON, win: 0, base_win: 0, lines: [], cascade_history: [] };

describe('classic', () => {
  it('spins to the board, then reveals the base-game lines', () => {
    expect(plan(WON).map((s) => s.kind)).toEqual(['spinTo', 'revealWins']);
  });

  it('spins to the grid it was given', () => {
    expect(plan(WON)[0]).toEqual({ kind: 'spinTo', board: WON.grid });
  });

  it('reveals base_win, not the credited win', () => {
    const reveal = plan(WON)[1] as { total: number };
    expect(reveal.total).toBe(0.5);
  });

  it('passes the lines through unchanged, positions and all', () => {
    const reveal = plan(WON)[1] as { lines: unknown[] };
    expect(reveal.lines).toEqual(WON.lines);
  });

  it('stops after the spin when nothing won', () => {
    expect(plan(LOST).map((s) => s.kind)).toEqual(['spinTo']);
  });

  it('ignores cascade_history even when the math produced one', () => {
    expect(JSON.stringify(plan(WON))).not.toContain('cascade_history');
    expect(plan(WON)).toHaveLength(2);
  });

  it('declares the fields it needs and not the ones it does not', () => {
    expect(expects.fields).toEqual({ grid: 'grid', base_win: 'number', lines: 'list' });
  });
});
