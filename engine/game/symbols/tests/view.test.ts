globalThis.requestAnimationFrame = ((fn: (t: number) => void) =>
  setTimeout(() => fn(performance.now()), 16)) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = clearTimeout as unknown as typeof cancelAnimationFrame;

/**
 * `fit` measures every wrapper, and a pixi `Text`'s bounds go through
 * `CanvasTextMetrics` — `document.createElement('canvas')` and a 2D
 * context, neither of which plain Node has. This much of a canvas (10 px
 * per character, whatever the size) is all a `text` state needs here: the
 * assertions below are on what the type was told, never on the box.
 */
class FakeContext2D {}
globalThis.CanvasRenderingContext2D = FakeContext2D as unknown as typeof CanvasRenderingContext2D;
const context2d = Object.assign(new FakeContext2D(), {
  font: '',
  measureText: (s: string) => ({
    width: s.length * 10,
    actualBoundingBoxAscent: 8,
    actualBoundingBoxDescent: 2,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: s.length * 10,
  }),
});
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => context2d }),
} as unknown as Document;

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import {
  AnimatedSprite,
  Container,
  Graphics,
  Sprite,
  Spritesheet,
  Text,
  Texture,
  TextureSource,
} from 'pixi.js';
import type { SymbolDef } from '@energy8engine/contracts';
import {
  createNodeTypes,
  image,
  text,
  type NodeType,
  type ScenesService,
} from '@energy8engine/scenes';
import { spritesheet } from '@energy8engine/node-media';
import Schema from 'schemastery';
import { createSymbolHandle, type ViewDeps } from '../src/view';

const frame = (x: number) => ({ frame: { x, y: 0, w: 8, h: 8 } });
let sheet: Spritesheet;
const png = new Texture({ source: new TextureSource({ width: 32, height: 16 }) });
beforeAll(async () => {
  sheet = new Spritesheet(Texture.WHITE, {
    frames: { a: frame(0), b: frame(8) },
    meta: { scale: 1 },
    animations: { spin: ['a', 'b'] },
  });
  await sheet.parse();
});

const SIZE = { width: 96, height: 96 };
const STATIC = { type: 'image', props: { src: 'assets/symbols/1.png' } };
const IDLE = { type: 'spritesheet', props: { sheet: 'assets/idle.json' } };
const WIN = { type: 'spritesheet', props: { sheet: 'assets/coin.json', loop: false } };

function setup(
  loaded: Record<string, unknown> = {
    'assets/symbols/1.png': png,
    'assets/coin.json': sheet,
    'assets/idle.json': sheet,
  },
) {
  const ctx = new Context();
  const nodeTypes = createNodeTypes();
  nodeTypes.register(image);
  nodeTypes.register(spritesheet);
  nodeTypes.register(text);
  const assets: Record<string, unknown> = { ...loaded };
  ctx.provide('assetLoader', {
    load: vi.fn(async () => {}),
    unload: vi.fn(async () => {}),
    get: (url: string) => assets[url],
  });
  const report = vi.fn();
  const deps: ViewDeps = { ctx, nodeTypes: () => nodeTypes, report };
  return { ctx, nodeTypes, assets, report, deps };
}

const wrapperOf = (view: Container, state: string) =>
  view.children.find((c) => c.label === state) as Container | undefined;

