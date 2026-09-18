/**
 * The three node types every project has: `container` (a group),
 * `image` (a sprite from a project-relative path) and `scene` (another
 * document, nested). Views these build are the runtime's to destroy;
 * any other type's view is only detached on unmount.
 */
import type { Context } from 'cordis';
import { Container, Sprite, Texture } from 'pixi.js';
import Schema from 'schemastery';
import type { NodeType } from './node-types';

/** What `image` reads to build a sprite — `pixi.js`' `Assets` in the runtime, a fake in tests. */
export interface AssetLoader {
  load(urls: string[]): Promise<void>;
  unload(urls: string[]): Promise<void>;
  get(url: string): Texture | undefined;
}

export const container: NodeType = {
  type: 'container',
  schema: Schema.object({}),
  mount: () => new Container(),
};

const textureOf = (ctx: Context, src: string): Texture | undefined =>
  (ctx.reflect.get('assetLoader', false) as AssetLoader | undefined)?.get(src);

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

export const image: NodeType<{ src: string }> = {
  type: 'image',
  schema: Schema.object({
    src: Schema.string()
      .required()
      .extra('asset', IMAGE_EXTENSIONS)
      .description('image path, project-relative'),
  }),
  accept: { extensions: IMAGE_EXTENSIONS, prop: 'src' },
  assetProps: ['src'],
  mount(props, ctx) {
    const texture = textureOf(ctx, props.src);
    // No texture yet (not loaded, or failed): an empty sprite keeps the
    // node's slot; `show` loads, reports a failure itself, then `update`s.
    return texture ? new Sprite(texture) : new Sprite();
  },
  update(view, props, ctx) {
    (view as Sprite).texture = textureOf(ctx, props.src) ?? Texture.EMPTY;
  },
  // A fresh image has `src: ''` — nothing to request (`''` would resolve to `/`).
  assets: (props) => (props.src ? [props.src] : []),
};

/** The referenced document, mounted as a child. `mountDoc` is the runtime's; the cycle guard is its chain of ids. */
export const scene: NodeType<{ scene: string }> = {
  type: 'scene',
  schema: Schema.object({ scene: Schema.string().required().description('scene id') }),
  mount(props, ctx) {
    const scenes = ctx.reflect.get('scenes', false) as
      { mountDoc(id: string, chain: string[]): Container | null } | undefined;
    const chain = (ctx as unknown as { __sceneChain?: string[] }).__sceneChain ?? [];
    const view = scenes?.mountDoc(props.scene, chain);
    if (!view)
      throw new Error(`scene "${props.scene}" cannot be nested here (missing, or a cycle)`);
    return view;
  },
};
