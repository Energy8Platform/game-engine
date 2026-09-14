import { CanvasTextMetrics, Text, TextStyle } from 'pixi.js';
import { SHELL_FONT_CSS } from '@/core/fonts';
import { HB_FONT_CSS, HB_HEAD_FONT_FAMILY, HB_NUM_FONT_FAMILY } from './fonts';
import { HB } from './theme';

// The HB shell renders text on canvas with three bundled faces registered in `document.fonts`:
// Inter (body, shared with every shell), Space Grotesk (headings / emphasis) and Switzer (numbers,
// drawn with an ink stroke). All @font-face CSS is injected once; text measured before a face
// swaps in is re-laid-out on `whenFontReady`.

const STYLE_ID = '__ge-pixi-hb-font__';

/** Inter leads the stack (same as the DOM shell) so the shell renders identically everywhere;
 *  the system fonts stay as graceful fallback if the webfont ever fails to load. */
export const FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/** Numeric font — Switzer 700 leads, falling back to Inter. Readout VALUES (balance/bet/win/FS
 *  counter, autoplay countdown, prices), always drawn with `stroke: true`. */
export const NUM_FONT_FAMILY = `${HB_NUM_FONT_FAMILY}, ${FONT_FAMILY}`;
/** Switzer sits close to Inter's width — no size bump needed. */
export const NUM_FONT_SCALE = 1;
/** Heading font — Space Grotesk (latin only; Cyrillic falls back to Inter). */
export const HEAD_FONT_FAMILY = `${HB_HEAD_FONT_FAMILY}, ${FONT_FAMILY}`;
/** Stroke width (px) around numerals — the "bordered digits" of the brand. */
export const NUM_STROKE = 3;

let installed = false;

/** Idempotently register the bundled Inter font in the document. No-op outside a DOM. */
export function installShellFont(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = SHELL_FONT_CSS + HB_FONT_CSS;
  document.head.appendChild(style);
  // Nudge the browser to actually fetch/decode the faces so text measured later is correct.
  // `.load()` returns a PROMISE — a try/catch only traps a synchronous throw, NOT a rejection.
  // WebKit rejects this with `NetworkError: A network error occurred.` when the (base64) face
  // fails to decode; left unhandled it trips the host's global `unhandledrejection` handler and
  // surfaces a fatal "reload" modal over a purely cosmetic font miss. Swallow each explicitly.
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.load('1em Inter')?.catch(() => {/* ignore — fallback fonts render meanwhile */});
    fonts?.load(`1em ${HB_HEAD_FONT_FAMILY}`)?.catch(() => {/* ignore — fallback fonts render meanwhile */});
    fonts?.load(`700 1em ${HB_NUM_FONT_FAMILY}`)?.catch(() => {/* ignore — fallback fonts render meanwhile */});
  } catch {
    /* ignore — fonts API access threw synchronously */
  }
}

/** Run `cb` once the Inter face is ready (or immediately when fonts aren't observable). */
export function whenFontReady(cb: () => void): void {
  const fonts = typeof document !== 'undefined'
    ? (document as Document & { fonts?: FontFaceSet }).fonts
    : undefined;
  if (!fonts) {
    cb();
    return;
  }
  fonts.ready.then(() => cb()).catch(() => cb());
}

export interface TextOpts {
  size: number;
  /** font-family override (e.g. NUM_FONT_FAMILY for numeric values); defaults to the Inter stack. */
  family?: string;
  /** numeric (e.g. 700) or keyword. */
  weight?: TextStyle['fontWeight'];
  color?: string;
  /** px letter-spacing (CSS `letter-spacing`). */
  letterSpacing?: number;
  /** UPPERCASE the string (CSS `text-transform:uppercase`). */
  upper?: boolean;
  align?: 'left' | 'center' | 'right';
  /** word-wrap width in px. */
  wrapWidth?: number;
  lineHeight?: number;
  /** drop shadow (the floating readouts use `text-shadow:0 1px 3px rgba(0,0,0,.65)`). */
  shadow?: boolean;
  /** Space Grotesk instead of Inter (headings, CTA labels, the bet-mode chip). */
  heading?: boolean;
  /** Switzer with an ink stroke — numeric readouts. `true` = NUM_STROKE px in HB.ink; a string = that
   *  stroke colour (e.g. beige digits on an orange face get an ink stroke either way, but a number
   *  ON beige wants no stroke — pass `false`/omit). */
  stroke?: boolean | string;
  /** Trim to ink bounds (default true). Set false when bottom-/baseline-aligning a row of
   *  same-size texts: trimmed glyph-tight boxes vary per content (e.g. a comma's descent), so
   *  `align:'end'` would misalign their baselines; an untrimmed line box is uniform. */
  trim?: boolean;
}

/** Distance (px) from an untrimmed text's top to its alphabetic baseline, for the given size/weight.
 *  Pixi's flex has no baseline cross-align, so a row of different-size texts (e.g. a 10px label next
 *  to a 14px value) must be baseline-aligned by hand: place each at `maxAscent - thisAscent`. Uses
 *  the same font-metrics Pixi uses to lay text out; falls back to a ratio with no DOM/canvas. */
export function textBaseline(size: number, weight: TextStyle['fontWeight'] = '400'): number {
  try {
    return CanvasTextMetrics.measureFont(`${weight} ${size}px ${FONT_FAMILY}`).ascent;
  } catch {
    return size * 0.92; // headless fallback (Inter ascender ≈ 0.92em)
  }
}

/** Create a Pixi Text in the shell font, resolution-bumped for crisp small text. */
export function makeText(str: string, opts: TextOpts): Text {
  const style = new TextStyle({
    fontFamily: opts.family ?? (opts.stroke ? NUM_FONT_FAMILY : opts.heading ? HEAD_FONT_FAMILY : FONT_FAMILY),
    fontSize: opts.size,
    fontWeight: opts.weight ?? (opts.stroke ? '700' : '400'),
    fill: opts.color ?? HB.fg,
    letterSpacing: opts.letterSpacing ?? 0,
    align: opts.align ?? 'left',
  });
  if (opts.wrapWidth != null) {
    style.wordWrap = true;
    style.wordWrapWidth = opts.wrapWidth;
    // CJK (and any long unbroken run) has no spaces to wrap on — without breakWords the line
    // overflows the wrap width instead of wrapping. This is the single shell text helper (How to
    // Play, disclaimer, Game Info section titles, mode table, win messages, buy-bonus cards), so
    // one flag fixes wrapping everywhere.
    style.breakWords = true;
  }
  if (opts.lineHeight != null) style.lineHeight = opts.lineHeight;
  if (opts.stroke) {
    style.stroke = { color: typeof opts.stroke === 'string' ? opts.stroke : HB.ink, width: NUM_STROKE, join: 'round' };
  }
  if (opts.shadow) {
    style.dropShadow = {
      color: '#000000',
      alpha: 0.65,
      blur: 3,
      distance: 1,
      angle: Math.PI / 2,
    };
  }
  // Trim to the ink bounds so vertical centring centres the visible glyphs, not the line box
  // (Pixi Text height includes ascent/descent leading → centred text otherwise sits high).
  style.trim = opts.trim ?? true;
  const t = new Text({
    text: opts.upper ? str.toUpperCase() : str,
    style,
    resolution: Math.min(3, (globalThis.devicePixelRatio || 1) * 2),
  });
  return t;
}

/** Mutate an existing Text's content (and re-uppercase if configured). */
export function setText(t: Text, str: string, upper = false): void {
  t.text = upper ? str.toUpperCase() : str;
}
