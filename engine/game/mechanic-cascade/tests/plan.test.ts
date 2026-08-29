import { describe, expect, it } from 'vitest';
import { expects, plan } from '../src/index';

const CHAIN = {
  grid: [[1, 2, 3]],
  win: 1.5,
  base_win: 0.5,
  lines: [],
  cascade_history: [
    { grid: [[1, 2, 3]], removed: [{ col: 0, row: 0 }], win: 0.5 },
    { grid: [[7, 2, 3]], removed: [{ col: 0, row: 1 }], win: 1.0 },
    { grid: [[7, 8, 3]], removed: [], win: 0 },
  ],
};

describe('cascade', () => {
  it('spins to the first board, then reveals and collapses each paying round', () => {
    expect(plan(CHAIN).map((s) => s.kind)).toEqual([
      'spinTo', 'revealWins', 'remove', 'refill',
      'revealWins', 'remove', 'refill',
    ]);
  });

  it('spins to the first round board', () => {
    expect(plan(CHAIN)[0]).toEqual({ kind: 'spinTo', board: CHAIN.cascade_history[0].grid });
  });

  it("reveals each round's own win, with no line breakdown to give", () => {
    const reveals = plan(CHAIN).filter((s) => s.kind === 'revealWins') as { total: number; lines: unknown[] }[];
    expect(reveals.map((r) => r.total)).toEqual([0.5, 1.0]);
    expect(reveals.every((r) => r.lines.length === 0)).toBe(true);
  });

  it('removes the cells that round cleared', () => {
    const removes = plan(CHAIN).filter((s) => s.kind === 'remove');
    expect(removes[0]).toEqual({ kind: 'remove', cells: [{ col: 0, row: 0 }] });
  });

  it('refills with the NEXT round board, not the one just cleared', () => {
    const refills = plan(CHAIN).filter((s) => s.kind === 'refill') as { board: number[][] }[];
    expect(refills[0].board).toEqual(CHAIN.cascade_history[1].grid);
    expect(refills[1].board).toEqual(CHAIN.cascade_history[2].grid);
  });

  it('stops at the first round that cleared nothing', () => {
    const one = { ...CHAIN, cascade_history: [{ grid: [[1]], removed: [], win: 0 }] };
    expect(plan(one).map((s) => s.kind)).toEqual(['spinTo']);
  });

  it('declares that it needs the chain', () => {
    expect(expects.fields).toEqual({ cascade_history: 'list' });
  });
});