describe('createSymbolHandle', () => {
  it('with no def shows the fallback box with the id, sized by resize, and defines no playWin', () => {
    const { deps } = setup();
    const h = createSymbolHandle('3', deps);
    h.apply(undefined);
    h.resize(SIZE);
    expect(h.view.children).toHaveLength(1);
    const box = h.view.children[0] as Container;
    expect(box.children[0]).toBeInstanceOf(Graphics);
    expect((box.children[1] as Text).text).toBe('3');
    expect(h.view.playWin).toBeUndefined();
    h.resize({ width: 64, height: 48 });
    expect(h.view.children).toHaveLength(1);
    expect((h.view.children[0].children[1] as Text).text).toBe('3');
  });

  it('after apply shows the static wrapper, fitted to resize (contain) and centred', () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC });
    h.resize(SIZE);
    const w = wrapperOf(h.view, 'static')!;
    expect(w.children[0]).toBeInstanceOf(Sprite);
    expect((w.children[0] as Sprite).texture).toBe(png);
    expect(w.scale.x).toBeCloseTo(96 / 32);
    expect(w.pivot.x).toBeCloseTo(16);
    expect(w.pivot.y).toBeCloseTo(8);
    expect(w.position.x).toBe(0);
    expect(w.position.y).toBe(0);
    h.resize({ width: 32, height: 8 });
    expect(w.scale.x).toBeCloseTo(0.5);
  });

  it('a common `x` on the state moves the art inside the cell (+x·s), and `scale` shrinks it under contain', () => {
    const { deps } = setup();
    const nudged = createSymbolHandle('1', deps);
    nudged.apply({
      id: '1',
      static: { type: 'image', props: { src: 'assets/symbols/1.png', x: 20 } },
    });
    nudged.resize(SIZE);
    // 32×16 art at s = 3 (96 / 32): the centre lands at +20·3 = 60, the width stays 96.
    const b = nudged.view.getLocalBounds();
    expect(b.x + b.width / 2).toBeCloseTo(60);
    expect(b.y + b.height / 2).toBeCloseTo(0);
    expect(b.width).toBeCloseTo(96);

    const shrunk = createSymbolHandle('1', deps);
    shrunk.apply({
      id: '1',
      static: { type: 'image', props: { src: 'assets/symbols/1.png', scale: 0.5 } },
    });
    shrunk.resize(SIZE);
    const c = shrunk.view.getLocalBounds();
    expect(c.width).toBeCloseTo(48);
    expect(c.x + c.width / 2).toBeCloseTo(0);
    expect(c.y + c.height / 2).toBeCloseTo(0);
  });

  it('a common `rotation` turns the art about the cell centre; with `x` too the nudge still lands at +x·s', () => {
    const { deps } = setup();
    const centre = (h: ReturnType<typeof createSymbolHandle>) => {
      const b = h.view.getLocalBounds();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
    };
    const turned = createSymbolHandle('1', deps);
    turned.apply({
      id: '1',
      static: { type: 'image', props: { src: 'assets/symbols/1.png', rotation: Math.PI / 2 } },
    });
    turned.resize(SIZE);
    // 32×16 turned a quarter: 16 wide, 32 tall, at s = 3 → 48×96, still centred.
    expect(centre(turned).x).toBeCloseTo(0);
    expect(centre(turned).y).toBeCloseTo(0);
    expect(centre(turned).w).toBeCloseTo(48);
    expect(centre(turned).h).toBeCloseTo(96);

    const both = createSymbolHandle('1', deps);
    both.apply({
      id: '1',
      static: {
        type: 'image',
        props: { src: 'assets/symbols/1.png', rotation: Math.PI / 2, x: 20 },
      },
    });
    both.resize(SIZE);
    expect(centre(both).x).toBeCloseTo(60);
    expect(centre(both).y).toBeCloseTo(0);
  });

  it('fit: none only centres', () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', fit: 'none', static: STATIC });
    h.resize(SIZE);
    const w = wrapperOf(h.view, 'static')!;
    expect(w.scale.x).toBe(1);
    expect(w.pivot.x).toBeCloseTo(16);
  });

  it('idle wins at rest; `only` pins a state', () => {
    const { deps } = setup();
    const def: SymbolDef = { id: '1', static: STATIC, idle: IDLE, win: WIN };
    const h = createSymbolHandle('1', deps);
    h.apply(def);
    expect(wrapperOf(h.view, 'idle')).toBeDefined();
    expect(wrapperOf(h.view, 'static')).toBeUndefined();
    const only = createSymbolHandle('1', deps, { only: 'static' });
    only.apply(def);
    expect(wrapperOf(only.view, 'static')).toBeDefined();
    expect(wrapperOf(only.view, 'idle')).toBeUndefined();
    expect(only.view.playWin).toBeUndefined();
  });

  it('playWin mounts win, awaits once, then restores the rest wrapper', async () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC, win: WIN });
    h.resize(SIZE);
    expect(h.view.playWin).toBeTypeOf('function');
    const rest = wrapperOf(h.view, 'static')!;
    const p = h.view.playWin!();
    expect(rest.visible).toBe(false);
    const win = wrapperOf(h.view, 'win')!;
    const sprite = win.children[0] as AnimatedSprite;
    expect(sprite.textures).toEqual([sheet.textures.a, sheet.textures.b]);
    expect(win.scale.x).toBeCloseTo(12);
    let done = false;
    void p.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    sprite.onComplete!();
    await p;
    expect(wrapperOf(h.view, 'win')).toBeUndefined();
    expect(sprite.destroyed).toBe(true);
    expect(rest.visible).toBe(true);
  });

  it("playWin resolves on view.destroy() even when the win type's once never settles", async () => {
    const { deps, nodeTypes } = setup();
    const stuck: NodeType = {
      type: 'stuck',
      schema: Schema.object({}),
      mount: () => new Container(),
      once: () => new Promise<void>(() => {}), // never resolves on its own
    };
    nodeTypes.register(stuck);
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC, win: { type: 'stuck', props: {} } });
    h.resize(SIZE);
    // The handle's own teardown listener is already on `'destroyed'` at this point (registered
    // at construction) — `playWin` adds a second, its own race listener.
    const before = h.view.listenerCount('destroyed');
    const p = h.view.playWin!();
    expect(h.view.listenerCount('destroyed')).toBe(before + 1);
    let done = false;
    void p.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    h.view.destroy();
    await p;
    expect(done).toBe(true);
    // No leftover listener from `playWin`'s `finally { view.off(...) }` stacking on top of
    // whatever pixi's own `destroy()` already swept — nothing survives the resolve either way.
    expect(h.view.listenerCount('destroyed')).toBe(0);
  });

  it('a win type without once holds 600 ms', async () => {
    vi.useFakeTimers();
    try {
      const { deps } = setup();
      const h = createSymbolHandle('1', deps);
      h.apply({ id: '1', static: STATIC, win: STATIC });
      let done = false;
      void h.view.playWin!().then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(599);
      expect(done).toBe(false);
      expect(wrapperOf(h.view, 'win')).toBeDefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      expect(wrapperOf(h.view, 'win')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('defines no playWin without win', () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC });
    expect('playWin' in h.view).toBe(false);
    h.apply({ id: '1', static: STATIC, win: WIN });
    expect(h.view.playWin).toBeTypeOf('function');
    h.apply({ id: '1', static: STATIC });
    expect('playWin' in h.view).toBe(false);
  });

  it('showStatic unmounts a win in flight; the once it was awaiting then resolves into a no-op', async () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC, win: WIN });
    const rest = wrapperOf(h.view, 'static')!;
    const p = h.view.playWin!();
    const win = wrapperOf(h.view, 'win')!;
    h.view.showStatic!();
    expect(win.destroyed).toBe(true);
    expect(wrapperOf(h.view, 'win')).toBeUndefined();
    expect(rest.visible).toBe(true);
    await p;
    expect(h.view.children).toEqual([rest]);
    expect(rest.visible).toBe(true);
  });

  it('apply keeps the wrapper of a JSON-equal def and remounts a changed one', () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC });
    const before = wrapperOf(h.view, 'static')!;
    h.apply({ id: '1', static: { type: 'image', props: { src: 'assets/symbols/1.png' } } });
    expect(wrapperOf(h.view, 'static')).toBe(before);
    h.apply({ id: '1', static: { type: 'image', props: { src: 'assets/symbols/2.png' } } });
    expect(wrapperOf(h.view, 'static')).not.toBe(before);
    expect(before.destroyed).toBe(true);
  });

  it('an unknown node type leaves the wrapper empty and reports once', () => {
    const { deps, report } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: { type: 'nope', props: {} } });
    h.resize(SIZE);
    h.refresh();
    expect(wrapperOf(h.view, 'static')!.children).toHaveLength(0);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('symbols/1/static', 'unknown node type "nope"');
  });

  it('a throwing type is reported once per handle and never takes the view down', async () => {
    const { deps, nodeTypes, report } = setup();
    const bomb: NodeType = {
      type: 'bomb',
      schema: Schema.object({}),
      mount: () => new Container(),
      update: () => {
        throw new Error('boom');
      },
      once: () => {
        throw new Error('kaboom');
      },
    };
    nodeTypes.register(bomb);
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: { type: 'bomb', props: {} }, win: { type: 'bomb', props: {} } });
    h.refresh();
    h.refresh();
    expect(wrapperOf(h.view, 'static')).toBeDefined();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toBe('symbols/1/static');
    expect(report.mock.calls[0][1]).toContain('boom');
    await h.view.playWin!();
    expect(wrapperOf(h.view, 'win')).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls[1][0]).toBe('symbols/1/win');
  });

  it('refresh fills a placeholder in after a load, then refits', () => {
    const { deps, assets } = setup({});
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC });
    h.resize(SIZE);
    const w = wrapperOf(h.view, 'static')!;
    const sprite = w.children[0] as Sprite;
    expect(sprite.texture).toBe(Texture.EMPTY);
    assets['assets/symbols/1.png'] = png;
    h.refresh();
    expect(sprite.texture).toBe(png);
    expect(w.scale.x).toBeCloseTo(3);
  });

  it('destroy unmounts every wrapper, destroys the view and calls onDestroy — from the cell side too', () => {
    const { deps, nodeTypes } = setup();
    const unmount = vi.fn((v: Container) => v.destroy());
    nodeTypes.register({ ...spritesheet, unmount });
    const onDestroy = vi.fn();
    const h = createSymbolHandle('1', deps, { onDestroy });
    h.apply({ id: '1', static: STATIC, idle: IDLE });
    h.destroy();
    expect(unmount).toHaveBeenCalledTimes(1);
    expect(h.view.destroyed).toBe(true);
    expect(onDestroy).toHaveBeenCalledTimes(1);

    const cellSide = createSymbolHandle('1', deps, { onDestroy });
    cellSide.apply({ id: '1', static: STATIC, idle: IDLE });
    cellSide.view.destroy();
    expect(unmount).toHaveBeenCalledTimes(2);
    expect(onDestroy).toHaveBeenCalledTimes(2);
    cellSide.destroy();
    expect(onDestroy).toHaveBeenCalledTimes(2);
  });
});

