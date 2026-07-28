// Convert the hand-authored packages/shell/icons.svg (scattered-layout sheet, each glyph an
// id'd <path>/<rect>/<circle> or <g> on a ~1090×1056 canvas) into the shipped 24×24 fragments
// for ui/html/icons.ts and ui/pixi/icons.ts.
//
// Each source glyph is parsed to absolute coordinates, its bbox measured, then placed into the
// 24×24 glyph box (per-glyph fill on the larger dimension, centered) so every glyph fills its
// button equally. Some glyphs are DERIVED by rotating another (the four chevrons all come from
// the single authored `chevron-up`). Run with `--measure` to print sizes instead of writing.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const SRC_SVG = join(ROOT, 'icons.svg');

// Map source glyph id -> shipped icon name. Ids absent here are ignored. `gift`/`ticket` are
// preserved from the current icons.ts (they aren't drawn in the source sheet).
const MAP = {
  autoplay: 'autoplay',
  spin: 'spin',
  'turbo-off': 'turboOff',
  'turbo-1': 'turbo1',
  'turbo-2': 'turbo2',
  stop: 'stop',
  minus: 'minus',
  plus: 'plus',
  menu: 'menu',
  info: 'info',
  close: 'close',
  'sound-on': 'soundOn',
  'chevrom-up': 'chevronUp', // (sic — the id is misspelled in the source svg)
  'chevron-down': 'chevronDown',
};
// sound-off has no id (a <g> holding a speaker <path> + <path id="close1">) — handled specially.

// Derived glyphs: a 90° rotation of another glyph. The chevron family is one authored shape
// (`chevronUp`, pointing ^) rotated into the other three directions, so they stay identical.
// rot maps a point (x,y) -> (a·x + c·y, b·x + d·y).
const DERIVE = {
  chevronRight: { from: 'chevronUp', rot: { a: 0, b: 1, c: -1, d: 0 } }, // ^ -> >
  back: { from: 'chevronUp', rot: { a: 0, b: -1, c: 1, d: 0 } }, //          ^ -> <
};

const round = (n) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};

// --- minimal SVG path tokenizer / absolute-coordinate walker ------------------------------------
function tokenize(d) {
  const out = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) out.push({ cmd: m[1] });
    else out.push({ num: parseFloat(m[2]) });
  }
  return out;
}

// Walk a path into a list of absolute commands: { c: 'M'|'L'|'C'|'Q'|'Z', pts: [[x,y],...] }.
// H/V become L, S/T are expanded to C/Q via reflection.
function walkPath(d) {
  const toks = tokenize(d);
  let i = 0, cur = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let px = 0, py = 0;
  let prev = null;
  const cmds = [];
  const num = () => { if (i >= toks.length || toks[i].cmd) throw new Error('num expected'); return toks[i++].num; };
  while (i < toks.length) {
    if (toks[i].cmd) { cur = toks[i].cmd; i++; }
    const rel = cur === cur.toLowerCase();
    switch (cur.toUpperCase()) {
      case 'M': {
        let X = num(), Y = num(); if (rel) { X += x; Y += y; }
        x = X; y = Y; sx = X; sy = Y;
        cmds.push({ c: 'M', pts: [[X, Y]] });
        cur = rel ? 'l' : 'L'; prev = 'M'; break;
      }
      case 'L': { let X = num(), Y = num(); if (rel) { X += x; Y += y; } x = X; y = Y; cmds.push({ c: 'L', pts: [[X, Y]] }); prev = 'L'; break; }
      case 'H': { let X = num(); if (rel) X += x; x = X; cmds.push({ c: 'L', pts: [[x, y]] }); prev = 'H'; break; }
      case 'V': { let Y = num(); if (rel) Y += y; y = Y; cmds.push({ c: 'L', pts: [[x, y]] }); prev = 'V'; break; }
      case 'C': {
        let x1 = num(), y1 = num(), x2 = num(), y2 = num(), X = num(), Y = num();
        if (rel) { x1 += x; y1 += y; x2 += x; y2 += y; X += x; Y += y; }
        px = x2; py = y2; x = X; y = Y;
        cmds.push({ c: 'C', pts: [[x1, y1], [x2, y2], [X, Y]] }); prev = 'C'; break;
      }
      case 'S': {
        let x2 = num(), y2 = num(), X = num(), Y = num();
        if (rel) { x2 += x; y2 += y; X += x; Y += y; }
        const x1 = (prev === 'C' || prev === 'S') ? 2 * x - px : x;
        const y1 = (prev === 'C' || prev === 'S') ? 2 * y - py : y;
        px = x2; py = y2; x = X; y = Y;
        cmds.push({ c: 'C', pts: [[x1, y1], [x2, y2], [X, Y]] }); prev = 'S'; break;
      }
      case 'Q': {
        let x1 = num(), y1 = num(), X = num(), Y = num();
        if (rel) { x1 += x; y1 += y; X += x; Y += y; }
        px = x1; py = y1; x = X; y = Y;
        cmds.push({ c: 'Q', pts: [[x1, y1], [X, Y]] }); prev = 'Q'; break;
      }
      case 'T': {
        let X = num(), Y = num(); if (rel) { X += x; Y += y; }
        const x1 = (prev === 'Q' || prev === 'T') ? 2 * x - px : x;
        const y1 = (prev === 'Q' || prev === 'T') ? 2 * y - py : y;
        px = x1; py = y1; x = X; y = Y;
        cmds.push({ c: 'Q', pts: [[x1, y1], [X, Y]] }); prev = 'T'; break;
      }
      case 'Z': { x = sx; y = sy; cmds.push({ c: 'Z', pts: [] }); prev = 'Z'; break; }
      default: throw new Error(`unhandled command ${cur}`);
    }
  }
  return cmds;
}

