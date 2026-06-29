// examples/reel-lab/src/board.ts
import type { CellData, ReelSystemConfig, TumbleStep } from '@energy8platform/game-engine/slot';
import { effectiveRowsPerReel } from '@energy8platform/game-engine/slot';
import { PAY_IDS } from './symbols';

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: T[]): T => a[rnd(a.length)];

export function rowsFor(cfg: ReelSystemConfig): number[] {
  return effectiveRowsPerReel(cfg.grid);
}

/** A fresh random board (board[col][row]). */
export function randomBoard(cfg: ReelSystemConfig, ids: string[] = PAY_IDS): CellData[][] {
  const rows = rowsFor(cfg);
  return Array.from({ length: cfg.grid.cols }, (_, c) =>
    Array.from({ length: rows[c] }, () => ({ symbol: pick(ids) as string | null })),
  );
}

/** A board seeded with N scatter symbols to exercise anticipation. */
export function scatterBoard(cfg: ReelSystemConfig, scatters: number): CellData[][] {
  const board = randomBoard(cfg);
  let placed = 0;
  // place scatters on the leftmost reels so trailing-reel anticipation arms
  for (let c = 0; c < cfg.grid.cols && placed < scatters; c++) {
    const r = rnd(board[c].length);
    board[c][r] = { symbol: 'scatter' };
    placed++;
  }
  return board;
}

/**
 * Build up to `maxSteps` cascade steps from a board: the most-frequent symbol that meets the
 * threshold wins, is removed, survivors fall, and new random symbols refill from the top.
 */
export function buildCascadeSteps(
  cfg: ReelSystemConfig,
  start: CellData[][],
  threshold = 4,
  maxSteps = 4,
): TumbleStep[] {
  const steps: TumbleStep[] = [];
  let board = clone(start);
  for (let s = 0; s < maxSteps; s++) {
    const counts = new Map<string, { col: number; row: number }[]>();
    for (let c = 0; c < board.length; c++)
      for (let r = 0; r < board[c].length; r++) {
        const sym = board[c][r].symbol;
        if (!sym) continue;
        if (!counts.has(sym)) counts.set(sym, []);
        counts.get(sym)!.push({ col: c, row: r });
      }
    let best: { col: number; row: number }[] | null = null;
    for (const cells of counts.values())
      if (cells.length >= threshold && (!best || cells.length > best.length)) best = cells;
    if (!best) break;

    const winning = best;
    const removed = best.slice();
    const removedByCol = new Map<number, Set<number>>();
    for (const cell of removed) {
      if (!removedByCol.has(cell.col)) removedByCol.set(cell.col, new Set());
      removedByCol.get(cell.col)!.add(cell.row);
    }
    const drops: TumbleStep['drops'] = [];
    const newCells: TumbleStep['newCells'] = [];
    const settled = clone(board);
    for (let c = 0; c < board.length; c++) {
      const rows = board[c].length;
      const removedSet = removedByCol.get(c) ?? new Set<number>();
      const survivors: string[] = [];
      const survivorRows: number[] = [];
      for (let r = 0; r < rows; r++)
        if (!removedSet.has(r)) {
          survivors.push(board[c][r].symbol!);
          survivorRows.push(r);
        }
      const newCount = rows - survivors.length;
      // new cells occupy the top
      for (let r = 0; r < newCount; r++) {
        const sym = pick(PAY_IDS);
        settled[c][r] = { symbol: sym };
        newCells.push({ col: c, row: r, symbol: sym });
      }
      // survivors fall to the bottom keeping order
      survivors.forEach((sym, i) => {
        const toRow = newCount + i;
        settled[c][toRow] = { symbol: sym };
        if (survivorRows[i] !== toRow) drops.push({ col: c, fromRow: survivorRows[i], toRow });
      });
    }
    steps.push({
      winningCells: winning,
      removedCells: removed,
      drops,
      newCells,
      settledGrid: settled,
    });
    board = settled;
  }
  return steps;
}

function clone(b: CellData[][]): CellData[][] {
  return b.map((col) => col.map((c) => ({ ...c })));
}
