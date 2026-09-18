import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import Schema from 'schemastery';
import { applyCommon, createNodeTypes, type NodeType } from '../src/node-types';
import { image } from '../src/builtin';

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
    expect(image.accept).toEqual({ extensions: ['png', 'jpg', 'jpeg', 'webp'], prop: 'src' });
    expect(image.assetProps).toEqual(['src']);
    expect((image.schema.dict!.src.meta as { asset?: string[] }).asset).toEqual([
      'png',
      'jpg',
      'jpeg',
      'webp',
    ]);
  });
});

describe('applyCommon', () => {
  it('applies the six common props with their defaults and anchor only where there is one', () => {
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
    expect(withAnchor.anchor.set).toHaveBeenCalledWith(0.5);
  });
});
