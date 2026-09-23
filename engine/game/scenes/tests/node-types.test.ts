import { describe, expect, it, vi } from 'vitest';
import { Color, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Context } from 'cordis';
import Schema from 'schemastery';
import { COLOUR, COMMON, applyCommon, createNodeTypes, emptyProp, type NodeType } from '../src/node-types';
import { container, image, shape } from '../src/builtin';

const t = (type: string): NodeType => ({
  type,
  schema: Schema.object({}),
  mount: () => new Container(),
});

describe('createNodeTypes', () => {
  it('last registration wins and notifies; the disposer takes back only its own', () => {
    const reg = createNodeTypes();
    const heard = vi.fn();
    reg.subscribe(heard);
    const a = t('image');
    const offA = reg.register(a);
    const b = t('image');
    reg.register(b);
    expect(reg.get('image')).toBe(b);
    expect(heard).toHaveBeenCalledTimes(2);
    offA();
    expect(reg.get('image')).toBe(b);
    expect(reg.list().map((x) => x.type)).toEqual(['image']);
  });
});

describe('image', () => {
  it('declares its asset contract: which extensions, which prop, and the prop carries the `asset` schema meta', () => {
    expect(image.accept).toEqual({
      extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif'],
      prop: 'src',
    });
    expect(image.assetProps).toEqual(['src']);
    expect((image.schema.dict!.src.meta as { asset?: string[] }).asset).toEqual([
      'png',
      'jpg',
      'jpeg',
      'webp',
      'avif',
    ]);
  });
});

describe('image: an asset set (`srcOf` keyed by `srcKey`)', () => {
  const tex: Record<string, Texture> = {
    'a.png': new Texture(),
    'g.png': new Texture(),
    'b.png': new Texture(),
  };
  const ctx = {
    reflect: { get: () => ({ get: (url: string) => tex[url] }) },
  } as unknown as Context;
  const props = (over: Record<string, unknown> = {}) =>
    image.schema({ src: 'a.png', srcOf: { g: 'g.png', b: 'b.png' }, ...over } as never);

  it('declares `srcOf` as an asset map, its values carrying the same `asset` meta as `src`', () => {
    expect(image.assetMapProps).toEqual(['srcOf']);
    const srcOf = image.schema.dict!.srcOf;
    expect((srcOf.inner!.meta as { asset?: string[] }).asset).toEqual([
      'png',
      'jpg',
      'jpeg',
      'webp',
      'avif',
    ]);
    expect(image.schema({ src: 'a.png' } as never)).toMatchObject({ srcOf: {}, srcKey: '' });
  });

  it('assets(): `src` first, then the set in insertion order — no duplicates, no empty `src`', () => {
    expect(image.assets!(props({ srcKey: '' }))).toEqual(['a.png', 'g.png', 'b.png']);
    expect(image.assets!(props({ srcOf: { g: 'g.png', same: 'a.png' } }))).toEqual([
      'a.png',
      'g.png',
    ]);
    expect(image.assets!(props({ src: '' }))).toEqual(['g.png', 'b.png']);
    expect(image.assets!({ src: 'a.png' } as never)).toEqual(['a.png']);
  });

  it('mount shows the keyed entry; an unknown key, an empty key or no set shows `src`', () => {
    expect((image.mount(props({ srcKey: 'b' }), ctx) as Sprite).texture).toBe(tex['b.png']);
    expect((image.mount(props({ srcKey: 'zz' }), ctx) as Sprite).texture).toBe(tex['a.png']);
    expect((image.mount(props({ srcKey: '' }), ctx) as Sprite).texture).toBe(tex['a.png']);
    expect((image.mount({ src: 'a.png' } as never, ctx) as Sprite).texture).toBe(tex['a.png']);
  });

  it("a prototype name as the key ('toString', 'constructor') shows `src`, not Object's own member", () => {
    for (const srcKey of ['toString', 'constructor', '__proto__'])
      expect((image.mount(props({ srcKey }), ctx) as Sprite).texture).toBe(tex['a.png']);
  });

  it("assets(): a `srcOf` value of '' is left out", () => {
    expect(image.assets!(props({ srcOf: { g: 'g.png', none: '' } }))).toEqual(['a.png', 'g.png']);
  });

  it('update with a new key swaps the texture on the same view', () => {
    const view = image.mount(props({ srcKey: 'g' }), ctx) as Sprite;
    expect(view.texture).toBe(tex['g.png']);
    image.update!(view, props({ srcKey: 'b' }), ctx);
    expect(view.texture).toBe(tex['b.png']);
    image.update!(view, props({ srcKey: '' }), ctx);
    expect(view.texture).toBe(tex['a.png']);
  });
});

