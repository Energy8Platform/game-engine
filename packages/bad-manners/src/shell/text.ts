import { Text, TextStyle } from 'pixi.js';
import { C } from './theme';

// §3.2: words in Luckiest Guy caps, numbers in Montserrat 800, copy in Montserrat 600. Luckiest Guy is
// Latin-only, so a locale outside it draws display text in Montserrat 900 caps — chosen by LOCALE, not
// by the characters.

const SANS = "BMSans, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const DISPLAY = `BMDisplay, ${SANS}`;
/** Locales whose display text Luckiest Guy (Latin-1) covers. */
const DISPLAY_LOCALES = new Set(['en', 'da', 'de', 'es', 'fi', 'fr', 'id', 'pt', 'it', 'nl', 'sv', 'no', 'nb']);

let latinDisplay = true;

export function setDisplayLanguage(lang: string): void {
  latinDisplay = DISPLAY_LOCALES.has((lang || 'en').toLowerCase().split(/[-_]/)[0]);
}

export interface TextOpts {
  wrap?: number;
  align?: 'left' | 'center' | 'right';
  /** Black outline width (card titles over art). */
  stroke?: number;
  lineHeight?: number;
}

function make(str: string, size: number, color: number, family: string, weight: TextStyle['fontWeight'], o: TextOpts & { letterSpacing?: number } = {}): Text {
  const style = new TextStyle({
    fontFamily: family,
    fontSize: size,
    fontWeight: weight,
    fill: color,
    letterSpacing: o.letterSpacing ?? 0,
    align: o.align ?? 'left',
    ...(o.wrap != null ? { wordWrap: true, wordWrapWidth: o.wrap, breakWords: true } : {}),
    ...(o.lineHeight != null ? { lineHeight: o.lineHeight } : {}),
    ...(o.stroke ? { stroke: { color: C.ink, width: o.stroke, join: 'round' as const } } : {}),
    padding: Math.ceil(size * 0.15) + (o.stroke ?? 0),
  });
  return new Text({ text: str, style });
}

/** Display caps: titles, buttons, field labels, tabs. */
export function display(str: string, size: number, color: number = C.paper, o: TextOpts = {}): Text {
  return latinDisplay
    ? make(str.toUpperCase(), size, color, DISPLAY, '400', { ...o, letterSpacing: size * 0.03 })
    : make(str.toUpperCase(), size, color, SANS, '900', { ...o, letterSpacing: size * 0.02 });
}

/** Money, multipliers, counters. */
export function num(str: string, size: number, color: number = C.paper, o: TextOpts = {}): Text {
  return make(str, size, color, SANS, '800', o);
}

/** Descriptions and rules. */
export function body(str: string, size: number, color: number = C.paper, o: TextOpts = {}): Text {
  return make(str, size, color, SANS, '600', { lineHeight: Math.round(size * 1.45), ...o });
}

/** Shrink `t` to fit `maxW` (never grow). */
export function fitWidth(t: Text, maxW: number): Text {
  if (t.width > maxW && maxW > 0) t.scale.set((t.scale.x * maxW) / t.width);
  return t;
}
