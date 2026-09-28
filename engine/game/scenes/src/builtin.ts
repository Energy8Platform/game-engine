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
  /** Paths something declared it will load — a document names them, or a row `require`d them: `get` does not call them "nothing loaded". Loads nothing. Optional: a loader without it warns as before. */
  expect?(urls: string[]): void;
}

export const container: NodeType = {
  type: 'container',
  schema: Schema.object({}),
  mount: () => new Container(),
};

const textureOf = (ctx: Context, src: string): Texture | undefined =>
  (ctx.reflect.get('assetLoader', false) as AssetLoader | undefined)?.get(src);

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif'];

/**
 * The path an asset-set node shows: the set's entry for the key, or the
 * plain prop. `srcKey` is an ordinary string prop — a `$cell` expression in a
 * symbol's state resolves before this runs — so an unknown key, an empty one
 * or no set at all falls back to what every document before the set had.
 */
export const pickFromSet = (
  src: string,
  srcOf: Record<string, string> | undefined,
  key: string | undefined,
): string => (key && srcOf && Object.hasOwn(srcOf, key) ? srcOf[key] : '') || src;

/** `src` and every entry of the set, once each, `src` first — the set preloads with the document, so a key change swaps a texture already there. */
export const setAssets = (src: string, srcOf: Record<string, string> | undefined): string[] =>
  // A fresh node has `src: ''` — nothing to request (`''` would resolve to `/`).
  [...new Set([src, ...Object.values(srcOf ?? {})].filter(Boolean))];

export interface ImageProps {
  src: string;
  /** Alternative images by key; `srcKey` picks one. */
  srcOf: Record<string, string>;
  srcKey: string;
}

export const image: NodeType<ImageProps> = {
  type: 'image',
  schema: Schema.object({
    src: Schema.string()
      .required()
      .extra('asset', IMAGE_EXTENSIONS)
      .description('image path, project-relative'),
    srcOf: Schema.dict(Schema.string().extra('asset', IMAGE_EXTENSIONS))
      .default({})
      .description('alternative images by key — every one preloaded with the document'),
    srcKey: Schema.string()
      .default('')
      .description(
        'which `srcOf` entry to show: a literal, or a `$cell` expression; unknown or empty → `src`',
      ),
  }) as Schema<ImageProps>,
  accept: { extensions: IMAGE_EXTENSIONS, prop: 'src' },
  assetProps: ['src'],
  assetMapProps: ['srcOf'],
  mount(props, ctx) {
    const texture = textureOf(ctx, pickFromSet(props.src, props.srcOf, props.srcKey));
    // No texture yet (not loaded, or failed): an empty sprite keeps the
    // node's slot; `show` loads, reports a failure itself, then `update`s.
    return texture ? new Sprite(texture) : new Sprite();
  },
  update(view, props, ctx) {
    (view as Sprite).texture =
      textureOf(ctx, pickFromSet(props.src, props.srcOf, props.srcKey)) ?? Texture.EMPTY;
  },
  assets: (props) => setAssets(props.src, props.srcOf),
};

/** The referenced document, mounted as a child. `mountDoc` is the runtime's; the cycle guard is its chain of ids. */
export const scene: NodeType<{ scene: string }> = {
  type: 'scene',
  schema: Schema.object({
    scene: Schema.string().required().extra('pick', 'scene').description('scene id'),
  }),
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
  /** Px added between letters; 0 = the renderer's own. */
  letterSpacing: number;
  /** Px per line; 0 = the renderer's own (its font metrics). */
  lineHeight: number;
  /** Shrinks the font so the laid-out text fits this width, design px; 0 = off. */
  fitWidth: number;
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
  letterSpacing: props.letterSpacing,
  // `COLOUR` in the schema refused a typo already; `Color` here is the
  // same judgment run for the VALUE. An empty fill is a cleared IDE field,
  // not an error — white, pixi's own default for text.
  fill: new Color(props.fill || '#ffffff').toNumber(),
  ...(props.stroke && props.strokeWidth > 0
    ? { stroke: { color: new Color(props.stroke).toNumber(), width: props.strokeWidth } }
    : {}),
  // Same "0 means unset" idiom as `stroke` above: an explicit 0 here would
  // still read back as pixi's own default (also 0), but leaving the key out
  // says so rather than relying on the coincidence.
  ...(props.lineHeight > 0 ? { lineHeight: props.lineHeight } : {}),
  wordWrap: props.wrap > 0,
  wordWrapWidth: props.wrap,
});

/**
 * Shrinks the font until the laid-out text fits `fitWidth` (never grows
 * it). Called AFTER the style (including `wrap`) is on the view, so a
 * wrapped text is measured by its widest LINE, not the whole string on one
 * line — `t.width` is whatever pixi already laid out.
 *
 * A wrapped text also gets `wordWrapWidth` scaled by the SAME factor as
 * `fontSize`: pixi's wrap boundary does not move with the font, so
 * shrinking the font alone lets it re-wrap MORE words onto each line at
 * the old boundary and the width climbs back toward `wrap` instead of
 * settling at `fitWidth`. Scaling both keeps the authored line breaks and
 * shrinks the whole block uniformly. Re-measured for up to 3 passes total
 * — a single proportional guess can under- or overshoot (rounding, a
 * bitmap font's discrete glyph widths), so one more pass corrects it
 * instead of leaving the text slightly over.
 */
function fitText(t: Text, props: TextProps): void {
  if (!(props.fitWidth > 0)) return;
  for (let pass = 0; pass < 3; pass++) {
    const width = t.width; // measured with the current size first
    if (width <= props.fitWidth) return;
    const factor = props.fitWidth / width;
    t.style.fontSize = Math.max(1, t.style.fontSize * factor);
    // The wrap boundary shrinks WITH the font — see this function's doc.
    if (t.style.wordWrap) t.style.wordWrapWidth = Math.max(1, t.style.wordWrapWidth * factor);
  }
}

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
    letterSpacing: Schema.number().default(0).description('px between letters'),
    lineHeight: Schema.number().default(0).description("px per line; 0 = the renderer's own"),
    fitWidth: Schema.number()
      .default(0)
      .description('shrink the font so the text fits this width, design px; 0 = off'),
  }) as Schema<TextProps>,
  assetProps: ['font'],
  mount(props, ctx) {
    const options = { text: props.text, style: styleOf(props, faceOf(ctx, props)) };
    // The branch is the DOCUMENT's (`font` named or not), never the
    // loader's: it must hold before the font has landed, and a swap of
    // class mid-life would need a remount, which an edited `font` gets
    // anyway.
    const view = props.font ? new BitmapText(options) : new Text(options);
    fitText(view as Text, props);
    return view;
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
    // After the style, not before: `styleOf` just set `fontSize` back to
    // `props.size` — a shorter `text` on the same node re-fits from the
    // full size, not from whatever a previous fit shrunk it to.
    fitText(t, props);
  },
  assets: (props) => (props.font ? [props.font] : []),
};