/**
 * Slice 24: a state's props may hold `'$cell.<field>'`, resolved against
 * the data of the cell the symbol landed in (`bind`, called by the reels
 * board). `text` is the natural subject — the one type that puts the
 * value on screen.
 */
describe('$cell bindings', () => {
  const textOf = (h: { view: Container }, state = 'static') =>
    wrapperOf(h.view, state)!.children[0] as Text;

  it("stands at the prop's empty until bound, then says what the cell carries", () => {
    const { deps } = setup();
    const h = createSymbolHandle('orb', deps);
    h.apply({ id: 'orb', static: { type: 'text', props: { text: '$cell.multiplier' } } });
    h.resize(SIZE);
    // the raw `$cell.` string never reached the type: the empty string did
    expect(textOf(h).text).toBe('');
    h.view.bind({ symbol: 'orb', multiplier: 5 });
    expect(textOf(h).text).toBe('5');
  });

  it("a union prop stands at its FIRST literal until bound — the empty '' would be refused — and takes the cell's value", () => {
    const { deps, report } = setup();
    const h = createSymbolHandle('orb', deps);
    h.apply({ id: 'orb', static: { type: 'text', props: { text: 'x', align: '$cell.align' } } });
    expect(report).not.toHaveBeenCalled();
    expect(textOf(h).style.align).toBe('left');
    h.view.bind({ symbol: 'orb', align: 'right' });
    expect(textOf(h).style.align).toBe('right');
    // A cell without the field: the first literal again, not the stale 'right'.
    h.view.bind({ symbol: 'orb' });
    expect(textOf(h).style.align).toBe('left');
    expect(report).not.toHaveBeenCalled();
  });

  it('a number prop takes 0 for a field the cell does not carry, and the value when it does', () => {
    const { deps } = setup();
    const h = createSymbolHandle('orb', deps);
    h.apply({ id: 'orb', static: { type: 'text', props: { text: 'x', size: '$cell.size' } } });
    expect(textOf(h).style.fontSize).toBe(0);
    h.view.bind({ symbol: 'orb', multiplier: 5 });
    expect(textOf(h).style.fontSize).toBe(0);
    h.view.bind({ symbol: 'orb', size: 40 });
    expect(textOf(h).style.fontSize).toBe(40);
  });

  it('binds again on every call — the second spin overwrites the first', () => {
    const { deps } = setup();
    const h = createSymbolHandle('orb', deps);
    h.apply({ id: 'orb', static: { type: 'text', props: { text: '$cell.multiplier' } } });
    h.view.bind({ symbol: 'orb', multiplier: 5 });
    h.view.bind({ symbol: 'orb', multiplier: 7 });
    expect(textOf(h).text).toBe('7');
    // a cell that lost the field falls back to the empty, not to the stale 7
    h.view.bind({ symbol: 'orb' });
    expect(textOf(h).text).toBe('');
  });

  it('a state with no binding is left alone — no re-update per bound cell', () => {
    const { deps, nodeTypes } = setup();
    const update = vi.fn(text.update!);
    nodeTypes.register({ ...text, update });
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: { type: 'text', props: { text: 'fixed' } } });
    update.mockClear();
    h.view.bind({ symbol: '1', multiplier: 5 });
    expect(update).not.toHaveBeenCalled();
    expect(textOf(h).text).toBe('fixed');
  });

  it('a win mounted after the bind carries it too', async () => {
    const { deps } = setup();
    const h = createSymbolHandle('orb', deps);
    h.apply({
      id: 'orb',
      static: STATIC,
      win: { type: 'text', props: { text: '$cell.multiplier' } },
    });
    h.view.bind({ symbol: 'orb', multiplier: 3 });
    const playing = h.view.playWin!();
    expect(textOf(h, 'win').text).toBe('3');
    await playing;
  });

  it('a binding on a common prop moves the view, and an absent field leaves it at 0', () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({
      id: '1',
      fit: 'none',
      static: { type: 'image', props: { src: 'assets/symbols/1.png', x: '$cell.multiplier' } },
    });
    h.resize(SIZE);
    expect(wrapperOf(h.view, 'static')!.children[0].x).toBe(0);
    h.view.bind({ symbol: '1', multiplier: 12 });
    expect(wrapperOf(h.view, 'static')!.children[0].x).toBe(12);
  });
});

