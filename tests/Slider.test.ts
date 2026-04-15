import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pixi.js
vi.mock('pixi.js', () => {
  class MockContainer {
    children: MockContainer[] = [];
    parent: MockContainer | null = null;
    x = 0;
    y = 0;
    _width = 0;
    _height = 0;
    visible = true;
    alpha = 1;
    mask: any = null;
    eventMode = 'auto';
    cursor = '';
    hitArea: any = null;
    _flexConfig?: any;
    _listeners: Record<string, Function[]> = {};

    get width() { return this._width; }
    set width(v: number) { this._width = v; }
    get height() { return this._height; }
    set height(v: number) { this._height = v; }

    addChild(...children: MockContainer[]) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
      return children[0];
    }

    removeChild(...children: MockContainer[]) {
      for (const child of children) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
          this.children.splice(idx, 1);
          child.parent = null;
        }
      }
      return children[0];
    }

    on(event: string, fn: Function, ctx?: any) {
      if (!this._listeners[event]) this._listeners[event] = [];
      this._listeners[event].push(fn.bind(ctx || this));
      return this;
    }

    off() { return this; }

    emit(event: string, ...args: any[]) {
      const fns = this._listeners[event] || [];
      for (const fn of fns) fn(...args);
    }

    getLocalBounds() {
      return { x: 0, y: 0, width: this._width, height: this._height };
    }

    toLocal(point: { x: number; y: number }) {
      return { x: point.x - this.x, y: point.y - this.y };
    }

    destroy() {
      this.children.length = 0;
      this._listeners = {};
    }
  }

  class MockGraphics extends MockContainer {
    roundRect() { return this; }
    rect() { return this; }
    circle() { return this; }
    fill() { return this; }
    stroke() { return this; }
    clear() { return this; }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
  };
});

import { Slider } from '../src/ui/Slider';

describe('Slider', () => {
  it('creates with default config', () => {
    const slider = new Slider();
    expect(slider.value).toBe(0);
    expect(slider.min).toBe(0);
    expect(slider.max).toBe(1);
  });

  it('creates with custom config', () => {
    const slider = new Slider({ min: 0, max: 100, value: 50, step: 10 });
    expect(slider.value).toBe(50);
    expect(slider.min).toBe(0);
    expect(slider.max).toBe(100);
  });

  it('clamps value to min/max', () => {
    const slider = new Slider({ min: 0, max: 100, value: 50 });
    slider.value = 200;
    expect(slider.value).toBe(100);
    slider.value = -50;
    expect(slider.value).toBe(0);
  });

  it('applies step', () => {
    const slider = new Slider({ min: 0, max: 100, step: 25 });
    slider.value = 37;
    expect(slider.value).toBe(25);
    slider.value = 63;
    expect(slider.value).toBe(75);
  });

  it('updateConfig updates value', () => {
    const slider = new Slider({ min: 0, max: 1 });
    slider.updateConfig({ value: 0.5 });
    expect(slider.value).toBe(0.5);
  });

  it('updateConfig updates callbacks', () => {
    const slider = new Slider();
    const cb = vi.fn();
    slider.updateConfig({ onUpdate: cb });
    expect(slider.onUpdate).toBe(cb);
  });

  it('has __uiComponent flag', () => {
    const slider = new Slider();
    expect(slider.__uiComponent).toBe(true);
  });

  it('destroy cleans up', () => {
    const slider = new Slider({ onUpdate: vi.fn(), onChange: vi.fn() });
    slider.destroy();
    expect(slider.onUpdate).toBeNull();
    expect(slider.onChange).toBeNull();
  });
});
