// The studio intro — BRANDBOOK §6, data from brand/intro.json (stage, layers, pivots, timeline). A
// straight port of intro-reference.html: DOM layers driven by the Web Animations API.

export interface Layer {
  /** Inline-SVG layer id (src/generated/intro-svg.ts), or a plain box. */
  svg?: string;
  kind?: 'circle' | 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  pivot: [number, number];
  fill?: string;
  radius?: number;
  rotation?: number;
  init: Props;
}

export interface Props {
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  alpha?: number;
  widthFrac?: number;
}

export interface Track {
  target: string;
  at: number;
  dur: number;
  ease: keyof typeof EASE;
  keys: Array<[number, Props]>;
}

export const STAGE = { w: 1000, h: 820, fit: 0.62 };

export const LAYERS: Record<string, Layer> = {
  dot: { kind: 'circle', x: 486, y: 520, w: 28, h: 28, fill: '#FFFFFF', pivot: [0.5, 0.5], init: { scale: 0 } },
  manners: { svg: 'manners', x: 59, y: 565, w: 882, h: 229, pivot: [0.5, 1], init: { alpha: 0 } },
  badClosed: { svg: 'badClosed', x: 69, y: 307, w: 613, h: 277, pivot: [0.5, 1], init: { alpha: 0 } },
  bad: { svg: 'bad', x: 69, y: 307, w: 613, h: 277, pivot: [0.5, 1], init: { alpha: 0 } },
  tongue: { svg: 'tongue', x: 335, y: 470, w: 139, h: 128, pivot: [0.5, 0.08], init: { scaleY: 0 } },
  bubble: { svg: 'bubble', x: 684, y: 310, w: 257, h: 229, pivot: [0.14, 0.96], init: { scale: 0 } },
  burst1: { kind: 'rect', x: 116, y: 106, w: 14, h: 46, radius: 4, fill: '#B6FF3B', rotation: -50, pivot: [0.5, 0.5], init: { alpha: 0 } },
  burst2: { kind: 'rect', x: 406, y: 76, w: 14, h: 46, radius: 4, fill: '#B6FF3B', rotation: 40, pivot: [0.5, 0.5], init: { alpha: 0 } },
  burst3: { kind: 'rect', x: 430, y: 166, w: 14, h: 46, radius: 4, fill: '#B6FF3B', rotation: 75, pivot: [0.5, 0.5], init: { alpha: 0 } },
  face: { svg: 'face', x: 150, y: 46, w: 262, h: 272, pivot: [0.5, 1], init: { alpha: 0 } },
  track: { kind: 'rect', x: 69, y: 810, w: 862, h: 12, radius: 4, fill: '#3A3A3A', pivot: [0, 0.5], init: { alpha: 0 } },
  progress: { kind: 'rect', x: 69, y: 810, w: 862, h: 12, radius: 4, fill: '#B6FF3B', pivot: [0, 0.5], init: { widthFrac: 0 } },
};

/** GSAP curve names from intro.json → the CSS cubic-béziers intro-reference.html uses. */
export const EASE = {
  'power3.out': 'cubic-bezier(.22,1,.36,1)',
  'back.out(2.2)': 'cubic-bezier(.34,1.8,.64,1)',
  'power2.in': 'cubic-bezier(.55,0,1,.45)',
  'power2.inOut': 'cubic-bezier(.65,0,.35,1)',
  none: 'linear',
} as const;

const SLAM: Array<[number, Props]> = [
  [0, { scale: 1.35, alpha: 0 }],
  [0.55, { scale: 0.94, alpha: 1 }],
  [1, { scale: 1, alpha: 1 }],
];
const BURST: Array<[number, Props]> = [
  [0, { scale: 0, alpha: 1 }],
  [0.4, { scale: 1, alpha: 1 }],
  [1, { scale: 1, alpha: 0, y: -14 }],
];
/** The tongue's pop-out (t = 800 in the full intro; t = 0 in the short one). */
export const TONGUE_IN: Track = {
  target: 'tongue',
  at: 800,
  dur: 360,
  ease: 'power3.out',
  keys: [[0, { scaleY: 0 }], [0.45, { scaleY: 1.25 }], [0.75, { scaleY: 0.9 }], [1, { scaleY: 1 }]],
};

