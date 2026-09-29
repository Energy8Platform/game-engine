/** The S palette — sampled from the reference screenshot (2026-09-29). Fixed by brand, like HB:
 *  `theme.scheme` / `theme.accent` never reach the S bar. */
export const S = {
  yellow: '#f8be45', // SPIN / BUY faces, labels, ± glyphs, an engaged tab
  yellowHover: '#e9ae36',
  yellowDot: '#d8a63d', // halftone on yellow
  plate: '#0b0b0b', // the black slab
  plateHover: '#1b1b1b',
  plateDot: '#2e2614', // halftone on black — warm olive, as sampled
  red: '#e0301e', // BUY while a feature is active
  redHover: '#c42716',
  shadow: '#000000',
  fg: '#f4f2eb', // values, white glyphs
  ink: '#0b0b0b', // glyphs and text on yellow
} as const;

export const SHADOW_ALPHA = 0.45;
export const DISABLED_ALPHA = 0.4;
