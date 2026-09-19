/**
 * `strip`: an `AnimatedSprite` over frames sliced from a grid-strip image —
 * one file cut into `cols`×`rows` equal cells, the first `frames` of them
 * (row-major) used as the animation. No atlas JSON, unlike `spritesheet`.
 *
 * The runtime mounts before the image loads, so `mount` may find nothing:
 * the view is then an `AnimatedSprite` on `Texture.EMPTY`, and `update`
 * (after every load) slices the real frames in — the same placeholder
 * shape `spritesheet` uses. The sliced `Texture`s are this node's own (not
 * the asset cache's), so they are destroyed — on every re-slice, and on
 * unmount — same as `texture.destroy(false)` in `gif`/`video`, just for a
 * texture this file made rather than one it merely stopped using.
 */
import type { Context } from 'cordis';
import { AnimatedSprite, Rectangle, Texture, type TextureSource } from 'pixi.js';
import Schema from 'schemastery';
import type { AssetLoader, NodeType } from '@energy8engine/scenes';

export interface StripProps {
  src: string;
  cols: number;
  rows: number;
  frames: number;
  fps: number;
  loop: boolean;
  playing: boolean;
}

const EMPTY = [Texture.EMPTY];

/** Same raster set `image` accepts — `strip` has no `accept` of its own, drops go to `image`. */
const STRIP_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif'];

interface Sliced {
  source: TextureSource;
  cols: number;
  rows: number;
  frames: number;
  textures: Texture[];
}

/** What each view was last sliced from — skips re-slicing when nothing changed. */
const sliced = new WeakMap<AnimatedSprite, Sliced>();

const destroySliced = (view: AnimatedSprite) => {
  const prev = sliced.get(view);
  if (!prev) return;
  for (const t of prev.textures) t.destroy(false);
  sliced.delete(view);
};

/** Slices the base texture into `cols`×`rows` cells, the first `frames` in row-major order. */
function framesOf(view: AnimatedSprite, ctx: Context, props: StripProps): Texture[] {
  const base = (ctx.reflect.get('assetLoader', false) as AssetLoader | undefined)?.get(props.src);
  if (!base || base === Texture.EMPTY) {
    destroySliced(view);
    return EMPTY;
  }
  const count = Math.min(
    Math.max(0, props.frames || props.cols * props.rows),
    props.cols * props.rows,
  );
  const prev = sliced.get(view);
  if (
    prev &&
    prev.source === base.source &&
    prev.cols === props.cols &&
    prev.rows === props.rows &&
    prev.frames === count
  )
    return prev.textures;
  destroySliced(view);
  if (count === 0) return EMPTY;
  const w = Math.floor(base.width / props.cols);
  const h = Math.floor(base.height / props.rows);
  const textures: Texture[] = [];
  for (let i = 0; i < count; i++) {
    const c = i % props.cols;
    const r = Math.floor(i / props.cols);
    textures.push(new Texture({ source: base.source, frame: new Rectangle(c * w, r * h, w, h) }));
  }
  sliced.set(view, { source: base.source, cols: props.cols, rows: props.rows, frames: count, textures });
  return textures;
}

export const strip: NodeType<StripProps> = {
  type: 'strip',
  schema: Schema.object({
    src: Schema.string()
      .required()
      .extra('asset', STRIP_EXTENSIONS)
      .description('grid-strip image, project-relative'),
    cols: Schema.natural().default(1).description('columns in the grid'),
    rows: Schema.natural().default(1).description('rows in the grid'),
    frames: Schema.number().default(0).description('frames to use, row-major (0: every cell)'),
    fps: Schema.number().default(12).description('frames per second'),
    loop: Schema.boolean().default(true),
    playing: Schema.boolean().default(true),
  }) as Schema<StripProps>,
  assetProps: ['src'],
  assets: (p) => (p.src ? [p.src] : []),
  mount(props, ctx) {
    const view = new AnimatedSprite(EMPTY);
    strip.update!(view, props, ctx);
    return view;
  },
  update(view, props, ctx) {
    const s = view as AnimatedSprite;
    const frames = framesOf(s, ctx, props);
    const swapped = s.textures !== frames;
    if (swapped) s.textures = frames;
    s.animationSpeed = props.fps / 60;
    s.loop = props.loop;
    // Props are fixed per view (an edit remounts), so only a frame swap starts playback —
    // a finished one-shot (`loop: false`) must stay on its last frame across later refreshes.
    const play = props.playing && frames !== EMPTY;
    if (play && swapped) s.gotoAndPlay(0);
    else if (!play && s.playing) s.stop();
  },
  // Not one of the runtime's own types, so it does not destroy the view: stop the ticker and
  // free this node's own sliced textures here.
  unmount(view) {
    const s = view as AnimatedSprite;
    destroySliced(s);
    s.destroy();
  },
  // A view still on the placeholder (`mount` beat the load) has nothing to play: resolve at once
  // rather than wait for a swap that `once`'s own caller has no way to trigger.
  once(view, props) {
    const s = view as AnimatedSprite;
    if (!(s instanceof AnimatedSprite) || s.textures.length <= 1) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      // Idempotent, and reachable two ways: the animation finishing, or the cell tearing the
      // view down mid-play. The 'destroyed' listener is `off`'d on the normal path too — left
      // registered, a repeat `once()` on the same still-live view would stack another one on
      // every call.
      const done = (viaDestroy: boolean) => {
        if (settled) return;
        settled = true;
        s.onComplete = undefined;
        s.off('destroyed', onDestroyed);
        if (!viaDestroy) s.loop = props.loop;
        resolve();
      };
      const onDestroyed = () => done(true);
      s.loop = false;
      s.onComplete = () => done(false);
      s.once('destroyed', onDestroyed);
      s.gotoAndPlay(0);
    });
  },
};
