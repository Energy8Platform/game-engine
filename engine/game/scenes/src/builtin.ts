/**
 * The five node types every project has: `container` (a group), `image`
 * (a sprite from a project-relative path), `scene` (another document,
 * nested), `shape` (a `Graphics` primitive — also the intended mask:
 * `mask: true` on a `shape` clips its parent, applied generically by the
 * runtime for any node type) and `text` (a `Text`, or a `BitmapText` when
 * a bitmap font is named). Views these build are the runtime's to
 * destroy (`OWN` in `./scenes`); any other type's view is only detached on
 * unmount.
 */
import type { Context } from 'cordis';
import { BitmapText, Color, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import Schema from 'schemastery';
import { COLOUR } from './common-schema';
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
    fill: Schema.string()
      .pattern(COLOUR)
      .default('#ffffff')
      .description('#rrggbb, or empty for no fill'),
    fillAlpha: Schema.number().default(1).description('fill opacity'),
    stroke: Schema.string()
      .pattern(COLOUR)
      .default('')
      .description('#rrggbb, or empty for no stroke'),
    strokeWidth: Schema.number().default(0).description('stroke width, px'),
  }) as Schema<ShapeProps>,
  mount(props, ctx) {
    const view = new Graphics();
    shape.update!(view, props, ctx);
    return view;
  },
  update(view, props) {
    const g = view as Graphics;
    // Parsed BEFORE `clear()`: a colour `Color` refuses must leave the
    // shape as it was, not wipe it. `COLOUR` in the schema already turns
    // a typo into a refusal one step earlier; this keeps the apply itself
    // all-or-nothing for anything that slips past it.
    const fill = props.fill ? new Color(props.fill).toNumber() : undefined;
    const stroke =
      props.stroke && props.strokeWidth > 0 ? new Color(props.stroke).toNumber() : undefined;
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
    if (fill !== undefined) g.fill({ color: fill, alpha: props.fillAlpha });
    if (stroke !== undefined) g.stroke({ color: stroke, width: props.strokeWidth });
  },
};

export interface TextProps {
  text: string;
  size: number;
  family: string;
  fill: string;
  weight: 'normal' | 'bold';
  align: 'left' | 'center' | 'right';
  stroke: string;
  strokeWidth: number;
  /** `wordWrapWidth`, design px; 0 is no wrap at all. */
  wrap: number;
  /** A bitmap font, project-relative; empty means a web font from `family`. */
  font: string;
}

const FONT_EXTENSIONS = ['fnt', 'xml'];

/**
 * The face name a `BitmapText` resolves `fontFamily` against. Loading
 * `x.fnt` registers a `BitmapFont` under the name inside the FILE — the
 * document's path is not it — so the loaded asset is what to ask. Not
 * loaded yet (mount runs before `show` loads): the web `family` stands in
 * until `update` runs again, the way `image` waits for its texture.
 */
const faceOf = (ctx: Context, props: TextProps): string => {
  if (!props.font) return props.family;
  const font = (ctx?.reflect.get('assetLoader', false) as AssetLoader | undefined)?.get(
    props.font,
  ) as unknown as { fontFamily?: string } | undefined;
  return font?.fontFamily ?? props.family;
};

const styleOf = (props: TextProps, fontFamily: string) => ({
  fontFamily,
  fontSize: props.size,
  fontWeight: props.weight,
  align: props.align,
  // `COLOUR` in the schema refused a typo already; `Color` here is the
  // same judgment run for the VALUE. An empty fill is a cleared IDE field,
  // not an error — white, pixi's own default for text.
  fill: new Color(props.fill || '#ffffff').toNumber(),
  ...(props.stroke && props.strokeWidth > 0
    ? { stroke: { color: new Color(props.stroke).toNumber(), width: props.strokeWidth } }
    : {}),
  wordWrap: props.wrap > 0,
  wordWrapWidth: props.wrap,
});

/** A pixi `Text` — or a `BitmapText` when `font` names a bitmap font. Both have an `anchor`, so the common anchor props apply to either. */
export const text: NodeType<TextProps> = {
  type: 'text',
  schema: Schema.object({
    text: Schema.string().default('').description('what it says'),
    size: Schema.number().default(24).description('font size, design px'),
    family: Schema.string().default('sans-serif').description('font family, when `font` is empty'),
    fill: Schema.string().pattern(COLOUR).default('#ffffff').description('#rrggbb'),
    weight: Schema.union(['normal', 'bold']).default('normal'),
    align: Schema.union(['left', 'center', 'right']).default('left'),
    stroke: Schema.string()
      .pattern(COLOUR)
      .default('')
      .description('#rrggbb, or empty for no outline'),
    strokeWidth: Schema.number().default(0).description('outline width, px'),
    wrap: Schema.number().default(0).description('word-wrap width, design px; 0 = no wrap'),
    font: Schema.string()
      .default('')
      .extra('asset', FONT_EXTENSIONS)
      .description('bitmap font, project-relative; empty for a web font'),
  }) as Schema<TextProps>,
  assetProps: ['font'],
  mount(props, ctx) {
    const options = { text: props.text, style: styleOf(props, faceOf(ctx, props)) };
    // The branch is the DOCUMENT's (`font` named or not), never the
    // loader's: it must hold before the font has landed, and a swap of
    // class mid-life would need a remount, which an edited `font` gets
    // anyway.
    return props.font ? new BitmapText(options) : new Text(options);
  },
  update(view, props, ctx) {
    // The style is built BEFORE the first assignment: `styleOf` parses
    // colours, and a throw between `text` and `style` would leave the node
    // saying the new thing in the old style.
    const style = styleOf(props, faceOf(ctx, props));
    // `Text` and `BitmapText` both extend `AbstractText`: same `text`, same
    // `style` setter, which REPLACES the style rather than merging into it.
    const t = view as Text;
    t.text = props.text;
    t.style = style;
  },
  assets: (props) => (props.font ? [props.font] : []),
};
