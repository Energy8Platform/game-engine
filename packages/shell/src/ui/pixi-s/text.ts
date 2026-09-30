import type { Text } from 'pixi.js';
import { installFontFaces } from '@/core/fontface';
import { makeText, FONT_FAMILY } from '../pixi-hb/text';
import { S_FONT_CSS, S_FONT_FAMILY } from './fonts';
import { S } from './theme';

// The S bar draws every label and value in Montserrat ExtraBold. HB's overlays keep their own faces
// (installed by the HB renderer); this module only adds the S face and two text styles.

const STYLE_ID = '__ge-pixi-s-font__';

/** Montserrat first, then the shell's Inter stack — glyphs outside the two subsets (e.g. ₽) fall back. */
export const S_FAMILY = `${S_FONT_FAMILY}, ${FONT_FAMILY}`;

let installed = false;

/** Idempotently register the S face (FontFace-from-bytes — Stake's CSP blocks data: font URLs). */
export function installSFont(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  installFontFaces(S_FONT_CSS, STYLE_ID);
  // `.load()` returns a promise — a try/catch only traps a synchronous throw, so swallow the rejection
  // too (WebKit rejects when a base64 face fails to decode; see pixi-hb/text.ts).
  try {
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    fonts?.load(`800 1em ${S_FONT_FAMILY}`)?.catch(() => {/* ignore — fallback fonts render meanwhile */});
  } catch {
    /* ignore — fonts API access threw synchronously */
  }
}

/** An uppercase bar label (WIN / BALANCE / BET). */
export function sLabel(str: string, size: number, color: string = S.yellow): Text {
  return makeText(str, { size, family: S_FAMILY, weight: '800', color, upper: true, letterSpacing: size * 0.02 });
}

/** A money / counter value. */
export function sValue(str: string, size: number, color: string = S.fg): Text {
  return makeText(str, { size, family: S_FAMILY, weight: '800', color });
}

/** Body copy (descriptions, rules, paragraphs): Inter — long text in Montserrat 800 caps is
 *  unreadable. Wraps when `wrapWidth` is given. */
export function sBody(str: string, size: number, color: string = S.fg, wrapWidth?: number, align: 'left' | 'center' | 'right' = 'left'): Text {
  return makeText(str, {
    size,
    family: FONT_FAMILY,
    weight: '400',
    color,
    wrapWidth,
    lineHeight: wrapWidth != null ? Math.round(size * 1.5) : undefined,
    align,
  });
}
