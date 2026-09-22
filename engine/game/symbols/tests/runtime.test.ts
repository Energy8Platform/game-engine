globalThis.requestAnimationFrame = ((fn: (t: number) => void) =>
  setTimeout(() => fn(performance.now()), 16)) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = clearTimeout as unknown as typeof cancelAnimationFrame;

import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { Container, Sprite, Text, Texture, TextureSource } from 'pixi.js';
import type { SymbolsDoc } from '@energy8engine/contracts';
import { createNodeTypes, image, type ScenesService } from '@energy8engine/scenes';
import { spritesheet } from '@energy8engine/node-media';
import * as runtime from '../src/runtime';
import type { SymbolsService } from '../src/runtime';

const png = new Texture({ source: new TextureSource({ width: 32, height: 16 }) });

const doc: SymbolsDoc = {
  version: 1,
  symbols: [
    {
      id: '1',
      static: { type: 'image', props: { src: 'assets/symbols/1.png' } },
      win: { type: 'spritesheet', props: { sheet: 'assets/coin.json', loop: false } },
    },
    { id: '2', static: { type: 'image', props: { src: 'assets/symbols/1.png' } } },
  ],
};

const fetchOk = (body: unknown) =>
  vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

async function boot(
  fetchFn = fetchOk({ doc: null, known: [], diagnostics: [] }),
  fakeBoard = true,
) {
  const ctx = new Context();
  const nodeTypes = createNodeTypes();
  nodeTypes.register(image);
  nodeTypes.register(spritesheet);
  ctx.provide('nodeTypes', nodeTypes);
  const assets: Record<string, unknown> = {};
  const loader = {
    load: vi.fn(async (urls: string[]) => {
      for (const u of urls) if (u.endsWith('.png')) assets[u] = png;
    }),
    unload: vi.fn(async () => {}),
    get: (url: string) => assets[url],
  };
  ctx.provide('assetLoader', loader);
  const report = vi.fn();
  ctx.provide('diagnostics', { report });
  const board = { repaint: vi.fn() };
  if (fakeBoard) ctx.provide('board', board);
  const fiber = ctx.plugin(runtime, { fetchFn });
  await fiber;
  const symbols = ctx.get('symbols') as SymbolsService;
  const resolve = (ctx.get('assets') as { resolve(id: string): Container }).resolve;
  return { ctx, fiber, loader, report, board, symbols, resolve };
}

const wrapperOf = (view: Container, state: string) =>
  view.children.find((c) => c.label === state) as Container | undefined;
const isBox = (view: Container, id: string) =>
  view.children.length === 1 && (view.children[0].children[1] as Text)?.text === id;
