import { useEffect, useRef, useState } from 'react';

/** `cols` reels, `rows[col]` cells in each — `reels1`'s own `grid.cols`/
 * `grid.rowsPerReel ?? Array(cols).fill(grid.rows)` (see `ReelsDocument`). */
export interface BoardShape {
  cols: number;
  rows: number[];
}

/** One saved cell: what the painter writes (a symbol id, `null` for empty), or
 * anything else `reels1`'s `Board` vocabulary allows — a number, or a
 * `{ symbol, …extras }` record (`@energy8engine/contracts`' `BoardCell`). */
export type BoardCellValue =
  string | number | { symbol?: unknown; [extra: string]: unknown } | null;

/** `board[col][row]`. */
export type BoardGrid = BoardCellValue[][];

/** The id a cell shows — a record's `symbol`; `null` (drawn empty) for anything without a string/number one. */
function symbolOf(cell: BoardCellValue): string | null {
  const symbol = typeof cell === 'object' && cell !== null ? cell.symbol : cell;
  return typeof symbol === 'string' || typeof symbol === 'number' ? String(symbol) : null;
}

function isGrid(board: unknown): board is BoardGrid {
  return Array.isArray(board) && board.every((col) => Array.isArray(col));
}

function shapeOf(board: BoardGrid): BoardShape {
  return { cols: board.length, rows: board.map((col) => col.length) };
}

function sameShape(a: BoardShape, b: BoardShape): boolean {
  return (
    a.cols === b.cols && a.rows.length === b.rows.length && a.rows.every((n, i) => n === b.rows[i])
  );
}

function emptyGrid(shape: BoardShape): BoardGrid {
  return Array.from({ length: shape.cols }, (_, c) => Array(shape.rows[c] ?? 0).fill(null));
}

/** The saved board reshaped onto `shape`: a kept cell stays wherever `[col][row]`
 * still exists in both, everything newly in range is `null`, and anything
 * past `shape.cols` (or past that column's own row count) is dropped —
 * covers padding a short board AND truncating a long one with the one rule. */
function fitBoard(board: BoardGrid, shape: BoardShape): BoardGrid {
  return Array.from({ length: shape.cols }, (_, c) => {
    const saved = board[c] ?? [];
    return Array.from({ length: shape.rows[c] ?? 0 }, (_, r) => saved[r] ?? null);
  });
}

/**
 * The Board section's body (`ReelsDocument`) — `reels1.board` painted cell
 * by cell, one column per reel, top row (index 0) first. Plain props, not
 * a `fieldOverrides` entry: `board` is `Schema.any()`, so no `Field` kind
 * would ever route here on its own.
 *
 * Rendering never writes (the caller may be mid-render with a board that
 * doesn't match `shape` — a grid resized after the board was painted, or a
 * hand-authored bundle). A saved board whose own shape (cols, and each
 * column's row count) differs from `shape` is drawn AS SAVED — its own
 * dimensions, not padded or cut to fit — behind a `board-mismatch` line;
 * only clicking `board-fit` reshapes it (`fitBoard`, above). No saved
 * board at all draws an all-empty grid at `shape`'s own dimensions
 * instead, and that never counts as a mismatch (there is nothing saved to
 * disagree with `shape`).
 *
 * A cell click opens a small popup — the known ids plus `empty` — right
 * under it (a labelled `role="group"`, plain buttons; not `role="menu"`,
 * which implies arrow-key/`menuitem` semantics this never offers); picking
 * one replaces just that cell in whatever grid is currently drawn and
 * hands the WHOLE grid to `onChange` (a `{ symbol, … }` record cell keeps
 * its other fields — only `symbol` changes). `board-clear` hands up
 * `undefined` outright — the section drops the `board` key entirely rather
 * than writing an empty grid, so a later `reels1.config` with no `board` at
 * all reads exactly as "no starting board", not "one cell of nothing". It
 * is disabled while nothing is saved, and `board-fit` while nothing
 * mismatches — neither would change anything.
 *
 * The popup closes three ways, same rule a native `<select>` follows:
 * picking an entry (`paint`, above), `Escape` (focus returns to the cell
 * that opened it — `triggerRef`), or a pointerdown anywhere outside this
 * component (`containerRef`) — a click on `board-clear`/`board-fit`, or on
 * a DIFFERENT cell, is still inside the painter, so those keep their own
 * click handlers rather than being swallowed by the outside-close check.
 */
export function BoardPainter({
  board,
  shape,
  known,
  onChange,
}: {
  board: unknown;
  shape: BoardShape;
  known: readonly { id: string; name: string }[];
  onChange: (next: BoardGrid | undefined) => void;
}) {
  const [open, setOpen] = useState<{ col: number; row: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const saved = isGrid(board) ? board : null;
  const mismatched = saved !== null && !sameShape(shapeOf(saved), shape);
  const grid = saved ?? emptyGrid(shape);

  // A record cell keeps its other fields (a multiplier, a sticky counter) —
  // only `symbol` is the painter's; any other cell becomes the plain id.
  const paint = (col: number, row: number, symbol: string | null) => {
    const repaint = (cell: BoardCellValue): BoardCellValue =>
      typeof cell === 'object' && cell !== null ? { ...cell, symbol } : symbol;
    onChange(
      grid.map((cells, c) =>
        c === col ? cells.map((cell, r) => (r === row ? repaint(cell) : cell)) : cells,
      ),
    );
    setOpen(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(null);
      triggerRef.current?.focus();
    };
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) return;
      setOpen(null);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  return (
    <div className="e8-board-painter" ref={containerRef}>
      <div className="e8-board-toolbar">
        <button
          type="button"
          data-testid="board-clear"
          disabled={board == null}
          onClick={() => onChange(undefined)}
        >
          clear
        </button>
        <button
          type="button"
          data-testid="board-fit"
          disabled={!mismatched}
          onClick={() => onChange(fitBoard(grid, shape))}
        >
          fit to grid
        </button>
      </div>
      {mismatched ? (
        <p className="e8-board-mismatch" data-testid="board-mismatch">
          the saved board doesn't match this grid's shape — shown as saved; fit to update it
        </p>
      ) : null}
      <div className="e8-board-grid">
        {grid.map((cells, col) => (
          <div className="e8-board-col" key={col}>
            {cells.map((cell, row) => {
              const symbol = symbolOf(cell);
              return (
                <div className="e8-board-cell-wrap" key={row}>
                  <button
                    type="button"
                    className="e8-board-cell"
                    data-testid={`board-cell-${col}-${row}`}
                    aria-label={`column ${col}, row ${row}: ${symbol ?? 'empty'}`}
                    aria-expanded={open?.col === col && open.row === row}
                    onClick={(e) => {
                      triggerRef.current = e.currentTarget;
                      setOpen((current) =>
                        current?.col === col && current.row === row ? null : { col, row },
                      );
                    }}
                  >
                    {symbol ?? '·'}
                  </button>
                  {open?.col === col && open.row === row ? (
                    <div
                      className="e8-board-menu"
                      role="group"
                      aria-label={`symbol for reel ${col} row ${row}`}
                    >
                      <button type="button" onClick={() => paint(col, row, null)}>
                        empty
                      </button>
                      {known.map((s) => (
                        <button key={s.id} type="button" onClick={() => paint(col, row, s.id)}>
                          {s.id}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
