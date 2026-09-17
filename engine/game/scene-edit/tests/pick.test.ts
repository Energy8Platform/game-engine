import { describe, expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
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
  it('an invisible view is not picked', () => {
    const root = new Container();
    const a = box(0, 0, 100, 100); a.visible = false; root.addChild(a);
    expect(pickAt([{ node: 'a', view: a }], { x: 10, y: 10 })).toBeNull();
  });
});
