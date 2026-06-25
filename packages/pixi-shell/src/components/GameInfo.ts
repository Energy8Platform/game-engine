import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { ShellHost, ShellLayer } from '../context';
import type {
  CellRef,
  GameInfoSection,
  GameMode,
  PaytableRow,
  PaylineDef,
  ShapeDef,
  WinSection,
} from '../types';
import { Overlay } from '../primitives/overlay';
import { makeText, textBaseline } from '../text';
import { makeIcon } from '../pixi-icon';
import { FlexBox } from '../primitives/flex';
import { section, paragraph, Spacer } from '../primitives/controls';
import { BuyBonusBadge } from '../primitives/widgets';
import { PACKAGE_VERSION } from '../version';

/** Game info overlay — modes, controls, paytable, win illustrations, custom sections. */
export function openGameInfo(host: ShellHost): ShellLayer {
  return new Overlay(host, {
    tag: 'game-info',
    title: host.t('Game info'),
    onClose: () => host.closeLayer(),
    onBack: () => {
      host.closeLayer();
      host.openSettings();
    },
    build: (w) => buildBody(host, w),
  });
}

function buildBody(host: ShellHost, width: number): Container {
  const col = new FlexBox({ direction: 'column', align: 'stretch', gap: 12 });
  const sections = host.config.gameInfo.sections ?? [];
  const base = (s: GameInfoSection, i: number): number =>
    s.order ?? (s.type === 'modes' ? -2 : s.type === 'controls' ? -1 : i);
  sections
    .map((s, i) => ({ s, i, k: base(s, i) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .forEach(({ s }) => col.add(renderSection(host, s, width)));
  col.add(versionFooter(host, width));
  return col;
}

/** A muted version stamp pinned to the bottom of the game-info overlay:
 *  `${config.version ?? '1.0.0'}.${engine version without dots}` (e.g. '1.0.0.010'). */
function versionFooter(host: ShellHost, width: number): FlexBox {
  const gameVersion = host.config.version ?? '1.0.0';
  const stamp = `${gameVersion}.${PACKAGE_VERSION.split('.').join('')}`;
  const row = new FlexBox({ direction: 'row', justify: 'center', width, padding: { top: 6, bottom: 4 } });
  // white-based muted (the overlay is always dark) so it's visible regardless of the dark/light
  // scheme — the scheme-dependent `muted` is near-invisible on the dark overlay in light mode.
  const t = makeText(stamp, { size: 11, weight: '600', color: host.tokens.plaqueLabel, letterSpacing: 0.88 });
  row.add(t);
  return row;
}

function renderSection(host: ShellHost, s: GameInfoSection, width: number): FlexBox {
  switch (s.type) {
    case 'modes':
      return sectionModes(host, s.modes, s.title ?? host.t('Modes'), width);
    case 'controls':
      return sectionControls(host, s.title ?? host.t('Controls'), width);
    case 'paytable':
      return sectionPaytable(host, s.rows, s.title ?? host.t('Paytable'), width);
    case 'wins':
      return sectionWins(host, s, width);
    case 'custom':
      return sectionCustom(host, s, width);
  }
}

const SECTION_PAD = 18 * 2; // section() horizontal padding (left+right)

// ── modes ──────────────────────────────────────────────────────────────────────
function sectionModes(host: ShellHost, modes: GameMode[], title: string, width: number): FlexBox {
  const sec = section(host, title);
  const inner = width - SECTION_PAD;
  modes.forEach((m, i) => {
    if (i > 0) sec.add(hairline(host, inner));
    sec.add(modeRow(host, m, inner));
  });
  return sec;
}

function modeRow(host: ShellHost, m: GameMode, inner: number): FlexBox {
  const row = new FlexBox({ direction: 'column', align: 'stretch', gap: 6, padding: { top: 12, bottom: 12 } });
  const title = makeText(m.title, { size: 16, weight: '800', color: '#ffffff' });

  // Label + value baseline-aligned within each cell (CSS .ge-gi-mode-st { align-items: baseline }).
  // trim:false gives uniform line boxes; placing each text at `base - itsAscent` lands both on one
  // baseline so a 14px value sits level with its 10px UPPER label — and so the comma in "5,000×"
  // no longer drops the value relative to "100×".
  const LABEL_SIZE = 10, VALUE_SIZE = 14, LV_GAP = 5;
  const labelAsc = textBaseline(LABEL_SIZE, '600');
  const valueAsc = textBaseline(VALUE_SIZE, '800');
  const base = Math.max(labelAsc, valueAsc);
  const cells: Container[] = [];
  const stat = (label: string, val: string): void => {
    const lt = makeText(host.t(label), { size: LABEL_SIZE, weight: '600', color: host.tokens.plaqueLabel, letterSpacing: 1, upper: true, trim: false });
    const vt = makeText(val, { size: VALUE_SIZE, weight: '800', color: '#ffffff', trim: false });
    lt.position.set(0, base - labelAsc);
    vt.position.set(lt.width + LV_GAP, base - valueAsc);
    const cell = new Container();
    cell.addChild(lt, vt);
    cells.push(cell);
  };
  if (m.price != null) stat('Price', m.price);
  if (typeof m.rtp === 'number') stat('RTP', `${m.rtp}%`);
  if (m.maxWin != null) stat('Max win', m.maxWin);

  const GAP = 14;
  const cellW = cells.map((c) => c.getLocalBounds().width);
  const statsW = cellW.reduce((a, b) => a + b, 0) + GAP * Math.max(0, cells.length - 1);

  // DOM `.ge-gi-mode-top { flex-wrap:wrap; justify-content:space-between }`: title and stats share a
  // line when they fit (title left, stats right); otherwise the stats wrap onto their own line(s),
  // which a plain row would instead overlap onto the title at narrow (mobile) widths.
  if (cells.length === 0 || title.width + 16 + statsW <= inner) {
    const top = new FlexBox({ direction: 'row', align: 'center', justify: 'space-between', width: inner });
    top.add(title);
    if (cells.length) {
      const stats = new FlexBox({ direction: 'row', align: 'end', gap: GAP });
      cells.forEach((c) => stats.add(c));
      top.add(stats);
    }
    row.add(top);
  } else {
    row.add(title);
    row.add(wrapFlow(cells, cellW, inner, GAP, 8));
  }

  if (m.description) row.add(paragraph(host, m.description, inner, { size: 14, color: 'rgba(255,255,255,.78)' }));
  return row;
}

/** Pack cells left-to-right into lines no wider than maxW (a minimal flex-wrap), stacked in a
 *  column — used to wrap the mode stats below the title on narrow widths. */
function wrapFlow(cells: Container[], widths: number[], maxW: number, gapX: number, gapY: number): FlexBox {
  const col = new FlexBox({ direction: 'column', align: 'start', gap: gapY });
  let line = new FlexBox({ direction: 'row', align: 'end', gap: gapX });
  let lineW = 0;
  cells.forEach((cell, i) => {
    const w = widths[i];
    if (lineW > 0 && lineW + gapX + w > maxW) {
      col.add(line);
      line = new FlexBox({ direction: 'row', align: 'end', gap: gapX });
      lineW = 0;
    }
    line.add(cell);
    lineW += (lineW > 0 ? gapX : 0) + w;
  });
  col.add(line);
  return col;
}

// ── controls ─────────────────────────────────────────────────────────────────
interface CtlRow {
  vis: Container;
  name: string;
  desc: string;
  on: boolean;
}

function sectionControls(host: ShellHost, title: string, width: number): FlexBox {
  const sec = section(host, title);
  const inner = width - SECTION_PAD;
  const { features } = host.config;
  const slotIcon = (name: Parameters<typeof makeIcon>[0]): Container => {
    const box = new Container();
    const g = makeIcon(name, 26, '#ffffff');
    g.position.set((48 - 26) / 2, (48 - 26) / 2);
    box.addChild(spacerBox(48, 48), g);
    return box;
  };
  const buyBadge = (): Container => {
    const box = new Container();
    const badge = new BuyBonusBadge({
      size: 46,
      fontSize: 8,
      border: 2,
      bg: host.tokens.accent,
      fg: '#ffffff',
      label: host.t('BUY BONUS').split(/\s+/).join('\n'),
      tokens: host.tokens,
      ticker: host.ticker,
      onTap: () => {},
    });
    badge.eventMode = 'none';
    box.addChild(spacerBox(48, 48), badge);
    badge.position.set(1, 1);
    return box;
  };

  const game: CtlRow[] = [
    { vis: slotIcon('spin'), name: 'Spin', desc: 'Start a spin at the current bet.', on: true },
    { vis: slotIcon('plus'), name: 'Raise bet', desc: 'Increase your stake.', on: true },
    { vis: slotIcon('minus'), name: 'Lower bet', desc: 'Decrease your stake.', on: true },
    { vis: slotIcon('autoplay'), name: 'Autoplay', desc: 'Spin automatically a set number of times.', on: features.autoplay != null },
    { vis: slotIcon('turbo1'), name: 'Turbo', desc: 'Speed up spin animations.', on: features.turbo > 0 },
    { vis: buyBadge(), name: 'Buy bonus', desc: 'Pay a fixed cost to enter a bonus feature.', on: features.buyBonus !== false },
  ];
  const menu: CtlRow[] = [
    { vis: slotIcon('menu'), name: 'Menu', desc: 'Open settings and game info.', on: true },
    { vis: slotIcon('soundOn'), name: 'Sound', desc: 'Mute or unmute the game.', on: true },
    { vis: slotIcon('info'), name: 'Game info', desc: 'Open the paytable and rules.', on: true },
    { vis: slotIcon('close'), name: 'Close', desc: 'Dismiss the current overlay.', on: true },
  ];

  sec.add(ctlBlock(host, 'Game', game, inner, false));
  sec.add(ctlBlock(host, 'Menu & info', menu, inner, true));
  return sec;
}

function ctlBlock(host: ShellHost, label: string, rows: CtlRow[], inner: number, topBorder: boolean): FlexBox {
  const block = new FlexBox({ direction: 'column', align: 'stretch', gap: 0, padding: { top: topBorder ? 16 : 0 } });
  if (topBorder) block.add(hairline(host, inner));
  // Heading off the divider above and the first row below — the DOM gives it margin:8px 0 2px plus
  // the block's 4px padding under the border; with gap:0 the pixi heading sat flush on the hairline.
  const head = new FlexBox({ direction: 'column', align: 'start', padding: { top: topBorder ? 12 : 0, bottom: 4 } });
  head.add(makeText(host.t(label), { size: 11, weight: '700', color: host.tokens.plaqueLabel, letterSpacing: 1.3, upper: true }));
  block.add(head);
  const visible = rows.filter((r) => r.on);
  visible.forEach((r, i) => {
    if (i > 0) block.add(hairline(host, inner));
    const row = new FlexBox({ direction: 'row', align: 'center', gap: 14, padding: { top: 9, bottom: 9 } });
    const tx = new FlexBox({ direction: 'column', align: 'start', gap: 2 });
    tx.add(makeText(host.t(r.name), { size: 15, weight: '700', color: '#ffffff' }));
    tx.add(paragraph(host, host.t(r.desc), inner - 48 - 14, { size: 13, color: 'rgba(255,255,255,.7)' }));
    row.add(r.vis);
    row.add(tx);
    block.add(row);
  });
  return block;
}

// ── paytable ───────────────────────────────────────────────────────────────────
function sectionPaytable(host: ShellHost, rows: PaytableRow[], title: string, width: number): FlexBox {
  const sec = section(host, title);
  const inner = width - SECTION_PAD;
  const gap = 10;
  const cols = Math.max(1, Math.floor((inner + gap) / (120 + gap)));
  const cardW = (inner - gap * (cols - 1)) / cols;
  const grid = new FlexBox({ direction: 'column', align: 'start', gap });
  for (let i = 0; i < rows.length; i += cols) {
    const row = new FlexBox({ direction: 'row', align: 'start', gap });
    for (const r of rows.slice(i, i + cols)) row.add(paytableCard(host, r, cardW));
    row.layout();
    grid.add(row);
  }
  sec.add(grid);
  return sec;
}

function paytableCard(host: ShellHost, r: PaytableRow, w: number): FlexBox {
  const card = new FlexBox({
    direction: 'column',
    align: 'center',
    gap: 8,
    padding: { top: 14, bottom: 14, left: 12, right: 12 },
    width: w,
    background: { fill: host.tokens.plaqueDark, radius: 14 },
  });
  const sym = new FlexBox({ direction: 'column', align: 'center', gap: 5 });
  if (r.symbol.image) sym.add(imageBox(r.symbol.image, 56, 56));
  if (r.symbol.text) sym.add(makeText(r.symbol.text, { size: 13, weight: '700', color: '#ffffff', upper: true, letterSpacing: 0.65 }));
  card.add(sym);
  const wins = new FlexBox({ direction: 'column', align: 'stretch', gap: 2, width: w - 24 });
  for (const win of r.wins) {
    const wr = new FlexBox({ direction: 'row', align: 'center', justify: 'space-between' });
    wr.add(makeText(win.count ? String(win.count) : '', { size: 13.5, weight: '400', color: host.tokens.plaqueLabel }));
    wr.add(new Spacer(), { grow: 1 });
    wr.add(makeText(`x${win.multiplier}`, { size: 13.5, weight: '700', color: host.tokens.accent }));
    wins.add(wr);
  }
  card.add(wins);
  return card;
}

// ── wins ─────────────────────────────────────────────────────────────────────
function winFallbackTitle(kind: WinSection['kind']): string {
  return { classic: 'Paylines', cluster: 'Cluster pays', anywhere: 'Pays anywhere', ways: 'Ways to win', shapes: 'Winning shapes' }[
    kind
  ];
}

function sectionWins(host: ShellHost, s: WinSection, width: number): FlexBox {
  const inner = width - SECTION_PAD;
  const title = s.title ?? host.t(winFallbackTitle(s.kind));
  const sec = section(host);
  // header (title + optional "min N" badge)
  const header = new FlexBox({ direction: 'row', align: 'center', gap: 10 });
  header.add(makeText(title, { size: 11, weight: '700', color: host.tokens.plaqueLabel, letterSpacing: 1.54, upper: true }));
  if ((s.kind === 'cluster' || s.kind === 'anywhere') && 'minCount' in s) header.add(badgePill(host, `min ${s.minCount}`));
  sec.add(header);

  if (s.kind === 'classic') {
    if (s.description) sec.add(paragraph(host, s.description, inner, { size: 14, color: 'rgba(255,255,255,.78)' }));
    const gap = 12;
    const cols = Math.max(1, Math.floor((inner + gap) / (72 + gap)));
    const itemW = (inner - gap * (cols - 1)) / cols;
    const grid = new FlexBox({ direction: 'column', align: 'start', gap });
    const lines = s.lines;
    for (let i = 0; i < lines.length; i += cols) {
      const row = new FlexBox({ direction: 'row', align: 'start', gap });
      lines.slice(i, i + cols).forEach((line, j) => {
        const def: PaylineDef = Array.isArray(line) ? { pattern: line } : line;
        const on: CellRef[] = def.pattern.map((rowIdx, col) => [col, rowIdx]);
        row.add(lineItem(host, s.grid, on, i + j + 1, Math.min(itemW, 140)));
      });
      row.layout();
      grid.add(row);
    }
    sec.add(grid);
  } else if (s.kind === 'cluster' || s.kind === 'anywhere') {
    const example = s.example ?? (s.kind === 'cluster' ? clusterExample(s.grid, s.minCount) : anywhereExample(s.grid, s.minCount));
    const row = new FlexBox({ direction: 'row', align: 'start', gap: 16 });
    row.add(gridIllustration(host, s.grid, example, 140));
    if (s.description) row.add(paragraph(host, s.description, inner - 156, { size: 14, color: 'rgba(255,255,255,.78)' }));
    sec.add(row);
  } else if (s.kind === 'shapes') {
    if (s.description) sec.add(paragraph(host, s.description, inner, { size: 14, color: 'rgba(255,255,255,.78)' }));
    s.shapes.forEach((sh, i) => {
      if (i > 0) sec.add(hairline(host, inner));
      sec.add(shapeRow(host, s.grid, sh, inner));
    });
  } else {
    if (s.description) sec.add(paragraph(host, s.description, inner, { size: 14, color: 'rgba(255,255,255,.78)' }));
    const two = new FlexBox({ direction: 'row', align: 'start', gap: 22 });
    two.add(waysCol(host, '✓ wins', host.tokens.winOk, s.grid, s.winExample ?? waysWin(s.grid)));
    two.add(waysCol(host, '✗ no win', host.tokens.winNo, s.grid, s.loseExample ?? waysLose(s.grid)));
    sec.add(two);
  }
  return sec;
}

function lineItem(host: ShellHost, grid: { cols: number; rows: number }, on: CellRef[], n: number, w: number): FlexBox {
  const item = new FlexBox({ direction: 'column', align: 'center', gap: 6 });
  item.add(makeText(String(n), { size: 13, weight: '700', color: '#ffffff' }));
  item.add(gridIllustration(host, grid, on, w));
  return item;
}

function waysCol(host: ShellHost, tag: string, color: string, grid: { cols: number; rows: number }, cells: CellRef[]): FlexBox {
  const col = new FlexBox({ direction: 'column', align: 'center', gap: 6 });
  col.add(makeText(tag, { size: 12, weight: '700', color }));
  col.add(gridIllustration(host, grid, cells, 140));
  return col;
}

function shapeRow(host: ShellHost, grid: { cols: number; rows: number }, sh: ShapeDef, inner: number): FlexBox {
  const row = new FlexBox({ direction: 'row', align: 'center', gap: 16, padding: { top: 12, bottom: 12 } });
  row.add(gridIllustration(host, grid, sh.cells, 96));
  const tx = new FlexBox({ direction: 'column', align: 'start', gap: 4 });
  tx.add(makeText(sh.name, { size: 16, weight: '800', color: '#ffffff' }));
  if (sh.description) tx.add(paragraph(host, sh.description, inner - 112, { size: 14, color: 'rgba(255,255,255,.78)' }));
  row.add(tx);
  return row;
}

/** A cols×rows grid; `on` cells filled in the accent colour, the rest faint (`.ge-gi-pl-*`). */
function gridIllustration(host: ShellHost, grid: { cols: number; rows: number }, on: CellRef[], width: number): Container {
  const { cols, rows } = grid;
  const cell = width / cols;
  const inset = width / 100;
  const rx = width / 50;
  const onSet = new Set(on.map(([c, r]) => `${c},${r}`));
  const g = new Graphics();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g.roundRect(x * cell + inset, y * cell + inset, cell - 2 * inset, cell - 2 * inset, rx);
      g.fill(onSet.has(`${x},${y}`) ? host.tokens.accent : host.tokens.plaqueLine);
    }
  }
  const c = new Container();
  c.addChild(g);
  return c;
}

// ── custom ─────────────────────────────────────────────────────────────────────
function sectionCustom(host: ShellHost, s: Extract<GameInfoSection, { type: 'custom' }>, width: number): FlexBox {
  const sec = section(host, s.title);
  const inner = width - SECTION_PAD;
  if (s.node) {
    sec.add(s.node); // game-supplied Pixi content owns its own layout
  } else if (s.html) {
    const text = s.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) sec.add(paragraph(host, text, inner, { size: 15 }));
  }
  return sec;
}

