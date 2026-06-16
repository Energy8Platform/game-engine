import type { GameShell } from '../GameShell';
import type { CellRef, GameInfoSection, GameMode, PaytableRow, PaylineDef, WinSection } from '../types';
import { createOverlay, twoLine } from './primitives';
import { icon } from './icons';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function openGameInfoModal(shell: GameShell): HTMLElement {
  const { root, body } = createOverlay({
    title: shell.t('Game info'),
    onClose: () => root.remove(),
    onBack: () => { root.remove(); shell.openSettings(); },
  });
  root.dataset.ge = 'info-modal';

  const sections = shell.config.gameInfo.sections ?? [];
  // Default placement: modes first, controls second, the rest in declaration order.
  // An explicit `order` overrides; ties keep declaration order (stable).
  const base = (s: GameInfoSection, i: number): number =>
    s.order ?? (s.type === 'modes' ? -2 : s.type === 'controls' ? -1 : i);
  sections
    .map((s, i) => ({ s, i, k: base(s, i) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .forEach(({ s }) => body.appendChild(renderSection(shell, s)));

  return root;
}

function renderSection(shell: GameShell, s: GameInfoSection): HTMLElement {
  switch (s.type) {
    case 'modes': return sectionModes(shell, s.modes, sec('info-modes', s.title, shell.t('Modes')));
    case 'controls': return sectionControls(shell, sec('info-controls', s.title, shell.t('Controls')));
    case 'paytable': return sectionPaytable(s.rows, sec('info-paytable', s.title, shell.t('Paytable')));
    case 'wins': return sectionWins(s, sec('info-wins', s.title, shell.t(winFallbackTitle(s.kind))));
    case 'custom': return sectionCustom(s, sec('info-custom', s.title, ''));
  }
}

/** A titled glass-plaque section shell. */
function sec(ge: string, title: string | undefined, fallback: string): HTMLElement {
  const el = document.createElement('section');
  el.dataset.ge = ge; el.className = 'ge-gi-sec';
  const t = title ?? fallback;
  if (t) { const h = document.createElement('h3'); h.textContent = t; el.appendChild(h); }
  return el;
}

// ── modes (rows — varying description lengths read better than fixed cards) ────
function sectionModes(shell: GameShell, modes: GameMode[], el: HTMLElement): HTMLElement {
  const list = document.createElement('div'); list.className = 'ge-gi-modes';
  for (const m of modes) list.appendChild(modeRow(shell, m));
  el.appendChild(list);
  return el;
}
function modeRow(shell: GameShell, m: GameMode): HTMLElement {
  const row = document.createElement('div'); row.className = 'ge-gi-mode';
  const stat = (label: string, val: string) =>
    `<span class="ge-gi-mode-st"><span>${label}</span><b>${val}</b></span>`;
  let stats = '';
  if (m.price != null) stats += stat(shell.t('Price'), m.price);
  if (typeof m.rtp === 'number') stats += stat(shell.t('RTP'), `${m.rtp}%`);
  if (m.maxWin != null) stats += stat(shell.t('Max win'), m.maxWin);
  row.innerHTML =
    `<div class="ge-gi-mode-top"><span class="ge-gi-mode-h">${m.title}</span>` +
    (stats ? `<span class="ge-gi-mode-stats">${stats}</span>` : '') + '</div>' +
    (m.description ? `<p class="ge-gi-mode-desc">${m.description}</p>` : '');
  return row;
}

// ── controls (auto-generated, split into a gameplay block and a menu/overlay block) ──
type CtlRow = { vis: string; name: string; desc: string; on: boolean };

function sectionControls(shell: GameShell, el: HTMLElement): HTMLElement {
  const { features } = shell.config;
  const slot = (inner: string, cls = '') => `<span class="ge-gi-ctl-ic ${cls}">${inner}</span>`;
  const buyLabel = twoLine(shell.t('BUY BONUS'));
  const buyBadge = slot(`<span class="ge-shell-buybonus"><span>${buyLabel}</span></span>`);

  // Block 1 — gameplay. Bet is split into two rows: one to raise, one to lower.
  const game: CtlRow[] = [
    { vis: slot(icon('spin')), name: 'Spin', desc: 'Start a spin at the current bet.', on: true },
    { vis: slot(icon('plus')), name: 'Raise bet', desc: 'Increase your stake.', on: true },
    { vis: slot(icon('minus')), name: 'Lower bet', desc: 'Decrease your stake.', on: true },
    { vis: slot(icon('autoplay')), name: 'Autoplay', desc: 'Spin automatically a set number of times.', on: features.autoplay != null },
    { vis: slot(icon('turbo1')), name: 'Turbo', desc: 'Speed up spin animations.', on: features.turbo > 0 },
    { vis: buyBadge, name: 'Buy bonus', desc: 'Pay a fixed cost to enter a bonus feature.', on: features.buyBonus !== false },
  ];
  // Block 2 — menu & overlay chrome (always available).
  const menu: CtlRow[] = [
    { vis: slot(icon('menu')), name: 'Menu', desc: 'Open settings and game info.', on: true },
    { vis: slot(icon('soundOn')), name: 'Sound', desc: 'Mute or unmute the game.', on: true },
    { vis: slot(icon('info')), name: 'Game info', desc: 'Open the paytable and rules.', on: true },
    { vis: slot(icon('close')), name: 'Close', desc: 'Dismiss the current overlay.', on: true },
  ];

  el.appendChild(ctlBlock(shell, 'Game', game));
  el.appendChild(ctlBlock(shell, 'Menu & info', menu));
  return el;
}

function ctlBlock(shell: GameShell, label: string, rows: CtlRow[]): HTMLElement {
  const block = document.createElement('div'); block.className = 'ge-gi-ctl-block';
  const h = document.createElement('h4'); h.className = 'ge-gi-ctl-block-h'; h.textContent = shell.t(label);
  block.appendChild(h);
  for (const r of rows.filter((x) => x.on)) {
    const row = document.createElement('div'); row.className = 'ge-gi-ctl';
    row.innerHTML = `${r.vis}<div class="ge-gi-ctl-tx"><b>${shell.t(r.name)}</b><span>${shell.t(r.desc)}</span></div>`;
    block.appendChild(row);
  }
  return block;
}

// ── paytable (cards — image on top, name, then win tiers "<count> x<mult>") ────
function sectionPaytable(rows: PaytableRow[], el: HTMLElement): HTMLElement {
  const grid = document.createElement('div'); grid.className = 'ge-gi-pt-grid';
  for (const r of rows) grid.appendChild(paytableCard(r));
  el.appendChild(grid);
  return el;
}
function paytableCard(r: PaytableRow): HTMLElement {
  const card = document.createElement('div'); card.className = 'ge-gi-pt-card';
  const sym = document.createElement('div'); sym.className = 'ge-gi-pt-sym';
  if (r.symbol.image) {
    const img = document.createElement('img'); img.src = r.symbol.image; img.alt = r.symbol.text ?? '';
    sym.appendChild(img);
  }
  if (r.symbol.text) {
    const t = document.createElement('span'); t.textContent = r.symbol.text; sym.appendChild(t);
  }
  const wins = document.createElement('div'); wins.className = 'ge-gi-pt-wins';
  for (const w of r.wins) {
    const wi = document.createElement('span'); wi.className = 'ge-gi-pt-win';
    wi.innerHTML = (w.count ? `<i>${w.count}</i> ` : '') + `<b>x${w.multiplier}</b>`;
    wins.appendChild(wi);
  }
  card.append(sym, wins);
  return card;
}

// ── wins (one section = one pay type; cells filled in the accent colour, no line) ──
function winFallbackTitle(kind: WinSection['kind']): string {
  return { classic: 'Paylines', cluster: 'Cluster pays', anywhere: 'Pays anywhere', ways: 'Ways to win' }[kind];
}

function sectionWins(s: WinSection, el: HTMLElement): HTMLElement {
  if (s.kind === 'classic') {
    if (s.description) el.appendChild(winDesc(s.description));
    const wrap = document.createElement('div'); wrap.className = 'ge-gi-pl-grid';
    s.lines.forEach((line, i) => {
      const def: PaylineDef = Array.isArray(line) ? { pattern: line } : line;
      wrap.appendChild(lineItem(s.grid, def, i + 1));
    });
    el.appendChild(wrap);
  } else if (s.kind === 'cluster' || s.kind === 'anywhere') {
    badge(el, `min ${s.minCount}`);
    const row = document.createElement('div'); row.className = 'ge-gi-win-row';
    const example = s.example ?? (s.kind === 'cluster' ? clusterExample(s.grid, s.minCount) : anywhereExample(s.grid, s.minCount));
    row.appendChild(gridSvg(s.grid, example));
    if (s.description) row.appendChild(winDesc(s.description));
    el.appendChild(row);
  } else {
    if (s.description) el.appendChild(winDesc(s.description));
    const two = document.createElement('div'); two.className = 'ge-gi-win-two';
    two.append(
      waysCol('✓ wins', 'ge-gi-win-ok', s.grid, s.winExample ?? waysWin(s.grid)),
      waysCol('✗ no win', 'ge-gi-win-no', s.grid, s.loseExample ?? waysLose(s.grid)),
    );
    el.appendChild(two);
  }
  return el;
}

function winDesc(text: string): HTMLElement {
  const p = document.createElement('p'); p.className = 'ge-gi-win-desc'; p.textContent = text;
  return p;
}
/** Append a "min N" pill to the section header. */
function badge(el: HTMLElement, text: string): void {
  const h = el.querySelector('h3');
  if (!h) return;
  const b = document.createElement('span'); b.className = 'ge-gi-win-badge'; b.textContent = text;
  h.appendChild(b);
}

/** A cols×rows grid SVG; `on` cells are filled in the accent colour, the rest are faint. */
function gridSvg(grid: { cols: number; rows: number }, on: CellRef[]): SVGSVGElement {
  const { cols, rows } = grid;
  const W = 100, H = Math.round((rows / cols) * 100);
  const cw = W / cols, ch = H / rows;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'ge-gi-pl-svg');
  const onSet = new Set(on.map(([c, r]) => `${c},${r}`));
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const r = document.createElementNS(SVG_NS, 'rect');
    r.setAttribute('x', String(x * cw + 1)); r.setAttribute('y', String(y * ch + 1));
    r.setAttribute('width', String(cw - 2)); r.setAttribute('height', String(ch - 2));
    r.setAttribute('rx', '2'); r.setAttribute('class', onSet.has(`${x},${y}`) ? 'ge-gi-pl-on' : 'ge-gi-pl-cell');
    svg.appendChild(r);
  }
  return svg;
}

/** A classic payline: number caption on top, filled cells (no connecting line). */
function lineItem(grid: { cols: number; rows: number }, def: PaylineDef, n: number): HTMLElement {
  const item = document.createElement('div'); item.className = 'ge-gi-pl-item';
  const cap = document.createElement('span'); cap.className = 'ge-gi-pl-cap'; cap.textContent = String(n);
  const on: CellRef[] = def.pattern.map((rowIdx, col) => [col, rowIdx]);
  item.append(cap, gridSvg(grid, on)); // caption first → renders above the grid
  return item;
}

function waysCol(tag: string, tagCls: string, grid: { cols: number; rows: number }, cells: CellRef[]): HTMLElement {
  const col = document.createElement('div'); col.className = 'ge-gi-win-col';
  const t = document.createElement('span'); t.className = `ge-gi-win-tag ${tagCls}`; t.textContent = tag;
  col.append(t, gridSvg(grid, cells));
  return col;
}

// Default illustrations (used when the section omits an explicit example).
function clusterExample(grid: { cols: number; rows: number }, n: number): CellRef[] {
  const w = Math.min(grid.cols, Math.max(1, Math.ceil(Math.sqrt(n))));
  const cells: CellRef[] = [];
  for (let y = 0; y < grid.rows && cells.length < n; y++)
    for (let x = 0; x < w && cells.length < n; x++) cells.push([x, y]);
  return cells;
}
function anywhereExample(grid: { cols: number; rows: number }, n: number): CellRef[] {
  const count = Math.min(n, grid.cols * grid.rows);
  const cells: CellRef[] = [];
  for (let i = 0; i < count; i++) cells.push([Math.floor((i * grid.cols) / count), (i * 2 + 1) % grid.rows]);
  return cells;
}
function waysWin(grid: { cols: number; rows: number }): CellRef[] {
  const cells: CellRef[] = [];
  for (let c = 0; c < grid.cols; c++) cells.push([c, c % grid.rows]); // one symbol on every reel
  return cells;
}
function waysLose(grid: { cols: number; rows: number }): CellRef[] {
  const gap = Math.floor(grid.cols / 2);
  return waysWin(grid).filter(([c]) => c !== gap); // a broken chain (reel `gap` empty)
}

// ── custom ───────────────────────────────────────────────────────────────────
function sectionCustom(s: Extract<GameInfoSection, { type: 'custom' }>, el: HTMLElement): HTMLElement {
  if (s.node) {
    el.appendChild(s.node);
  } else if (s.html) {
    const d = document.createElement('div'); d.className = 'ge-gi-custom'; d.innerHTML = s.html;
    el.appendChild(d);
  }
  return el;
}
