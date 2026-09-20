import { describe, expect, it, vi } from 'vitest';
import { boardFromReelSystem, type CellLike, type LegacyReelSystem } from '../src/index';

/**
 * A fake `LegacyReelSystem` recording exactly what was measured in Step 1:
 * `spin`/`setBoard` take a `CellData[][]`, `grid.getCell(col,row)` returns
 * an object with `setState`/`setData`/`playWin`. No pixi, no ticker — the
 * point of the fake is that this suite never needs either.
 */
function fakeReelSystem(initialBoard: LegacyReelSystem['board'] = []) {
  const calls: unknown[] = [];
  const cells = new Map<string, ReturnType<typeof makeCell>>();
  // Plain mutable local, exposed through a GETTER on `reelSystem.board` below — faithful to the
  // fact that in the REAL ReelSystem it changes ONLY when setBoard/spin/cascade/reelStep run,
  // never as a side effect of `grid.getCell(...).setData(...)`. That gap is exactly what
  // remove()'s re-sync exists to close.
  let board = initialBoard;

  function makeCell(col: number, row: number): CellLike {
    return {
      setState: vi.fn((state) => calls.push(['setState', col, row, state])),
      setData: vi.fn((data) => calls.push(['setData', col, row, data])),
      playWin: vi.fn(async () => {
        calls.push(['playWin', col, row]);
      }),
      // What a `SymbolCell` exposes: the mounted symbol view (`bind` is the
      // symbols package's `$cell.<field>` resolution) and the data it last took,
      // read straight off the board the way the real cell's getter does.
      view: { bind: vi.fn() } as unknown as CellLike['view'],
      get data() {
        return board[col]?.[row] ?? { symbol: null };
      },
    };
  }

  const getCell = vi.fn((col: number, row: number) => {
    const key = `${col}:${row}`;
    if (!cells.has(key)) cells.set(key, makeCell(col, row));
    return cells.get(key)!;
  });

  const spin = vi.fn(async (target: unknown) => {
    calls.push(['spin', target]);
  });
  const setBoard = vi.fn((target: LegacyReelSystem['board']) => {
    calls.push(['setBoard', target]);
    board = target;
  });

  const reelSystem: LegacyReelSystem = {
    grid: {
      getCell,
      get cols() {
        return board.length;
      },
      get rows() {
        return board[0]?.length ?? 0;
      },
    },
    get board() {
      return board;
    },
    spin,
    setBoard,
  };

  return {
    reelSystem,
    calls,
    spin,
    setBoard,
    getCell,
    cellAt: (c: number, r: number) => cells.get(`${c}:${r}`),
    bindAt: (c: number, r: number) =>
      cells.get(`${c}:${r}`)?.view?.bind as ReturnType<typeof vi.fn>,
  };
}

describe('boardFromReelSystem: spinTo', () => {
  it('calls the measured reelSystem.spin with the board converted to CellData[][] (String(id) symbols)', async () => {
    const { reelSystem, spin, setBoard } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.spinTo({
      kind: 'spinTo',
      board: [
        [1, 2],
        [3, 4],
      ],
    });

    expect(spin).toHaveBeenCalledTimes(1);
    expect(spin).toHaveBeenCalledWith([
      [{ symbol: '1' }, { symbol: '2' }],
      [{ symbol: '3' }, { symbol: '4' }],
    ]);
    // no repaint was asked for: the op's own settle re-sets nothing
    expect(setBoard).not.toHaveBeenCalled();
  });

  // A real game's math emits symbol NAMES ('ROCK'), not just numeric ids —
  // the step vocabulary's `Board` widened to carry them, and `toCellBoard`
  // now goes through `@energy8engine/contracts`' `cellData()` instead of a
  // bare `String(id)`.
  it('resolves a name board straight through — no numeric conversion for a symbol name', async () => {
    const { reelSystem, spin } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.spinTo({ kind: 'spinTo', board: [['ROCK', 'PAPER']] });

    expect(spin).toHaveBeenCalledWith([[{ symbol: 'ROCK' }, { symbol: 'PAPER' }]]);
  });

  it('a record cell: symbol normalized, extras (multiplier, bonus, …) reach setData/spin untouched', async () => {
    const { reelSystem, spin } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.spinTo({
      kind: 'spinTo',
      board: [[{ symbol: 'ORB', multiplier: 5 }, { symbol: 2, bonus: 1 }]],
    });

    expect(spin).toHaveBeenCalledWith([[{ symbol: 'ORB', multiplier: 5 }, { symbol: '2', bonus: 1 }]]);
  });
});

