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
import { createNodeTypes, image, text, type NodeType } from '@energy8engine/scenes';
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

  it('playWin resolves on view.destroy() even when the win type\'s once never settles', async () => {
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