// --- shape model --------------------------------------------------------------------------------
const attr = (attrs, name) => { const m = attrs.match(new RegExp(`\\b${name}="([^"]+)"`)); return m ? m[1] : null; };

function parseShape(tag, attrs) {
  if (tag === 'path') return { tag: 'path', cmds: walkPath(attr(attrs, 'd')) };
  if (tag === 'rect') {
    const x = +attr(attrs, 'x'), y = +attr(attrs, 'y'), w = +attr(attrs, 'width'), h = +attr(attrs, 'height');
    const rx = attr(attrs, 'rx');
    return { tag: 'rect', x, y, w, h, rx: rx != null ? +rx : null };
  }
  if (tag === 'circle') return { tag: 'circle', cx: +attr(attrs, 'cx'), cy: +attr(attrs, 'cy'), r: +attr(attrs, 'r') };
  throw new Error(`unhandled shape ${tag}`);
}

function shapePoints(s) {
  if (s.tag === 'path') return s.cmds.flatMap((cmd) => cmd.pts);
  if (s.tag === 'rect') return [[s.x, s.y], [s.x + s.w, s.y + s.h]];
  return [[s.cx - s.r, s.cy - s.r], [s.cx + s.r, s.cy + s.r]];
}

// Rotate a glyph's shapes by `rot` (paths only — chevrons are single paths).
function rotateShapes(shapes, rot) {
  const rp = ([X, Y]) => [rot.a * X + rot.c * Y, rot.b * X + rot.d * Y];
  return shapes.map((s) => {
    if (s.tag !== 'path') throw new Error('rotation only supported for path glyphs');
    return { tag: 'path', cmds: s.cmds.map((cmd) => ({ c: cmd.c, pts: cmd.pts.map(rp) })) };
  });
}

// --- extract source glyphs ----------------------------------------------------------------------
const svg = readFileSync(SRC_SVG, 'utf8');

function shapesInside(fragment) {
  const out = [];
  const re = /<(path|rect|circle)\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(fragment)) !== null) out.push(parseShape(m[1], m[2]));
  return out;
}

const glyphs = {}; // name -> shapes[]
for (const gm of svg.matchAll(/<g id="([^"]+)">([\s\S]*?)<\/g>/g)) {
  const name = MAP[gm[1]];
  if (name) glyphs[name] = shapesInside(gm[2]);
}
for (const em of svg.matchAll(/<(path|rect|circle)\b([^>]*?)\/>/g)) {
  const id = attr(em[2], 'id');
  if (id && MAP[id]) glyphs[MAP[id]] = [parseShape(em[1], em[2])];
}
{
  const m = svg.match(/<g>\s*(<path class="st4"[\s\S]*?id="close1"[\s\S]*?)<\/g>/);
  if (m) glyphs.soundOff = shapesInside(`<g>${m[1]}</g>`);
}
for (const [name, { from, rot }] of Object.entries(DERIVE)) {
  if (!glyphs[from]) throw new Error(`derive ${name}: source ${from} not found`);
  glyphs[name] = rotateShapes(glyphs[from], rot);
}

// --- placement: per-glyph fit, centered ---------------------------------------------------------
const BOX = 24;
const PAD = 1.6;
const AVAIL = BOX - 2 * PAD;

