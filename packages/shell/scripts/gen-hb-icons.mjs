// Convert the hand-authored packages/shell/icons-hb.svg (the Hellbuddha sheet: stroked "button"
// glyphs on a ~1544×1067 canvas) into the shipped 24×24 fragments for ui/pixi-hb/icons.ts.
//
// Unlike gen-icons-from-svg.mjs this keeps the strokes: every glyph is emitted with THREE colour
// slots that the renderer substitutes at build time —
//   currentColor   ink: strokes and solid glyphs
//   currentFill    the inner face of stroked shapes (beige)
//   currentAccent  the autoplay triangle (orange)
// The stroke width is fixed in the 24-unit box (HB_STROKE) so every glyph carries the same border
// whatever its source size. Derived glyphs (the chevron family) are rotations of `chevronUp`.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const SRC_SVG = join(ROOT, 'icons-hb.svg');
const OUT = join(ROOT, 'src', 'ui', 'pixi-hb', 'icons.ts');

const HB_STROKE = 2; // 24-box units — the renderer overrides per glyph size (currentStroke)
const BOX = 24;
const PAD = 1;

// source id -> shipped name
const MAP = {
  spin: 'spin',
  turbo: 'turbo',
  stop: 'stop',
  minus: 'minus',
  plus: 'plus',
  menu: 'menu',
  info: 'info',
  close: 'close',
  'chevrom-up': 'chevronUp', // (sic — misspelled in the source sheet)
  'chevron-down': 'chevronDown',
  'sound-on': 'soundOn',
  'sound-off': 'soundOff',
  autoplay: 'autoplay',
  'music-on': 'musicOn',
  'music-off': 'musicOff',
  bonus: 'bonus',
  volality: 'volatility', // (sic)
};
const DERIVE = {
  chevronRight: { from: 'chevronUp', rot: { a: 0, b: 1, c: -1, d: 0 } },
  back: { from: 'chevronUp', rot: { a: 0, b: -1, c: 1, d: 0 } },
};
// per-glyph shape overrides: glyph -> shape index -> style. The turbo bolts take their own fill
// slots (left bolt = shape 1 = `currentBoltA`, right bolt = shape 0 = `currentBoltB`) so the bar can
// paint them in per level.
const OVERRIDE = { autoplay: { 1: 'accent' }, turbo: { 1: 'boltA', 0: 'boltB' } };

const round = (n) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};

// --- path walker (absolute coords; H/V→L, S/T expanded) ------------------------------------------
function tokenize(d) {
  const out = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let m;
  while ((m = re.exec(d)) !== null) out.push(m[1] ? { cmd: m[1] } : { num: parseFloat(m[2]) });
  return out;
}
function walkPath(d) {
  const toks = tokenize(d);
  let i = 0, cur = null, x = 0, y = 0, sx = 0, sy = 0, px = 0, py = 0, prev = null;
  const cmds = [];
  const num = () => { if (i >= toks.length || toks[i].cmd) throw new Error('num expected'); return toks[i++].num; };
  while (i < toks.length) {
    if (toks[i].cmd) { cur = toks[i].cmd; i++; }
    const rel = cur === cur.toLowerCase();
    switch (cur.toUpperCase()) {
      case 'M': { let X = num(), Y = num(); if (rel) { X += x; Y += y; } x = X; y = Y; sx = X; sy = Y; cmds.push({ c: 'M', pts: [[X, Y]] }); cur = rel ? 'l' : 'L'; prev = 'M'; break; }
      case 'L': { let X = num(), Y = num(); if (rel) { X += x; Y += y; } x = X; y = Y; cmds.push({ c: 'L', pts: [[X, Y]] }); prev = 'L'; break; }
      case 'H': { let X = num(); if (rel) X += x; x = X; cmds.push({ c: 'L', pts: [[x, y]] }); prev = 'H'; break; }
      case 'V': { let Y = num(); if (rel) Y += y; y = Y; cmds.push({ c: 'L', pts: [[x, y]] }); prev = 'V'; break; }
      case 'C': { let x1 = num(), y1 = num(), x2 = num(), y2 = num(), X = num(), Y = num(); if (rel) { x1 += x; y1 += y; x2 += x; y2 += y; X += x; Y += y; } px = x2; py = y2; x = X; y = Y; cmds.push({ c: 'C', pts: [[x1, y1], [x2, y2], [X, Y]] }); prev = 'C'; break; }
      case 'S': { let x2 = num(), y2 = num(), X = num(), Y = num(); if (rel) { x2 += x; y2 += y; X += x; Y += y; } const x1 = prev === 'C' || prev === 'S' ? 2 * x - px : x; const y1 = prev === 'C' || prev === 'S' ? 2 * y - py : y; px = x2; py = y2; x = X; y = Y; cmds.push({ c: 'C', pts: [[x1, y1], [x2, y2], [X, Y]] }); prev = 'S'; break; }
      case 'Q': { let x1 = num(), y1 = num(), X = num(), Y = num(); if (rel) { x1 += x; y1 += y; X += x; Y += y; } px = x1; py = y1; x = X; y = Y; cmds.push({ c: 'Q', pts: [[x1, y1], [X, Y]] }); prev = 'Q'; break; }
      case 'T': { let X = num(), Y = num(); if (rel) { X += x; Y += y; } const x1 = prev === 'Q' || prev === 'T' ? 2 * x - px : x; const y1 = prev === 'Q' || prev === 'T' ? 2 * y - py : y; px = x1; py = y1; x = X; y = Y; cmds.push({ c: 'Q', pts: [[x1, y1], [X, Y]] }); prev = 'T'; break; }
      case 'Z': { x = sx; y = sy; cmds.push({ c: 'Z', pts: [] }); prev = 'Z'; break; }
      default: throw new Error(`unhandled command ${cur}`);
    }
  }
  return cmds;
}

