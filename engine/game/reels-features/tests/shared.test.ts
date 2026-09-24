/**
 * The helpers every feature handler stands on: the data check (`checkCells`), the re-seat through
 * the board's `refill` (`reseat`), the per-run tempo (`createPace`), the kit/board lookup (`need`),
 * and the row's persistent overlay layer (`createOverlayLayer`).
 */
import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import {
  ReelGrid,
  createReelSystem,
  type ReelKit,
  type ReelSystem,
} from '@energy8engine/reel-core';
import { checkCells, createPace, need, reseat, type FeatureDeps } from '../src/shared';
import { createOverlayLayer } from '../src/layer';

const resolve = () => new Container() as never;

describe('checkCells', () => {
  const grid = new ReelGrid({ cols: 3, rows: 3, cellSize: 50, resolve });
  /** A ragged grid: reel 1 is a row short. */
  const ragged = new ReelGrid({ cols: 3, rows: 3, rowsPerReel: [3, 2, 3], cellSize: 50, resolve });

  it('accepts cells inside the grid, the corners included', () => {
    expect(() =>
      checkCells('reveal', grid, [
        { col: 0, row: 0 },
        { col: 2, row: 2 },
      ]),
    ).not.toThrow();
    expect(() => checkCells('reveal', ragged, [{ col: 1, row: 1 }])).not.toThrow();
  });

  it('refuses a column past `cols`, naming the kind, the field and the cell', () => {
    expect(() =>
      checkCells('reveal', grid, [
        { col: 0, row: 0 },
        { col: 3, row: 0 },
      ]),
    ).toThrow('reveal: cells[1] (3, 0) is outside the grid');
  });

  it('refuses a row past a SHORT reel’s own height, though the grid is taller', () => {
    expect(() => checkCells('dropWilds', ragged, [{ col: 1, row: 2 }], 'spots')).toThrow(
      'dropWilds: spots[0] (1, 2) is outside the grid',
    );
  });

  it('refuses an empty list', () => {
    expect(() => checkCells('transform', grid, [])).toThrow('transform: cells is empty');
  });
});

describe('reseat', () => {
  it('refills once with the live board, changed only at the given cells — extras kept', async () => {
    const live = [
      [{ symbol: 'A', band: 2 }, { symbol: 'B' }],
      [{ symbol: 'C' }, { symbol: 'D' }],
    ];
    const kit = { board: live } as unknown as ReelKit;
    const refill = vi.fn(async () => {});
    const opts = { turbo: true };

    await reseat({ refill }, kit, [{ col: 1, row: 0, data: { symbol: 'W', multiplier: 3 } }], opts);

    expect(refill).toHaveBeenCalledTimes(1);
    expect(refill).toHaveBeenCalledWith(
      {
        kind: 'refill',
        board: [
          [{ symbol: 'A', band: 2 }, { symbol: 'B' }],
          [{ symbol: 'W', multiplier: 3 }, { symbol: 'D' }],
        ],
      },
      opts,
    );
    // the live board itself is not written to — the refill is what changes it
    expect(live[1][0]).toEqual({ symbol: 'C' });
  });
});

describe('createPace', () => {
  it('halves under turbo, answers 0 once skipped — and a new pace starts unskipped', () => {
    const pace = createPace({ turbo: true });
    expect(pace.ms(100)).toBe(50);
    expect(pace.skipped).toBe(false);
    pace.skip();
    expect(pace.skipped).toBe(true);
    expect(pace.ms(100)).toBe(0);

    const next = createPace();
    expect(next.skipped).toBe(false);
    expect(next.ms(100)).toBe(100);
  });
});

describe('need', () => {
  const deps = (reels: ReelSystem | undefined): FeatureDeps<unknown> => ({
    reels: () => reels,
    config: () => ({}),
    layer: () => undefined,
  });

  it('hands back the kit, the board and the reels', () => {
    const reels = createReelSystem({ resolve, grid: { cols: 3, rows: 3 } });
    const board = { refill: async () => {} };
    const got = need('reveal', deps(reels), board);
    expect(got.kit).toBe(reels.kit());
    expect(got.board).toBe(board);
    expect(got.reels).toBe(reels);
  });

  it('with no reels: a throw naming the step and the row that provides one', () => {
    expect(() => need('reveal', deps(undefined), { refill: async () => {} })).toThrow(
      /the "reveal" step needs the reel system.*"reels1"/,
    );
  });

  it('with a board that cannot refill: a throw naming the step and the row', () => {
    const reels = createReelSystem({ resolve, grid: { cols: 3, rows: 3 } });
    expect(() => need('reveal', deps(reels), { spinTo: async () => {} })).toThrow(
      /the "reveal" step needs a reel board to run on.*"reels1"/,
    );
  });
});

describe('createOverlayLayer', () => {
  function setup() {
    const reels = createReelSystem({ resolve, grid: { cols: 3, rows: 3 } });
    const kit = reels.kit();
    return { kit, layer: createOverlayLayer(kit) };
  }
  const labelled = (c: Container, label: string) => c.children.filter((x) => x.label === label);

  it('sits on the grid above the cells and the fx layer', () => {
    const { kit, layer } = setup();
    expect(layer.view.label).toBe('reels-features');
    expect(kit.grid.children.indexOf(layer.view)).toBeGreaterThan(
      kit.grid.children.indexOf(kit.fx),
    );
  });

  it('one sticky ring per cell however often it is asked; ringOff takes only that one', () => {
    const { layer } = setup();
    layer.ringOn({ col: 0, row: 0 }, 0xec4899);
    layer.ringOn({ col: 0, row: 0 }, 0xec4899);
    layer.ringOn({ col: 1, row: 2 }, 0xec4899);
    expect(labelled(layer.view, 'sticky')).toHaveLength(2);
    layer.ringOff({ col: 0, row: 0 });
    layer.ringOff({ col: 2, row: 2 }); // never on — nothing to do
    expect(labelled(layer.view, 'sticky')).toHaveLength(1);
  });

  it('a second giant replaces the first; clearGiants destroys it and re-shows the cells it hid', () => {
    const { kit, layer } = setup();
    const first = new Container();
    layer.showGiant(first);
    layer.hideForGiant([kit.grid.getCell(0, 0)]);
    const second = new Container();
    layer.showGiant(second);
    layer.hideForGiant([kit.grid.getCell(1, 1)]);

    expect(labelled(layer.view, 'giant')).toEqual([second]);
    expect(first.destroyed).toBe(true);
    // the first giant's cell is not left as a hole
    expect(kit.grid.getCell(0, 0).visible).toBe(true);
    expect(kit.grid.getCell(1, 1).visible).toBe(false);

    layer.clearGiants();
    expect(labelled(layer.view, 'giant')).toHaveLength(0);
    expect(second.destroyed).toBe(true);
    expect(kit.grid.getCell(1, 1).visible).toBe(true);
  });

  it('destroy takes the layer off the grid, and survives the grid going first', () => {
    const { kit, layer } = setup();
    layer.ringOn({ col: 0, row: 0 }, 0xec4899);
    layer.destroy();
    expect(kit.grid.children.some((c) => c.label === 'reels-features')).toBe(false);

    const again = setup();
    again.kit.grid.destroy({ children: true });
    expect(() => again.layer.destroy()).not.toThrow();
  });
});
