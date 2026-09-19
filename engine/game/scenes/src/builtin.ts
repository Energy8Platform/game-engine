/**
 * The four node types every project has: `container` (a group), `image`
 * (a sprite from a project-relative path), `scene` (another document,
 * nested) and `shape` (a `Graphics` primitive — also the intended mask:
 * `mask: true` on a `shape` clips its parent, applied generically by the
 * runtime for any node type). Views these build are the runtime's to
 * destroy (`OWN` in `./scenes`); any other type's view is only detached on
 * unmount.
 */
import type { Context } from 'cordis';
import { Color, Container, Graphics, Sprite, Texture } from 'pixi.js';
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

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif'];

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

export interface ShapeProps {
  kind: 'rect' | 'roundRect' | 'circle' | 'ellipse';
  width: number;
  height: number;
  /** Corner radius (`roundRect`) or radius (`circle`); `ellipse` uses `width`/`height` instead. */
  radius: number;
  fill: string;
  fillAlpha: number;
  stroke: string;
  strokeWidth: number;
}

/** A `Graphics` rect/roundRect/circle/ellipse, local-origin at (0,0) — the runtime's `mask: true` primitive. */
export const shape: NodeType<ShapeProps> = {
  type: 'shape',
  schema: Schema.object({
    kind: Schema.union(['rect', 'roundRect', 'circle', 'ellipse']).default('rect'),
    width: Schema.number().default(100).description('design px (rect/roundRect/ellipse)'),
    height: Schema.number().default(100).description('design px (rect/roundRect/ellipse)'),
    radius: Schema.number().default(8).description('corner radius (roundRect) or radius (circle)'),
    fill: Schema.string().default('#ffffff').description('#rrggbb, or empty for no fill'),
    fillAlpha: Schema.number().default(1).description('fill opacity'),
    stroke: Schema.string().default('').description('#rrggbb, or empty for no stroke'),
    strokeWidth: Schema.number().default(0).description('stroke width, px'),
  }) as Schema<ShapeProps>,
  mount(props, ctx) {
    const view = new Graphics();
    shape.update!(view, props, ctx);
    return view;
  },
  update(view, props) {
    const g = view as Graphics;
    g.clear();
    switch (props.kind) {
      case 'roundRect':
        g.roundRect(0, 0, props.width, props.height, props.radius);
        break;
      case 'circle':
        g.circle(0, 0, props.radius);
        break;
      case 'ellipse':
        g.ellipse(0, 0, props.width / 2, props.height / 2);
        break;
      default:
        g.rect(0, 0, props.width, props.height);
    }
    // `Color`, not the raw string: THROWS on a value that is neither `#rrggbb` nor a named
    // colour, which `mountNode`/`refresh` already turn into this node's own diagnostic.
    if (props.fill) g.fill({ color: new Color(props.fill).toNumber(), alpha: props.fillAlpha });
    if (props.stroke && props.strokeWidth > 0)
      g.stroke({ color: new Color(props.stroke).toNumber(), width: props.strokeWidth });
  },
};