// --- shapes ----------------------------------------------------------------------------------------
const attr = (attrs, name) => { const m = attrs.match(new RegExp(`\\b${name}="([^"]+)"`)); return m ? m[1] : null; };
// class -> style (from the sheet's <style>): st4 stroke-only (round caps); st0/st2/st3 face+stroke;
// st1 / none = solid ink
function styleOf(attrs) {
  const cls = attr(attrs, 'class');
  if (cls === 'st4') return 'line';
  if (cls === 'st0' || cls === 'st2' || cls === 'st3') return 'stroked';
  return 'solid';
}
function parseShape(tag, attrs) {
  const style = styleOf(attrs);
  if (tag === 'path') return { tag: 'path', style, cmds: walkPath(attr(attrs, 'd')) };
  if (tag === 'line') {
    return { tag: 'path', style, cmds: [
      { c: 'M', pts: [[+attr(attrs, 'x1'), +attr(attrs, 'y1')]] },
      { c: 'L', pts: [[+attr(attrs, 'x2'), +attr(attrs, 'y2')]] },
    ] };
  }
  if (tag === 'rect') {
    const rx = attr(attrs, 'rx');
    return { tag: 'rect', style, x: +attr(attrs, 'x'), y: +attr(attrs, 'y'), w: +attr(attrs, 'width'), h: +attr(attrs, 'height'), rx: rx != null ? +rx : null };
  }
  if (tag === 'circle') return { tag: 'circle', style, cx: +attr(attrs, 'cx'), cy: +attr(attrs, 'cy'), r: +attr(attrs, 'r') };
  throw new Error(`unhandled shape ${tag}`);
}
function shapePoints(s) {
  if (s.tag === 'path') return s.cmds.flatMap((cmd) => cmd.pts);
  if (s.tag === 'rect') return [[s.x, s.y], [s.x + s.w, s.y + s.h]];
  return [[s.cx - s.r, s.cy - s.r], [s.cx + s.r, s.cy + s.r]];
}
function rotateShapes(shapes, rot) {
  const rp = ([X, Y]) => [rot.a * X + rot.c * Y, rot.b * X + rot.d * Y];
  return shapes.map((s) => {
    if (s.tag !== 'path') throw new Error('rotation only supported for path glyphs');
    return { ...s, cmds: s.cmds.map((cmd) => ({ c: cmd.c, pts: cmd.pts.map(rp) })) };
  });
}

// --- extract: top-level id'd elements, depth-aware for nested <g> --------------------------------
const svg = readFileSync(SRC_SVG, 'utf8');
function shapesInside(fragment) {
  const out = [];
  const re = /<(path|rect|circle|line)\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(fragment)) !== null) out.push(parseShape(m[1], m[2]));
  return out;
}
function groupBody(id) {
  const open = svg.indexOf(`<g id="${id}">`);
  if (open < 0) return null;
  let depth = 0, i = open;
  const re = /<g\b|<\/g>/g;
  re.lastIndex = open;
  let m;
  while ((m = re.exec(svg)) !== null) {
    if (m[0] === '<g' || m[0] === '<g ') depth++;
    else depth--;
    if (depth === 0) return svg.slice(open, m.index);
  }
  return null;
}
const glyphs = {};
for (const [id, name] of Object.entries(MAP)) {
  const body = groupBody(id);
  if (body) { glyphs[name] = shapesInside(body); continue; }
  const em = svg.match(new RegExp(`<(path|rect|circle)\\b([^>]*?\\bid="${id}"[^>]*?)/>`));
  if (!em) throw new Error(`glyph ${id} not found`);
  glyphs[name] = [parseShape(em[1], em[2])];
}
for (const [name, { from, rot }] of Object.entries(DERIVE)) glyphs[name] = rotateShapes(glyphs[from], rot);
for (const [name, ov] of Object.entries(OVERRIDE)) for (const [i, st] of Object.entries(ov)) glyphs[name][+i].style = st;

// --- placement --------------------------------------------------------------------------------------
function bboxOf(shapes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) for (const [px, py] of shapePoints(s)) {
    if (px < minX) minX = px; if (py < minY) minY = py; if (px > maxX) maxX = px; if (py > maxY) maxY = py;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}