// ── default illustrations (ported from DOM GameInfo) ─────────────────────────────
function clusterExample(grid: { cols: number; rows: number }, n: number): CellRef[] {
  const w = Math.min(grid.cols, Math.max(1, Math.ceil(Math.sqrt(n))));
  const cells: CellRef[] = [];
  for (let y = 0; y < grid.rows && cells.length < n; y++) for (let x = 0; x < w && cells.length < n; x++) cells.push([x, y]);
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
  for (let c = 0; c < grid.cols; c++) cells.push([c, c % grid.rows]);
  return cells;
}
function waysLose(grid: { cols: number; rows: number }): CellRef[] {
  const gap = Math.floor(grid.cols / 2);
  return waysWin(grid).filter(([c]) => c !== gap);
}

// ── small helpers ────────────────────────────────────────────────────────────
function hairline(host: ShellHost, width: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, width, 1).fill(host.tokens.plaqueLine);
  return g;
}

function badgePill(host: ShellHost, text: string): Container {
  const c = new Container();
  const label = makeText(text, { size: 11, weight: '700', color: host.tokens.accent, letterSpacing: 0.22 });
  const bg = new Graphics();
  const w = label.width + 16;
  const h = label.height + 4;
  bg.roundRect(0, 0, w, h, 999).fill(host.tokens.plaqueDark);
  label.position.set(8, 2);
  c.addChild(bg, label);
  return c;
}

function spacerBox(w: number, h: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0 });
  return g;
}

/** A fixed box that loads an image into it (object-fit: contain) once the texture resolves. */
function imageBox(url: string, w: number, h: number): Container {
  const c = new Container();
  c.addChild(spacerBox(w, h));
  Assets.load(url)
    .then((tex: Texture) => {
      const sp = new Sprite(tex);
      const scale = Math.min(w / tex.width, h / tex.height);
      sp.scale.set(scale);
      sp.position.set((w - tex.width * scale) / 2, (h - tex.height * scale) / 2);
      c.addChild(sp);
    })
    .catch(() => {
      /* missing image → empty box */
    });
  return c;
}
