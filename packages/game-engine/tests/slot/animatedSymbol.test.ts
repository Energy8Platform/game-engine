import { describe, it, expect } from 'vitest';
import { Texture } from 'pixi.js';
import { AnimatedSymbol } from '../../src/slot/grid/AnimatedSymbol';

// AnimatedSprite.play() calls requestAnimationFrame via Pixi's Ticker — stub it for node.
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 16);
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id);
}

describe('AnimatedSymbol', () => {
  it('sizes its base sprite to the configured size', () => {
    const sym = new AnimatedSymbol({ textures: { base: Texture.EMPTY }, size: 100 });
    expect(sym.children.length).toBe(1);
    const base = sym.children[0] as any;
    expect(base.width).toBe(100);
    expect(base.height).toBe(100);
    expect(base.anchor.x).toBe(0.5);
  });
  it('resizes via resize()', () => {
    const sym = new AnimatedSymbol({ textures: { base: Texture.EMPTY }, size: 100 });
    sym.resize(80);
    expect((sym.children[0] as any).width).toBe(80);
  });
  it('playWin resolves immediately when no win frames', async () => {
    const sym = new AnimatedSymbol({ textures: { base: Texture.EMPTY }, size: 50 });
    await expect(sym.playWin()).resolves.toBeUndefined();
  });
  it('playIdle adds an animated child when idle frames exist, showStatic restores base', () => {
    const sym = new AnimatedSymbol({ textures: { base: Texture.EMPTY, idle: [Texture.EMPTY, Texture.WHITE] }, size: 50 });
    sym.playIdle();
    expect(sym.children.length).toBe(2);
    sym.showStatic();
    expect(sym.children.length).toBe(1);
  });
});
