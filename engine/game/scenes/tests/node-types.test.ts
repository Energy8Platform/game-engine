import { describe, expect, it, vi } from 'vitest';
import { Container, Graphics, Sprite } from 'pixi.js';
import Schema from 'schemastery';
import { applyCommon, createNodeTypes, type NodeType } from '../src/node-types';
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
