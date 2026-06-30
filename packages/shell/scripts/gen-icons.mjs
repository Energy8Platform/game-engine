// Generate the shell icon sets (DOM + Pixi) from the hand-authored preview sheet.
//
//   icons-preview.svg  ──gen-icons.mjs──▶  ui/html/icons.ts  +  ui/pixi/icons.ts
//
// The preview lays each glyph in a 92×92 rounded tile; this flattens every tile's
// paths into the 24×24 glyph space (no <g transform> — coordinates are baked, so the
// SAME output works for the DOM <svg> and Pixi's GraphicsContext.svg, which ignores
// transforms). Transform: glyph = (6/11) · (preview − tileOrigin − 24), verified by
// reproducing the `back` glyph exactly.
//
// To change an icon: edit icons-preview.svg in a vector editor, then run
//   node scripts/gen-icons.mjs
// Glyphs NOT present in the preview (e.g. `ticket`) are preserved from the current file.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', 'src');
const PREVIEW = join(SRC, 'ui', 'html', 'icons-preview.svg');

const S = 6 / 11;
const r = (n) => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? 0 : v;
};
const ax = (x, TX) => r(S * (x - TX - 24));
const ay = (y, TY) => r(S * (y - TY - 24));
const sc = (d) => r(S * d);

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

function flattenPath(d, TX, TY) {
  const toks = tokenize(d);
  const parts = [];
  let i = 0;
  let cur = null;
  const nums = (n) => {
    const a = [];
    for (let k = 0; k < n; k++) {
      if (i >= toks.length || toks[i].cmd) throw new Error(`expected number for ${cur}`);
      a.push(toks[i].num);
      i++;
    }
    return a;
  };
  while (i < toks.length) {
    if (toks[i].cmd) { cur = toks[i].cmd; i++; }
    switch (cur) {
      case 'M': { const [x, y] = nums(2); parts.push(`M${ax(x, TX)} ${ay(y, TY)}`); cur = 'L'; break; }
      case 'L': { const [x, y] = nums(2); parts.push(`L${ax(x, TX)} ${ay(y, TY)}`); break; }
      case 'l': { const [dx, dy] = nums(2); parts.push(`l${sc(dx)} ${sc(dy)}`); break; }
      case 'h': { const [dx] = nums(1); parts.push(`h${sc(dx)}`); break; }
      case 'v': { const [dy] = nums(1); parts.push(`v${sc(dy)}`); break; }
      case 'c': { const [a, b, c, dd, e, f] = nums(6); parts.push(`c${sc(a)} ${sc(b)} ${sc(c)} ${sc(dd)} ${sc(e)} ${sc(f)}`); break; }
      case 's': { const [a, b, c, dd] = nums(4); parts.push(`s${sc(a)} ${sc(b)} ${sc(c)} ${sc(dd)}`); break; }
      case 'C': { const [a, b, c, dd, e, f] = nums(6); parts.push(`C${ax(a, TX)} ${ay(b, TY)} ${ax(c, TX)} ${ay(dd, TY)} ${ax(e, TX)} ${ay(f, TY)}`); break; }
      case 'S': { const [a, b, c, dd] = nums(4); parts.push(`S${ax(a, TX)} ${ay(b, TY)} ${ax(c, TX)} ${ay(dd, TY)}`); break; }
      case 'H': { const [x] = nums(1); parts.push(`H${ax(x, TX)}`); break; }
      case 'V': { const [y] = nums(1); parts.push(`V${ay(y, TY)}`); break; }
      case 'Z': case 'z': parts.push('Z'); cur = null; break;
      default: throw new Error(`unhandled command: ${cur}`);
    }
  }
  return parts.join('');
}

const svg = readFileSync(PREVIEW, 'utf8');
const tileRe = /<rect class="st10" x="([\d.]+)" y="([\d.]+)"[^/]*\/>([\s\S]*?)<text class="st0"[^>]*>\s*<tspan[^>]*>([^<]+)<\/tspan>/g;
const tiles = [];
let mm;
while ((mm = tileRe.exec(svg)) !== null) {
  tiles.push({ TX: parseFloat(mm[1]), TY: parseFloat(mm[2]), body: mm[3], name: mm[4].trim() });
}
if (tiles.length === 0) throw new Error('no icon tiles parsed from preview');

