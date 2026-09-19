globalThis.requestAnimationFrame = ((fn: (t: number) => void) =>
  setTimeout(() => fn(performance.now()), 16)) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = clearTimeout as unknown as typeof cancelAnimationFrame;

import { describe, expect, it } from 'vitest';
import { AnimatedSprite, Container, Texture, TextureSource } from 'pixi.js';
import type { Context } from 'cordis';
import { strip } from '../src/strip';

const textureSized = (w: number, h: number) => new Texture({ source: new TextureSource({ width: w, height: h }) });

const ctxWith = (get: (path: string) => unknown) =>
  ({ reflect: { get: () => ({ get }) } }) as unknown as Context;
const none = { reflect: { get: () => undefined } } as unknown as Context;
const props = (over: Record<string, unknown> = {}) =>
  strip.schema({ src: 'assets/coin.png', ...over } as never);

describe('strip', () => {
  it('declares its asset contract, with no accept (drops go to image)', () => {
    expect(strip.type).toBe('strip');
    expect(strip.accept).toBeUndefined();
    expect(strip.assetProps).toEqual(['src']);
    expect((strip.schema.dict!.src.meta as { asset?: string[] }).asset).toEqual([
      'png',
      'jpg',
      'jpeg',
      'webp',
      'avif',
    ]);
    expect(props()).toMatchObject({ cols: 1, rows: 1, frames: 0, fps: 12, loop: true, playing: true });
    expect(strip.assets!(props())).toEqual(['assets/coin.png']);
    expect(strip.assets!(strip.schema({ src: '' } as never))).toEqual([]);
  });

  // `cols`/`rows` are `Schema.natural()` (step 1, min 0): a negative or fractional value is
  // REFUSED at the schema boundary (the same trust boundary `x: 'abc'` already relies on) —
  // it never reaches `framesOf`, which used to compute a negative frame count and hand pixi's
  // `AnimatedSprite` an empty `textures` array (pixi itself throws on that). `0` is a valid
  // natural number and reaches `framesOf` fine: `cols*rows` is `0`, so `framesOf` returns the
  // empty placeholder rather than slicing anything — no clamp needed for that case.
  it('cols/rows are naturals: a negative or fractional value is refused by the schema', () => {
    expect(() => props({ cols: -2 })).toThrow();
    expect(() => props({ rows: -1 })).toThrow();
    expect(() => props({ cols: 1.5 })).toThrow();
    expect(props({ cols: 0 })).toMatchObject({ cols: 0 });
  });

  it('a 64×16 strip with cols: 4 gives four 16×16 frames with the right frame.x', () => {
    const base = textureSized(64, 16);
    const view = strip.mount(props({ cols: 4 }), ctxWith(() => base)) as AnimatedSprite;
    expect(view.textures).toHaveLength(4);
    expect(view.textures.map((t) => (t as Texture).frame.x)).toEqual([0, 16, 32, 48]);
    for (const t of view.textures as Texture[]) {
      expect(t.width).toBe(16);
      expect(t.height).toBe(16);
    }
    view.destroy();
  });

  it('frames: 3 of a 2×2 grid gives three, row-major', () => {
    const base = textureSized(32, 32);
    const view = strip.mount(
      props({ cols: 2, rows: 2, frames: 3 }),
      ctxWith(() => base),
    ) as AnimatedSprite;
    expect(view.textures).toHaveLength(3);
    const frames = (view.textures as Texture[]).map((t) => [t.frame.x, t.frame.y]);
    expect(frames).toEqual([
      [0, 0],
      [16, 0],
      [0, 16],
    ]);
    view.destroy();
  });

  it('mounts on the named fps/loop/playing, playing when told to', () => {
    const base = textureSized(32, 16);
    const view = strip.mount(
      props({ cols: 2, fps: 30, loop: false }),
      ctxWith(() => base),
    ) as AnimatedSprite;
    expect(view.animationSpeed).toBeCloseTo(30 / 60);
    expect(view.loop).toBe(false);
    expect(view.playing).toBe(true);
    view.destroy();
  });

  it('playing: false does not play; update can stop a playing view', () => {
    const base = textureSized(32, 16);
    const stopped = strip.mount(
      props({ cols: 2, playing: false }),
      ctxWith(() => base),
    ) as AnimatedSprite;
    expect(stopped.playing).toBe(false);
    stopped.destroy();

    const view = strip.mount(props({ cols: 2 }), ctxWith(() => base)) as AnimatedSprite;
    expect(view.playing).toBe(true);
    strip.update!(view, props({ cols: 2, playing: false }), ctxWith(() => base));
    expect(view.playing).toBe(false);
    view.destroy();
  });

  it('with no image loaded mounts an empty placeholder and fills it in on update', () => {
    const view = strip.mount(props({ cols: 2 }), none);
    expect(view).toBeInstanceOf(Container);
    expect(view.children).toHaveLength(0);
    const s = view as AnimatedSprite;
    expect(s.texture).toBe(Texture.EMPTY);
    expect(s.playing).toBe(false);
    const base = textureSized(32, 16);
    strip.update!(view, props({ cols: 2 }), ctxWith(() => base));
    expect(s.textures).toHaveLength(2);
    expect(s.playing).toBe(true);
    s.destroy();
  });

  it('update re-slices when cols changes, destroying the previous sliced textures', () => {
    const base = textureSized(32, 16);
    const view = strip.mount(props({ cols: 2 }), ctxWith(() => base)) as AnimatedSprite;
    const before = view.textures as Texture[];
    expect(before).toHaveLength(2);
    strip.update!(view, props({ cols: 4 }), ctxWith(() => base));
    expect(view.textures).toHaveLength(4);
    expect((view.textures as Texture[]).map((t) => t.frame.x)).toEqual([0, 8, 16, 24]);
    for (const t of before) expect(t.destroyed).toBe(true);
    view.destroy();
  });

  it('unmount destroys the view and frees its sliced textures, not the shared source', () => {
    const base = textureSized(32, 16);
    const view = strip.mount(props({ cols: 2 }), ctxWith(() => base)) as AnimatedSprite;
    const textures = view.textures as Texture[];
    strip.unmount!(view);
    expect(view.destroyed).toBe(true);
    for (const t of textures) expect(t.destroyed).toBe(true);
    expect(base.destroyed).toBe(false);
  });

  it('once resolves at once on a view still on the placeholder (single-texture)', async () => {
    const view = strip.mount(props({ cols: 2 }), none) as AnimatedSprite;
    await expect(strip.once!(view, props({ cols: 2 }), none)).resolves.toBeUndefined();
    view.destroy();
  });

  it('once plays without looping and resolves (restoring loop) when the animation completes', async () => {
    const base = textureSized(32, 16);
    const view = strip.mount(
      props({ cols: 2, loop: true }),
      ctxWith(() => base),
    ) as AnimatedSprite;
    const p = strip.once!(view, props({ cols: 2, loop: true }), none);
    expect(view.loop).toBe(false);
    expect(view.playing).toBe(true);
    view.onComplete!();
    await expect(p).resolves.toBeUndefined();
    expect(view.loop).toBe(true);
    expect(view.onComplete).toBeUndefined();
    expect(view.listenerCount('destroyed')).toBe(0);
    view.destroy();
  });

  it('once resolves when the view is destroyed mid-play, without restoring loop', async () => {
    const base = textureSized(32, 16);
    const view = strip.mount(
      props({ cols: 2, loop: true }),
      ctxWith(() => base),
    ) as AnimatedSprite;
    const p = strip.once!(view, props({ cols: 2, loop: true }), none);
    view.destroy();
    await expect(p).resolves.toBeUndefined();
    expect(view.loop).toBe(false);
  });
});
