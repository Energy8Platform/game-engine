/**
 * The kinds that draw above the cells — `multipliers` (transient labels on `fx`), `sticky` and
 * `giant` (the row's overlay layer, which outlives the run) — on `./harness`'s reel system.
 */
import { describe, expect, it, vi } from 'vitest';
import { Container, Text } from 'pixi.js';
import { Tween } from '@energy8engine/tween';
import type { ReelSystem } from '@energy8engine/reel-core';
import { createOverlayLayer, type OverlayLayer } from '../src/layer';
import { createMultipliersHandler } from '../src/handlers/multipliers';
import { createStickyHandler } from '../src/handlers/sticky';
import { createGiantHandler } from '../src/handlers/giant';
import {
  boardWith,
  depsOf,
  expectCellsHome,
  pump,
  run,
  setup,
  skipMidRun,
  startBoard,
  tick,
  useManualTicker,
} from './harness';

useManualTicker();

const childrenLabelled = (layer: OverlayLayer, label: string) =>
  layer.view.children.filter((child) => child.label === label);

describe('multipliers', () => {
  const cfg = {
    pulseMs: 240,
    labelMs: 500,
    totalMs: 900,
    labelColor: 0xffd24a,
    totalColor: 0xffe24a,
  };
  const create = (reels: ReelSystem) => createMultipliersHandler(depsOf(reels, cfg));
  const step = {
    kind: 'multipliers',
    cells: [
      { col: 0, row: 0, value: 2 },
      { col: 1, row: 1, value: 5 },
    ],
    total: 10,
  };
  const after = boardWith({
    '0,0': { symbol: 'A', multiplier: 2 },
    '1,1': { symbol: 'E', multiplier: 5 },
  });

  /** The texts of every label `fx` was handed while `work` ran. */
  async function labelsOf(reels: ReelSystem, work: () => Promise<unknown>): Promise<string[]> {
    const added: string[] = [];
    const onAdded = (child: Container) => child instanceof Text && added.push(child.text);
    reels.fx.on('childAdded', onAdded);
    await work();
    reels.fx.off('childAdded', onAdded);
    return added;
  }

  it('is the step kind', () => {
    expect(create(setup().reels).kind).toBe('multipliers');
  });

  it('badges the cells (symbols kept), one label per cell and one for the total', async () => {
    const { reels, board, refills } = setup();
    const labels = await labelsOf(reels, () => pump(run(create(reels), step, board)));

    expect(labels).toEqual(['×2', '×5', '×10']);
    expect(refills).toEqual([after]);
    expect(reels.board).toEqual(after);
    expect(reels.grid.getCell(1, 1).hasBadge('multiplier')).toBe(true);
    expectCellsHome(reels);
    expect(reels.fx.children).toHaveLength(0);
  });

  it('no `total`: no total label', async () => {
    const { reels, board } = setup();
    const labels = await labelsOf(reels, () =>
      pump(run(create(reels), { ...step, total: undefined }, board)),
    );
    expect(labels).toEqual(['×2', '×5']);
  });

  it.each([0, -3, '2', Number.NaN])('a value of %s is refused, board untouched', async (value) => {
    const { reels, board, refills } = setup();
    await expect(
      run(create(reels), { kind: 'multipliers', cells: [{ col: 0, row: 0, value }] }, board),
    ).rejects.toThrow('multipliers: cells[0].value must be a positive number');
    expect(refills).toEqual([]);
    expect(reels.board).toEqual(startBoard());
  });

  it('a cell outside the grid, or a bad total, is refused', async () => {
    const { reels, board, refills } = setup();
    await expect(
      run(create(reels), { kind: 'multipliers', cells: [{ col: 3, row: 0, value: 2 }] }, board),
    ).rejects.toThrow('multipliers: cells[0] (3, 0) is outside the grid');
    await expect(run(create(reels), { ...step, total: 0 }, board)).rejects.toThrow(
      'multipliers: total must be a positive number',
    );
    expect(refills).toEqual([]);
  });

  // mid-pulse; with the cells' labels up; with the total's up
  it.each([
    [30, 0],
    [300, 2],
    [840, 1],
  ])(
    'skip() %sms in (%s labels up): the end board, cells home, labels gone, nothing animating',
    async (atMs, up) => {
      const { reels, board, refills } = setup();
      const handler = create(reels);
      await skipMidRun(handler, run(handler, step, board), atMs, () =>
        expect(reels.fx.children).toHaveLength(up),
      );

      expect(refills).toEqual([after]);
      expectCellsHome(reels);
      expect(reels.fx.children).toHaveLength(0);
      expect(Tween.activeTweens).toBe(0);
      // nothing starts after the skip — the total's label included
      await tick(1000);
      expect(reels.fx.children).toHaveLength(0);
      expectCellsHome(reels);
    },
  );

  it('turbo halves the run', async () => {
    const normal = setup();
    const full = await pump(run(create(normal.reels), step, normal.board));
    const quick = setup();
    const half = await pump(run(create(quick.reels), step, quick.board, { turbo: true }));
    expect(half / full).toBeGreaterThan(0.4);
    expect(half / full).toBeLessThan(0.6);
  });
});

