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

  const spin = vi.fn(async (target: unknown, opts?: unknown) => {
    calls.push(['spin', target, opts]);
  });
  const setBoard = vi.fn((target: LegacyReelSystem['board']) => {
    calls.push(['setBoard', target]);
    board = target;
  });
  // Faithful to the real facade (measured in `ReelSystem.cascade`): it assigns
  // `board = steps[i].settledGrid` as each step settles, so a cascade leaves
  // `reelSystem.board` in step. The CELLS are another matter — the real
  // `TumbleController` seats them with its own `setGrid(settledGrid)`, which
  // its `_dead` guard skips once the round was skipped; that is why `tumble`
  // re-seats them with a `setBoard` of its own.
  const cascade = vi.fn(
    async (steps: { settledGrid: LegacyReelSystem['board'] }[], opts?: unknown) => {
      calls.push(['cascade', steps, opts]);
      const last = steps[steps.length - 1];
      if (last) board = last.settledGrid;
    },
  );
  const skip = vi.fn(() => {
    calls.push(['skip']);
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
    cascade,
    skip,
  };

  return {
    reelSystem,
    calls,
    spin,
    setBoard,
    cascade,
    skip,
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
    expect(spin).toHaveBeenCalledWith(
      [
        [{ symbol: '1' }, { symbol: '2' }],
        [{ symbol: '3' }, { symbol: '4' }],
      ],
      // slice 25: the legacy run options, carrying whatever tempo the step was
      // given — `{ turbo: undefined }` is `spin(target)`'s own default.
      { turbo: undefined },
    );
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

    expect(spin).toHaveBeenCalledWith([[{ symbol: 'ROCK' }, { symbol: 'PAPER' }]], {
      turbo: undefined,
    });
  });

  it('a record cell: symbol normalized, extras (multiplier, bonus, …) reach setData/spin untouched', async () => {
    const { reelSystem, spin } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.spinTo({
      kind: 'spinTo',
      board: [[{ symbol: 'ORB', multiplier: 5 }, { symbol: 2, bonus: 1 }]],
    });

    expect(spin).toHaveBeenCalledWith([[{ symbol: 'ORB', multiplier: 5 }, { symbol: '2', bonus: 1 }]], {
      turbo: undefined,
    });
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
    const board = boardFromReelSystem({
      ...reelSystem,
      config: { grid: { cellSize: 64 } } as unknown as LegacyReelSystem['config'],
    });

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

/**
 * Slice 25 — `tumble`. One vocabulary step is one legacy `TumbleStep`
 * through `ReelSystem.cascade`: the gravity slide the IDE's `remove` +
 * `refill` (= `setBoard` twice) could never draw.
 */
describe('boardFromReelSystem: tumble', () => {
  const step = () => ({
    kind: 'tumble' as const,
    winning: [{ col: 0, row: 0 }],
    removed: [{ col: 0, row: 0 }],
    drops: [{ col: 0, fromRow: 1, toRow: 2 }],
    fresh: [
      { col: 0, row: 0, symbol: 7 },
      { col: 1, row: 0, symbol: { symbol: 'ORB', multiplier: 5 } },
    ],
    settled: [
      [{ symbol: 'ORB', multiplier: 5 }, 'b'],
      ['c', 2],
    ],
  });

  it('calls cascade once with the mapped legacy TumbleStep — drops through, symbols via cellData', async () => {
    const { reelSystem, cascade } = fakeReelSystem([[{ symbol: 'x' }, { symbol: 'y' }]]);
    const board = boardFromReelSystem(reelSystem);

    await board.tumble(step());

    expect(cascade).toHaveBeenCalledTimes(1);
    expect(cascade.mock.calls[0][0]).toEqual([
      {
        winningCells: [{ col: 0, row: 0 }],
        removedCells: [{ col: 0, row: 0 }],
        drops: [{ col: 0, fromRow: 1, toRow: 2 }],
        // `newCells.symbol` is a bare string in the legacy step — a number
        // stringifies, a record contributes only its symbol (its extras ride
        // along on `settledGrid`, which is where the cell takes its data).
        newCells: [
          { col: 0, row: 0, symbol: '7' },
          { col: 1, row: 0, symbol: 'ORB' },
        ],
        settledGrid: [
          [{ symbol: 'ORB', multiplier: 5 }, { symbol: 'b' }],
          [{ symbol: 'c' }, { symbol: '2' }],
        ],
      },
    ]);
  });

  // An empty fresh cell lands EMPTY: `null` is what the legacy
  // `SymbolCell.setData` means by "no symbol" (and what `remove()` hands it).
  // `''` would send `resolve('')` looking for a symbol that cannot exist.
  it('an empty fresh cell carries null through, not an empty symbol name', async () => {
    const { reelSystem, cascade } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.tumble({
      ...step(),
      fresh: [{ col: 0, row: 0, symbol: { symbol: null } }],
    });

    const [[[sent]]] = cascade.mock.calls as unknown as [[{ newCells: unknown[] }[]]];
    expect(sent.newCells).toEqual([{ col: 0, row: 0, symbol: null }]);
  });

  it('a tumble with no drops passes none — the controller derives gravity', async () => {
    const { reelSystem, cascade } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);
    const { drops: _drops, ...noDrops } = step();

    await board.tumble(noDrops);

    expect((cascade.mock.calls[0][0] as { drops?: unknown }[])[0].drops).toBeUndefined();
  });

  it('forwards turbo to cascade, and nothing when no opts were given', async () => {
    const { reelSystem, cascade } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.tumble(step(), { turbo: true });
    expect(cascade.mock.calls[0][1]).toEqual({ turbo: true });

    await board.tumble(step());
    expect(cascade.mock.calls[1][1]).toEqual({ turbo: undefined });
  });

  it('leaves reelSystem.board reading the settled grid, and binds every cell after', async () => {
    const { reelSystem, bindAt } = fakeReelSystem([[{ symbol: 'x' }, { symbol: 'y' }]]);
    const board = boardFromReelSystem(reelSystem);

    await board.tumble(step());

    expect(reelSystem.board).toEqual([
      [{ symbol: 'ORB', multiplier: 5 }, { symbol: 'b' }],
      [{ symbol: 'c' }, { symbol: '2' }],
    ]);
    expect(bindAt(0, 0)).toHaveBeenCalledWith({ symbol: 'ORB', multiplier: 5 });
    expect(bindAt(1, 1)).toHaveBeenCalledWith({ symbol: '2' });
  });

  // A SKIPPED round never reaches `TumbleController`'s own
  // `setGrid(settledGrid)` (`_dead` returns first), so the cells would keep
  // the pre-tumble symbols while `reelSystem.board` reports `settled` — and
  // the `bindAll()` that follows would bind that stale data. The re-seat is
  // the board's, after the cascade lands and before anything binds.
  it('re-seats the settled grid after the cascade resolves and before bindAll', async () => {
    const { reelSystem, cascade, setBoard, bindAt } = fakeReelSystem([
      [{ symbol: 'x' }, { symbol: 'y' }],
    ]);
    const board = boardFromReelSystem(reelSystem);

    await board.tumble(step());

    expect(setBoard).toHaveBeenCalledTimes(1);
    expect(setBoard).toHaveBeenCalledWith([
      [{ symbol: 'ORB', multiplier: 5 }, { symbol: 'b' }],
      [{ symbol: 'c' }, { symbol: '2' }],
    ]);
    const [reseat] = setBoard.mock.invocationCallOrder;
    expect(reseat).toBeGreaterThan(cascade.mock.invocationCallOrder[0]);
    expect(reseat).toBeLessThan(bindAt(0, 0).mock.invocationCallOrder[0]);
  });

  it('a repaint asked for mid-tumble is deferred until it lands, like a spin', async () => {
    const { reelSystem, cascade, setBoard } = fakeReelSystem([[{ symbol: 'x' }]]);
    let land!: () => void;
    cascade.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          land = resolve;
        }),
    );
    const board = boardFromReelSystem(reelSystem);

    const tumbling = board.tumble(step());
    board.repaint();
    await new Promise((r) => setTimeout(r, 5));
    expect(setBoard).not.toHaveBeenCalled();

    land();
    await tumbling;
    // Two: the tumble's own re-seat of `settled`, then the deferred repaint.
    expect(setBoard).toHaveBeenCalledTimes(2);
  });
});

