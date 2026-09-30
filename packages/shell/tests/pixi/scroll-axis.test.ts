import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Container, Graphics, Point, type FederatedPointerEvent } from 'pixi.js';
import { ScrollBox } from '@/ui/pixi-hb/primitives/scroll';

const ptr = (x: number, y: number) => ({ global: new Point(x, y) }) as unknown as FederatedPointerEvent;
function make(axis: 'x' | 'y', w: number, h: number, canvas?: HTMLCanvasElement) {
  const box = new ScrollBox(canvas, undefined, undefined, axis);
  box.content.addChild(new Graphics().rect(0, 0, w, h).fill(0xffffff));
  box.setViewport(axis === 'x' ? 300 : 100, axis === 'x' ? 100 : 300);
  return box;
}

describe('ScrollBox axis', () => {
  it('x: scrollBy moves content.x and clamps', () => {
    const box = make('x', 900, 80);
    expect(box.maxScrollY).toBe(600);
    box.scrollBy(250);
    expect(box.content.x).toBe(-250);
    box.scrollBy(9999);
    expect(box.content.x).toBe(-600);
    expect(box.content.y).toBe(0);
  });
  it('x: wheel deltaY scrolls x', () => {
    const canvas = document.createElement('canvas');
    const box = make('x', 900, 80, canvas);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }));
    expect(box.content.x).toBe(-120);
  });
  it('x: drag', () => {
    const box = make('x', 900, 80);
    box.emit('pointerdown', ptr(200, 50));
    box.emit('globalpointermove', ptr(150, 50));
    expect(box.content.x).toBe(-50);
    expect(box.didDrag).toBe(true);
  });
  it('x: a slow drag (ten 1px moves) counts as a drag; 3px in all does not', () => {
    const slow = make('x', 900, 80);
    slow.emit('pointerdown', ptr(200, 50));
    for (let i = 1; i <= 10; i++) slow.emit('globalpointermove', ptr(200 - i, 50));
    expect(slow.didDrag).toBe(true);
    const jitter = make('x', 900, 80);
    jitter.emit('pointerdown', ptr(200, 50));
    for (let i = 1; i <= 3; i++) jitter.emit('globalpointermove', ptr(200 - i, 50));
    expect(jitter.didDrag).toBe(false);
  });
  it('x: drag under a scaled parent is 1:1 under the finger', () => {
    const parent = new Container();
    parent.scale.set(0.5);
    const box = make('x', 900, 80);
    parent.addChild(box);
    box.emit('pointerdown', ptr(200, 20));
    box.emit('globalpointermove', ptr(150, 20));
    expect(box.content.x).toBe(-100);
  });
  it('x: the drag slop is 4 global px, whatever the parent scale', () => {
    const drag = (to: number) => {
      const parent = new Container();
      parent.scale.set(0.5);
      const box = make('x', 900, 80);
      parent.addChild(box);
      box.emit('pointerdown', ptr(200, 20));
      box.emit('globalpointermove', ptr(200 - to, 20));
      return box.didDrag;
    };
    expect(drag(3)).toBe(false); // 6 parent units, but only 3 screen px
    expect(drag(5)).toBe(true);
  });
  it('x: a press at the right end of the bottom gutter drags the thumb to the end', () => {
    const box = make('x', 900, 80);
    const t = box.affordance.trackBounds!;
    box.emit('pointerdown', ptr(t.x + t.w, t.y + t.h / 2));
    expect(box.content.x).toBe(-box.maxScrollY);
  });
  it('x: a deltaX-dominant wheel scrolls by deltaX', () => {
    const canvas = document.createElement('canvas');
    const box = make('x', 900, 80, canvas);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaX: 90, deltaY: 10 }));
    expect(box.content.x).toBe(-90);
  });
  it('y default scrolls content.y only', () => {
    const box = make('y', 80, 900);
    box.scrollBy(50);
    expect(box.content.y).toBe(-50);
    expect(box.content.x).toBe(0);
  });
});
