// Extract the FULL-COLOUR buy-bonus coins from packages/shell/icons.svg into self-contained SVG
// strings (src/ui/buy-bonus-art.ts), shared by the DOM + Pixi shells for the buy-bonus button.
// Three variants: the default coin, the social-casino coin, and the "deactivate" coin.
//
// Unlike the monochrome glyph set (gen-icons-from-svg.mjs → currentColor fragments), the coins keep
// their own palette: the <style> classes (st0/st2/st3/st4/st7 — golds + brown) are resolved to inline
// fill/stroke, and each viewBox is tightened to the coin's bounding box. To refresh: edit icons.svg,
// then `node scripts/gen-buy-bonus.mjs`.
const VARIANTS = [
  { id: 'buy-bonus', name: 'BUY_BONUS_ART' },
  { id: 'buy-bonus-social', name: 'BUY_BONUS_SOCIAL_ART' },
  { id: 'buy-bonus-disabled', name: 'BUY_BONUS_DISABLED_ART' },
];
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const svg = readFileSync(join(ROOT, 'icons.svg'), 'utf8');

// --- resolve the <style> class table ------------------------------------------------------------
// Adobe emits grouped selectors (".st0, .st1 { … }") plus per-class blocks; merge both.
function parseStyle(css) {
  const map = {}; // stN -> { fill, stroke, 'stroke-width' }
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const sel = m[1];
    const body = m[2];
    const decls = {};
    for (const d of body.split(';')) {
      const [k, v] = d.split(':').map((s) => s && s.trim());
      if (k && v) decls[k] = v;
    }
    for (const cls of sel.split(',').map((s) => s.trim())) {
      const cm = cls.match(/^\.(st\d+)$/);
      if (!cm) continue;
      map[cm[1]] = { ...(map[cm[1]] || {}), ...decls };
    }
  }
  return map;
}
const styleBlock = (svg.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const CLASSES = parseStyle(styleBlock);

// --- pull the buy-bonus group (balanced <g>…</g>) -----------------------------------------------
function groupById(id) {
  const start = svg.indexOf(`<g id="${id}">`);
  if (start < 0) throw new Error(`group #${id} not found`);
  const re = /<g\b|<\/g>/g;
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(svg))) {
    if (m[0] === '</g>') { if (--depth === 0) return svg.slice(start, re.lastIndex); }
    else depth++;
  }
  throw new Error(`group #${id} unterminated`);
}
// --- bbox over all path/rect points -------------------------------------------------------------
function tokenize(d) {
  const out = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])|(-?\d*\.?\d+(?:e[-+]?\d+)?)/gi;
  let m;
  while ((m = re.exec(d))) out.push(m[1] ? { cmd: m[1] } : { num: parseFloat(m[2]) });
  return out;
}
function pathPoints(d) {
  const t = tokenize(d);
  let i = 0, cur = null, x = 0, y = 0, sx = 0, sy = 0;
  const pts = [];
  const n = () => t[i++].num;
  while (i < t.length) {
    if (t[i].cmd) { cur = t[i].cmd; i++; }
    const rel = cur === cur.toLowerCase();
    const C = cur.toUpperCase();
    if (C === 'M' || C === 'L' || C === 'T') {
      let X = n(), Y = n(); if (rel) { X += x; Y += y; } x = X; y = Y; pts.push([X, Y]);
      if (C === 'M') { sx = X; sy = Y; cur = rel ? 'l' : 'L'; }
    } else if (C === 'H') { let X = n(); if (rel) X += x; x = X; pts.push([x, y]); }
    else if (C === 'V') { let Y = n(); if (rel) Y += y; y = Y; pts.push([x, y]); }
    else if (C === 'C') { for (let k = 0; k < 3; k++) { let X = n(), Y = n(); if (rel) { X += x; Y += y; } if (k === 2) { x = X; y = Y; } pts.push([X, Y]); } }
    else if (C === 'S' || C === 'Q') { for (let k = 0; k < 2; k++) { let X = n(), Y = n(); if (rel) { X += x; Y += y; } if (k === 1) { x = X; y = Y; } pts.push([X, Y]); } }
    else if (C === 'A') { n(); n(); n(); n(); n(); let X = n(), Y = n(); if (rel) { X += x; Y += y; } x = X; y = Y; pts.push([X, Y]); }
    else if (C === 'Z') { x = sx; y = sy; }
    else throw new Error(`unhandled ${cur}`);
  }
  return pts;
}
const num = (s) => parseFloat(s);

// --- inline the class fills/strokes, tighten the viewBox ----------------------------------------
function inlineClasses(frag) {
  return frag.replace(/class="(st\d+)"/g, (_, cls) => {
    const d = CLASSES[cls] || {};
    const parts = [];
    if (d.fill) parts.push(`fill="${d.fill}"`);
    if (d.stroke) parts.push(`stroke="${d.stroke}"`);
    if (d['stroke-width']) parts.push(`stroke-width="${d['stroke-width']}"`);
    if (d.stroke) parts.push('stroke-miterlimit="10"');
    return parts.join(' ');
  });
}

/** Extract one coin group → { art, w, h } (self-contained SVG, viewBox tightened to its bbox). */
function extractCoin(id) {
  const g = groupById(id);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (px, py) => { if (px < minX) minX = px; if (py < minY) minY = py; if (px > maxX) maxX = px; if (py > maxY) maxY = py; };
  for (const m of g.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)) for (const [px, py] of pathPoints(m[1])) grow(px, py);
  for (const m of g.matchAll(/<rect\b([^>]*)\/>/g)) {
    const a = (k) => { const mm = m[1].match(new RegExp(`\\b${k}="([^"]+)"`)); return mm ? num(mm[1]) : 0; };
    grow(a('x'), a('y')); grow(a('x') + a('width'), a('y') + a('height'));
  }
  const inner = g.replace(new RegExp(`^<g id="${id}">`), '').replace(/<\/g>$/, '');
  const PAD = 1.5;
  const vb = `${(minX - PAD).toFixed(2)} ${(minY - PAD).toFixed(2)} ${(maxX - minX + 2 * PAD).toFixed(2)} ${(maxY - minY + 2 * PAD).toFixed(2)}`;
  const body = inlineClasses(inner).replace(/\s+/g, ' ').trim();
  return { art: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${body}</svg>`, w: maxX - minX, h: maxY - minY };
}

const HEADER = `// AUTO-GENERATED from ../../icons.svg by scripts/gen-buy-bonus.mjs — do not edit by hand.
// The full-colour buy-bonus coins (default / social / deactivate), shared by the DOM shell
// (inline <svg>) and the Pixi shell (GraphicsContext.svg). To refresh: edit icons.svg, then
// \`node scripts/gen-buy-bonus.mjs\`.`;

let out = HEADER + '\n';
for (const v of VARIANTS) {
  const { art, w, h } = extractCoin(v.id);
  out += `export const ${v.name} = \`${art}\`;\n`;
  console.log(`  ${v.name.padEnd(24)} #${v.id} (${w.toFixed(0)}×${h.toFixed(0)}, ${art.length} bytes)`);
}
writeFileSync(join(ROOT, 'src', 'ui', 'buy-bonus-art.ts'), out);
console.log('wrote src/ui/buy-bonus-art.ts');
