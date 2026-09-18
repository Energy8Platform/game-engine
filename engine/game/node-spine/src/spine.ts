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
import { diagnostic } from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
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

/**
 * The `SkeletonData` of `props` from what the loader holds: nothing while
 * either half is missing; throws when the loaded skeleton is no skeleton
 * (the picker offers every `.json`) or does not parse.
 */
export function resolveSkeleton(
  loader: AssetLoader | undefined,
  props: SpineProps,
): SkeletonData | undefined {
  const raw = loader?.get(props.skeleton) as unknown;
  const atlas = loader?.get(atlasOf(props)) as unknown;
  if (!raw || !(atlas instanceof TextureAtlas)) return undefined;
  const attachments = new AtlasAttachmentLoader(atlas);
  if (raw instanceof Uint8Array) return new SkeletonBinary(attachments).readSkeletonData(raw);
  // Spine's own loader test for a skeleton JSON.
  if (!Object.prototype.hasOwnProperty.call(raw, 'bones')) throw new Error('no "bones"');
  return new SkeletonJson(attachments).readSkeletonData(raw);
}

/** Animation (the named one, else the first), loop, skin (the named one, else the default) and speed onto a built `Spine`; a running track is left alone. */
export function applyProps(s: Spine, props: SpineProps): void {
  const data = s.skeleton.data;
  const animation = (props.animation && data.findAnimation(props.animation)) || data.animations[0];
  const track = s.state.tracks[0];
  if (animation && track?.animation !== animation)
    s.state.setAnimation(0, animation.name, props.loop);
  else if (track) track.loop = props.loop;
  const skin = (props.skin && data.findSkin(props.skin)) || data.defaultSkin;
  if (skin && s.skeleton.skin !== skin) {
    s.skeleton.setSkin(skin);
    s.skeleton.setSlotsToSetupPose();
  }
  s.state.timeScale = props.speed;
}

/** Placeholders whose skeleton failed to parse, so the error is reported once and not on every refresh. */
const reported = new WeakSet<Container>();

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
      let data: SkeletonData | undefined;
      try {
        data = resolveSkeleton(loader, props);
      } catch (e) {
        // A throw here would abort every other node's refresh; report it once per view (a refresh runs after every load) and keep the placeholder.
        if (!reported.has(view)) {
          reported.add(view);
          (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(
            diagnostic(
              'error',
              'spine',
              props.skeleton,
              `spine skeleton "${props.skeleton}" did not parse: ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
        }
        return;
      }
      if (!data) return;
      s = view.addChild(new Spine({ skeletonData: data }));
    } else if (!loader?.get(props.skeleton) || !loader?.get(atlasOf(props))) {
      // Unloaded: the textures are gone with the atlas; the next load builds it again.
      s.destroy();
      return;
    }
    applyProps(s, props);
  },
  // Not one of the runtime's own types, so it does not destroy the view; `Spine.destroy` leaves the ticker.
  unmount: (view) => view.destroy({ children: true }),
};