const names = Object.keys(glyphs);
const boxes = Object.fromEntries(names.map((n) => [n, bboxOf(glyphs[n])]));
const hasStroke = (n) => glyphs[n].some((s) => s.style !== 'solid');
// stroked glyphs shrink by the stroke so the outer edge of the border lands inside the box
const availOf = (n) => BOX - 2 * PAD - (hasStroke(n) ? HB_STROKE : 0);
const scaleOf = (n) => availOf(n) / Math.max(boxes[n].w, boxes[n].h);

if (process.argv.includes('--measure')) {
  for (const n of names) {
    const b = boxes[n], sc = scaleOf(n);
    console.log(`${n.padEnd(12)} src ${b.w.toFixed(0)}×${b.h.toFixed(0)} -> ${(b.w * sc).toFixed(1)}×${(b.h * sc).toFixed(1)} ${glyphs[n].map((s) => s.style[0]).join('')}`);
  }
  process.exit(0);
}

function placer(name) {
  const b = boxes[name], SCALE = scaleOf(name);
  const ox = (BOX - b.w * SCALE) / 2, oy = (BOX - b.h * SCALE) / 2;
  return { x: (X) => round((X - b.minX) * SCALE + ox), y: (Y) => round((Y - b.minY) * SCALE + oy), s: (D) => round(D * SCALE) };
}
const STYLE_ATTRS = {
  solid: 'fill="currentColor"',
  stroked: `fill="currentFill" stroke="currentColor" stroke-width="currentStroke" stroke-linejoin="round"`,
  accent: `fill="currentAccent" stroke="currentColor" stroke-width="currentStroke" stroke-linejoin="round"`,
  boltA: `fill="currentBoltA" stroke="currentColor" stroke-width="currentStroke" stroke-linejoin="round"`,
  boltB: `fill="currentBoltB" stroke="currentColor" stroke-width="currentStroke" stroke-linejoin="round"`,
  line: `fill="none" stroke="currentColor" stroke-width="currentStroke" stroke-linecap="round" stroke-linejoin="round"`,
};
function emitShape(s, T) {
  const st = STYLE_ATTRS[s.style];
  if (s.tag === 'path') {
    let d = '';
    for (const cmd of s.cmds) d += cmd.c === 'Z' ? 'Z' : cmd.c + cmd.pts.map(([X, Y]) => `${T.x(X)} ${T.y(Y)}`).join(' ');
    return `<path d="${d}" ${st}/>`;
  }
  if (s.tag === 'rect') {
    const rx = s.rx != null ? ` rx="${T.s(s.rx)}"` : '';
    return `<rect x="${T.x(s.x)}" y="${T.y(s.y)}" width="${T.s(s.w)}" height="${T.s(s.h)}"${rx} ${st}/>`;
  }
  return `<circle cx="${T.x(s.cx)}" cy="${T.y(s.cy)}" r="${T.s(s.r)}" ${st}/>`;
}
const built = {};
for (const n of names) { const T = placer(n); built[n] = glyphs[n].map((s) => emitShape(s, T)).join(''); }

const HEADER = `// AUTO-GENERATED from ../../../icons-hb.svg by scripts/gen-hb-icons.mjs — do not edit by hand.
// Hellbuddha icon set: 24×24 viewBox fragments with three colour slots — \`currentColor\` (ink:
// strokes + solid glyphs), \`currentFill\` (the face of stroked shapes) and \`currentAccent\` (the
// autoplay triangle) plus \`currentStroke\` — the stroke width in box units, which the renderer sets
// per glyph size so every icon carries the same on-screen border (the sheet was fitted for
// ${HB_STROKE}). To change an icon: edit icons-hb.svg, then run \`node scripts/gen-hb-icons.mjs\`.`;
const body = names.map((n) => `  ${n}: \`${built[n]}\`,`).join('\n');
const out = `${HEADER}
const SVGS = {
${body}
} as const;

export const HB_ICON_NAMES = Object.keys(SVGS) as HbIconName[];
export type HbIconName = keyof typeof SVGS;

export function isHbIcon(name: unknown): name is HbIconName {
  return typeof name === 'string' && name in SVGS;
}

export interface HbIconColors {
  ink?: string;
  fill?: string;
  accent?: string;
  /** Stroke width in 24-box units (default ${HB_STROKE}). */
  stroke?: number;
  /** Turbo only: the left / right bolt faces (default = \`fill\`). */
  boltA?: string;
  boltB?: string;
}

/** A standalone, parseable SVG document with the colour slots resolved. Used by the Pixi renderer to
 *  build vector geometry via GraphicsContext.svg(). */
export function iconSVG(name: HbIconName, colors: HbIconColors = {}): string {
  const { ink = '#1a120a', fill = '#f5efe3', accent = '#ffbc00', stroke = ${HB_STROKE} } = colors;
  const src = SVGS[name]
    .split('currentColor').join(ink)
    .split('currentFill').join(fill)
    .split('currentAccent').join(accent)
    .split('currentBoltA').join(colors.boltA ?? fill)
    .split('currentBoltB').join(colors.boltB ?? fill)
    .split('currentStroke').join(String(stroke));
  return \`<svg viewBox="0 0 24 24">\${src}</svg>\`;
}
`;
writeFileSync(OUT, out);
console.log(`wrote ui/pixi-hb/icons.ts: ${names.length} glyphs`);
