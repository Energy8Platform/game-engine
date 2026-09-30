/** The S palette — sampled from the reference screenshot (2026-09-29). Fixed by brand, like HB:
 *  `theme.scheme` / `theme.accent` never reach the S bar. */
export const S = {
  yellow: '#f8be45', // SPIN / BUY faces, labels, ± glyphs, an engaged tab
  yellowHover: '#e9ae36',
  plate: '#0b0b0b', // the black slab
  plateHover: '#1b1b1b',
  red: '#e0301e', // BUY while a feature is active
  redHover: '#c42716',
  shadow: '#000000',
  fg: '#f4f2eb', // values, white glyphs
  ink: '#0b0b0b', // glyphs and text on yellow
  panel: '#0b0b0b', // flat panels: menu rows, modal cards, content cards
  track: '#2a2a2a', // slider / toggle / scroll tracks, empty volatility bars, off grid cells
  muted: 'rgba(244,242,235,.6)', // secondary text: descriptions, stat labels, version
  veil: 'rgba(0,0,0,.55)', // the dark layer over the frosted game under a modal
  winOk: '#4ade80', // game info "✓ wins" tag
  winNo: '#f87171', // game info "✗ no win" tag
} as const;

export const SHADOW_ALPHA = 0.45;
export const DISABLED_ALPHA = 0.4;
