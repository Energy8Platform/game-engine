import { describe, it, expect, vi } from 'vitest';
import { extractConfig, diffConfig, applyProps } from '../src/react/applyProps';

describe('extractConfig', () => {
  it('unfolds dash-notation into nested objects', () => {
    const config = extractConfig({
      text: 'BALANCE',
      'style-fontSize': 24,
      'style-fill': 0xffd700,
      'style-fontFamily': 'Roboto',
    });

    expect(config).toEqual({
      text: 'BALANCE',
      style: { fontSize: 24, fill: 0xffd700, fontFamily: 'Roboto' },
    });
  });

  it('unfolds multiple dash-notation groups side by side', () => {
    const config = extractConfig({
      'colors-default': 0x22aa22,
      'colors-hover': 0x33cc33,
      'textStyle-fontSize': 20,
      'textStyle-fill': 0xffffff,
    });

    expect(config).toEqual({
      colors: { default: 0x22aa22, hover: 0x33cc33 },
      textStyle: { fontSize: 20, fill: 0xffffff },
    });
  });

  it('strips reserved, flex-item, and container props', () => {
    const config = extractConfig({
      text: 'hi',
      children: null,
      key: 'k',
      ref: null,
      x: 10,
      y: 20,
      alpha: 0.5,
      flexGrow: 1,
      flexExclude: true,
      left: 5,
    });

    expect(config).toEqual({ text: 'hi' });
  });

  it('strips event props', () => {
    const config = extractConfig({
      text: 'hi',
      onClick: () => {},
      onPointerDown: () => {},
    });

    expect(config).toEqual({ text: 'hi' });
  });

  it('preserves full object form alongside dash-notation absence', () => {
    const config = extractConfig({
      style: { fontSize: 18, fill: 0xffffff },
    });

    expect(config).toEqual({ style: { fontSize: 18, fill: 0xffffff } });
  });
});

describe('applyProps — Graphics width/height redirect', () => {
  /** Minimal Graphics-like stub: has clear/fill/rect so isGraphicsLike() matches. */
  function makeGraphicsStub() {
    return {
      clear: vi.fn(),
      fill: vi.fn().mockReturnThis(),
      rect: vi.fn().mockReturnThis(),
      circle: vi.fn().mockReturnThis(),
      _widthWrites: [] as number[],
      _heightWrites: [] as number[],
      // Track that applyProps DOES NOT write to the scale-applying width/height setters.
      set width(v: number) { this._widthWrites.push(v); },
      set height(v: number) { this._heightWrites.push(v); },
    };
  }

  it('routes width/height to _flexConfig.layoutWidth/layoutHeight instead of the scale setter', () => {
    const g = makeGraphicsStub();
    applyProps(g, { width: 36, height: 36, draw: () => {} });

    expect((g as any)._flexConfig).toEqual({ layoutWidth: 36, layoutHeight: 36 });
    expect(g._widthWrites).toEqual([]);
    expect(g._heightWrites).toEqual([]);
  });

  it('preserves an existing _flexConfig when redirecting', () => {
    const g = makeGraphicsStub() as any;
    g._flexConfig = { flexGrow: 2 };
    applyProps(g, { width: 40 });
    expect(g._flexConfig).toEqual({ flexGrow: 2, layoutWidth: 40 });
  });

  it('clears the redirected entry when the prop is removed', () => {
    const g = makeGraphicsStub() as any;
    applyProps(g, { width: 36 }, {});
    expect(g._flexConfig.layoutWidth).toBe(36);

    applyProps(g, {}, { width: 36 });
    expect(g._flexConfig.layoutWidth).toBeUndefined();
    expect(g._widthWrites).toEqual([]);
  });

  it('leaves non-Graphics instances unchanged (Sprite still scales via width)', () => {
    const sprite = {
      _widthWrites: [] as number[],
      set width(v: number) { this._widthWrites.push(v); },
      // No clear/fill/rect → not graphics-like
    };
    applyProps(sprite, { width: 100 });
    expect((sprite as any)._flexConfig).toBeUndefined();
    expect(sprite._widthWrites).toEqual([100]);
  });
});

describe('diffConfig', () => {
  it('returns only changed props', () => {
    const changed = diffConfig(
      { text: 'new', disabled: false },
      { text: 'old', disabled: false },
    );
    expect(changed).toEqual({ text: 'new' });
  });

  it('returns changed dash-notation props folded into nested objects', () => {
    const changed = diffConfig(
      { 'colors-default': 0xff0000, 'colors-hover': 0x00ff00 },
      { 'colors-default': 0xff0000, 'colors-hover': 0x0000ff },
    );
    expect(changed).toEqual({ colors: { hover: 0x00ff00 } });
  });

  it('ignores container and flex-item props', () => {
    const changed = diffConfig(
      { x: 100, flexGrow: 2, text: 'new' },
      { x: 50, flexGrow: 1, text: 'old' },
    );
    expect(changed).toEqual({ text: 'new' });
  });
});