export const TIMELINE: Track[] = [
  { target: 'dot', at: 0, dur: 120, ease: 'back.out(2.2)', keys: [[0, { scale: 0 }], [1, { scale: 1 }]] },
  { target: 'dot', at: 120, dur: 140, ease: 'none', keys: [[0, { alpha: 1 }], [0.5, { alpha: 0.15 }], [1, { alpha: 1 }]] },
  { target: 'dot', at: 260, dur: 60, ease: 'power2.in', keys: [[0, { scale: 1 }], [1, { scale: 0 }]] },
  { target: 'badClosed', at: 300, dur: 260, ease: 'power3.out', keys: SLAM },
  { target: 'manners', at: 380, dur: 260, ease: 'power3.out', keys: SLAM },
  {
    target: 'stage',
    at: 520,
    dur: 140,
    ease: 'none',
    keys: [[0, { x: 0, y: 0 }], [0.25, { x: 7, y: -4 }], [0.5, { x: -6, y: 3 }], [0.75, { x: 3, y: 0 }], [1, { x: 0, y: 0 }]],
  },
  { target: 'badClosed', at: 800, dur: 1, ease: 'none', keys: [[0, { alpha: 1 }], [1, { alpha: 0 }]] },
  { target: 'bad', at: 800, dur: 1, ease: 'none', keys: [[0, { alpha: 0 }], [1, { alpha: 1 }]] },
  TONGUE_IN,
  {
    target: 'tongue',
    at: 1000,
    dur: 600,
    ease: 'power3.out',
    keys: [[0, { rotation: 0 }], [0.25, { rotation: 7 }], [0.5, { rotation: -5 }], [0.75, { rotation: 3 }], [1, { rotation: 0 }]],
  },
  { target: 'bubble', at: 1200, dur: 300, ease: 'back.out(2.2)', keys: [[0, { scale: 0 }], [0.6, { scale: 1.15 }], [1, { scale: 1 }]] },
  {
    target: 'face',
    at: 1600,
    dur: 260,
    ease: 'power2.in',
    keys: [[0, { alpha: 0, y: -300, rotation: -12 }], [0.03, { alpha: 1, y: -290, rotation: -12 }], [1, { alpha: 1, y: 0, rotation: 0 }]],
  },
  {
    target: 'face',
    at: 1860,
    dur: 140,
    ease: 'power3.out',
    keys: [[0, { scaleX: 1.12, scaleY: 0.86 }], [0.5, { scaleX: 0.97, scaleY: 1.04 }], [1, { scaleX: 1, scaleY: 1 }]],
  },
  { target: 'burst1', at: 1860, dur: 300, ease: 'power3.out', keys: BURST },
  { target: 'burst2', at: 1890, dur: 300, ease: 'power3.out', keys: BURST },
  { target: 'burst3', at: 1920, dur: 300, ease: 'power3.out', keys: BURST },
  { target: 'track', at: 2150, dur: 150, ease: 'none', keys: [[0, { alpha: 0 }], [1, { alpha: 1 }]] },
  { target: 'progress', at: 2200, dur: 300, ease: 'power2.inOut', keys: [[0, { widthFrac: 0 }], [1, { widthFrac: 0.7 }]] },
];

/** §6.3: the full intro runs at least this long; the short (repeat-visit) one exits after SHORT_MS. */
export const MIN_MS = 2400;
export const SHORT_MS = 1000;
/** Skip (tap / click / space) is honoured this long into the intro. */
export const SKIP_AFTER_MS = 500;
/** The underline fill the intro animates to before it follows the real load. */
export const PRELOAD_FILL = 0.7;

/** CSS for one layer at `p` (intro-reference.html's `kf`). */
export function frame(id: string, p: Props): Keyframe {
  if (id === 'stage') return { translate: `${p.x ?? 0}px ${p.y ?? 0}px` };
  const l = LAYERS[id];
  const sx = p.scaleX ?? p.scale ?? 1;
  const sy = p.scaleY ?? p.scale ?? 1;
  const k: Keyframe = { transform: `translateY(${p.y ?? 0}px) rotate(${(l.rotation ?? 0) + (p.rotation ?? 0)}deg) scale(${sx},${sy})` };
  if (p.alpha != null) k.opacity = p.alpha;
  if (p.widthFrac != null) k.width = `${l.w * p.widthFrac}px`;
  return k;
}
