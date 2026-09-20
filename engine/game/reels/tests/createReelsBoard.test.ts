import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import { executePlan } from '@energy8engine/play-loop';
import { createReelsBoard } from '../src/index';

/**
 * `boardFromReelSystem` (board.test.ts) is proven against a fake, per the
 * brief — pixi does not initialise usefully in jsdom and animation timing
 * cannot be asserted in a unit test. But `refill` and `remove` both
 * measured out SYNCHRONOUS in Step 1 (no `Tween`, no `Ticker` involved),
 * so this suite wires `createReelsBoard` to the REAL `createReelSystem`
 * and exercises exactly those two — real construction, real
 * `ReelGrid`/`SymbolCell` objects, no fake standing in for them. This
 * is strictly extra: it is not a substitute for the mapping tests, and it
 * deliberately never touches `spinTo`/`revealWins` (both need a live pixi
 * `Application` ticker to settle — see the module doc in src/index.ts).
 */
const resolve: SymbolResolver = vi.fn((id: string) => {
  const c = new Container() as unknown as { __symbol: string };
  c.__symbol = id;
  return c as any;
});

describe('createReelsBoard (real createReelSystem, synchronous paths only)', () => {
  it('constructs headlessly and exposes a mountable view', () => {
    const board = createReelsBoard({ resolve, config: { grid: { cols: 2, rows: 2 } } });
    expect(board.view).toBeInstanceOf(Container);
    board.destroy();
  });

  it('refill really updates the board read back through the same grid the board drives', async () => {
    const board = createReelsBoard({ resolve, config: { grid: { cols: 2, rows: 1 } } });

    await board.refill({ kind: 'refill', board: [[9], [3]] });

    // SymbolCell exposes the resolved view for inspection; `resolve` above tags it with __symbol.
    const cell = board.grid.getCell(0, 0) as unknown as { view: { __symbol?: string } | null };
    expect(cell.view?.__symbol).toBe('9');
    board.destroy();
  });

  it('remove really flips the cell to the removed frame state (SymbolCell.setState is synchronous)', async () => {
    const board = createReelsBoard({ resolve, config: { grid: { cols: 1, rows: 1 } } });
    await board.refill({ kind: 'refill', board: [[1]] });

    await board.remove({ kind: 'remove', cells: [{ col: 0, row: 0 }] });

    // `frameStyleKey` is SymbolCell's own public hook, "exposed for tests/inspection".
    const cell = board.grid.getCell(0, 0) as unknown as { frameStyleKey: string };
    expect(cell.frameStyleKey).toBe('removed');
    board.destroy();
  });
});

/**
 * A hot `reels1` re-apply (`gameRows.update`) disposes the row's effects —
 * `board.destroy()` among them — and provides a NEW board. A caller that
 * captured the old one (a spin already in flight, a page that read
 * `ctx.board` once) would otherwise drive a torn-down reel system: the
 * legacy `spin` resolved `done` on it and the spin was recorded as
 * presented, silently (measured — Task 5's product defect). A destroyed
 * board refuses instead, and `executePlan` turns that refusal into the
 * diagnostic the page paints.
 */
describe('createReelsBoard — after destroy()', () => {
  const plan = [{ kind: 'spinTo' as const, board: [[1]] }];

  it('every BoardApi method throws, naming the cause', async () => {
    const board = createReelsBoard({ resolve, config: { grid: { cols: 1, rows: 1 } } });
    board.destroy();

    for (const call of [
      () => board.spinTo({ kind: 'spinTo', board: [[1]] }),
      () => board.revealWins({ kind: 'revealWins', total: 0, lines: [] }),
      () => board.remove({ kind: 'remove', cells: [] }),
      () => board.refill({ kind: 'refill', board: [[1]] }),
      () =>
        board.tumble({
          kind: 'tumble',
          winning: [],
          removed: [],
          fresh: [],
          settled: [[1]],
        }),
    ]) {
      await expect(call()).rejects.toThrow('board destroyed — reels1 was re-applied; spin again');
    }
  });

  // `skip` joins `repaint` on the other side of that rule: there is no spin
  // result a stale skip could misreport, so it is a no-op, not a throw.
  it('skip() after destroy is a quiet no-op, not a refusal', () => {
    const board = createReelsBoard({ resolve, config: { grid: { cols: 1, rows: 1 } } });
    board.destroy();
    expect(() => board.skip()).not.toThrow();
  });

  it('a plan run against it is a play-loop diagnostic, not a throw and not a silent "done"', async () => {
    const board = createReelsBoard({ resolve, config: { grid: { cols: 1, rows: 1 } } });
    board.destroy();

    const problems = await executePlan(plan, board);

    expect(problems).toHaveLength(1);
    expect(problems[0].plugin).toBe('play-loop');
    expect(problems[0].message).toContain('board destroyed');
  });
});

describe('createReelsBoard: repaint / cellSize (real createReelSystem)', () => {
  it('cellSize reflects the grid config, defaulting to 96 square', () => {
    const withDefault = createReelsBoard({ resolve, config: { grid: { cols: 1, rows: 1 } } });
    expect(withDefault.cellSize).toEqual({ width: 96, height: 96 });
    withDefault.destroy();

    const withCustom = createReelsBoard({
      resolve,
      config: { grid: { cols: 1, rows: 1, cellSize: 64 } },
    });
    expect(withCustom.cellSize).toEqual({ width: 64, height: 64 });
    withCustom.destroy();
  });

  it('repaint re-resolves the board in place — same data, a fresh view', async () => {
    const calls: string[] = [];
    const spy: SymbolResolver = vi.fn((id: string) => {
      calls.push(id);
      const c = new Container() as unknown as { __symbol: string };
      c.__symbol = id;
      return c as any;
    });
    const board = createReelsBoard({ resolve: spy, config: { grid: { cols: 1, rows: 1 } } });
    await board.refill({ kind: 'refill', board: [[7]] });
    const before = calls.length;

    board.repaint();

    expect(calls.length).toBeGreaterThan(before);
    board.destroy();
  });

  it('repaint is a no-op after destroy — does not throw', () => {
    const board = createReelsBoard({ resolve, config: { grid: { cols: 1, rows: 1 } } });
    board.destroy();
    expect(() => board.repaint()).not.toThrow();
  });
});