describe('boardFromReelSystem: refill', () => {
  it('calls the measured reelSystem.setBoard with the same conversion as spinTo', async () => {
    const { reelSystem, setBoard, spin } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.refill({ kind: 'refill', board: [[5]] });

    expect(setBoard).toHaveBeenCalledTimes(1);
    expect(setBoard).toHaveBeenCalledWith([[{ symbol: '5' }]]);
    // refill must not be routed through spin() — Task 7's review flagged these as
    // genuinely different legacy calls (initial land vs. post-cascade drop).
    expect(spin).not.toHaveBeenCalled();
  });
});

describe('boardFromReelSystem: remove', () => {
  const threeByTwo = () => [
    [{ symbol: 'a' }, { symbol: 'b' }],
    [{ symbol: 'c' }, { symbol: 'd' }],
    [{ symbol: 'e' }, { symbol: 'f' }],
  ];

  it('marks each cell removed and clears its symbol, via grid.getCell', async () => {
    const { reelSystem, getCell, cellAt } = fakeReelSystem(threeByTwo());
    const board = boardFromReelSystem(reelSystem);

    await board.remove({
      kind: 'remove',
      cells: [
        { col: 0, row: 1 },
        { col: 2, row: 0 },
      ],
    });

    expect(getCell).toHaveBeenCalledWith(0, 1);
    expect(getCell).toHaveBeenCalledWith(2, 0);
    expect(cellAt(0, 1)!.setState).toHaveBeenCalledWith({ removed: true });
    expect(cellAt(0, 1)!.setData).toHaveBeenCalledWith({ symbol: null });
    expect(cellAt(2, 0)!.setState).toHaveBeenCalledWith({ removed: true });
    expect(cellAt(2, 0)!.setData).toHaveBeenCalledWith({ symbol: null });
  });

  it('re-syncs reelSystem.board via setBoard with ONLY the removed cells nulled (fix: remove() used to leave it stale)', async () => {
    const { reelSystem, setBoard } = fakeReelSystem(threeByTwo());
    const board = boardFromReelSystem(reelSystem);

    await board.remove({
      kind: 'remove',
      cells: [
        { col: 0, row: 1 },
        { col: 2, row: 0 },
      ],
    });

    expect(setBoard).toHaveBeenCalledTimes(1);
    expect(setBoard).toHaveBeenCalledWith([
      [{ symbol: 'a' }, { symbol: null }],
      [{ symbol: 'c' }, { symbol: 'd' }],
      [{ symbol: null }, { symbol: 'f' }],
    ]);
    // and reelSystem.board itself now reads the nulled snapshot back — not the stale one
    expect(reelSystem.board).toEqual([
      [{ symbol: 'a' }, { symbol: null }],
      [{ symbol: 'c' }, { symbol: 'd' }],
      [{ symbol: null }, { symbol: 'f' }],
    ]);
  });

  it('touches nothing when there are no cells to remove', async () => {
    const { reelSystem, getCell, setBoard } = fakeReelSystem(threeByTwo());
    const board = boardFromReelSystem(reelSystem);

    await board.remove({ kind: 'remove', cells: [] });

    expect(getCell).not.toHaveBeenCalled();
    expect(setBoard).not.toHaveBeenCalled();
  });

  it("keeps a surviving cell's extras (multiplier, bonus, …) through the re-sync snapshot", async () => {
    const withExtras = () => [
      [{ symbol: 'a', multiplier: 3 }, { symbol: 'b', bonus: 1 }],
      [{ symbol: 'c', sticky: { remaining: 2 } }, { symbol: 'd' }],
    ];
    const { reelSystem, setBoard } = fakeReelSystem(withExtras());
    const board = boardFromReelSystem(reelSystem);

    await board.remove({ kind: 'remove', cells: [{ col: 0, row: 1 }] });

    // the removed cell is nulled with nothing else — same as before this
    // task; every OTHER cell's extras survive the snapshot spread untouched.
    expect(setBoard).toHaveBeenCalledWith([
      [{ symbol: 'a', multiplier: 3 }, { symbol: null }],
      [{ symbol: 'c', sticky: { remaining: 2 } }, { symbol: 'd' }],
    ]);
  });
});