describe('boardFromReelSystem: turbo, skip, config, lastOpts', () => {
  it('spinTo hands turbo to the legacy spin', async () => {
    const { reelSystem, spin } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.spinTo({ kind: 'spinTo', board: [[1]] }, { turbo: true });

    expect(spin).toHaveBeenCalledWith([[{ symbol: '1' }]], { turbo: true });
  });

  it('revealWins still runs the legacy playWin as is — turbo cannot hurry it', async () => {
    const { reelSystem, cellAt } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    await board.revealWins(
      { kind: 'revealWins', total: 1, lines: [{ line: 0, symbol: 1, count: 1, win: 1, positions: [{ col: 0, row: 0 }] }] },
      { turbo: true },
    );

    expect(cellAt(0, 0)!.playWin).toHaveBeenCalledTimes(1);
  });

  it('skip forwards to the legacy ReelSystem.skip', () => {
    const { reelSystem, skip } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    board.skip();

    expect(skip).toHaveBeenCalledTimes(1);
  });

  it('config is the reel system\'s own, read through', () => {
    const { reelSystem } = fakeReelSystem();
    const config = { grid: { cellSize: 64 } } as unknown as LegacyReelSystem['config'];
    const board = boardFromReelSystem({ ...reelSystem, config });

    expect(board.config).toBe(config);
  });

  it('lastOpts records the opts the last method was given — undefined until one runs', async () => {
    const { reelSystem } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    expect(board.lastOpts).toBeUndefined();

    await board.spinTo({ kind: 'spinTo', board: [[1]] }, { turbo: true });
    expect(board.lastOpts).toEqual({ turbo: true });

    await board.refill({ kind: 'refill', board: [[1]] });
    expect(board.lastOpts).toBeUndefined();
  });
});

