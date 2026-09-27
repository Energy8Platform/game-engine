/**
 * The reel lab's test actions: synthetic spins, scatters, a win and a
 * tumble, built from nothing but the project's own symbol ids and a shape
 * — no mechanic, no server. Every function here is pure (a `Rand` is
 * handed in, never read from `Math.random` directly) so this file needs no
 * renderer and no `ctx` to test; `bootReels` (`./index.ts`) is the only
 * caller, and it is what wires a real board and a real symbol list to
 * these.
 *
 * The four actions correspond to the four board steps a reel presentation
 * can carry (`@energy8engine/contracts`'s `presentation.ts`):
 * `randomBoard`/`scatterBoard` build a `SpinToStep.board`, `lineWin` a
 * `RevealWinsStep`, `clusterTumble` a `TumbleStep` — deliberately the
 * SAME shapes a real mechanic's plan would carry, so the lab exercises the
 * board through its one real door rather than a shortcut of its own.
 */
import type { Cell, RevealWinsStep, TumbleStep } from '@energy8engine/contracts';

/** A source of numbers in `[0, 1)` — `Math.random` in production, a seeded generator in tests. */
export type Rand = () => number;

/** A board's shape: how many reels, and each one's height (a ragged grid has different heights). */
export interface Shape {
  cols: number;
  rows: number[];
}

/** A grid of `cols` columns, each `shape.rows[col]` cells tall, every cell a symbol picked from `symbols`. */
export function randomBoard(shape: Shape, symbols: readonly string[], rand: Rand): string[][] {
  return Array.from({ length: shape.cols }, (_, col) =>
    Array.from({ length: shape.rows[col] }, () => symbols[Math.floor(rand() * symbols.length)]),
  );
}

/**
 * A `randomBoard` seeded for anticipation: the first `threshold` reels each
 * get one `triggers` symbol dropped at a random row over an otherwise
 * random fill — the rest are plain `randomBoard`. Guaranteed: each of the
 * first `threshold` reels shows a trigger at least once (a reel of height
 * 0 among them is skipped — there is no row to drop one on). NOT
 * guaranteed: that the OTHER reels show none — a trigger id that also
 * happens to be one of the project's ordinary `symbols` can still land
 * there by chance, same as any other symbol would.
 */
export function scatterBoard(
  shape: Shape,
  symbols: readonly string[],
  triggers: readonly string[],
  threshold: number,
  rand: Rand,
): string[][] {
  const board = randomBoard(shape, symbols, rand);
  for (let col = 0; col < Math.min(threshold, shape.cols); col++) {
    if (shape.rows[col] === 0) continue; // no row to drop a trigger on — leave this reel empty, not length 1
    const row = Math.floor(rand() * shape.rows[col]);
    board[col][row] = triggers[Math.floor(rand() * triggers.length)];
  }
  return board;
}

/**
 * One full-width line at a random row every reel actually has (bounded by
 * the shortest reel) — a `revealWins` a real mechanic never emits (nothing
 * checks the row actually matches across reels), but the shape a board's
 * `revealWins` step needs to light cells and play a win is exactly this.
 */
export function lineWin(board: readonly (readonly string[])[], rand: Rand): RevealWinsStep {
  const cols = board.length;
  const minRows = Math.min(...board.map((col) => col.length));
  const row = Math.floor(rand() * minRows);
  const positions: Cell[] = board.map((_, col) => ({ col, row }));
  return { kind: 'revealWins', total: 0, lines: [{ line: 0, symbol: board[0][row], count: cols, win: 0, positions }] };
}

/**
 * A three-cell horizontal cluster on reels 0..2, tumbled: `winning`/`removed`
 * both name it, one fresh symbol drops into each of those reels' row 0, and
 * `settled` is what each reel reads after — the removed cell gone, whatever
 * was above it shifted down one, the fresh symbol on top. Reels past 2 are
 * untouched, carried into `settled` as they are.
 *
 * Throws (a plain `Error`, its `message` meant to reach the caller as-is —
 * `bootReels`' `runStep` turns it into `{ ok: false, reason: <message> }`)
 * when there is no row to cluster: fewer than 3 reels at all, the legal
 * shape a lab board can be handed but a cluster needs; or one of the first
 * 3 is height 0, which `board[col].length` would otherwise silently accept
 * and `Math.min` would happily bound the row to 0 for.
 */
export function clusterTumble(board: readonly (readonly string[])[], symbols: readonly string[], rand: Rand): TumbleStep {
  if (board.length < 3) throw new Error('a tumble needs at least 3 reels');
  const heights = [board[0].length, board[1].length, board[2].length];
  if (heights.some((h) => h === 0)) throw new Error('a tumble needs a row on each of the first 3 reels');
  const minRows = Math.min(...heights);
  const row = Math.floor(rand() * minRows);
  const cells: Cell[] = [0, 1, 2].map((col) => ({ col, row }));
  const fresh = [0, 1, 2].map((col) => ({ col, row: 0, symbol: symbols[Math.floor(rand() * symbols.length)] }));
  const settled = board.map((col, i) =>
    i < 3 ? [fresh[i].symbol, ...col.slice(0, row), ...col.slice(row + 1)] : [...col],
  );
  return { kind: 'tumble', winning: cells, removed: cells, fresh, settled };
}