describe('boardFromReelSystem: revealWins', () => {
  it('sets every position across every line winning and plays its win animation', async () => {
    const { reelSystem, getCell, cellAt } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.revealWins({
      kind: 'revealWins',
      total: 8,
      lines: [
        {
          line: 0,
          symbol: 1,
          count: 3,
          win: 5,
          positions: [
            { col: 0, row: 0 },
            { col: 1, row: 0 },
          ],
        },
        { line: 1, symbol: 2, count: 2, win: 3, positions: [{ col: 0, row: 1 }] },
      ],
    });

    // all three positions across BOTH lines were reached — a mutant that only
    // looked at lines[0] would leave (0,1) untouched.
    expect(getCell).toHaveBeenCalledTimes(3);
    for (const [c, r] of [
      [0, 0],
      [1, 0],
      [0, 1],
    ] as const) {
      expect(cellAt(c, r)!.setState).toHaveBeenCalledWith({ winning: true });
      expect(cellAt(c, r)!.playWin).toHaveBeenCalledTimes(1);
    }
  });

  it('resolves cleanly with an empty line list (a reveal with no per-line breakdown)', async () => {
    const { reelSystem, getCell } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await expect(
      board.revealWins({ kind: 'revealWins', total: 4, lines: [] }),
    ).resolves.toBeUndefined();
    expect(getCell).not.toHaveBeenCalled();
  });

  it("does not resolve until every cell's playWin() has settled (executePlan awaits this before the next step)", async () => {
    const { reelSystem, getCell } = fakeReelSystem();
    let releasePlayWin: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releasePlayWin = resolve;
    });
    getCell.mockImplementation(() => ({
      setState: vi.fn(),
      setData: vi.fn(),
      playWin: vi.fn(() => gate),
      view: null,
      data: { symbol: null },
    }));
    const board = boardFromReelSystem(reelSystem);

    let settled = false;
    const result = board
      .revealWins({
        kind: 'revealWins',
        total: 1,
        lines: [{ line: 0, symbol: 1, count: 1, win: 1, positions: [{ col: 0, row: 0 }] }],
      })
      .then(() => {
        settled = true;
      });

    // give the microtask queue every chance to settle `result` on its own — it must not,
    // because `gate` (what `playWin()` returned) is still pending.
    await Promise.race([result, new Promise((r) => setTimeout(r, 20))]);
    expect(settled).toBe(false);

    releasePlayWin();
    await result;
    expect(settled).toBe(true);
  });
});

describe('boardFromReelSystem: repaint / cellSize', () => {
  it('repaint re-sets the current board — a setBoard call with the board unchanged', async () => {
    const initial = [[{ symbol: 'a' }], [{ symbol: 'b' }]];
    const { reelSystem, setBoard } = fakeReelSystem(initial);
    const board = boardFromReelSystem(reelSystem);

    board.repaint();

    expect(setBoard).toHaveBeenCalledTimes(1);
    expect(setBoard).toHaveBeenCalledWith(initial);
  });

  it('repaint during a spin is deferred: no setBoard while it is in flight, exactly one once it lands', async () => {
    const { reelSystem, spin, setBoard } = fakeReelSystem([[{ symbol: 'a' }]]);
    let land!: () => void;
    spin.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    const board = boardFromReelSystem(reelSystem);

    const spinning = board.spinTo({ kind: 'spinTo', board: [[2]] });
    board.repaint();
    board.repaint();
    await new Promise((r) => setTimeout(r, 5));
    expect(setBoard).not.toHaveBeenCalled();

    land();
    await spinning;
    expect(setBoard).toHaveBeenCalledTimes(1);
    expect(setBoard).toHaveBeenCalledWith(reelSystem.board);

    // idle again: immediate, and nothing left pending
    board.repaint();
    expect(setBoard).toHaveBeenCalledTimes(2);
  });

  it('cellSize reads grid.cellSize off the fake, square', () => {
    const { reelSystem } = fakeReelSystem();
    const board = boardFromReelSystem({ ...reelSystem, config: { grid: { cellSize: 64 } } });

    expect(board.cellSize).toEqual({ width: 64, height: 64 });
  });

  it('cellSize falls back to 96 when the fake has no config', () => {
    const { reelSystem } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    expect(board.cellSize).toEqual({ width: 96, height: 96 });
  });
});

