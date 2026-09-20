/**
 * `text` — the one node type that puts a number on the canvas.
 *
 * Headless note: pixi 8's `Text` AND `BitmapText` both CONSTRUCT in plain
 * Node (measured here, not assumed) — what needs a canvas is MEASURING
 * them (`width`/`height`/`getLocalBounds()` go through
 * `CanvasTextMetrics`, which calls `document.createElement`). So this file
 * asserts the class, the text and the whole style, never the bounds; the
 * browser e2e is where a text's box is proved.
 */
import { describe, expect, it } from 'vitest';
import type { Context } from 'cordis';
import { BitmapText, Text } from 'pixi.js';
import { text } from '../src/builtin';
import { applyCommon } from '../src/node-types';

const props = (over: Record<string, unknown> = {}) => text.schema(over as never);

/** A ctx whose `assetLoader` answers `get` out of `assets` — what a loaded `.fnt` looks like to the type. */
const ctxWith = (assets: Record<string, unknown>) =>
  ({
    reflect: {
      get: (name: string) =>
        name === 'assetLoader' ? { get: (url: string) => assets[url] } : undefined,
    },
  }) as unknown as Context;

describe('text', () => {
  it('declares its contract: a bitmap-font asset prop, no accept, the spec defaults', () => {
    expect(text.type).toBe('text');
    expect(text.accept).toBeUndefined();
    expect(text.once).toBeUndefined();
    expect(text.assetProps).toEqual(['font']);
    expect(props()).toMatchObject({
      text: '',
      size: 24,
      family: 'sans-serif',
      fill: '#ffffff',
      weight: 'normal',
      align: 'left',
      stroke: '',
      strokeWidth: 0,
      wrap: 0,
      font: '',
    });
    // Nothing to load until a bitmap font is named.
    expect(text.assets!(props())).toEqual([]);
    expect(text.assets!(props({ font: 'fonts/hb.fnt' }))).toEqual(['fonts/hb.fnt']);
  });

  it('mounts a `Text` carrying the whole style', () => {
    const view = text.mount(
      props({
        text: 'WIN 120',
        size: 28,
        family: 'Inter',
        fill: '#ffd166',
        weight: 'bold',
        align: 'center',
        wrap: 200,
      }),
      null as never,
    ) as Text;
    expect(view).toBeInstanceOf(Text);
    expect(view.text).toBe('WIN 120');
    expect(view.style.fontSize).toBe(28);
    expect(view.style.fontFamily).toBe('Inter');
    expect(view.style.fill).toBe(0xffd166);
    expect(view.style.fontWeight).toBe('bold');
    expect(view.style.align).toBe('center');
    expect(view.style.wordWrap).toBe(true);
    expect(view.style.wordWrapWidth).toBe(200);
    view.destroy();
  });

  it('`wrap: 0` is no wrap at all', () => {
    const view = text.mount(props({ text: 'a b c' }), null as never) as Text;
    expect(view.style.wordWrap).toBe(false);
    view.destroy();
  });

  it('an outline only once it has a width', () => {
    const none = text.mount(props({ stroke: '#112233', strokeWidth: 0 }), null as never) as Text;
    expect(none.style.stroke).toBeFalsy();
    const outlined = text.mount(
      props({ stroke: '#112233', strokeWidth: 3 }),
      null as never,
    ) as Text;
    expect(outlined.style.stroke).toMatchObject({ color: 0x112233, width: 3 });
    none.destroy();
    outlined.destroy();
  });

  it('update changes the text and the style on the same view', () => {
    const view = text.mount(props({ text: 'a', fill: '#ffffff' }), null as never) as Text;
    text.update!(view, props({ text: 'b', fill: '#ff0000', size: 40 }), null as never);
    expect(view.text).toBe('b');
    expect(view.style.fill).toBe(0xff0000);
    expect(view.style.fontSize).toBe(40);
    view.destroy();
  });

  it('the common anchor reaches it — both text classes have one', () => {
    const view = text.mount(props({ text: 'x' }), null as never) as Text;
    applyCommon(view, { anchor: 0.5 }, text);
    expect(view.anchor.x).toBe(0.5);
    expect(view.anchor.y).toBe(0.5);
    applyCommon(view, { anchor: 0.5, anchorX: 1 }, text);
    expect(view.anchor.x).toBe(1);
    expect(view.anchor.y).toBe(0.5);
    view.destroy();
  });

  it('an invalid colour is refused by the SCHEMA, and `update` is all-or-nothing if one gets past it', () => {
    expect(() => props({ fill: 'not-a-colour' })).toThrow();
    expect(() => props({ stroke: 'not-a-colour' })).toThrow();
    const view = text.mount(props({ text: 'OLD' }), null as never) as Text;
    const bad = { ...props({ text: 'NEW' }), stroke: 'not-a-colour', strokeWidth: 2 };
    expect(() => text.update!(view, bad as never, null as never)).toThrow();
    // The style is built before the first assignment: the old text stands.
    expect(view.text).toBe('OLD');
    view.destroy();
  });

  it("`font` mounts a `BitmapText` under the LOADED font's own face name", () => {
    // `Assets.load('/x.fnt')` registers a `BitmapFont` whose `fontFamily`
    // is the face name inside the file — the document's PATH is not it.
    const ctx = ctxWith({ 'fonts/hb.fnt': { fontFamily: 'Hellbuddha' } });
    const view = text.mount(
      props({ text: '5', font: 'fonts/hb.fnt', family: 'sans-serif', size: 30 }),
      ctx,
    ) as BitmapText;
    expect(view).toBeInstanceOf(BitmapText);
    expect(view.text).toBe('5');
    expect(view.style.fontFamily).toBe('Hellbuddha');
    expect(view.style.fontSize).toBe(30);
  });

  it('a `font` that has not landed yet still takes the BitmapText branch; `update` fills the face in after the load', () => {
    // The branch is the DOCUMENT's — mount runs BEFORE `show` loads.
    const assets: Record<string, unknown> = {};
    const ctx = ctxWith(assets);
    const p = props({ text: '5', font: 'fonts/hb.fnt', family: 'Fallback' });
    const view = text.mount(p, ctx) as BitmapText;
    expect(view).toBeInstanceOf(BitmapText);
    expect(view.style.fontFamily).toBe('Fallback');
    assets['fonts/hb.fnt'] = { fontFamily: 'Hellbuddha' };
    text.update!(view, p, ctx);
    expect(view.style.fontFamily).toBe('Hellbuddha');
  });
});