describe('sticky', () => {
  const cfg = { ringColor: 0xec4899 };
  function stickySetup() {
    const { reels, board, refills } = setup();
    const layer = createOverlayLayer(reels.kit());
    const handler = createStickyHandler(depsOf(reels, cfg, layer));
    return { reels, board, refills, layer, handler };
  }
  const cells = [
    { col: 0, row: 0 },
    { col: 2, row: 1 },
  ];

  it('is the step kind', () => {
    expect(stickySetup().handler.kind).toBe('sticky');
  });

  it('on: a ring per cell, never two; off: that ring goes, the other stays; no re-seat', async () => {
    const { board, refills, layer, handler } = stickySetup();
    await pump(run(handler, { kind: 'sticky', cells, on: true }, board));
    expect(childrenLabelled(layer, 'sticky')).toHaveLength(2);

    await pump(run(handler, { kind: 'sticky', cells, on: true }, board));
    expect(childrenLabelled(layer, 'sticky')).toHaveLength(2);

    await pump(run(handler, { kind: 'sticky', cells: [cells[0]], on: false }, board));
    expect(childrenLabelled(layer, 'sticky')).toHaveLength(1);
    // (0,0) is already off: the ring left is (2,1)'s
    await pump(run(handler, { kind: 'sticky', cells: [cells[0]], on: false }, board));
    expect(childrenLabelled(layer, 'sticky')).toHaveLength(1);
    await pump(run(handler, { kind: 'sticky', cells: [cells[1]], on: false }, board));
    expect(childrenLabelled(layer, 'sticky')).toHaveLength(0);

    expect(refills).toEqual([]);
  });

  it('bad data is refused, no ring drawn', async () => {
    const { board, layer, handler } = stickySetup();
    await expect(
      run(handler, { kind: 'sticky', cells: [{ col: 0, row: 3 }], on: true }, board),
    ).rejects.toThrow('sticky: cells[0] (0, 3) is outside the grid');
    await expect(run(handler, { kind: 'sticky', cells }, board)).rejects.toThrow(
      'sticky: on must be true or false',
    );
    expect(layer.view.children).toHaveLength(0);
  });

  it('with no overlay layer, refused', async () => {
    const { reels, board } = setup();
    await expect(
      run(createStickyHandler(depsOf(reels, cfg)), { kind: 'sticky', cells, on: true }, board),
    ).rejects.toThrow(`the "sticky" step needs the row's overlay layer`);
  });

  it('skip() at once: the rings are up', async () => {
    const { board, refills, layer, handler } = stickySetup();
    const work = run(handler, { kind: 'sticky', cells, on: true }, board);
    handler.skip?.();
    await work;
    expect(childrenLabelled(layer, 'sticky')).toHaveLength(2);
    expect(refills).toEqual([]);
  });

  describe('clear: true', () => {
    it('clears every ring, no re-seat', async () => {
      const { board, refills, layer, handler } = stickySetup();
      await pump(run(handler, { kind: 'sticky', cells, on: true }, board));
      expect(childrenLabelled(layer, 'sticky')).toHaveLength(2);

      await pump(run(handler, { kind: 'sticky', clear: true }, board));
      expect(childrenLabelled(layer, 'sticky')).toHaveLength(0);
      expect(refills).toEqual([]);
    });

    it('with no ring up: no error, no-op', async () => {
      const { board, refills, layer, handler } = stickySetup();
      await pump(run(handler, { kind: 'sticky', clear: true }, board));
      expect(childrenLabelled(layer, 'sticky')).toHaveLength(0);
      expect(refills).toEqual([]);
    });

    it('with cells: refused', async () => {
      const { board, refills, handler } = stickySetup();
      await expect(run(handler, { kind: 'sticky', clear: true, cells }, board)).rejects.toThrow(
        'sticky: clear takes no cells',
      );
      expect(refills).toEqual([]);
    });

    it('with on: refused', async () => {
      const { board, refills, handler } = stickySetup();
      await expect(
        run(handler, { kind: 'sticky', clear: true, on: true }, board),
      ).rejects.toThrow('sticky: clear takes no cells');
      expect(refills).toEqual([]);
    });
  });
});

