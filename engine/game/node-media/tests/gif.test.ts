globalThis.requestAnimationFrame = ((fn: (t: number) => void) =>
  setTimeout(() => fn(performance.now()), 16)) as unknown as typeof requestAnimationFrame;
globalThis.cancelAnimationFrame = clearTimeout as unknown as typeof cancelAnimationFrame;

import { describe, expect, it } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { GifSource, GifSprite } from 'pixi.js/gif';
import type { Context } from 'cordis';
import { gif } from '../src/gif';

const source = () => new GifSource([{ texture: Texture.WHITE as never, start: 0, end: 100 }]);
const ctxWith = (get: (path: string) => unknown) =>
  ({ reflect: { get: () => ({ get }) } }) as unknown as Context;
const none = { reflect: { get: () => undefined } } as unknown as Context;
const props = (over: Record<string, unknown> = {}) =>
  gif.schema({ src: 'assets/loader.gif', ...over } as never);

describe('gif', () => {
  it('declares its asset contract', () => {
    expect(gif.type).toBe('gif');
    expect(gif.accept).toEqual({ extensions: ['gif'], prop: 'src' });
    expect(gif.assetProps).toEqual(['src']);
    expect((gif.schema.dict!.src.meta as { asset?: string[] }).asset).toEqual(['gif']);
    expect(props()).toMatchObject({ loop: true, speed: 1 });
    expect(gif.assets!(props())).toEqual(['assets/loader.gif']);
    expect(gif.assets!(gif.schema({} as never))).toEqual([]);
  });

  it('mounts a container holding a playing GifSprite on the source', () => {
    const src = source();
    const view = gif.mount(
      props({ loop: false, speed: 2 }),
      ctxWith(() => src),
    );
    expect(view).toBeInstanceOf(Container);
    const s = view.children[0] as GifSprite;
    expect(s).toBeInstanceOf(GifSprite);
    expect(s.source).toBe(src);
    expect(s.loop).toBe(false);
    expect(s.animationSpeed).toBe(2);
    expect(s.playing).toBe(true);
    gif.unmount!(view);
    expect(s.destroyed).toBe(true);
    expect(src.frames).toHaveLength(1);
  });

  it('a foreign child mounted under the wrapper (a hand-edited YAML child) survives update, is not treated as the GifSprite', () => {
    const view = gif.mount(props(), none);
    const foreign = view.addChild(new Container());
    foreign.label = 'foreign';
    const src = source();
    gif.update!(view, props(), ctxWith(() => src));
    expect(view.children).toContain(foreign);
    expect(foreign.destroyed).toBe(false);
    const sprite = view.children.find((c) => c instanceof GifSprite) as GifSprite | undefined;
    expect(sprite).toBeInstanceOf(GifSprite);
    expect(sprite!.source).toBe(src);
  });

  it('with no source mounts an empty container; update builds the sprite once the source lands', () => {
    const view = gif.mount(props(), none);
    expect(view.children).toHaveLength(0);
    const src = source();
    gif.update!(
      view,
      props(),
      ctxWith(() => src),
    );
    expect(view.children).toHaveLength(1);
    const s = view.children[0] as GifSprite;
    expect(s.source).toBe(src);
    gif.update!(
      view,
      props({ loop: false, speed: 0.5 }),
      ctxWith(() => src),
    );
    expect(view.children[0]).toBe(s);
    expect(s.loop).toBe(false);
    expect(s.animationSpeed).toBe(0.5);
    const other = source();
    gif.update!(
      view,
      props(),
      ctxWith(() => other),
    );
    expect(view.children).toHaveLength(1);
    expect((view.children[0] as GifSprite).source).toBe(other);
    expect(s.destroyed).toBe(true);
    gif.unmount!(view);
  });
});