const settle = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('symbols row', () => {
  it('names itself, injects nothing, provides assets.resolve and symbols', async () => {
    expect(runtime.name).toBe('symbols');
    expect(runtime.inject).toEqual([]);
    const { symbols, resolve } = await boot();
    expect(resolve).toBeTypeOf('function');
    expect(symbols.replace).toBeTypeOf('function');
    await symbols.ready;
    expect(symbols.doc()).toBeNull();
  });

  it('resolve before a doc is the fallback box plus one diagnostic per id', async () => {
    const { resolve, report, symbols } = await boot();
    await symbols.ready;
    const a = resolve('7');
    const b = resolve('7');
    expect(isBox(a, '7')).toBe(true);
    expect(isBox(b, '7')).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        plugin: 'symbols',
        where: 'symbols/7',
        message: 'no symbol "7" in symbols.yml',
      }),
    );
  });

  it('the boot GET replaces with the served doc; ready resolves after', async () => {
    const { symbols, resolve, loader } = await boot(fetchOk({ doc, known: [], diagnostics: [] }));
    await symbols.ready;
    expect(symbols.doc()).toEqual(doc);
    await settle();
    expect(loader.load).toHaveBeenCalledWith(['assets/symbols/1.png', 'assets/coin.json']);
    const view = resolve('1');
    expect((wrapperOf(view, 'static')!.children[0] as Sprite).texture).toBe(png);
  });

  it('a replace that lands before the GET wins over it', async () => {
    let resolveFetch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const gated = vi.fn(
      () =>
        new Promise((r) => {
          resolveFetch = r;
        }),
    ) as unknown as typeof fetch;
    const { symbols } = await boot(gated);
    const raced: SymbolsDoc = { version: 1, symbols: [] };
    symbols.replace(raced);
    resolveFetch({ ok: true, json: async () => ({ doc, known: [], diagnostics: [] }) });
    await symbols.ready;
    await settle();
    expect(symbols.doc()).toEqual(raced);
  });

  it('a failed GET is one diagnostic on /api/symbols; ready rejects when nothing replaced', async () => {
    const { symbols, report } = await boot(
      vi.fn(async () => {
        throw new Error('down');
      }) as unknown as typeof fetch,
    );
    await expect(symbols.ready).rejects.toThrow('down');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ plugin: 'symbols', where: '/api/symbols' }),
    );
  });

  it('a GET landing after dispose replaces nothing', async () => {
    let resolveFetch!: (v: { ok: boolean; json: () => Promise<unknown> }) => void;
    const gated = vi.fn(
      () =>
        new Promise((r) => {
          resolveFetch = r;
        }),
    ) as unknown as typeof fetch;
    const { symbols, fiber, report } = await boot(gated);
    await fiber.dispose();
    resolveFetch({ ok: true, json: async () => ({ doc, known: [], diagnostics: [] }) });
    await symbols.ready;
    expect(symbols.doc()).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it('replace re-applies live views, loads every state asset once, refreshes them and repaints the board', async () => {
    const { symbols, resolve, loader, board, report } = await boot();
    await symbols.ready;
    const view = resolve('1');
    const twin = resolve('1');
    expect(isBox(view, '1')).toBe(true);
    symbols.replace(doc);
    expect(symbols.doc()).toEqual(doc);
    const w = wrapperOf(view, 'static')!;
    expect((w.children[0] as Sprite).texture).toBe(Texture.EMPTY);
    expect(board.repaint).not.toHaveBeenCalled();
    await settle();
    expect(loader.load).toHaveBeenCalledTimes(1);
    expect(loader.load).toHaveBeenCalledWith(['assets/symbols/1.png', 'assets/coin.json']);
    expect((w.children[0] as Sprite).texture).toBe(png);
    expect((wrapperOf(twin, 'static')!.children[0] as Sprite).texture).toBe(png);
    expect(board.repaint).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('a load failure is one diagnostic; the board still repaints', async () => {
    const { symbols, loader, board, report } = await boot();
    await symbols.ready;
    loader.load.mockRejectedValueOnce(new Error('404'));
    symbols.replace(doc);
    await settle();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toMatchObject({ plugin: 'symbols', where: 'symbols' });
    expect(report.mock.calls[0][0].message).toContain('404');
    expect(board.repaint).toHaveBeenCalledTimes(1);
  });

  it('replace(null) drops the doc, live views fall back to the box, missing ids report again', async () => {
    const { symbols, resolve, report } = await boot(fetchOk({ doc, known: [], diagnostics: [] }));
    await symbols.ready;
    const view = resolve('1');
    expect(wrapperOf(view, 'static')).toBeDefined();
    expect(report).not.toHaveBeenCalled();
    symbols.replace(null);
    expect(symbols.doc()).toBeNull();
    expect(isBox(view, '1')).toBe(true);
    resolve('1');
    expect(report).toHaveBeenCalledTimes(1);
    symbols.replace(doc);
    symbols.replace(null);
    resolve('1');
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('preview returns a fitted container of one state, null for an absent state or id', async () => {
    const { symbols } = await boot(fetchOk({ doc, known: [], diagnostics: [] }));
    await symbols.ready;
    await settle();
    const view = symbols.preview('1', 'static', { width: 64, height: 64 })!;
    expect(view).toBeInstanceOf(Container);
    const w = wrapperOf(view, 'static')!;
    expect(w.scale.x).toBeCloseTo(2);
    expect((view as { playWin?: unknown }).playWin).toBeUndefined();
    const win = symbols.preview('1', 'win', { width: 64, height: 64 })!;
    expect(wrapperOf(win, 'win')).toBeDefined();
    expect(symbols.preview('1', 'idle', { width: 64, height: 64 })).toBeNull();
    expect(symbols.preview('9', 'static', { width: 64, height: 64 })).toBeNull();
  });

  it('a destroyed view leaves the live set: a later replace no longer touches it', async () => {
    const { symbols, resolve, ctx } = await boot(fetchOk({ doc, known: [], diagnostics: [] }));
    await symbols.ready;
    // A handle keeps the type it mounted with (as a scene entry does): swap in the spy before resolving.
    const update = vi.fn(image.update!);
    (ctx.get('nodeTypes') as ReturnType<typeof createNodeTypes>).register({ ...image, update });
    const gone = resolve('2');
    const kept = resolve('2');
    const previewed = symbols.preview('2', 'static', { width: 8, height: 8 })!;
    update.mockClear();
    gone.destroy();
    previewed.destroy();
    symbols.replace({ ...doc, symbols: [...doc.symbols] });
    await settle();
    expect(kept.destroyed).toBe(false);
    expect(update.mock.calls.every(([v]) => v === wrapperOf(kept, 'static')!.children[0])).toBe(
      true,
    );
    expect(update).toHaveBeenCalled();
  });
});

describe('symbols row against the real reels board', () => {
  it('cells take the view sized to the cell; repaint re-resolves and the old handles leave the live set', async () => {
    const { createReelsBoard } = await import('@energy8engine/reels');
    const { symbols, resolve, ctx } = await boot(
      fetchOk({ doc, known: [], diagnostics: [] }),
      false,
    );
    await symbols.ready;
    await settle();
    const update = vi.fn(image.update!);
    (ctx.get('nodeTypes') as ReturnType<typeof createNodeTypes>).register({ ...image, update });
    const board = createReelsBoard({
      resolve,
      config: { grid: { cols: 2, rows: 1, cellSize: 64 } },
    });
    ctx.provide('board', board);
    await board.refill({ kind: 'refill', board: [[1], [2]] });
    const cell = board.grid.getCell(0, 0) as unknown as { view: Container | null };
    const first = cell.view!;
    expect(wrapperOf(first, 'static')!.scale.x).toBeCloseTo(2); // 64 / 32
    expect(first.parent).toBeDefined();

    update.mockClear();
    symbols.replace({ ...doc, symbols: doc.symbols.map((d) => ({ ...d, fit: 'none' as const })) });
    await settle();
    expect(first.destroyed).toBe(true);
    const second = cell.view!;
    expect(second).not.toBe(first);
    expect(wrapperOf(second, 'static')!.scale.x).toBe(1);
    // Exactly the two views the board holds now are live: the next replace remounts them (2),
    // refreshes them after the load (2) and mounts two more on the repaint (2). Had the two
    // views the first repaint destroyed stayed in the live set, they would add four more.
    update.mockClear();
    symbols.replace(doc);
    await settle();
    expect(update).toHaveBeenCalledTimes(6);
    board.destroy();
  });
});

/**
 * Slice 30: a def's states are the three built-ins plus every key of
 * `states`, and one of them may be a `scene` — whose assets are the
 * document's, which only the scenes runtime can name.
 */
describe('named and scene states', () => {
  const doc30: SymbolsDoc = {
    version: 1,
    symbols: [
      {
        id: '3',
        static: { type: 'image', props: { src: 'assets/symbols/3.png' } },
        states: {
          death: { type: 'image', props: { src: 'assets/death.png' } },
          celebrate: { type: 'scene', props: { scene: 'orb' } },
        },
      },
    ],
  };

  it('preloads every named state, a scene state through scenes.assetsOf', async () => {
    const { ctx, symbols, loader } = await boot();
    await symbols.ready;
    const assetsOf = vi.fn((id: string) => (id === 'orb' ? ['assets/orb.png'] : []));
    ctx.provide('scenes', { assetsOf } as unknown as ScenesService);
    symbols.replace(doc30);
    await settle();
    expect(assetsOf).toHaveBeenCalledWith('orb');
    expect(loader.load).toHaveBeenCalledWith([
      'assets/symbols/3.png',
      'assets/death.png',
      'assets/orb.png',
    ]);
  });

  it('without a scenes runtime the other states still load', async () => {
    const { symbols, loader, report } = await boot();
    await symbols.ready;
    symbols.replace(doc30);
    await settle();
    expect(loader.load).toHaveBeenCalledWith(['assets/symbols/3.png', 'assets/death.png']);
    expect(report).not.toHaveBeenCalled();
  });

  it('preview pins a named state', async () => {
    const { symbols } = await boot();
    await symbols.ready;
    symbols.replace(doc30);
    await settle();
    const view = symbols.preview('3', 'death', { width: 64, height: 64 })!;
    expect(wrapperOf(view, 'death')).toBeDefined();
    expect(symbols.preview('3', 'nope', { width: 64, height: 64 })).toBeNull();
  });
});
