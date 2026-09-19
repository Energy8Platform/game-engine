/**
 * `video`: a `Sprite` on a video texture (`Assets.get(src)` for an
 * `.mp4`/`.webm` is a `Texture` whose source is a `VideoSource`; its
 * `resource` is the `<video>` element). `loop`/`muted`/`autoplay` are
 * driven on that element every `update`, since the texture is shared by
 * the assets cache and only the element remembers them.
 */
import { Sprite, Texture } from 'pixi.js';
import Schema from 'schemastery';
import type { AssetLoader, NodeType } from '@energy8engine/scenes';

export interface VideoProps {
  src?: string;
  loop: boolean;
  muted: boolean;
  autoplay: boolean;
}

type VideoEl = Pick<HTMLVideoElement, 'loop' | 'muted' | 'play' | 'pause'>;

const elementOf = (tex: Texture): VideoEl | undefined => {
  const el = (tex.source as { resource?: unknown }).resource as Partial<VideoEl> | undefined;
  return el && typeof el.play === 'function' && typeof el.pause === 'function'
    ? (el as VideoEl)
    : undefined;
};

/** The fuller element `once` drives — same resource, a few more members. */
type OnceEl = Pick<HTMLVideoElement, 'loop' | 'currentTime' | 'play' | 'addEventListener'>;

const onceElementOf = (tex: Texture): OnceEl | undefined => {
  const el = (tex.source as { resource?: unknown }).resource as Partial<OnceEl> | undefined;
  return el && typeof el.play === 'function' && typeof el.addEventListener === 'function'
    ? (el as OnceEl)
    : undefined;
};

const VIDEO_EXTENSIONS = ['mp4', 'webm'];

export const video: NodeType<VideoProps> = {
  type: 'video',
  schema: Schema.object({
    src: Schema.string()
      .extra('asset', VIDEO_EXTENSIONS)
      .description('video path, project-relative'),
    loop: Schema.boolean().default(true),
    muted: Schema.boolean().default(true),
    autoplay: Schema.boolean().default(true),
  }) as Schema<VideoProps>,
  accept: { extensions: VIDEO_EXTENSIONS, prop: 'src' },
  assetProps: ['src'],
  assets: (p) => (p.src ? [p.src] : []),
  mount(props, ctx) {
    const view = new Sprite();
    video.update!(view, props, ctx);
    return view;
  },
  update(view, props, ctx) {
    const s = view as Sprite;
    const tex = props.src
      ? ((ctx.reflect.get('assetLoader', false) as AssetLoader | undefined)?.get(props.src) as
          Texture | undefined)
      : undefined;
    s.texture = tex ?? Texture.EMPTY;
    const el = tex && elementOf(tex);
    if (!el) return;
    el.loop = props.loop;
    el.muted = props.muted;
    // `play()` rejects when the browser blocks autoplay (unmuted, no gesture); nothing to do about it here.
    if (props.autoplay) void Promise.resolve(el.play()).catch(() => {});
    else el.pause();
  },
  unmount(view) {
    const s = view as Sprite;
    elementOf(s.texture)?.pause();
    s.destroy();
  },
  once(view, props) {
    const s = view as Sprite;
    const el = onceElementOf(s.texture);
    if (!el) return Promise.resolve();
    return new Promise<void>((resolve) => {
      el.loop = false;
      el.currentTime = 0;
      void el.play();
      el.addEventListener(
        'ended',
        () => {
          el.loop = props.loop;
          resolve();
        },
        { once: true },
      );
    });
  },
};
