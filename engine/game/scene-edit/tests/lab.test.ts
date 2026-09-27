import { describe, expect, it } from 'vitest';
import { clusterTumble, lineWin, randomBoard, scatterBoard, type Rand } from '../src/lab';

/** mulberry32 — a small seeded PRNG, deterministic across runs and platforms, good enough for a test. */
function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('randomBoard', () => {
  it('fills cols × rows, every cell from the symbol set', () => {
    const board = randomBoard({ cols: 5, rows: [3, 3, 3, 3, 3] }, ['1', '2', '3'], seeded(1));
    expect(board).toHaveLength(5);
    for (const col of board) {
      expect(col).toHaveLength(3);
      for (const cell of col) expect(['1', '2', '3']).toContain(cell);
    }
  });

  it('gives each reel its own shape height', () => {
    const board = randomBoard({ cols: 3, rows: [2, 3, 4] }, ['1'], seeded(2));
    expect(board.map((col) => col.length)).toEqual([2, 3, 4]);
  });
});

describe('scatterBoard', () => {
  it('drops the trigger on the first `threshold` reels once each, none past it', () => {
    const board = scatterBoard({ cols: 5, rows: [3, 3, 3, 3, 3] }, ['1', '2'], ['S'], 2, seeded(3));
    expect(board[0].filter((c) => c === 'S')).toHaveLength(1);
    expect(board[1].filter((c) => c === 'S')).toHaveLength(1);
    for (const col of board.slice(2)) expect(col).not.toContain('S');
  });

  it('skips a zero-height reel among the first `threshold` — no trigger, no length change', () => {
    // Reel 0 is legally empty (a ragged grid); it must stay length 0, not
    // grow to 1 from `board[0][row] = trigger` writing an out-of-range index.
    const board = scatterBoard({ cols: 3, rows: [0, 3, 3] }, ['1', '2'], ['S'], 2, seeded(7));
    expect(board[0]).toHaveLength(0);
    expect(board[1].filter((c) => c === 'S')).toHaveLength(1);
  });
});

describe('lineWin', () => {
  it('lights one full-width row shared by every reel, symbol from reel 0', () => {
    const rand = seeded(4);
    const board = randomBoard({ cols: 5, rows: [3, 3, 3, 3, 3] }, ['1', '2', '3'], rand);
    const step = lineWin(board, rand);
    expect(step.kind).toBe('revealWins');
    expect(step.total).toBe(0);
    expect(step.lines).toHaveLength(1);
    const line = step.lines[0];
    expect(line.count).toBe(5);
    expect(line.win).toBe(0);
    expect(line.positions).toHaveLength(5);
    const row = line.positions[0].row;
    expect(row).toBeLessThan(3);
    line.positions.forEach((p, col) => expect(p).toEqual({ col, row }));
    expect(line.symbol).toBe(board[0][row]);
  });

  it('bounds the row by the shortest reel', () => {
    const rand = seeded(5);
    // Row must always land in [0, 2) — reel 1 is the short one.
    const board = [['a', 'a', 'a'], ['a', 'a'], ['a', 'a', 'a']];
    for (let i = 0; i < 20; i++) {
      const step = lineWin(board, rand);
      expect(step.lines[0].positions[0].row).toBeLessThan(2);
    }
  });
});

describe('clusterTumble', () => {
  it('removes a 3-cell row on cols 0..2 and settles a fresh symbol on top; other cols untouched', () => {
    const rand = seeded(6);
    const symbols = ['1', '2', '3'];
    const board = randomBoard({ cols: 5, rows: [3, 3, 3, 3, 3] }, symbols, rand);
    const step = clusterTumble(board, symbols, rand);
    expect(step.kind).toBe('tumble');
    expect(step.winning).toEqual(step.removed);
    const row = step.removed[0].row;
    expect(step.removed).toEqual([{ col: 0, row }, { col: 1, row }, { col: 2, row }]);
    expect(step.fresh).toHaveLength(3);
    step.fresh.forEach((f, col) => {
      expect(f.col).toBe(col);
      expect(f.row).toBe(0);
      expect(symbols).toContain(f.symbol);
    });
    for (let col = 0; col < 3; col++) {
      const expected = [...board[col]];
      expected.splice(row, 1);
      expected.unshift(step.fresh[col].symbol as string);
      expect(step.settled[col]).toEqual(expected);
    }
    for (let col = 3; col < 5; col++) expect(step.settled[col]).toEqual(board[col]);
  });

  it('refuses fewer than 3 reels with a clear reason, rather than reading past the array', () => {
    const rand = seeded(8);
    const board = randomBoard({ cols: 2, rows: [3, 3] }, ['1', '2'], rand);
    expect(() => clusterTumble(board, ['1', '2'], rand)).toThrow('a tumble needs at least 3 reels');
  });

  it('refuses a height-0 reel among the first 3 with a clear reason', () => {
    const rand = seeded(9);
    const board = randomBoard({ cols: 3, rows: [3, 0, 3] }, ['1', '2'], rand);
    expect(() => clusterTumble(board, ['1', '2'], rand)).toThrow('a tumble needs a row on each of the first 3 reels');
  });
});