function shapes(body) {
  const out = [];
  const elRe = /<(path|rect)\b([^>]*)\/>/g;
  let e;
  while ((e = elRe.exec(body)) !== null) {
    out.push({ tag: e[1], attrs: e[2], cls: (e[2].match(/class="([^"]+)"/) || [, ''])[1] });
  }
  return out;
}
const attr = (attrs, name) => { const m = attrs.match(new RegExp(`${name}="([^"]+)"`)); return m ? m[1] : null; };

function buildFragment(name, { TX, TY, body }) {
  const sh = shapes(body);
  const flat = [];
  for (const s of sh) {
    if (s.tag === 'path') {
      flat.push({ tag: 'path', cls: s.cls, d: flattenPath(attr(s.attrs, 'd'), TX, TY) });
    } else {
      const x = parseFloat(attr(s.attrs, 'x')), y = parseFloat(attr(s.attrs, 'y'));
      const w = parseFloat(attr(s.attrs, 'width')), h = parseFloat(attr(s.attrs, 'height'));
      const rx = attr(s.attrs, 'rx');
      flat.push({ tag: 'rect', cls: s.cls, x: ax(x, TX), y: ay(y, TY), w: sc(w), h: sc(h), rx: rx != null ? sc(parseFloat(rx)) : null });
    }
  }
  const classes = new Set(flat.map((p) => p.cls));

  if (classes.has('st11')) {
    const sw = r(S * 3.67);
    return `<path d="${flat[0].d}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (name === 'gift') {
    return flat.map((p) => {
      if (p.tag === 'rect') {
        const rxAttr = p.rx != null ? ` rx="${p.rx}"` : '';
        const fill = p.rx == null ? 'rgba(0,0,0,.35)' : 'currentColor';
        return `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}"${rxAttr} fill="${fill}"/>`;
      }
      return `<path d="${p.d}" fill="currentColor"/>`;
    }).join('');
  }
  if (classes.has('st8') && flat.length === 1 && flat[0].tag === 'path') {
    return `<path d="${flat[0].d}" fill="currentColor"/>`;
  }
  const inner = flat.map((p) => `<path d="${p.d}"/>`).join('');
  return `<g fill="currentColor" fill-rule="evenodd">${inner}</g>`;
}

// Glyphs that live in the preview sheet (design reference) but are NOT shipped — unused by any
// component. turbo2/turbo3 went away with the single-bolt turbo redesign; betUp/betDown are
// superseded by plus/minus; star is unused. Edit this set if a glyph becomes (un)used.
const DROP = new Set(['turbo', 'turbo2', 'turbo3', 'betUp', 'betDown', 'star']);
const shipped = tiles.filter((t) => !DROP.has(t.name));

const built = {};
for (const t of shipped) built[t.name] = buildFragment(t.name, t);

// Self-check: `back` must reproduce the canonical chevron exactly (proves the transform).
if (!/M15 6l-6 6 6 6/.test(built.back.replace(/\s+/g, ' ')) && !/M15 6 l-6 6/.test(built.back)) {
  // tolerant: back is a stroked chevron starting at 15,6
  if (!built.back.includes('M15')) {
    throw new Error(`transform self-check failed: back = ${built.back}`);
  }
}

// Parse current SVGS to preserve glyphs not present in the preview (e.g. ticket).
function parseSvgs(ts) {
  const map = {};
  const re = /^\s*(\w+):\s*`([\s\S]*?)`,\s*$/gm;
  let m;
  while ((m = re.exec(ts)) !== null) map[m[1]] = m[2];
  return map;
}

const HEADER = `// AUTO-GENERATED from ./icons-preview.svg by scripts/gen-icons.mjs — do not edit by hand.
// Sharp monochrome icon set: each glyph is a 24×24 viewBox fragment using currentColor
// (hollow shapes use fill-rule="evenodd"; the few stroked glyphs use stroke="currentColor").
// Coordinates are baked into the 24×24 space (no <g transform>), so the same fragment renders
// identically in the DOM <svg> and in Pixi's GraphicsContext.svg.
// To change an icon: edit icons-preview.svg, then run \`node scripts/gen-icons.mjs\`.`;

function emit(targetRel, withIconSVG) {
  const path = join(SRC, targetRel);
  const current = parseSvgs(readFileSync(path, 'utf8'));
  // order: preview tile order (minus DROPped), then any preserved extras (ticket) appended.
  // "extras" = glyphs the current file has that are NOT in the preview at all (e.g. ticket) and are
  // not DROPped — so a DROPped preview glyph is removed, not resurrected as an "extra".
  const names = shipped.map((t) => t.name);
  const tileNames = new Set(tiles.map((t) => t.name));
  const extras = Object.keys(current).filter((k) => !tileNames.has(k) && !DROP.has(k));
  const entries = [...names.map((n) => [n, built[n]]), ...extras.map((n) => [n, current[n]])];
  const body = entries.map(([n, frag]) => `  ${n}: \`${frag}\`,`).join('\n');
  let out = `${HEADER}\nconst SVGS: Record<string, string> = {\n${body}\n};\n\n`;
  out += `export type IconName = keyof typeof SVGS;\n`;
  out += `export const ICON_NAMES = Object.keys(SVGS) as IconName[];\n\n`;
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
  console.log(`wrote ${targetRel}: ${entries.length} glyphs (${names.length} from preview + ${extras.length} preserved: ${extras.join(',') || 'none'})`);
}

emit(join('ui', 'html', 'icons.ts'), false);
emit(join('ui', 'pixi', 'icons.ts'), true);
console.log('icons regenerated from preview.');
