import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import * as runtime from '../src/runtime';
import * as stageRuntime from '@energy8engine/stage/runtime';

/**
 * The runtime half's own two concerns, neither of which `createReelsBoard`
 * itself has: where the symbol resolver comes from (a row's YAML config
 * cannot carry a function, so it comes off `ctx` as an `assets` service),
 * and when the board's view gets mounted (whenever `stage` appears — via
 * `ctx.inject`, not call order).
 *
 * `stage` is registered AFTER `reels` on purpose in the mount test: that
 * is exactly the "ordered by dependency, not by registration order"
 * property the module doc claims. The stage stand-in is a real pixi
 * `Container` — it builds headlessly, no `Application` needed.
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

/**
 * A stand-in `stage` service shaped like the real one only as far as this
 * package reads it: `container` (the old, pre-layer mount point) plus a
 * `layer(id)` backed by containers built from the given layer ids. Called
 * with no ids it has no layers at all, which is what exercises the "no
 * such layer" fallback the same as an old, layer-less fake would.
 */
function fakeStage(layers: string[] = []) {
  const container = new Container();
  const byId = new Map(layers.map((id) => [id, new Container()]));
  return {
    name: 'stage',
    apply(ctx: Context) {
      ctx.provide('stage', { container, layer: (id: string) => byId.get(id) } as any);
    },
  };
}

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

  it('mounts its board into the stage once stage appears, even though stage is registered second', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });

    // Not mounted yet — stage doesn't exist yet.
    expect(ctx.reflect.get('stage', false)).toBeUndefined();

    await ctx.plugin(fakeStage());

    expect(ctx.stage.container.children).toContain(ctx.board.view);

    await ctx.fiber.dispose();
  });

  it('never mounts, and never throws, when stage does not appear at all', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });

    expect(ctx.board).toBeDefined();
    expect(ctx.reflect.get('stage', false)).toBeUndefined();

    await ctx.fiber.dispose();
  });

  /**
   * The hot path: the IDE edits `reels1`'s config and the row's fiber
   * re-applies in place. What that has to mean for this half: a NEW board
   * with the new geometry, the old one destroyed (its effect disposer),
   * and the stage holding exactly one board view — not the dead one next
   * to the live one.
   */
  it('re-applies on fiber.update: a new board with the new grid, the old destroyed, one view on the stage', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(fakeStage());
    const fiber = await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });

    // `cols` is the real `ReelGrid`'s own field, not part of the `GridLike`
    // slice the board is typed against — read through a cast on purpose.
    const cols = (board: typeof ctx.board) => (board.grid as unknown as { cols: number }).cols;
    const before = ctx.board;
    const destroy = vi.spyOn(before, 'destroy');
    expect(cols(before)).toBe(2);
    expect(ctx.stage.container.children).toEqual([before.view]);

    fiber.update({ config: { grid: { cols: 4, rows: 3 } } });
    await fiber.await();

    const after = ctx.board;
    expect(after).not.toBe(before);
    expect(cols(after)).toBe(4);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(ctx.stage.container.children).toEqual([after.view]);

    await ctx.fiber.dispose();
  });

  it('mounts the board into the layer its config names, reels by default', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(fakeStage(['bg', 'reels']));
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });
    expect(ctx.stage.layer('reels')!.children).toEqual([ctx.board.view]);
    expect(ctx.stage.container.children).not.toContain(ctx.board.view);
    await ctx.fiber.dispose();
  });

  it('a layer that does not exist falls back to the root, with a warning', async () => {
    const ctx = new Context();
    const reported: Diagnostic[] = [];
    await ctx.plugin({
      name: 'diagnostics',
      apply(c: Context) {
        c.provide('diagnostics', { report: (d: Diagnostic) => reported.push(d) });
      },
    });
    await ctx.plugin(assetsService);
    await ctx.plugin(fakeStage(['bg']));
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } }, layer: 'fx' });
    expect(ctx.stage.container.children).toEqual([ctx.board.view]);
    expect(reported[0]).toMatchObject({ severity: 'warning', plugin: 'reels', where: 'fx' });
    await ctx.fiber.dispose();
  });

  it('follows a re-provided stage into its new layer, with the same board', async () => {
    // The REAL stage runtime, so this is the hot-stage path Task 1 promised.
    const ctx = new Context();
    const root = new Container();
    await ctx.plugin({
      name: 'renderer-pixi',
      apply(c: Context) {
        c.provide('renderer', { app: { stage: root } } as any);
      },
    });
    await ctx.plugin(assetsService);
    const stageFiber = await ctx.plugin(stageRuntime, {
      design: { width: 1, height: 1 },
      layers: [{ id: 'reels', z: 0 }],
    });
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });
    const board = ctx.board;
    expect(ctx.stage.layer('reels')!.children).toEqual([board.view]);
    stageFiber.update({
      design: { width: 1, height: 1 },
      layers: [
        { id: 'bg', z: 0 },
        { id: 'reels', z: 1 },
      ],
    });
    await stageFiber.await();
    expect(ctx.board).toBe(board);
    expect(ctx.stage.layers().map((l) => l.id)).toEqual(['bg', 'reels']);
    expect(ctx.stage.layer('reels')!.children).toEqual([board.view]);
    expect(board.view.destroyed).toBe(false);
    await ctx.fiber.dispose();
  });
});