function bboxOf(shapes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) for (const [px, py] of shapePoints(s)) {
    if (px < minX) minX = px; if (py < minY) minY = py;
    if (px > maxX) maxX = px; if (py > maxY) maxY = py;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

const names = Object.keys(glyphs);
const boxes = Object.fromEntries(names.map((n) => [n, bboxOf(glyphs[n])]));
const scaleOf = (n) => AVAIL / Math.max(boxes[n].w, boxes[n].h);

if (process.argv.includes('--measure')) {
  for (const n of names) {
    const b = boxes[n], sc = scaleOf(n);
    console.log(`${n.padEnd(12)} src ${b.w.toFixed(0)}×${b.h.toFixed(0)}  ->  ${(b.w * sc).toFixed(1)}×${(b.h * sc).toFixed(1)}  (${glyphs[n].map((s) => s.tag).join(',')})`);
  }
  process.exit(0);
}

function placer(name) {
  const b = boxes[name], SCALE = scaleOf(name);
  const gw = b.w * SCALE, gh = b.h * SCALE;
  const ox = (BOX - gw) / 2, oy = (BOX - gh) / 2;
  return {
    x: (X) => round((X - b.minX) * SCALE + ox),
    y: (Y) => round((Y - b.minY) * SCALE + oy),
    s: (D) => round(D * SCALE),
  };
}

function emitShape(s, T) {
  if (s.tag === 'path') {
    let out = '';
    for (const cmd of s.cmds) {
      if (cmd.c === 'Z') { out += 'Z'; continue; }
      out += cmd.c + cmd.pts.map(([X, Y]) => `${T.x(X)} ${T.y(Y)}`).join(' ');
    }
    return `<path d="${out}"/>`;
  }
  if (s.tag === 'rect') {
    const rx = s.rx != null ? ` rx="${T.s(s.rx)}"` : '';
    return `<rect x="${T.x(s.x)}" y="${T.y(s.y)}" width="${T.s(s.w)}" height="${T.s(s.h)}"${rx}/>`;
  }
  return `<circle cx="${T.x(s.cx)}" cy="${T.y(s.cy)}" r="${T.s(s.r)}"/>`;
}

const built = {};
for (const n of names) {
  const T = placer(n);
  built[n] = `<g fill="currentColor" fill-rule="evenodd">${glyphs[n].map((s) => emitShape(s, T)).join('')}</g>`;
}

// --- merge into existing icons.ts files ---------------------------------------------------------
function parseSvgs(ts) {
  const map = {}, order = [];
  const re = /^\s*(\w+):\s*`([\s\S]*?)`,\s*$/gm;
  let m;
  while ((m = re.exec(ts)) !== null) { map[m[1]] = m[2]; order.push(m[1]); }
  return { map, order };
}

const HEADER = `// AUTO-GENERATED from ../../icons.svg by scripts/gen-icons-from-svg.mjs — do not edit by hand.
// Sharp monochrome icon set: each glyph is a 24×24 viewBox fragment using currentColor
// (hollow shapes use fill-rule="evenodd"). Coordinates are baked into the 24×24 space (no
// <g transform>), so the same fragment renders identically in the DOM <svg> and in Pixi's
// GraphicsContext.svg. To change an icon: edit icons.svg, then run
// \`node scripts/gen-icons-from-svg.mjs\`.`;

function emit(targetRel, withIconSVG) {
  const path = join(ROOT, 'src', targetRel);
  const { map, order } = parseSvgs(readFileSync(path, 'utf8'));
  const merged = { ...map };
  for (const n of names) merged[n] = built[n];
  // key order is hoisted into KEYS (see below) so both renderer files match core/icon-names.ts
  const keys = KEYS;
  const body = keys.map((n) => `  ${n}: \`${merged[n]}\`,`).join('\n');
  let out = `${HEADER}\nconst SVGS: Record<string, string> = {\n${body}\n};\n\n`;
  out += `export type { IconName } from '@/core/icon-names';\n`;
  out += `import type { IconName } from '@/core/icon-names';\n`;
  out += `export { ICON_NAMES } from '@/core/icon-names';\n\n`;
  out += `/** Inline SVG string for an icon, sized to 1em (scale via font-size/width). */\n`;
  out += `export function icon(name: IconName): string {\n`;
  out += `  return \`<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">\${SVGS[name]}</svg>\`;\n}\n`;
  if (withIconSVG) {
    out += `\n/** A standalone, parseable SVG document with \`currentColor\` resolved to \`color\`.\n`;
    out += ` *  Used by the Pixi renderer to build vector geometry via GraphicsContext.svg(). */\n`;
    out += `export function iconSVG(name: IconName, color = '#ffffff'): string {\n`;
    out += `  return \`<svg viewBox="0 0 24 24">\${SVGS[name].split('currentColor').join(color)}</svg>\`;\n}\n`;
  }
  writeFileSync(path, out);
  console.log(`wrote ${targetRel}: ${keys.length} glyphs (${names.length} from svg, +${keys.length - order.length} new)`);
}

function emitCoreNames(keys) {
  const path = join(ROOT, 'src', 'core/icon-names.ts');
  const list = keys.map((n) => `  '${n}',`).join('\n');
  const out =
    `${HEADER}\n` +
    `// The single glyph-name union, shared by core (menu items) and both renderers.\n` +
    `export const ICON_NAMES = [\n${list}\n] as const;\n\n` +
    `export type IconName = (typeof ICON_NAMES)[number];\n`;
  writeFileSync(path, out);
  console.log(`wrote core/icon-names.ts: ${keys.length} names`);
}

function keyOrder(targetRel) {
  const { order } = parseSvgs(readFileSync(join(ROOT, 'src', targetRel), 'utf8'));
  return [...order, ...names.filter((n) => !order.includes(n))];
}
const KEYS = keyOrder('ui/html/icons.ts');
emitCoreNames(KEYS);

emit(join('ui', 'html', 'icons.ts'), false);
emit(join('ui', 'pixi', 'icons.ts'), true);
console.log('icons regenerated from icons.svg.');
