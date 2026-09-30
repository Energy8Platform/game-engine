// Convert the hand-authored packages/shell/icons-s.svg (the S sheet: solid black glyphs on an A4
// Illustrator canvas) into the shipped 24×24 fragments in ui/pixi-s/icons-sheet.ts.
//
// Every glyph is parsed to absolute coordinates, fitted into the 24-unit box (the larger side fills
// it, centred) and emitted with one colour slot, `currentColor`. White shapes (the bonus mask's
// details, class st1) become real holes — one `fill-rule="evenodd"` path whose largest subpath is
// the body, which Pixi's SVG parser cuts the rest out of — so the button face shows through on hover
// and at the disabled alpha. A white shape's own inner subpaths (black islands in the details) are
// emitted as solid paths on top. The chevrons derive from the one authored `chevron` (pointing
// down). Run with `--measure` to print sizes instead of writing.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const SRC_SVG = join(ROOT, 'icons-s.svg');
const OUT = join(ROOT, 'src', 'ui', 'pixi-s', 'icons-sheet.ts');

const BOX = 24;
const PAD = 1;
const HOLE_CLASS = 'st1';
const SKIP_CLASS = 'st0'; // an empty stray path in the sheet

// source id -> shipped name
const MAP = { turbo: 'turbo', spin: 'spin', chevron: 'chevron', plus: 'plus', minus: 'minus', stop: 'stop', menu: 'menu', close: 'close', bonus: 'bonus' };
// derived glyphs: rot maps (x, y) -> (a·x + c·y, b·x + d·y); y points down
const DERIVE = {
  chevronLeft: { from: 'chevron', rot: { a: 0, b: 1, c: -1, d: 0 } },
  chevronRight: { from: 'chevron', rot: { a: 0, b: -1, c: 1, d: 0 } },
};
const DROP = ['chevron']; // only its rotations ship

const round = (n) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};

// --- path walker: absolute M/L/C/Z subpaths (H/V → L, S expanded) --------------------------------
function tokenize(d) {
  const out = [];
  // any letter is a command (an unsupported one, e.g. A / Q / T, throws below); a number's `e` is
  // consumed by the number alternative
  const re = /([A-Za-z])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let m;
  while ((m = re.exec(d)) !== null) out.push(m[1] ? { cmd: m[1] } : { num: parseFloat(m[2]) });
  return out;
}
/** Subpaths, each a list of { c: 'M'|'L'|'C'|'Z', pts }. */
function walkPath(d) {
  const toks = tokenize(d);
  let i = 0, cur = null, x = 0, y = 0, sx = 0, sy = 0, px = 0, py = 0, prev = null;
  const subs = [];
  const push = (cmd) => subs[subs.length - 1].push(cmd);
  const num = () => {
    if (i >= toks.length || toks[i].cmd) throw new Error('num expected');
    return toks[i++].num;
  };
  while (i < toks.length) {
    if (toks[i].cmd) cur = toks[i++].cmd;
    else if (!cur || cur.toUpperCase() === 'Z') throw new Error(`number ${toks[i].num} after ${cur ?? 'no command'}`); // Z takes none
    const rel = cur === cur.toLowerCase();
    switch (cur.toUpperCase()) {
      case 'M': { let X = num(), Y = num(); if (rel) { X += x; Y += y; } x = sx = X; y = sy = Y; subs.push([{ c: 'M', pts: [[X, Y]] }]); cur = rel ? 'l' : 'L'; prev = 'M'; break; }
      case 'L': { let X = num(), Y = num(); if (rel) { X += x; Y += y; } x = X; y = Y; push({ c: 'L', pts: [[X, Y]] }); prev = 'L'; break; }
      case 'H': { let X = num(); if (rel) X += x; x = X; push({ c: 'L', pts: [[x, y]] }); prev = 'H'; break; }
      case 'V': { let Y = num(); if (rel) Y += y; y = Y; push({ c: 'L', pts: [[x, y]] }); prev = 'V'; break; }
      case 'C': { let x1 = num(), y1 = num(), x2 = num(), y2 = num(), X = num(), Y = num(); if (rel) { x1 += x; y1 += y; x2 += x; y2 += y; X += x; Y += y; } px = x2; py = y2; x = X; y = Y; push({ c: 'C', pts: [[x1, y1], [x2, y2], [X, Y]] }); prev = 'C'; break; }
      case 'S': { let x2 = num(), y2 = num(), X = num(), Y = num(); if (rel) { x2 += x; y2 += y; X += x; Y += y; } const smooth = prev === 'C' || prev === 'S'; const x1 = smooth ? 2 * x - px : x; const y1 = smooth ? 2 * y - py : y; px = x2; py = y2; x = X; y = Y; push({ c: 'C', pts: [[x1, y1], [x2, y2], [X, Y]] }); prev = 'S'; break; }
      case 'Z': { x = sx; y = sy; push({ c: 'Z', pts: [] }); prev = 'Z'; break; }
      default: throw new Error(`unhandled command ${cur}`);
    }
  }
  return subs;
}
function polygonSub(points) {
  const n = points.trim().split(/[\s,]+/).map(Number);
  const sub = [];
  for (let k = 0; k < n.length; k += 2) sub.push({ c: k ? 'L' : 'M', pts: [[n[k], n[k + 1]]] });
  sub.push({ c: 'Z', pts: [] });
  return [sub];
}

