/**
 * `spritesheet`: an `AnimatedSprite` over one animation of a pixi
 * spritesheet (`Assets.get(sheet)` after the JSON loads). The runtime
 * mounts before it loads, so `mount` may find nothing: the view is then an
 * `AnimatedSprite` on `Texture.EMPTY`, and `update` (after every load)
 * swaps the real frames in — the same shape `image` uses.
 */
import type { Context } from 'cordis';
import { AnimatedSprite, Spritesheet, Texture } from 'pixi.js';
import Schema from 'schemastery';
import type { AssetLoader, NodeType } from '@energy8engine/scenes';

export interface SpritesheetProps {
  sheet: string;
  animation?: string;
  fps: number;
  loop: boolean;
  playing: boolean;
}

const EMPTY = [Texture.EMPTY];

/** The named animation, else the sheet's first, else every frame in name order. */
function framesOf(ctx: Context, props: SpritesheetProps): Texture[] {
  const sheet = (ctx.reflect.get('assetLoader', false) as AssetLoader | undefined)?.get(
    props.sheet,
  ) as unknown;
  // The picker offers every `.json`: one that is not a spritesheet keeps the placeholder.
  if (!(sheet instanceof Spritesheet)) return EMPTY;
  const named = sheet.animations[props.animation || Object.keys(sheet.animations)[0]];
  const frames = (
    named ??
    Object.keys(sheet.textures)
      .sort()
      .map((k) => sheet.textures[k])
  ).filter((t): t is Texture => t instanceof Texture); // a frame name missing from the atlas: drop it, not throw
  return frames.length > 0 ? frames : EMPTY;
}

const same = (a: Texture[], b: Texture[]) => a.length === b.length && a.every((t, i) => t === b[i]);

export const spritesheet: NodeType<SpritesheetProps> = {
  type: 'spritesheet',
  schema: Schema.object({
    sheet: Schema.string()
      .required()
      .extra('asset', ['json'])
      .description('spritesheet JSON, project-relative'),
    animation: Schema.string().description("animation name (empty: the sheet's first)"),
    fps: Schema.number().default(12).description('frames per second'),
    loop: Schema.boolean().default(true),
    playing: Schema.boolean().default(true),
  }) as Schema<SpritesheetProps>,
  accept: { extensions: ['json'], prop: 'sheet' },
  assetProps: ['sheet'],
  assets: (p) => (p.sheet ? [p.sheet] : []),
  mount(props, ctx) {
    const view = new AnimatedSprite(EMPTY);
    spritesheet.update!(view, props, ctx);
    return view;
  },
  update(view, props, ctx) {
    const s = view as AnimatedSprite;
    const frames = framesOf(ctx, props);
    const swapped = !same(s.textures as Texture[], frames);
    if (swapped) s.textures = frames;
    s.animationSpeed = props.fps / 60;
    s.loop = props.loop;
    // Props are fixed per view (an edit remounts), so only a frame swap starts playback —
    // a finished one-shot (`loop: false`) must stay on its last frame across later refreshes.
    const play = props.playing && frames !== EMPTY;
    if (play && swapped) s.gotoAndPlay(0);
    else if (!play && s.playing) s.stop();
  },
  // Not one of the runtime's own types, so it does not destroy the view: stop the ticker here.
  unmount: (view) => view.destroy(),
  // A view still on the placeholder (`mount` beat the load) has nothing to play: resolve at once
  // rather than wait for a swap that `once`'s own caller has no way to trigger.
  once(view, props) {
    const s = view as AnimatedSprite;
    if (!(s instanceof AnimatedSprite) || s.textures.length <= 1) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      // Idempotent, and reachable two ways: the animation finishing, or the cell tearing the
      // view down mid-play (a symbol's `playWin` awaits this — it must not hang on a destroy).
      // The 'destroyed' listener is `off`'d on the normal path too — left registered, a repeat
      // `once()` on the same still-live view would stack another one on every call.
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