/**
 * Slice 30: a state's node may be `{ type: scene }` — a private copy of a
 * scene document mounted for THIS cell (`scenes.mountCell`), which owns
 * the binding, the `once` and its own teardown. The fake below is that
 * service: one `CellMount` per document id, each a spy whose `once` the
 * test settles by hand.
 */
function cellMount(label = 'orb', bound = true) {
  const view = new Container();
  view.label = label;
  view.addChild(new Graphics().rect(-8, -8, 16, 16).fill(0xffffff));
  let settle: ((ran: boolean) => void) | undefined;
  return {
    view,
    bound,
    bind: vi.fn(),
    once: vi.fn(() => new Promise<boolean>((r) => (settle = r))),
    destroy: vi.fn(() => view.destroy({ children: true })),
    /** `ran`: whether any node of the copy had an `once` — what the floor below reads. */
    settle: (ran = true) => settle!(ran),
  };
}

function withScenes(ctx: Context, mounts: Record<string, ReturnType<typeof cellMount>>) {
  const mountCell = vi.fn((id: string, _data?: Record<string, unknown>) => mounts[id] ?? null);
  ctx.provide('scenes', { mountCell } as unknown as ScenesService);
  return mountCell;
}

describe('a scene state', () => {
  it('mounts the document as a cell copy, fits it, and binds through it', () => {
    const { ctx, deps } = setup();
    const orb = cellMount();
    const mountCell = withScenes(ctx, { orb });
    const h = createSymbolHandle('orb', deps);
    h.apply({ id: 'orb', static: { type: 'scene', props: { scene: 'orb' } } });
    h.resize(SIZE);
    expect(mountCell).toHaveBeenCalledWith('orb', undefined);
    const w = wrapperOf(h.view, 'static')!;
    expect(w.children).toEqual([orb.view]);
    expect(w.scale.x).toBeCloseTo(6); // 16 px of art in a 96 px cell
    h.view.bind({ symbol: 'orb', mv: 4 });
    expect(orb.bind).toHaveBeenCalledWith({ symbol: 'orb', mv: 4 });
  });

  it('mounted after a bind, the copy is built with that cell data', () => {
    const { ctx, deps } = setup();
    const coin = cellMount('coin');
    const mountCell = withScenes(ctx, { coin });
    const h = createSymbolHandle('orb', deps);
    h.apply({ id: 'orb', static: STATIC, win: { type: 'scene', props: { scene: 'coin' } } });
    h.view.bind({ symbol: 'orb', mv: 3 });
    void h.view.playWin!();
    expect(mountCell).toHaveBeenCalledWith('coin', { symbol: 'orb', mv: 3 });
  });

  it("playWin on a scene win awaits the copy's once, then destroys it and restores the rest", async () => {
    const { ctx, deps } = setup();
    const coin = cellMount('coin');
    withScenes(ctx, { coin });
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC, win: { type: 'scene', props: { scene: 'coin' } } });
    h.resize(SIZE);
    const rest = wrapperOf(h.view, 'static')!;
    const p = h.view.playWin!();
    expect(rest.visible).toBe(false);
    expect(coin.once).toHaveBeenCalledTimes(1);
    let done = false;
    void p.then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    coin.settle();
    await p;
    expect(coin.destroy).toHaveBeenCalledTimes(1);
    expect(wrapperOf(h.view, 'win')).toBeUndefined();
    expect(rest.visible).toBe(true);
  });

  it('without a scenes runtime, or with a document nothing declares, reports once and draws nothing', () => {
    const bare = setup();
    const h = createSymbolHandle('1', bare.deps);
    h.apply({ id: '1', static: { type: 'scene', props: { scene: 'orb' } } });
    expect(wrapperOf(h.view, 'static')!.children).toHaveLength(0);
    expect(bare.report).toHaveBeenCalledTimes(1);
    expect(bare.report.mock.calls[0][0]).toBe('symbols/1/static');

    const known = setup();
    withScenes(known.ctx, {});
    const absent = createSymbolHandle('1', known.deps);
    absent.apply({ id: '1', static: { type: 'scene', props: { scene: 'orb' } } });
    expect(wrapperOf(absent.view, 'static')!.children).toHaveLength(0);
    expect(known.report).toHaveBeenCalledTimes(1);
    expect(known.report.mock.calls[0][0]).toBe('symbols/1/static');
    expect(known.report.mock.calls[0][1]).toContain('orb');
  });

  it('a copy that ran no once of its own holds 600 ms; one that ran a media node ends with it', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, deps } = setup();
      const quiet = cellMount('quiet');
      const loud = cellMount('loud');
      withScenes(ctx, { quiet, loud });
      const h = createSymbolHandle('1', deps);
      h.apply({
        id: '1',
        static: STATIC,
        states: {
          quiet: { type: 'scene', props: { scene: 'quiet' } },
          loud: { type: 'scene', props: { scene: 'loud' } },
        },
      });
      // Nothing in the copy had an `once`: without the floor the state would
      // mount and unmount inside one microtask and the player would see none of it.
      let done = false;
      void h.view.playState!('quiet').then(() => (done = true));
      quiet.settle(false);
      await vi.advanceTimersByTimeAsync(599);
      expect(done).toBe(false);
      expect(wrapperOf(h.view, 'quiet')).toBeDefined();
      await vi.advanceTimersByTimeAsync(1);
      expect(done).toBe(true);
      expect(wrapperOf(h.view, 'quiet')).toBeUndefined();

      // A media node ran: the state is as long as the media, not 600 ms.
      let played = false;
      void h.view.playState!('loud').then(() => (played = true));
      loud.settle(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(played).toBe(true);
      expect(wrapperOf(h.view, 'loud')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a copy with no bound node is not re-fitted on every bind', () => {
    const { ctx, deps } = setup();
    const plain = cellMount('plain', false);
    withScenes(ctx, { plain });
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: { type: 'scene', props: { scene: 'plain' } } });
    h.resize(SIZE);
    const w = wrapperOf(h.view, 'static')!;
    const fitted = w.scale.x;
    // A copy the document bound nothing in has nothing to re-resolve, and
    // `getLocalBounds()` over the whole copy is what a fit costs.
    const spy = vi.spyOn(plain.view, 'getLocalBounds');
    h.view.bind({ symbol: '1', mv: 4 });
    expect(plain.bind).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    expect(w.scale.x).toBe(fitted);
  });

  it('destroying the handle destroys the copy', () => {
    const { ctx, deps } = setup();
    const orb = cellMount();
    withScenes(ctx, { orb });
    const h = createSymbolHandle('orb', deps);
    h.apply({ id: 'orb', static: { type: 'scene', props: { scene: 'orb' } } });
    h.destroy();
    expect(orb.destroy).toHaveBeenCalledTimes(1);
    expect(orb.view.destroyed).toBe(true);
  });
});

