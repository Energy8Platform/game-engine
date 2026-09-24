import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import { createNodeTypes } from '@energy8engine/scenes';
import { DEFAULT_REEL_CONFIG, type MotionStyle, type SymbolResolver } from '@energy8engine/reel-core';
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

    await ctx.plugin(runtime, { grid: { cols: 2, rows: 2 } });

    expect(ctx.board).toBeDefined();
    expect(typeof ctx.board.spinTo).toBe('function');

    await ctx.fiber.dispose();
  });

  it('says what is missing, rather than building a board with no art', async () => {
    const ctx = new Context();

    // No `assets` provided anywhere, and no `resolve` in the config —
    // this throws, which is how a row reports failure: the loader turns
    // it into a Diagnostic naming the row.
    await expect(ctx.plugin(runtime, { grid: { cols: 2, rows: 2 } })).rejects.toThrow(
      /resolver/i,
    );

    await ctx.fiber.dispose();
  });

  it('never registers, and never throws, when nodeTypes does not appear at all', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { grid: { cols: 2, rows: 2 } });

    expect(ctx.board).toBeDefined();
    expect(ctx.reflect.get('nodeTypes', false)).toBeUndefined();

    await ctx.fiber.dispose();
  });
});

/** A motion style that records the targets it ran to and seats them at once. */
function fakeStyle(key = 'fake') {
  const ran: unknown[] = [];
  const style: MotionStyle = {
    key,
    create: (kit) => ({
      plan: () => [],
      run: async (target) => {
        ran.push(target);
        kit.setBoard(target);
      },
      skip() {},
    }),
  };
  return { style, ran };
}

describe('the reels service', () => {
  it('the row provides `reels`, and a style registered on it is what board.spinTo runs', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { grid: { cols: 1, rows: 1 } });

    const { style, ran } = fakeStyle();
    ctx.reels.motions.register(style);
    ctx.reels.useMotion('fake', DEFAULT_REEL_CONFIG.motion);
    await ctx.board.spinTo({ kind: 'spinTo', board: [[7]] });

    expect(ran).toEqual([[[{ symbol: '7' }]]]);
    expect(ctx.reels.board).toEqual([[{ symbol: '7' }]]);
    await ctx.fiber.dispose();
  });

  it('a hot re-apply provides a NEW reels, and a dependent that injects it has registered on the new one', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    const fiber = ctx.plugin(runtime, { grid: { cols: 5, rows: 3 } });
    await fiber;
    const { style } = fakeStyle();
    await ctx.plugin({
      name: 'motion-dependent',
      apply(c: Context) {
        c.inject(['reels'], (rc) => {
          rc.effect(() => rc.reels.motions.register(style), 'dependent:style');
        });
      },
    });
    await vi.waitFor(() => expect(ctx.reels.motions.get('fake')).toBe(style));
    const first = ctx.reels;

    await fiber.update({ grid: { cols: 3, rows: 3 } });

    // Mid re-apply the service is briefly unprovided; wait for the new one.
    await vi.waitFor(() => expect(ctx.reels?.config.grid.cols).toBe(3));
    expect(ctx.reels).not.toBe(first);
    await vi.waitFor(() => expect(ctx.reels.motions.get('fake')).toBe(style));
    await ctx.fiber.dispose();
  });

  it("with no motion row, a spin snaps and the warning reaches the composition's diagnostics", async () => {
    const ctx = new Context();
    const report = vi.fn();
    ctx.provide('diagnostics', { report } as never);
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { grid: { cols: 1, rows: 1 } });

    await ctx.board.spinTo({ kind: 'spinTo', board: [[4]] });

    expect(ctx.reels.board).toEqual([[{ symbol: '4' }]]);
    expect(report).toHaveBeenCalledWith({
      severity: 'warning',
      plugin: 'reels',
      where: 'reels1',
      message: 'no motion row — the reels snap to the result',
    });
    await ctx.fiber.dispose();
  });
});