/**
 * Slice 24: a symbol state's props may read the cell's own data
 * (`'$cell.multiplier'`). The board is what hands it over — after the op
 * that seated the data, never during it.
 */
describe('boardFromReelSystem: $cell bindings', () => {
  const twoByOne = () => [[{ symbol: 'a', multiplier: 2 }], [{ symbol: 'b' }]];

  it('binds every cell to its own data once a spin has landed', async () => {
    const { reelSystem, bindAt } = fakeReelSystem(twoByOne());
    const board = boardFromReelSystem(reelSystem);

    await board.spinTo({ kind: 'spinTo', board: [['a'], ['b']] });

    expect(bindAt(0, 0)).toHaveBeenCalledWith({ symbol: 'a', multiplier: 2 });
    expect(bindAt(1, 0)).toHaveBeenCalledWith({ symbol: 'b' });
  });

  it('binds every cell after a refill, against the board that refill just set', async () => {
    const { reelSystem, bindAt } = fakeReelSystem([[{ symbol: 'x' }]]);
    const board = boardFromReelSystem(reelSystem);

    await board.refill({ kind: 'refill', board: [[{ symbol: 'ORB', multiplier: 5 }]] });

    expect(bindAt(0, 0)).toHaveBeenCalledWith({ symbol: 'ORB', multiplier: 5 });
  });

  it('binds on a repaint — and a repaint deferred behind a spin binds only once it lands', async () => {
    const { reelSystem, spin, getCell, bindAt } = fakeReelSystem(twoByOne());
    let land!: () => void;
    spin.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    const board = boardFromReelSystem(reelSystem);

    const spinning = board.spinTo({ kind: 'spinTo', board: [['a'], ['b']] });
    board.repaint();
    await new Promise((r) => setTimeout(r, 5));
    // nothing was even looked up, let alone bound, while the spin is in flight
    expect(getCell).not.toHaveBeenCalled();

    land();
    await spinning;
    expect(bindAt(0, 0)).toHaveBeenLastCalledWith({ symbol: 'a', multiplier: 2 });

    // idle: a repaint binds straight away
    (bindAt(0, 0) as ReturnType<typeof vi.fn>).mockClear();
    board.repaint();
    expect(bindAt(0, 0)).toHaveBeenCalledWith({ symbol: 'a', multiplier: 2 });
  });

  it('an empty cell (no view) and a view with no bind are skipped, not thrown over', async () => {
    const { reelSystem, getCell } = fakeReelSystem([[{ symbol: null }], [{ symbol: 'b' }]]);
    getCell.mockImplementation((col: number) =>
      col === 0
        ? ({
            setState: vi.fn(),
            setData: vi.fn(),
            playWin: vi.fn(),
            view: null,
            data: { symbol: null },
          } as unknown as CellLike)
        : ({
            setState: vi.fn(),
            setData: vi.fn(),
            playWin: vi.fn(),
            view: {} as CellLike['view'],
            data: { symbol: 'b' },
          } as unknown as CellLike),
    );
    const board = boardFromReelSystem(reelSystem);

    await expect(
      board.refill({ kind: 'refill', board: [[{ symbol: null }], ['b']] }),
    ).resolves.toBeUndefined();
  });

  it('a ragged grid — no cell past a short reel — is walked, not thrown over', () => {
    // `cols`/`rows` are the WIDEST extent, so the walk asks reel 1 for a row
    // it does not have; the real `ReelGrid` answers `undefined` there.
    const { reelSystem, getCell, bindAt } = fakeReelSystem([
      [{ symbol: 'a' }, { symbol: 'b' }],
      [{ symbol: 'c' }],
    ]);
    const cellOrUndefined = getCell.getMockImplementation()!;
    getCell.mockImplementation((col, row) =>
      col === 1 && row === 1 ? (undefined as unknown as CellLike) : cellOrUndefined(col, row),
    );
    const board = boardFromReelSystem(reelSystem);

    expect(() => board.repaint()).not.toThrow();
    // Every cell that IS there still bound — the gap is skipped, not a stop.
    expect(bindAt(0, 0)).toHaveBeenCalledWith({ symbol: 'a' });
    expect(bindAt(0, 1)).toHaveBeenCalledWith({ symbol: 'b' });
    expect(bindAt(1, 0)).toHaveBeenCalledWith({ symbol: 'c' });
  });
});
