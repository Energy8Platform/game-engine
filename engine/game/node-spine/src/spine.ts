/**
 * `spine`: a `Spine` over a skeleton (`.skel`/`.json`) and its atlas, both
 * in the loader after `scenes.show` (`spine-pixi-v8`'s parsers — registered
 * by importing it — leave the skeleton raw and the atlas a textured
 * `TextureAtlas`; the `SkeletonData` is built here, the way `Spine.from`
 * does). A `Spine` is born with its data, so the view is a `Container` and
 * the `Spine` its only child — built by `update` once both assets are
 * there, dropped when they go.
 *
 * ponytail: the wrapper has no `anchor`, so the common `anchor` prop does not reach the skeleton (a skeleton has no anchor anyway — its origin is its root bone).
 * ponytail: `SkeletonData` is parsed per node, not cached like `Spine.from`'s `Cache` key — add a cache when many nodes share one big skeleton.
 */
import { Container } from 'pixi.js';
import {
  AtlasAttachmentLoader,
  SkeletonBinary,
  SkeletonJson,
  Spine,
  TextureAtlas,
  type SkeletonData,
} from '@esotericsoftware/spine-pixi-v8';
import Schema from 'schemastery';
import type { AssetLoader, NodeType } from '@energy8engine/scenes';

export interface SpineProps {
  skeleton: string;
  atlas?: string;
  animation?: string;
  loop: boolean;
  skin?: string;
  speed: number;
}

const atlasOf = (p: SpineProps) => p.atlas || p.skeleton.replace(/\.(skel|json)$/, '.atlas');

/** The `SkeletonData` of `props` from what the loader holds, or nothing while either half is missing. */
export function resolveSkeleton(
  loader: AssetLoader | undefined,
  props: SpineProps,
): SkeletonData | undefined {
  const raw = loader?.get(props.skeleton) as unknown;
  const atlas = loader?.get(atlasOf(props)) as unknown;
  if (!raw || !(atlas instanceof TextureAtlas)) return undefined;
  const binary = raw instanceof Uint8Array;
  // The picker offers every `.json`: one that is no skeleton (spine's own loader test) keeps the placeholder.
  if (!binary && !Object.prototype.hasOwnProperty.call(raw, 'bones')) return undefined;
  const attachments = new AtlasAttachmentLoader(atlas);
  // ponytail: a malformed skeleton keeps the placeholder in silence — `refresh()` has no per-node guard yet, and a throw here would abort every other node's update; report it once `update` can name its node.
  try {
    return binary
      ? new SkeletonBinary(attachments).readSkeletonData(raw)
      : new SkeletonJson(attachments).readSkeletonData(raw);
  } catch {
    return undefined;
  }
}

/** Animation (the named one, else the first), loop, skin and speed onto a built `Spine`; a running track is left alone. */
export function applyProps(s: Spine, props: SpineProps): void {
  const data = s.skeleton.data;
  const animation = (props.animation && data.findAnimation(props.animation)) || data.animations[0];
  const track = s.state.tracks[0];
  if (animation && track?.animation !== animation)
    s.state.setAnimation(0, animation.name, props.loop);
  else if (track) track.loop = props.loop;
  const skin = props.skin ? data.findSkin(props.skin) : null;
  if (skin && s.skeleton.skin !== skin) {
    s.skeleton.setSkin(skin);
    s.skeleton.setSlotsToSetupPose();
  }
  s.state.timeScale = props.speed;
}

export const spine: NodeType<SpineProps> = {
  type: 'spine',
  schema: Schema.object({
    skeleton: Schema.string()
      .required()
      .extra('asset', ['skel', 'json'])
      .description('skeleton (.skel or Spine .json), project-relative'),
    atlas: Schema.string()
      .extra('asset', ['atlas'])
      .description('atlas text (empty: the skeleton path with .atlas)'),
    animation: Schema.string().description("animation name (empty: the skeleton's first)"),
    loop: Schema.boolean().default(true),
    skin: Schema.string().description('skin name (empty: the default skin)'),
    speed: Schema.number().default(1).description('playback speed multiplier (timeScale)'),
  }) as Schema<SpineProps>,
  accept: { extensions: ['skel', 'json'], prop: 'skeleton', sibling: 'atlas' },
  assetProps: ['skeleton', 'atlas'],
  assets: (p) => (p.skeleton ? [p.skeleton, atlasOf(p)] : []),
  mount(props, ctx) {
    const view = new Container();
    spine.update!(view, props, ctx);
    return view;
  },
  update(view, props, ctx) {
    const loader = ctx.reflect.get('assetLoader', false) as AssetLoader | undefined;
    let s = view.children[0] as Spine | undefined;
    if (!s) {
      const data = resolveSkeleton(loader, props);
      if (!data) return;
      s = view.addChild(new Spine({ skeletonData: data }));
    } else if (!loader?.get(props.skeleton)) {
      // Unloaded: the textures are gone with the atlas; the next load builds it again.
      s.destroy();
      return;
    }
    applyProps(s, props);
  },
  // Not one of the runtime's own types, so it does not destroy the view; `Spine.destroy` leaves the ticker.
  unmount: (view) => view.destroy({ children: true }),
};