describe('applyCommon', () => {
  it('applies the base common props with their defaults and anchor only where there is one', () => {
    const c = new Container();
    applyCommon(c, { x: 10, y: 20, scale: 2, alpha: 0.5, visible: false });
    expect([c.x, c.y, c.scale.x, c.rotation, c.alpha, c.visible]).toEqual([
      10,
      20,
      2,
      0,
      0.5,
      false,
    ]);
    const withAnchor = Object.assign(new Container(), { anchor: { set: vi.fn() } });
    applyCommon(withAnchor as unknown as Container, { anchor: 0.5 });
    expect(withAnchor.anchor.set).toHaveBeenCalledWith(0.5, 0.5);
  });

  it('width and height are per-axis: one alone leaves the other axis on `scale`', () => {
    const boxed = () => {
      const c = new Container();
      c.addChild(new Graphics().rect(0, 0, 10, 10).fill(0xffffff));
      return c;
    };
    const wide = boxed();
    applyCommon(wide, { width: 20 });
    expect([wide.scale.x, wide.scale.y]).toEqual([2, 1]);
    const both = boxed();
    applyCommon(both, { scale: 3, width: 20, height: 40 });
    expect([both.scale.x, both.scale.y]).toEqual([2, 4]);
  });

  it('tint is a hex string, applied only to a view that has one', () => {
    const s = new Sprite();
    applyCommon(s, { tint: '#ff8000' });
    expect(s.tint).toBe(0xff8000);
    // A view with no `tint` (a foreign type's own Container-alike) is left alone.
    const noTint = { position: { set: vi.fn() }, scale: { set: vi.fn() } } as unknown as Container;
    applyCommon(noTint, { tint: '#ff8000' });
    expect('tint' in noTint).toBe(false);
  });

  it('a colour the runtime cannot read is refused by the SCHEMA, before any view is touched', () => {
    // The schema is what the IDE host runs without a game: a typo is a
    // diagnostic on the document, not a half-applied view at run time.
    expect(() => COMMON({ tint: 'not-a-colour' } as never)).toThrow();
    expect(() => COMMON({ tint: 'rebeccapurple' } as never)).not.toThrow();
    const s = new Sprite();
    s.tint = 0x00ff00;
    s.position.set(5, 5);
    expect(() => applyCommon(s, { x: 40, tint: 'not-a-colour' })).toThrow();
    expect(s.tint).toBe(0x00ff00); // …and nothing moved on the way to the throw
    expect(s.x).toBe(5);
  });

  it('COLOUR and pixi `Color` agree on what a colour is', () => {
    // The schema check and the runtime apply must never disagree: one
    // refusing what the other takes is either a document the IDE rejects
    // for nothing, or a value that slips through to throw mid-apply.
    const cases = [
      '#abc',
      '#abcd',
      '#abcdef',
      '#abcdef12',
      '#abcde',
      '#abcdefa',
      '#FFF',
      'rgb(1,2,3)',
      'rgb(1, 2, 3)',
      'rgba(1,2,3,0.5)',
      'rgb(1 2 3 / 50%)',
      'hsl(1,2%,3%)',
      'hsl(120 50% 50%)',
      'hsla(1,2%,3%,.5)',
      // A function form takes NUMBERS: a name inside the parens is a typo, not a colour.
      'rgb(a,b,c)',
      'rgb(1,2)',
      'rgb(1,2,3,4,5)',
      'rgb(red green blue)',
      // Mixed separators: each syntax whole, or `Color` throws.
      'rgb(1,2,3/0.5)',
      'rgb(1 , 2 3)',
      'hsl(120, 50, 50)',
      'hwb(1 2% 3%)',
      'lab(1 2 3)',
      'cmyk(1,2,3,4)',
      'red',
      'RED',
      'rebeccapurple',
      'transparent',
      'nope',
      'not-a-colour',
      'rgb(',
    ];
    for (const v of cases) {
      let parses = true;
      try {
        new Color(v).toNumber();
      } catch {
        parses = false;
      }
      expect([v, COLOUR.test(v)]).toEqual([v, parses]);
    }
    // The one deliberate difference: empty is "none/unset" here, and the
    // callers skip it rather than handing it to `Color` (which throws).
    expect(COLOUR.test('')).toBe(true);
    expect(() => new Color('')).toThrow();
  });

  it('emptyProp: a number is 0, a boolean false, a string empty, a union its FIRST literal', () => {
    expect(emptyProp('number')).toBe(0);
    expect(emptyProp(Schema.boolean())).toBe(false);
    expect(emptyProp(Schema.string())).toBe('');
    expect(emptyProp(undefined)).toBe('');
    const kind = Schema.union(['rect', 'roundRect', 'circle']).default('circle');
    expect(emptyProp(kind)).toBe('rect');
    // The host's copy is rehydrated from JSON — same answer.
    const dict = (new Schema(JSON.parse(JSON.stringify(Schema.object({ kind })))) as unknown as { dict: Record<string, unknown> }).dict;
    expect(emptyProp(dict.kind as never)).toBe('rect');
    // COMMON's `pin` starts at '' — its first literal — so a bound `pin` still validates.
    expect(emptyProp(COMMON.dict!.pin)).toBe('');
    // A bare type name is all a caller may have: a union then falls to '' (no literal to read).
    expect(emptyProp('union')).toBe('');
  });

  it('anchorX / anchorY override `anchor` per axis', () => {
    const withAnchor = Object.assign(new Container(), { anchor: { set: vi.fn() } });
    applyCommon(withAnchor as unknown as Container, { anchor: 0.5, anchorY: 1 });
    expect(withAnchor.anchor.set).toHaveBeenCalledWith(0.5, 1);
  });

  it('`width`/`height` the TYPE declares are its own geometry — the common pass skips them', () => {
    const circle = new Graphics().circle(0, 0, 10).fill('#ffffff'); // 20 wide
    applyCommon(circle, { width: 40, scale: 3 }, shape);
    expect(circle.scale.x).toBe(3); // `shape.width` drew the art; nothing rescales it
    applyCommon(circle, { width: 40, scale: 3 }, container); // a type with no `width` of its own
    expect(circle.scale.x).toBe(2); // 40 / 20
  });
});
