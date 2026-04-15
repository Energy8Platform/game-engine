import { describe, it, expect, vi } from 'vitest';

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
    eventMode = 'auto';
    cursor = '';
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
    clear() { return this; }
  }

  return {
    Container: MockContainer,
    Graphics: MockGraphics,
  };
});

// Mock Tween to avoid animation dependencies
vi.mock('../src/animation/Tween', () => ({
  Tween: {
    to: vi.fn().mockReturnValue(Promise.resolve()),
    killTweensOf: vi.fn(),
  },
}));

import { Toggle } from '../src/ui/Toggle';

describe('Toggle', () => {
  it('creates with default config (off)', () => {
    const toggle = new Toggle();
    expect(toggle.value).toBe(false);
  });

  it('creates with initial value', () => {
    const toggle = new Toggle({ value: true });
    expect(toggle.value).toBe(true);
  });

  it('toggles on tap', () => {
    const onChange = vi.fn();
    const toggle = new Toggle({ onChange });

    // Simulate tap
    toggle.emit('pointertap');
    expect(toggle.value).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);

    toggle.emit('pointertap');
    expect(toggle.value).toBe(false);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('forceSwitch changes value', () => {
    const toggle = new Toggle({ value: false });
    toggle.forceSwitch(true);
    expect(toggle.value).toBe(true);
  });

  it('forceSwitch does nothing if same value', () => {
    const toggle = new Toggle({ value: true });
    toggle.forceSwitch(true);
    expect(toggle.value).toBe(true);
  });

  it('value setter triggers animation', () => {
    const toggle = new Toggle({ value: false });
    toggle.value = true;
    expect(toggle.value).toBe(true);
  });

  it('updateConfig updates value', () => {
    const toggle = new Toggle();
    toggle.updateConfig({ value: true });
    expect(toggle.value).toBe(true);
  });

  it('updateConfig updates onChange', () => {
    const toggle = new Toggle();
    const cb = vi.fn();
    toggle.updateConfig({ onChange: cb });
    expect(toggle.onChange).toBe(cb);
  });

  it('has __uiComponent flag', () => {
    const toggle = new Toggle();
    expect(toggle.__uiComponent).toBe(true);
  });

  it('destroy cleans up', () => {
    const toggle = new Toggle({ onChange: vi.fn() });
    toggle.destroy();
    expect(toggle.onChange).toBeNull();
  });
});
