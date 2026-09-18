/**
 * `gif`: a `GifSprite` over the `GifSource` that `Assets.get(src)` holds
 * once `pixi.js/gif`'s loader parsed the file. A `GifSprite` is born with
 * its source and cannot swap it, so the view is a `Container` and the
 * sprite its only child — (re)built by `update` when the source appears or
 * changes.
 *
 * ponytail: the wrapper has no `anchor`, so the common `anchor` prop does not reach the sprite — forward it in `update` when a gif needs one.
 */
import { Container } from 'pixi.js';
// Importing `pixi.js/gif` (its `init` entry) also registers the `.gif` asset parser `Assets.load` needs.
import { GifSource, GifSprite } from 'pixi.js/gif';
import Schema from 'schemastery';
import type { AssetLoader, NodeType } from '@energy8engine/scenes';

export interface GifProps {
  src?: string;
  loop: boolean;
  speed: number;
}

export const gif: NodeType<GifProps> = {
  type: 'gif',
  schema: Schema.object({
    src: Schema.string().extra('asset', ['gif']).description('gif path, project-relative'),
    loop: Schema.boolean().default(true),
    speed: Schema.number().default(1).description('playback speed multiplier'),
  }) as Schema<GifProps>,
  accept: { extensions: ['gif'], prop: 'src' },
  assetProps: ['src'],
  assets: (p) => (p.src ? [p.src] : []),
  mount(props, ctx) {
    const view = new Container();
    gif.update!(view, props, ctx);
    return view;
  },
  update(view, props, ctx) {
    const source = props.src
      ? ((ctx.reflect.get('assetLoader', false) as AssetLoader | undefined)?.get(
          props.src,
        ) as unknown)
      : undefined;
    let sprite = view.children[0] as GifSprite | undefined;
    if (!(source instanceof GifSource)) {
      sprite?.destroy(false);
      return;
    }
    if (sprite?.source !== source) {
      sprite?.destroy(false);
      sprite = view.addChild(new GifSprite({ source, autoPlay: true }));
    }
    sprite.loop = props.loop;
    sprite.animationSpeed = props.speed;
  },
  // `destroy(false)` keeps the source: it is the assets cache's, shared by every node on the same file.
  unmount(view) {
    (view.children[0] as GifSprite | undefined)?.destroy(false);
    view.destroy();
  },
};
