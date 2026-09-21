import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import { createNodeTypes } from '@energy8engine/scenes';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import * as runtime from '../src/runtime';

/**
 * The runtime half's own concern, separate from `createReelsBoard` itself:
 * where the symbol resolver comes from (a row's YAML config cannot carry
 * a function, so it comes off `ctx` as an `assets` service).
 *
 * Mounting the board's view is Task 4's concern now: the board reaches the
 * screen through a `reels` node type registered with `@energy8engine/scenes`,
 * not a `stage` layer.
 */
const resolve: SymbolResolver = vi.fn((id: string) => {
  const c = new Container() as unknown as { __symbol: string };
  c.__symbol = id;
  return c as any;
});

const assetsService = {
  name: 'assets',
  apply(ctx: Context) {
    ctx.provide('assets', { resolve });
  },
};

describe('reels runtime half', () => {
  it('takes its symbol resolver from the assets service when the row config has none', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);

    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });

    expect(ctx.board).toBeDefined();
    expect(typeof ctx.board.spinTo).toBe('function');

    await ctx.fiber.dispose();
  });

  it('says what is missing, rather than building a board with no art', async () => {
    const ctx = new Context();

    // No `assets` provided anywhere, and no `resolve` in the config —
    // this throws, which is how a row reports failure: the loader turns
    // it into a Diagnostic naming the row.
    await expect(ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } })).rejects.toThrow(
      /resolver/i,
    );

    await ctx.fiber.dispose();
  });

  it('never registers, and never throws, when nodeTypes does not appear at all', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });

    expect(ctx.board).toBeDefined();
    expect(ctx.reflect.get('nodeTypes', false)).toBeUndefined();

    await ctx.fiber.dispose();
  });
});

describe('the reels node type', () => {
  it('registers `reels` once nodeTypes appears, regardless of order; mount hands out the board view; unmount detaches', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 5, rows: 3 } } });
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const type = nodeTypes.get('reels')!;
    const parent = new Container();
    parent.addChild(ctx.get('board')!.view);
    const view = type.mount({ row: 'reels1' }, ctx);
    expect(view).toBe(ctx.get('board')!.view);
    expect(view.parent).toBeNull();
    const holder = new Container();
    holder.addChild(view);
    type.unmount!(view);
    expect(view.parent).toBeNull();
    expect(view.destroyed).toBe(false);
  });

  it('origin: center wraps the board view offset by the grid’s centre; cell (the default) hands out the bare view; unmount resets', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 5, rows: 3, cellSize: 100, gap: 10 } } });
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const type = nodeTypes.get('reels')!;
    const board = ctx.get('board')!;
    const g = board.grid.geometry!;
    const view = type.mount({ row: 'reels1', origin: 'center' }, ctx);
    expect(view).not.toBe(board.view);
    expect(board.view.parent).toBe(view);
    expect(board.view.position.x).toBeCloseTo(-g.centerX);
    expect(board.view.position.y).toBeCloseTo(-g.centerY);
    type.unmount!(view);
    expect(board.view.parent).toBeNull();
    expect(board.view.position.x).toBe(0);
    expect(type.mount({ row: 'reels1', origin: 'cell' }, ctx)).toBe(board.view);
  });

  it('a hot re-apply registers again (a new board) and the disposer takes the old registration back', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    const fiber = ctx.plugin(runtime, { config: { grid: { cols: 5, rows: 3 } } });
    await fiber;
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const first = nodeTypes.get('reels')!;
    await fiber.update({ config: { grid: { cols: 3, rows: 3 } } });
    await vi.waitFor(() => expect(nodeTypes.get('reels')).not.toBe(first));
    await fiber.dispose();
    expect(nodeTypes.get('reels')).toBeUndefined();
  });
});