describe('giant', () => {
  const cfg = { ms: 420, easing: 'easeOutBack' as const };
  /** Every view the resolver hands out can be resized — the giant's is resized to its area. */
  const resolve = () => Object.assign(new Container(), { resize: vi.fn() }) as never;
  function giantSetup() {
    const { reels, board, refills } = setup(resolve);
    const layer = createOverlayLayer(reels.kit());
    const handler = createGiantHandler(depsOf(reels, cfg, layer));
    return { reels, board, refills, layer, handler };
  }
  const step = { kind: 'giant', col: 1, row: 0, width: 2, height: 2, symbol: 'H1' };
  const H1 = { symbol: 'H1' };
  const after = boardWith({ '1,0': H1, '2,0': H1, '1,1': H1, '2,1': H1 });
  const covered = ['1,0', '2,0', '1,1', '2,1'];

  /** The `col,row` of every hidden cell. */
  function hidden(reels: ReelSystem): string[] {
    const out: string[] = [];
    for (let col = 0; col < 3; col++)
      for (let row = 0; row < 3; row++)
        if (!reels.grid.getCell(col, row).visible) out.push(`${col},${row}`);
    return out.sort();
  }

  it('is the step kind', () => {
    expect(giantSetup().handler.kind).toBe('giant');
  });

  it('one view over the area, its cells = the symbol and hidden', async () => {
    const { reels, board, refills, layer, handler } = giantSetup();
    await pump(run(handler, step, board));

    expect(refills).toEqual([after]);
    expect(hidden(reels)).toEqual(covered.slice().sort());
    const giants = childrenLabelled(layer, 'giant');
    expect(giants).toHaveLength(1);
    const [giant] = giants;
    expect([giant.scale.x, giant.scale.y, giant.alpha]).toEqual([1, 1, 1]);
    // centred on the area, sized to 2×2 cells (the legacy footprint: cells × cell size)
    const a = reels.grid.cellPosition(1, 0);
    const b = reels.grid.cellPosition(2, 1);
    expect([giant.x, giant.y]).toEqual([(a.x + b.x) / 2, (a.y + b.y) / 2]);
    expect((giant.children[0] as unknown as { resize: unknown }).resize).toHaveBeenLastCalledWith({
      width: 100,
      height: 100,
    });
    expectCellsHome(reels);
  });

  it('a second giant before a spin replaces the first; clearGiants shows every cell again', async () => {
    const { reels, board, layer, handler } = giantSetup();
    await pump(run(handler, step, board));
    await pump(
      run(handler, { kind: 'giant', col: 0, row: 1, width: 1, height: 2, symbol: 'W' }, board),
    );
    expect(childrenLabelled(layer, 'giant')).toHaveLength(1);
    expect(hidden(reels)).toEqual(['0,1', '0,2']);

    layer.clearGiants();
    expect(childrenLabelled(layer, 'giant')).toHaveLength(0);
    expect(hidden(reels)).toEqual([]);
  });

  it.each([
    [{ width: 9 }, 'giant: the 9×2 area at (1, 0) does not fit the grid'],
    [{ row: 2 }, 'giant: the 2×2 area at (1, 2) does not fit the grid'],
    [{ height: 0 }, 'giant: the 2×0 area at (1, 0) does not fit the grid'],
  ])('%o is refused, board untouched', async (over, message) => {
    const { reels, board, refills, layer, handler } = giantSetup();
    await expect(run(handler, { ...step, ...over }, board)).rejects.toThrow(message);
    expect(refills).toEqual([]);
    expect(reels.board).toEqual(startBoard());
    expect(layer.view.children).toHaveLength(0);
  });

  it('skip() mid scale-in: the giant at full size, its cells hidden, the end board', async () => {
    const { reels, board, refills, layer, handler } = giantSetup();
    await skipMidRun(handler, run(handler, step, board));

    expect(refills).toEqual([after]);
    expect(hidden(reels)).toEqual(covered.slice().sort());
    const [giant] = childrenLabelled(layer, 'giant');
    expect([giant.scale.x, giant.scale.y, giant.alpha]).toEqual([1, 1, 1]);
    expect(Tween.activeTweens).toBe(0);
  });

  it('turbo halves the run', async () => {
    const normal = giantSetup();
    const full = await pump(run(normal.handler, step, normal.board));
    const quick = giantSetup();
    const half = await pump(run(quick.handler, step, quick.board, { turbo: true }));
    expect(half / full).toBeGreaterThan(0.4);
    expect(half / full).toBeLessThan(0.6);
  });

  describe('clear: true', () => {
    it('clears the giant, re-shows its cells, no re-seat', async () => {
      const { reels, board, refills, layer, handler } = giantSetup();
      await pump(run(handler, step, board));

      await pump(run(handler, { kind: 'giant', clear: true }, board));
      expect(childrenLabelled(layer, 'giant')).toHaveLength(0);
      expect(hidden(reels)).toEqual([]);
      // only the area step re-seated the board — the clear step changed no cell
      expect(refills).toEqual([after]);
    });

    it('with no giant up: no error, no-op', async () => {
      const { board, refills, layer, handler } = giantSetup();
      await pump(run(handler, { kind: 'giant', clear: true }, board));
      expect(childrenLabelled(layer, 'giant')).toHaveLength(0);
      expect(refills).toEqual([]);
    });

    it('with an area field: refused', async () => {
      const { board, refills, handler } = giantSetup();
      await expect(run(handler, { kind: 'giant', clear: true, width: 2 }, board)).rejects.toThrow(
        'giant: clear takes no area',
      );
      expect(refills).toEqual([]);
    });
  });
});