// --- extract: every shape under an id'd element belongs to that glyph -----------------------------
const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const svg = readFileSync(SRC_SVG, 'utf8');
const glyphs = {}; // name -> { solid: subpath[], holes: subpath[], islands: subpath[] }
const stack = []; // open <g> ids
for (const m of svg.matchAll(/<(\/?)(g|path|polygon)\b([^>]*?)(\/?)>/g)) {
  const [, close, tag, attrs, selfClose] = m;
  if (tag === 'g') {
    if (close) stack.pop();
    else stack.push(attr(attrs, 'id'));
    continue;
  }
  const id = stack.find((s) => s && MAP[s]) ?? attr(attrs, 'id');
  const name = MAP[id];
  const cls = attr(attrs, 'class');
  if (!name || cls === SKIP_CLASS || !selfClose) continue;
  const subs = tag === 'polygon' ? polygonSub(attr(attrs, 'points')) : walkPath(attr(attrs, 'd'));
  const g = (glyphs[name] ??= { solid: [], holes: [], islands: [] });
  if (cls === HOLE_CLASS) {
    g.holes.push(subs[0]);
    g.islands.push(...subs.slice(1));
  } else g.solid.push(...subs);
}
for (const [name, { from, rot }] of Object.entries(DERIVE)) {
  const r = (sub) => sub.map((cmd) => ({ c: cmd.c, pts: cmd.pts.map(([X, Y]) => [rot.a * X + rot.c * Y, rot.b * X + rot.d * Y]) }));
  const src = glyphs[from];
  glyphs[name] = { solid: src.solid.map(r), holes: src.holes.map(r), islands: src.islands.map(r) };
}
for (const n of DROP) delete glyphs[n];
for (const n of Object.values(MAP)) if (!glyphs[n] && !DROP.includes(n)) throw new Error(`glyph ${n} not found`);

// --- place: the larger side fills the box, centred -------------------------------------------------
/** The drawn extent: curves are sampled, since their control points overshoot the curve. */
function bboxOf(g) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = ([X, Y]) => {
    minX = Math.min(minX, X); minY = Math.min(minY, Y); maxX = Math.max(maxX, X); maxY = Math.max(maxY, Y);
  };
  for (const sub of g.solid) {
    let p0 = null;
    for (const cmd of sub) {
      if (cmd.c === 'C') {
        const [p1, p2, p3] = cmd.pts;
        for (let t = 0; t <= 1; t += 1 / 32) {
          const u = 1 - t;
          const at = (i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i];
          add([at(0), at(1)]);
        }
      } else cmd.pts.forEach(add);
      if (cmd.pts.length) p0 = cmd.pts[cmd.pts.length - 1];
    }
  }
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}
const names = Object.keys(glyphs);
if (process.argv.includes('--measure')) {
  for (const n of names) {
    const b = bboxOf(glyphs[n]);
    console.log(`${n.padEnd(13)} ${b.w.toFixed(1)}×${b.h.toFixed(1)}  solid ${glyphs[n].solid.length} holes ${glyphs[n].holes.length} islands ${glyphs[n].islands.length}`);
  }
  process.exit(0);
}
function emit(g) {
  const b = bboxOf(g);
  const k = (BOX - 2 * PAD) / Math.max(b.w, b.h);
  const ox = (BOX - b.w * k) / 2, oy = (BOX - b.h * k) / 2;
  const d = (subs) =>
    subs
      .map((sub) => sub.map((cmd) => (cmd.c === 'Z' ? 'Z' : cmd.c + cmd.pts.map(([X, Y]) => `${round((X - b.minX) * k + ox)} ${round((Y - b.minY) * k + oy)}`).join(' '))).join(''))
      .join('');
  const out = [];
  if (g.holes.length) out.push(`<path fill-rule="evenodd" d="${d([...g.solid, ...g.holes])}" fill="currentColor"/>`);
  else for (const sub of g.solid) out.push(`<path d="${d([sub])}" fill="currentColor"/>`);
  for (const sub of g.islands) out.push(`<path d="${d([sub])}" fill="currentColor"/>`);
  return out.join('');
}

const body = names.map((n) => `  ${n}: \`${emit(glyphs[n])}\`,`).join('\n');
writeFileSync(
  OUT,
  `// AUTO-GENERATED from ../../../icons-s.svg by scripts/gen-s-icons.mjs — do not edit by hand.
// The S icon sheet: 24×24 fragments with one colour slot (\`currentColor\`); the bonus mask's details
// are holes. To change an icon: edit icons-s.svg, then run \`node scripts/gen-s-icons.mjs\`.
export const S_SHEET = {
${body}
} as const;
`,
);
console.log(`wrote ${names.length} glyphs: ${names.join(', ')}`);
