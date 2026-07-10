// examples/reel-lab/src/board.ts
import type {
  CellData,
  ReelSystemConfig,
  ReelStepData,
  TumbleStep,
} from '@energy8platform/game-engine/slot';
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

// ── ReelStep™ ────────────────────────────────────────────────────────────────

/**
 * Evaluate straight fixed lines (each row is a left-aligned payline, `wild` substitutes) on a
 * board. Returns the winning cells and, per reel, the set of distinct winning symbols on it —
 * the count of which is that reel's ReelStep shift.
 */
function evaluateLines(board: CellData[][], minLen = 3) {
  const rows = Math.min(...board.map((col) => col.length));
  const winning = new Set<string>(); // "col:row"
  const symbolsByReel = new Map<number, Set<string>>();
  const mark = (c: number, r: number, sym: string) => {
    winning.add(`${c}:${r}`);
    if (!symbolsByReel.has(c)) symbolsByReel.set(c, new Set());
    symbolsByReel.get(c)!.add(sym);
  };
  for (let r = 0; r < rows; r++) {
    // anchor = the first non-wild symbol on the line (a fully-wild run pays as wild)
    let anchor = board[0][r].symbol;
    for (let c = 0; c < board.length && anchor === 'wild'; c++) {
      const s = board[c][r].symbol;
      if (s && s !== 'wild') anchor = s;
    }
    if (!anchor) continue;
    let len = 0;
    for (let c = 0; c < board.length; c++) {
      const s = board[c][r].symbol;
      if (s === anchor || s === 'wild') len++;
      else break;
    }
    if (len >= minLen) for (let c = 0; c < len; c++) mark(c, r, board[c][r].symbol!);
  }
  return { winning, symbolsByReel };
}

/**
 * Build a ReelStep™ chain from a board: pay the winning lines, then scroll each reel DOWN by the
 * number of distinct winning symbols that played on it (0 = the reel stays put), fresh symbols
 * entering from the top. Re-evaluate the shifted board and repeat until no lines win.
 */
export function buildReelStepSteps(
  cfg: ReelSystemConfig,
  start: CellData[][],
  maxSteps = 6,
): ReelStepData[] {
  const steps: ReelStepData[] = [];
  let board = clone(start);
  for (let s = 0; s < maxSteps; s++) {
    const { winning, symbolsByReel } = evaluateLines(board);
    if (!winning.size) break;

    const winningCells = [...winning].map((k) => {
      const [col, row] = k.split(':').map(Number);
      return { col, row };
    });
    // N per reel = distinct winning symbols on it, clamped to the reel height
    const shifts = board.map((col, c) => Math.min(symbolsByReel.get(c)?.size ?? 0, col.length));

    // scroll each reel down by N: fresh symbols on top, the rest ride down
    const settled = board.map((col, c) => {
      const n = shifts[c];
      const rows = col.length;
      return Array.from({ length: rows }, (_, r) =>
        r < n ? { symbol: pick(PAY_IDS) as string | null } : { ...col[r - n] },
      );
    });

    steps.push({ winningCells, shifts, settledGrid: settled });
    board = settled;
  }
  return steps;
}

function clone(b: CellData[][]): CellData[][] {
  return b.map((col) => col.map((c) => ({ ...c })));
}
