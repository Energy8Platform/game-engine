// brand/tokens.json as code (BRANDBOOK §3). Components read colours and sizes from here only.

/** The kit's acid lime — the default accent. */
export const LIME = 0xb6ff3b;

export const C = {
  ink: 0x0b0b0b,
  void: 0x000000,
  paper: 0xffffff,
  /** The accent (§3.1 "lime") and its hover / pressed shades — `setAccent` swaps all three. */
  lime: LIME,
  limeHover: 0xc8ff6a,
  limePress: 0x8fd61f,
  grey700: 0x2b2b2b,
  grey600: 0x3a3a3a,
  grey500: 0x6b6b6b,
  grey400: 0x8a8a8a,
};

/** An accent's three shades. The kit's lime keeps its token shades; any other colour gets the same
 *  relation (hover ≈ 24% toward white, pressed ≈ 80% brightness). */
export function accentShades(a: number): { base: number; hover: number; press: number } {
  if (a === LIME) return { base: LIME, hover: 0xc8ff6a, press: 0x8fd61f };
  const ch = (f: (v: number) => number) => (((f((a >> 16) & 255) << 16) | (f((a >> 8) & 255) << 8) | f(a & 255)) >>> 0);
  return {
    base: a,
    hover: ch((v) => Math.round(v + (255 - v) * 0.24)),
    press: ch((v) => Math.round(v * 0.8)),
  };
}

/** Recolour every accent read (components pick it up when they are next built). */
export function setAccent(a: number): void {
  const s = accentShades(a);
  C.lime = s.base;
  C.limeHover = s.hover;
  C.limePress = s.press;
}

/** A colour from config (`#rgb`, `#rrggbb`, a CSS name, or a number) → 0xRRGGBB; undefined when unreadable. */
export function parseColor(v: string | number | undefined | null): number | undefined {
  if (typeof v === 'number') return v >>> 0;
  if (!v) return undefined;
  let s = v.trim();
  if (!s.startsWith('#') && typeof document !== 'undefined') {
    // a CSS name / rgb(): let the browser resolve it
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000';
      ctx.fillStyle = s;
      s = String(ctx.fillStyle);
    }
  }
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return undefined;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return parseInt(hex, 16);
}

/** Panel scrim (`scrim`), over the blurred game. */
export const SCRIM = { color: 0x000000, alpha: 0.55 };

/** Design px (1920×1080). */
export const TYPE = {
  title: 44,
  tab: 30,
  button: 30,
  fieldLabel: 24,
  fieldValue: 28,
  price: 52,
  cardTitle: 44,
  body: 22,
  caption: 16,
  tableMult: 18,
  tableCount: 18,
} as const;

export const SIZE = {
  glyph: 64,
  hudButton: 76,
  field: { h: 76, minW: 220 },
  spin: 128,
  pill: { h: 64, minW: 240 },
  sliderTrackH: 16,
  sliderKnob: 62,
  close: { w: 88, h: 84 },
  /** Bubble tail height: the body is the top `h − TAIL`. */
  tail: 16,
} as const;

export const MOTION = {
  press: { scale: 0.94, dur: 80 },
  release: { dur: 180 },
  hover: { dur: 120 },
  panelIn: { dur: 220, scale: 0.92 },
  panelOut: { dur: 140, scale: 0.96 },
  scrimIn: { dur: 180 },
  menuIn: { dur: 240 },
  bubblePop: { dur: 260 },
  /** SPIN glyph, revolutions per second. */
  spinRps: 2.2,
  spinRpsTurbo: 4,
} as const;

export const BLUR = 12;
