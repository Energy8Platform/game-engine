import { CanvasTextMetrics, Text, TextStyle } from 'pixi.js';
import { SHELL_FONT_CSS } from './fonts';
import { SHELL_DIGIT_FONT_CSS } from './fonts-digits';

// The Pixi shell renders text on canvas, so it relies on the same bundled Inter webfont as the
// DOM shell being registered in `document.fonts`. We inject the identical @font-face CSS (base64
// woff2) once; text measured before the font swaps in is re-laid-out on `whenFontReady`.

const STYLE_ID = '__ge-pixi-shell-font__';

/** Inter leads the stack (same as the DOM shell) so the shell renders identically everywhere;
 *  the system fonts stay as graceful fallback if the webfont ever fails to load. */
export const FONT_FAMILY = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/** Numeric font — Oswald (digit-only subset) leads, falling back to Inter. Used for the readout
 *  VALUES (balance/bet/win/FS counter, autoplay countdown), mirroring the DOM's `.ge-rd-val`. */
export const NUM_FONT_FAMILY = `OswaldNum, ${FONT_FAMILY}`;
/** Match the DOM's `.ge-rd-val { font-size:1.15em }` bump (offsets Oswald's narrower glyphs). */
export const NUM_FONT_SCALE = 1.15;

let installed = false;

/** Idempotently register the bundled Inter font in the document. No-op outside a DOM. */
export function installShellFont(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = SHELL_FONT_CSS + SHELL_DIGIT_FONT_CSS;
  document.head.appendChild(style);
  // Nudge the browser to actually fetch/decode the faces so text measured later is correct.
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.load('1em Inter');
    fonts?.load('1em OswaldNum');
  } catch {
    /* ignore — fallback fonts render meanwhile */
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
    fontFamily: opts.family ?? FONT_FAMILY,
    fontSize: opts.size,
    fontWeight: opts.weight ?? '400',
    fill: opts.color ?? '#ffffff',
    letterSpacing: opts.letterSpacing ?? 0,
    align: opts.align ?? 'left',
  });
  if (opts.wrapWidth != null) {
    style.wordWrap = true;
    style.wordWrapWidth = opts.wrapWidth;
  }
  if (opts.lineHeight != null) style.lineHeight = opts.lineHeight;
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