describe('the reels node type', () => {
  it('registers `reels` once nodeTypes appears, regardless of order; mount wraps the board view; unmount detaches and destroys the wrapper', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { grid: { cols: 5, rows: 3 } });
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const type = nodeTypes.get('reels')!;
    const board = ctx.get('board')!;
    const parent = new Container();
    parent.addChild(board.view);
    const view = type.mount({ row: 'reels1' }, ctx);
    expect(view).not.toBe(board.view);
    expect(view.children).toEqual([board.view]);
    expect(board.view.parent).toBe(view);
    type.unmount!(view);
    expect(view.destroyed).toBe(true);
    expect(board.view.parent).toBeNull();
    expect(board.view.destroyed).toBe(false);
    expect(board.view.position.x).toBe(0);
    expect(board.view.position.y).toBe(0);
  });

  it('origin: center offsets the wrapped view by the grid’s centre; update toggles it in place, same wrapper', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { grid: { cols: 5, rows: 3, cellSize: 100, gap: 10 } });
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const type = nodeTypes.get('reels')!;
    const board = ctx.get('board')!;
    const g = board.grid.geometry!;

    const view = type.mount({ row: 'reels1', origin: 'center' }, ctx);
    expect(board.view.parent).toBe(view);
    expect(board.view.position.x).toBeCloseTo(-g.centerX);
    expect(board.view.position.y).toBeCloseTo(-g.centerY);

    type.update!(view, { row: 'reels1', origin: 'cell' }, ctx);
    expect(board.view.parent).toBe(view);
    expect(board.view.position.x).toBe(0);
    expect(board.view.position.y).toBe(0);

    type.update!(view, { row: 'reels1', origin: 'center' }, ctx);
    expect(board.view.parent).toBe(view);
    expect(board.view.position.x).toBeCloseTo(-g.centerX);
    expect(board.view.position.y).toBeCloseTo(-g.centerY);
  });

  it('a fresh mount ahead of the old unmount (scenes.ts remountNode order: mount THEN unmount) leaves the board view under the fresh wrapper, not torn out', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { grid: { cols: 5, rows: 3, cellSize: 100, gap: 10 } });
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const type = nodeTypes.get('reels')!;
    const board = ctx.get('board')!;
    const g = board.grid.geometry!;

    // center -> cell: the fresh (cell) wrapper mounts first, taking board.view
    // out of the old (center) wrapper; only then does the old one unmount.
    const a = type.mount({ row: 'reels1', origin: 'center' }, ctx);
    const b = type.mount({ row: 'reels1', origin: 'cell' }, ctx);
    type.unmount!(a);
    expect(board.view.parent).toBe(b);
    expect(board.view.position.x).toBe(0);
    expect(board.view.position.y).toBe(0);
    expect(a.destroyed).toBe(true);
    expect(b.destroyed).toBe(false);
    type.unmount!(b);

    // cell -> center: same hazard, reverse origins.
    const c = type.mount({ row: 'reels1', origin: 'cell' }, ctx);
    const d = type.mount({ row: 'reels1', origin: 'center' }, ctx);
    type.unmount!(c);
    expect(board.view.parent).toBe(d);
    expect(board.view.position.x).toBeCloseTo(-g.centerX);
    expect(board.view.position.y).toBeCloseTo(-g.centerY);
    expect(c.destroyed).toBe(true);
    expect(d.destroyed).toBe(false);
  });

  it('a hot re-apply registers again (a new board) and the disposer takes the old registration back', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    const fiber = ctx.plugin(runtime, { grid: { cols: 5, rows: 3 } });
    await fiber;
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const first = nodeTypes.get('reels')!;
    await fiber.update({ grid: { cols: 3, rows: 3 } });
    await vi.waitFor(() => expect(nodeTypes.get('reels')).not.toBe(first));
    await fiber.dispose();
    expect(nodeTypes.get('reels')).toBeUndefined();
  });
});