/**
 * Slice 30 — `playState`. Not a win reveal (`revealWins`): no amount, no
 * line, and the named state is the mechanic's to choose. Reaches the
 * symbol view directly (`grid.getCell(col,row).view.playState(name)`),
 * the same `bind`-carrying view `spinTo`/`refill` already walk with
 * `bindAll` — never through `ReelSystem.spin`/`cascade`, since the legacy
 * facade knows nothing about a symbol's named states.
 */
describe('boardFromReelSystem: playState', () => {
  /** A `CellLike` whose view is whatever `viewOverrides` supplies — `undefined` fields read as absent, matching a plain `SymbolView`. */
  function cellWithView(viewOverrides: Record<string, unknown> | null): CellLike {
    return {
      setState: vi.fn(),
      setData: vi.fn(),
      playWin: vi.fn(),
      view: (viewOverrides ? { ...viewOverrides } : null) as unknown as CellLike['view'],
      data: { symbol: 'a' },
    };
  }

  it("calls view.playState(state) on each named cell", async () => {
    const { reelSystem, getCell } = fakeReelSystem();
    const c00 = cellWithView({ playState: vi.fn(async () => {}) });
    const c10 = cellWithView({ playState: vi.fn(async () => {}) });
    getCell.mockImplementation((col: number) => (col === 0 ? c00 : c10));
    const board = boardFromReelSystem(reelSystem);

    await board.playState({
      kind: 'playState',
      cells: [
        { col: 0, row: 0 },
        { col: 1, row: 0 },
      ],
      state: 'death',
    });

    expect(c00.view!.playState).toHaveBeenCalledWith('death');
    expect(c10.view!.playState).toHaveBeenCalledWith('death');
  });

  it('awaits every named cell before resolving when `wait` is absent (default true)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const cell = cellWithView({ playState: vi.fn(() => gate) });
    const { reelSystem, getCell } = fakeReelSystem();
    getCell.mockImplementation(() => cell);
    const board = boardFromReelSystem(reelSystem);

    let settled = false;
    const running = board
      .playState({ kind: 'playState', cells: [{ col: 0, row: 0 }], state: 'death' })
      .then(() => {
        settled = true;
      });

    await Promise.race([running, new Promise((r) => setTimeout(r, 20))]);
    expect(settled).toBe(false);

    release();
    await running;
    expect(settled).toBe(true);
  });

  it('returns at once with `wait: false` — the states keep playing on their own', async () => {
    const playState = vi.fn(() => new Promise<void>(() => {})); // never settles within this test
    const cell = cellWithView({ playState });
    const { reelSystem, getCell } = fakeReelSystem();
    getCell.mockImplementation(() => cell);
    const board = boardFromReelSystem(reelSystem);

    await expect(
      board.playState({
        kind: 'playState',
        cells: [{ col: 0, row: 0 }],
        state: 'death',
        wait: false,
      }),
    ).resolves.toBeUndefined();
    expect(playState).toHaveBeenCalledWith('death');
  });

  it('skips a cell with no view, a view with no playState, and a cell past a short reel — not a throw', async () => {
    const { reelSystem, getCell } = fakeReelSystem();
    const noView = cellWithView(null);
    const noPlayState = cellWithView({}); // a plain SymbolView: no playState of its own
    getCell.mockImplementation((col: number) => {
      if (col === 0) return noView;
      if (col === 1) return noPlayState;
      return undefined as unknown as CellLike; // a ragged grid: no cell past a short reel's last row
    });
    const board = boardFromReelSystem(reelSystem);

    await expect(
      board.playState({
        kind: 'playState',
        cells: [
          { col: 0, row: 0 },
          { col: 1, row: 0 },
          { col: 2, row: 0 },
        ],
        state: 'death',
      }),
    ).resolves.toBeUndefined();
  });

  // `skip()` (the board's) must leave no cell stuck mid-state: a `playState`
  // left playing when the round is hurried is collapsed to its resting look
  // through the same `showStatic()` the symbol view already exposes (Task 3)
  // — the legacy `ReelSystem.skip()` it also forwards to knows nothing about
  // a symbol's named states, so it cannot do this on its own.
  it("skip() shows the resting state of a cell whose playState is still in flight, and still forwards to the legacy skip", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const showStatic = vi.fn();
    const cell = cellWithView({ playState: vi.fn(() => gate), showStatic });
    const { reelSystem, getCell, skip } = fakeReelSystem();
    getCell.mockImplementation(() => cell);
    const board = boardFromReelSystem(reelSystem);

    const running = board.playState({
      kind: 'playState',
      cells: [{ col: 0, row: 0 }],
      state: 'death',
    });

    board.skip();

    expect(showStatic).toHaveBeenCalledTimes(1);
    expect(skip).toHaveBeenCalledTimes(1);

    release();
    await running;
  });

  it('a skip with nothing in flight calls no showStatic and still forwards to the legacy skip', async () => {
    const { reelSystem, skip } = fakeReelSystem();
    const board = boardFromReelSystem(reelSystem);

    board.skip();

    expect(skip).toHaveBeenCalledTimes(1);
  });
});