/** Slice 30: `playWin` generalised — any state of `states` can be played. */
describe('playState', () => {
  const withStates: SymbolDef = {
    id: '1',
    static: STATIC,
    states: { death: WIN, celebrate: WIN },
  };
  const spriteOf = (view: Container, state: string) =>
    wrapperOf(view, state)!.children[0] as AnimatedSprite;

  it('mounts a named state over the rest, awaits its once, then restores', async () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply(withStates);
    h.resize(SIZE);
    const rest = wrapperOf(h.view, 'static')!;
    const p = h.view.playState!('death');
    expect(rest.visible).toBe(false);
    spriteOf(h.view, 'death').onComplete!();
    await p;
    expect(wrapperOf(h.view, 'death')).toBeUndefined();
    expect(rest.visible).toBe(true);
  });

  it('a second call replaces the state in flight: the first resolves and its wrapper is gone', async () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply(withStates);
    h.resize(SIZE);
    const rest = wrapperOf(h.view, 'static')!;
    let first = false;
    const p1 = h.view.playState!('death').then(() => {
      first = true;
    });
    const death = wrapperOf(h.view, 'death')!;
    const p2 = h.view.playState!('celebrate');
    expect(death.destroyed).toBe(true);
    expect(wrapperOf(h.view, 'death')).toBeUndefined();
    await p1;
    expect(first).toBe(true);
    // The replacement is playing, and the rest wrapper is still hidden behind it.
    expect(wrapperOf(h.view, 'celebrate')).toBeDefined();
    expect(rest.visible).toBe(false);
    spriteOf(h.view, 'celebrate').onComplete!();
    await p2;
    expect(wrapperOf(h.view, 'celebrate')).toBeUndefined();
    expect(rest.visible).toBe(true);
  });

  it('a second call replaces a state whose own once never settles: the first resolves all the same', async () => {
    const { deps, nodeTypes } = setup();
    const stuck: NodeType = {
      type: 'stuck',
      schema: Schema.object({}),
      mount: () => new Container(),
      once: () => new Promise<void>(() => {}), // never resolves on its own
    };
    nodeTypes.register(stuck);
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC, states: { a: { type: 'stuck', props: {} }, b: WIN } });
    h.resize(SIZE);
    let first = false;
    const p1 = h.view.playState!('a').then(() => (first = true));
    const a = wrapperOf(h.view, 'a')!;
    const p2 = h.view.playState!('b');
    expect(a.destroyed).toBe(true);
    await p1;
    expect(first).toBe(true);
    // The replacement is unharmed by the first one letting go.
    expect(wrapperOf(h.view, 'b')).toBeDefined();
    spriteOf(h.view, 'b').onComplete!();
    await p2;
    expect(wrapperOf(h.view, 'static')!.visible).toBe(true);
  });

  it('a state the symbol does not have resolves at once — one info per state, not an error', async () => {
    const { deps, report } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC });
    await h.view.playState!('death');
    await h.view.playState!('death');
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith('symbols/1', 'no state "death"', 'info');
    await h.view.playState!('nope');
    expect(report).toHaveBeenCalledTimes(2);
    expect(h.view.children).toEqual([wrapperOf(h.view, 'static')]);
  });

  it('playWin is playState("win"), and both are gone with no def or a pinned state', () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps);
    h.apply({ id: '1', static: STATIC });
    expect(h.view.playState).toBeTypeOf('function');
    expect('playWin' in h.view).toBe(false);
    h.apply({ id: '1', static: STATIC, win: WIN });
    expect(h.view.playWin).toBeTypeOf('function');
    h.apply(undefined);
    expect('playState' in h.view).toBe(false);
    expect('playWin' in h.view).toBe(false);
    const only = createSymbolHandle('1', deps, { only: 'static' });
    only.apply({ id: '1', static: STATIC, win: WIN });
    expect('playState' in only.view).toBe(false);
  });

  it('pins a named state as the resting one for a preview', () => {
    const { deps } = setup();
    const h = createSymbolHandle('1', deps, { only: 'death' });
    h.apply(withStates);
    // The named state's own node, not the static one under its label.
    expect(wrapperOf(h.view, 'death')!.children[0]).toBeInstanceOf(AnimatedSprite);
    expect(wrapperOf(h.view, 'static')).toBeUndefined();
  });
});
