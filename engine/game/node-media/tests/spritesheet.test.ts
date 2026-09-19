globalThis.requestAnimationFrame = ((fn: (t: number) => void) =>
  setTimeout(() => fn(performance.now()), 16)) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = clearTimeout as unknown as typeof cancelAnimationFrame;

import { beforeAll, describe, expect, it } from 'vitest';
import { AnimatedSprite, Container, Spritesheet, Texture } from 'pixi.js';
import type { Context } from 'cordis';
import { spritesheet } from '../src/spritesheet';

const frame = (x: number) => ({ frame: { x, y: 0, w: 8, h: 8 } });
let sheet: Spritesheet;
let noAnimations: Spritesheet;
beforeAll(async () => {
  sheet = new Spritesheet(Texture.WHITE, {
    frames: { a: frame(0), b: frame(8), c: frame(0) },
    meta: { scale: 1 },
    animations: { spin: ['a', 'b'] },
  });
  await sheet.parse();
  noAnimations = new Spritesheet(Texture.WHITE, {
    frames: { z: frame(0), m: frame(8), a: frame(0) },
    meta: { scale: 1 },
  });
  await noAnimations.parse();
});

const ctxWith = (get: (path: string) => unknown) =>
  ({ reflect: { get: () => ({ get }) } }) as unknown as Context;
const none = { reflect: { get: () => undefined } } as unknown as Context;
const props = (over: Record<string, unknown> = {}) =>
  spritesheet.schema({ sheet: 'assets/coin.json', ...over } as never);

