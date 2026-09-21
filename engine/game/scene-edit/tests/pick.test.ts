import { describe, expect, it } from 'vitest';
import { Bounds, Container, Graphics, Matrix } from 'pixi.js';
import { pickAt } from '../src/pick';
const box = (x: number, y: number, w: number, h: number) => { const c = new Container(); c.addChild(new Graphics().rect(0, 0, w, h).fill(0xffffff)); c.position.set(x, y); return c; };
describe('pickAt', () => {
  it('returns the topmost (last) view containing the point, null when none', () => {
    const root = new Container();
    const a = box(0, 0, 100, 100), b = box(50, 50, 100, 100);
    root.addChild(a, b);
    const views = [{ node: 'a', view: a }, { node: 'b', view: b }];
    expect(pickAt(views, { x: 75, y: 75 })).toBe('b');
    expect(pickAt(views, { x: 10, y: 10 })).toBe('a');
    expect(pickAt(views, { x: 400, y: 400 })).toBeNull();
  });
  it('a mask view (measurable: false, empty world bounds) is picked by its local bounds brought to world', () => {
    // What pixi makes of a `mask: true` node: `getBounds()` empty, `getLocalBounds()` the real rect.
    const world = new Matrix(2, 0, 0, 2, 100, 50); // local × 2, then +(100, 50)
    const mask = {
      visible: true,
      measurable: false,
      getBounds: () => new Bounds(0, 0, 0, 0),
      getLocalBounds: () => new Bounds(0, 0, 40, 30),
      getGlobalTransform: () => world,
    } as unknown as Container;
    const views = [{ node: 'm', view: mask }];
    expect(pickAt(views, { x: 110, y: 60 })).toBe('m'); // local (5, 5)
    expect(pickAt(views, { x: 179, y: 109 })).toBe('m'); // local (39.5, 29.5)
    expect(pickAt(views, { x: 181, y: 60 })).toBeNull(); // local (40.5, 5): past the rect
    expect(pickAt(views, { x: 90, y: 40 })).toBeNull();
    // An ordinary view with genuinely empty bounds (an empty container) is still not picked.
    const empty = new Container();
    empty.position.set(100, 50);
    expect(pickAt([{ node: 'e', view: empty }], { x: 100, y: 50 })).toBeNull();
  });

  it('the real thing: a `Graphics` set as a sibling\'s mask is picked where it draws', () => {
    const root = new Container();
    const masked = box(0, 0, 200, 200);
    const mask = new Graphics().rect(0, 0, 40, 40).fill(0xffffff);
    mask.position.set(100, 100);
    root.addChild(masked, mask);
    masked.mask = mask;
    // No render pass here: `getGlobalTransform()` computes the world transform itself.
    expect(mask.measurable).toBe(false);
    expect(mask.getBounds().width).toBe(0);
    const views = [{ node: 'masked', view: masked }, { node: 'mask', view: mask }];
    expect(pickAt(views, { x: 120, y: 120 })).toBe('mask');
    expect(pickAt(views, { x: 90, y: 90 })).toBeNull(); // outside the mask: the masked node's own bounds are clipped to it
    expect(pickAt(views.slice(0, 1), { x: 120, y: 120 })).toBe('masked');
  });

  it('an invisible view is not picked', () => {
    const root = new Container();
    const a = box(0, 0, 100, 100); a.visible = false; root.addChild(a);
    expect(pickAt([{ node: 'a', view: a }], { x: 10, y: 10 })).toBeNull();
  });
});
