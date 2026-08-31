import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import { createReelsBoard } from '../src/index';

/**
 * `boardFromReelSystem` (board.test.ts) is proven against a fake, per the
 * brief — pixi does not initialise usefully in jsdom and animation timing
 * cannot be asserted in a unit test. But `refill`, `remove` and
 * `setMultiplier` all measured out SYNCHRONOUS in Step 1 (no `Tween`, no
 * `Ticker` involved), so this suite wires `createReelsBoard` to the REAL
 * `createReelSystem` and exercises exactly those three — real construction,
 * real `ReelGrid`/`SymbolCell` objects, no fake standing in for them. This
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
    expect(board.multiplier).toBe(1);
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

  it('setMultiplier really moves the accumulator the board reports back', async () => {
    const board = createReelsBoard({ resolve, config: {} });

    await board.setMultiplier({ kind: 'setMultiplier', value: 4 });

    expect(board.multiplier).toBe(4);
    board.destroy();
  });
});
