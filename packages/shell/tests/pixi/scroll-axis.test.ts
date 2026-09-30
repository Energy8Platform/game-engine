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
  it('x: drag under a scaled parent is 1:1 under the finger', () => {
    const parent = new Container();
    parent.scale.set(0.5);
    const box = make('x', 900, 80);
    parent.addChild(box);
    box.emit('pointerdown', ptr(200, 20));
    box.emit('globalpointermove', ptr(150, 20));
    expect(box.content.x).toBe(-100);
  });
  it('y default scrolls content.y only', () => {
    const box = make('y', 80, 900);
    box.scrollBy(50);
    expect(box.content.y).toBe(-50);
    expect(box.content.x).toBe(0);
  });
});