describe('spritesheet', () => {
  it('declares its asset contract', () => {
    expect(spritesheet.type).toBe('spritesheet');
    expect(spritesheet.accept).toEqual({ extensions: ['json'], prop: 'sheet' });
    expect(spritesheet.assetProps).toEqual(['sheet']);
    expect((spritesheet.schema.dict!.sheet.meta as { asset?: string[] }).asset).toEqual(['json']);
    expect(props()).toMatchObject({ fps: 12, loop: true, playing: true });
    expect(spritesheet.assets!(props())).toEqual(['assets/coin.json']);
    expect(spritesheet.assets!(spritesheet.schema({ sheet: '' } as never))).toEqual([]);
  });

  it('mounts an AnimatedSprite on the named animation, at fps/60, playing', () => {
    const view = spritesheet.mount(
      props({ animation: 'spin' }),
      ctxWith(() => sheet),
    );
    expect(view).toBeInstanceOf(AnimatedSprite);
    const s = view as AnimatedSprite;
    expect(s.textures).toEqual([sheet.textures.a, sheet.textures.b]);
    expect(s.animationSpeed).toBeCloseTo(12 / 60);
    expect(s.loop).toBe(true);
    expect(s.playing).toBe(true);
    spritesheet.unmount!(view);
    expect(s.destroyed).toBe(true);
  });

  it('an empty animation takes the first one; an unknown or absent one takes all frames by name', () => {
    const first = spritesheet.mount(
      props(),
      ctxWith(() => sheet),
    ) as AnimatedSprite;
    expect(first.textures).toEqual([sheet.textures.a, sheet.textures.b]);
    const nope = spritesheet.mount(
      props({ animation: 'nope' }),
      ctxWith(() => sheet),
    ) as AnimatedSprite;
    expect(nope.textures).toEqual([sheet.textures.a, sheet.textures.b, sheet.textures.c]);
    const all = spritesheet.mount(
      props(),
      ctxWith(() => noAnimations),
    ) as AnimatedSprite;
    expect(all.textures).toEqual([
      noAnimations.textures.a,
      noAnimations.textures.m,
      noAnimations.textures.z,
    ]);
    for (const v of [first, nope, all]) v.destroy();
  });

  it('with no sheet loaded mounts an empty placeholder and fills it in on update', () => {
    const view = spritesheet.mount(props(), none);
    expect(view).toBeInstanceOf(Container);
    expect(view.children).toHaveLength(0);
    const s = view as AnimatedSprite;
    expect(s.playing).toBe(false);
    spritesheet.update!(
      view,
      props(),
      ctxWith(() => sheet),
    );
    expect(s.textures).toEqual([sheet.textures.a, sheet.textures.b]);
    expect(s.playing).toBe(true);
    s.destroy();
  });

  it('an animation naming a frame missing from the sheet keeps the frames that exist, not throw', async () => {
    const bad = new Spritesheet(Texture.WHITE, {
      frames: { a: frame(0), b: frame(8) },
      meta: { scale: 1 },
      animations: { spin: ['a', 'missing', 'b'] },
    });
    await bad.parse();
    expect(() =>
      spritesheet.mount(
        props({ animation: 'spin' }),
        ctxWith(() => bad),
      ),
    ).not.toThrow();
    const view = spritesheet.mount(
      props({ animation: 'spin' }),
      ctxWith(() => bad),
    ) as AnimatedSprite;
    expect(view.textures).toEqual([bad.textures.a, bad.textures.b]);
    view.destroy();
  });

  it('a JSON that is not a spritesheet keeps the placeholder rather than throwing', () => {
    const notASheet = ctxWith(() => ({ some: 'data' }));
    const view = spritesheet.mount(props(), notASheet) as AnimatedSprite;
    expect(view.texture).toBe(Texture.EMPTY);
    expect(() => spritesheet.update!(view, props(), notASheet)).not.toThrow();
    expect(view.texture).toBe(Texture.EMPTY);
    expect(view.playing).toBe(false);
    view.destroy();
  });

  it('a finished one-shot stays on its last frame across later refreshes', () => {
    const ctx = ctxWith(() => sheet);
    const s = spritesheet.mount(props({ loop: false }), ctx) as AnimatedSprite;
    expect(s.playing).toBe(true);
    s.update({ deltaTime: 60 } as never);
    expect(s.playing).toBe(false);
    expect(s.currentFrame).toBe(1);
    spritesheet.update!(s, props({ loop: false }), ctx);
    expect(s.playing).toBe(false);
    expect(s.currentFrame).toBe(1);
    s.destroy();
  });

  it('update swaps frames, fps, loop and play/stop in place', () => {
    const view = spritesheet.mount(
      props(),
      ctxWith(() => sheet),
    ) as AnimatedSprite;
    const before = view.textures;
    spritesheet.update!(
      view,
      props({ fps: 30, loop: false }),
      ctxWith(() => sheet),
    );
    expect(view.textures).toBe(before);
    expect(view.animationSpeed).toBeCloseTo(0.5);
    expect(view.loop).toBe(false);
    expect(view.playing).toBe(true);
    spritesheet.update!(
      view,
      props({ playing: false }),
      ctxWith(() => sheet),
    );
    expect(view.playing).toBe(false);
    spritesheet.update!(
      view,
      props(),
      ctxWith(() => noAnimations),
    );
    expect(view.textures).toHaveLength(3);
    expect(view.playing).toBe(true);
    view.destroy();
  });

  it('once resolves at once on a view still on the placeholder (single-texture)', async () => {
    const view = spritesheet.mount(props(), none) as AnimatedSprite;
    await expect(spritesheet.once!(view, props(), none)).resolves.toBeUndefined();
    view.destroy();
  });

  it('once plays without looping and resolves (restoring loop) when the animation completes', async () => {
    const view = spritesheet.mount(
      props({ animation: 'spin', loop: true }),
      ctxWith(() => sheet),
    ) as AnimatedSprite;
    const p = spritesheet.once!(view, props({ animation: 'spin', loop: true }), none);
    expect(view.loop).toBe(false);
    expect(view.playing).toBe(true);
    view.onComplete!();
    await expect(p).resolves.toBeUndefined();
    expect(view.loop).toBe(true);
    expect(view.onComplete).toBeUndefined();
    expect(view.listenerCount('destroyed')).toBe(0); // not left stacking on a repeat once()
    view.destroy();
  });

  it('once resolves when the view is destroyed mid-play, without restoring loop', async () => {
    const view = spritesheet.mount(
      props({ animation: 'spin', loop: true }),
      ctxWith(() => sheet),
    ) as AnimatedSprite;
    const p = spritesheet.once!(view, props({ animation: 'spin', loop: true }), none);
    view.destroy();
    await expect(p).resolves.toBeUndefined();
    expect(view.loop).toBe(false); // not restored — the destroy path skips it
  });
});
