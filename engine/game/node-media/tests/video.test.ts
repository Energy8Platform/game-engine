import { describe, expect, it, vi } from 'vitest';
import { Sprite, Texture } from 'pixi.js';
import type { Context } from 'cordis';
import { video } from '../src/video';

const fakeVideo = () => {
  const el = { play: vi.fn(() => Promise.resolve()), pause: vi.fn(), loop: false, muted: false };
  return { el, tex: { source: { resource: el } } as unknown as Texture };
};
const ctxWith = (get: (path: string) => unknown) =>
  ({ reflect: { get: () => ({ get }) } }) as unknown as Context;
const none = { reflect: { get: () => undefined } } as unknown as Context;
const props = (over: Record<string, unknown> = {}) =>
  video.schema({ src: 'assets/intro.mp4', ...over } as never);

describe('video', () => {
  it('declares its asset contract', () => {
    expect(video.type).toBe('video');
    expect(video.accept).toEqual({ extensions: ['mp4', 'webm'], prop: 'src' });
    expect(video.assetProps).toEqual(['src']);
    expect((video.schema.dict!.src.meta as { asset?: string[] }).asset).toEqual(['mp4', 'webm']);
    expect(props()).toMatchObject({ loop: true, muted: true, autoplay: true });
    expect(video.assets!(props())).toEqual(['assets/intro.mp4']);
    expect(video.assets!(video.schema({} as never))).toEqual([]);
  });

  it('mounts a sprite on the video texture, drives loop/muted on the element and plays', () => {
    const { el, tex } = fakeVideo();
    const view = video.mount(
      props(),
      ctxWith(() => tex),
    ) as Sprite;
    expect(view).toBeInstanceOf(Sprite);
    expect(view.texture).toBe(tex);
    expect(el.loop).toBe(true);
    expect(el.muted).toBe(true);
    expect(el.play).toHaveBeenCalledTimes(1);
    expect(el.pause).not.toHaveBeenCalled();
  });

  it('with nothing loaded mounts an empty sprite; update fills the texture in and honours the props', () => {
    const view = video.mount(props(), none) as Sprite;
    expect(view.texture).toBe(Texture.EMPTY);
    const { el, tex } = fakeVideo();
    video.update!(
      view,
      props({ loop: false, muted: false, autoplay: false }),
      ctxWith(() => tex),
    );
    expect(view.texture).toBe(tex);
    expect(el.loop).toBe(false);
    expect(el.muted).toBe(false);
    expect(el.play).not.toHaveBeenCalled();
    expect(el.pause).toHaveBeenCalledTimes(1);
  });

  it('unmount pauses the element', () => {
    const { el, tex } = fakeVideo();
    const view = video.mount(
      props(),
      ctxWith(() => tex),
    );
    video.unmount!(view);
    expect(el.pause).toHaveBeenCalledTimes(1);
    expect(view.destroyed).toBe(true);
  });
});
