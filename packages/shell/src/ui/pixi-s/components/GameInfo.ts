// Fork of pixi-hb/components/GameInfo.ts in the S look — sections, order and behaviour unchanged.
import { Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { PixiComponentContext, ShellLayer } from '../../pixi/context';
import type {
  CellRef,
  GameInfoSection,
  GameMode,
  PaytableRow,
  PaylineDef,
  ShapeDef,
  WinSection,
} from '@/core/types';

/** Default order key for the auto-injected hotkeys section: just after `controls` (-1). */
const HOTKEYS_DEFAULT_ORDER = -0.5;
import { SPage } from '../primitives/page';
import { STitlePlate } from '../primitives/controls';
import { Spacer, giEm, setGiEm } from '../../pixi-hb/primitives/controls';
import { makeIcon } from '../../pixi-hb/pixi-icon';
import { FlexBox } from '../../pixi/primitives/flex';
import { SButton } from '../widgets';
import { SKEW } from '../slab';
import { sIcon } from '../icons';
import { sLabel, sValue, sBody } from '../text';
import { PACKAGE_VERSION } from '@/core/version';
import { S } from '../theme';

/** Game info — the S full-screen page: yellow title plate + ✕, sections under yellow title plates. */
export function openSGameInfo(host: PixiComponentContext): ShellLayer {
  return new SPage(host, {
    tag: 'game-info',
    title: host.t('Game info'),
    onClose: () => host.closeLayer(),
    build: (w) => buildBody(host, w),
  });
}

/** A section: its title in a yellow plate on the left, then the content centred as in HB's game info. */
function section(_host: PixiComponentContext, title: string | undefined, width: number): FlexBox {
  const sec = new FlexBox({ direction: 'column', align: 'center', gap: 12, padding: { top: 8, bottom: 8 } });
  if (title) {
    const head = new FlexBox({ direction: 'row', justify: 'start', width });
    head.add(new STitlePlate(title, Math.round(giEm() * 2.6), width));
    sec.add(head);
  }
  return sec;
}

/** Wrapped body copy (Inter), centred by default as in HB's game info. */
function paragraph(_host: PixiComponentContext, text: string, width: number, opts: { size?: number; color?: string; align?: 'left' | 'center' } = {}) {
  return sBody(text, opts.size ?? 15, opts.color ?? S.fg, width, opts.align ?? 'center');
}

/** A flat content panel — no border, sharp corners. */
function card(opts: { padding?: number; gap?: number; align?: 'start' | 'center' | 'stretch'; direction?: 'row' | 'column' } = {}): FlexBox {
  return new FlexBox({
    direction: opts.direction ?? 'column',
    align: opts.align ?? 'center',
    gap: opts.gap ?? 8,
    padding: opts.padding ?? 12,
    background: { fill: S.panel, radius: 0 },
  });
}

function buildBody(host: PixiComponentContext, width: number): Container {
  setGiEm(host.screenW, host.screenH);
  const col = new FlexBox({ direction: 'column', align: 'stretch', gap: 20 });
  const allSections = host.config.gameInfo.sections ?? [];
  // Auto-inject a hotkeys section unless the game already provides one. With hotkeys off — a
  // jurisdiction that forbids them, or a touchscreen that has no keys at all (see core/device.ts) —
  // there is no keyboard surface to document, and a game-supplied section is dropped along with the
  // auto-injected one: a keycap chart for keys the player cannot press is a promise the game breaks.
  const keys = host.config.features.hotkeys !== false;
  const rawSections = keys ? allSections : allSections.filter((s) => s.type !== 'hotkeys');
  const sectionsWithHotkeys: GameInfoSection[] = [...rawSections];
  if (keys && !rawSections.some((s) => s.type === 'hotkeys')) {
    sectionsWithHotkeys.push({ type: 'hotkeys', order: HOTKEYS_DEFAULT_ORDER });
  }
  const sections = sectionsWithHotkeys;
  const base = (s: GameInfoSection, i: number): number =>
    s.order ?? (s.type === 'modes' ? -2 : s.type === 'controls' ? -1 : i);
  sections
    .map((s, i) => ({ s, i, k: base(s, i) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .forEach(({ s }) => col.add(renderSection(host, s, width)));
  col.add(versionFooter(host, width));
  return col;
}

/** A muted version stamp pinned to the bottom of the game-info page:
 *  `${config.version ?? '1.0.0'}.${engine version without dots}` (e.g. '1.0.0.010'). */
function versionFooter(host: PixiComponentContext, width: number): FlexBox {
  const gameVersion = host.config.version ?? '1.0.0';
  const stamp = `${gameVersion}.${PACKAGE_VERSION.split('.').join('')}`;
  const row = new FlexBox({ direction: 'row', justify: 'center', width, padding: { top: 6, bottom: 4 } });
  row.add(sBody(stamp, 11, S.muted));
  return row;
}

function renderSection(host: PixiComponentContext, s: GameInfoSection, width: number): FlexBox {
  switch (s.type) {
    case 'modes':
      return sectionModes(host, s.modes, s.title ?? host.t('Modes'), width);
    case 'controls':
      return sectionControls(host, s.title ?? host.t('Controls'), width);
    case 'hotkeys':
      return sectionHotkeys(host, s.title ?? host.t('Hotkeys'), width);
    case 'paytable':
      return sectionPaytable(host, s.rows, s.title ?? host.t('Paytable'), width);
    case 'wins':
      return sectionWins(host, s, width);
    case 'custom':
      return sectionCustom(host, s, width);
  }
}

const SECTION_PAD = 0; // section() has no horizontal padding
const CARD_PAD = 14 * 2; // card() horizontal padding (left+right)

// ── modes ──────────────────────────────────────────────────────────────────────
function sectionModes(host: PixiComponentContext, modes: GameMode[], title: string, width: number): FlexBox {
  const sec = section(host, title, width);
  const inner = width - SECTION_PAD;
  modes.forEach((m) => {
    const c = card({ align: 'stretch', padding: 14 });
    c.add(modeRow(host, m, inner - CARD_PAD));
    sec.add(c, { grow: 1 });
    c.setLayoutSize(inner, undefined);
  });
  return sec;
}

function modeRow(host: PixiComponentContext, m: GameMode, inner: number): FlexBox {
  const row = new FlexBox({ direction: 'column', align: 'center', gap: 8 });
  const title = sLabel(m.title, giEm() * 1.15, S.fg);

  // Label + value centred on one line within each cell.
  const LABEL_SIZE = giEm() * 0.72, VALUE_SIZE = giEm(), LV_GAP = 5;
  const cells: Container[] = [];
  const stat = (label: string, val: string): void => {
    const lt = sLabel(host.t(label), LABEL_SIZE, S.muted);
    const vt = sValue(val, VALUE_SIZE, S.yellow);
    const h = Math.max(lt.height, vt.height);
    lt.position.set(0, (h - lt.height) / 2);
    vt.position.set(lt.width + LV_GAP, (h - vt.height) / 2);
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
  row.add(title);
  if (cells.length) {
    if (statsW <= inner) {
      const stats = new FlexBox({ direction: 'row', align: 'end', gap: GAP });
      cells.forEach((c) => stats.add(c));
      row.add(stats);
    } else {
      row.add(wrapFlow(cells, cellW, inner, GAP, 8));
    }
  }

  if (m.description) row.add(paragraph(host, m.description, inner, { size: giEm(), color: S.muted }));
  return row;
}

/** Pack cells left-to-right into lines no wider than maxW (a minimal flex-wrap), stacked in a
 *  column — used to wrap the mode stats below the title on narrow widths. */
function wrapFlow(cells: Container[], widths: number[], maxW: number, gapX: number, gapY: number): FlexBox {
  const col = new FlexBox({ direction: 'column', align: 'center', gap: gapY });
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

function sectionControls(host: PixiComponentContext, title: string, width: number): FlexBox {
  const sec = section(host, title, width);
  const inner = width - SECTION_PAD;
  const { features } = host.config;
  /** A 36-square S plate badge in a 48 box: yellow for SPIN / buy, black for the rest. */
  const badge = (face: 'yellow' | 'plate', glyph: Container, g: number): Container => {
    const box = new Container();
    const b = new SButton({ w: 36, h: 36, face, corners: SKEW.menu, glyph, glyphSize: g, onTap: () => {} });
    b.eventMode = 'none';
    b.position.set(6, 6);
    box.addChild(spacerBox(48, 48), b);
    return box;
  };
  const fgIcon = (name: Parameters<typeof makeIcon>[0]) => badge('plate', makeIcon(name, 20, { ink: S.fg, fill: S.fg }), 20);

  const game: CtlRow[] = [
    { vis: badge('yellow', makeIcon('spin', 26, { ink: S.ink, fill: S.ink }), 26), name: 'Spin', desc: 'Start a spin at the current bet.', on: true },
    { vis: fgIcon('plus'), name: 'Raise bet', desc: 'Increase your stake.', on: true },
    { vis: fgIcon('minus'), name: 'Lower bet', desc: 'Decrease your stake.', on: true },
    { vis: badge('plate', sIcon('play', 18, S.fg), 18), name: 'Autoplay', desc: 'Spin automatically a set number of times.', on: features.autoplay != null },
    { vis: badge('plate', sIcon('bolt', 18, S.fg), 18), name: 'Turbo', desc: 'Speed up spin animations.', on: features.turbo > 0 },
    { vis: badge('yellow', sIcon('mask', 30, S.ink), 30), name: 'Buy bonus', desc: 'Pay a fixed cost to enter a bonus feature.', on: features.buyBonus !== false },
  ];
  const menu: CtlRow[] = [
    { vis: fgIcon('menu'), name: 'Menu', desc: 'Open settings and game info.', on: true },
    { vis: fgIcon('soundOn'), name: 'Sound', desc: 'Mute or unmute the game.', on: true },
    { vis: fgIcon('musicOn'), name: 'Music', desc: 'Mute or unmute the music.', on: true },
    { vis: fgIcon('info'), name: 'Game info', desc: 'Open the paytable and rules.', on: true },
    { vis: fgIcon('close'), name: 'Close', desc: 'Dismiss the current overlay.', on: true },
  ];

  sec.add(ctlBlock(host, 'Game', game, inner, false));
  sec.add(ctlBlock(host, 'Menu & info', menu, inner, true));
  return sec;
}

function ctlBlock(host: PixiComponentContext, label: string, rows: CtlRow[], inner: number, _topBorder: boolean): FlexBox {
  const block = card({ align: 'stretch', padding: 14, gap: 6 });
  block.setLayoutSize(inner, undefined);
  const head = new FlexBox({ direction: 'row', justify: 'center', padding: { bottom: 4 } });
  head.add(sLabel(host.t(label), 12, S.muted));
  block.add(head);
  const w = inner - CARD_PAD;
  const visible = rows.filter((r) => r.on);
  visible.forEach((r) => {
    const row = new FlexBox({ direction: 'row', align: 'center', gap: 14, padding: { top: 6, bottom: 6 } });
    const tx = new FlexBox({ direction: 'column', align: 'start', gap: 2 });
    tx.add(sLabel(host.t(r.name), giEm() * 1.0, S.fg));
    tx.add(paragraph(host, host.t(r.desc), w - 48 - 14, { size: giEm(), color: S.muted, align: 'left' }));
    row.add(r.vis);
    row.add(tx);
    block.add(row);
  });
  return block;
}

// ── hotkeys (keycap chips → localized action name) ────────────────────────────
interface HkRow {
  chips: string[];
  name: string;
  on: boolean;
}

function sectionHotkeys(host: PixiComponentContext, title: string, width: number): FlexBox {
  const sec = section(host, title, width);
  const inner = width - SECTION_PAD;
  const { features } = host.config;

  const rows: HkRow[] = [
    { chips: ['Space'],               name: 'Spin',      on: true },
    { chips: ['Shift', '↑', 'Shift', '='], name: 'Raise bet', on: true },
    { chips: ['Shift', '↓', 'Shift', '-'], name: 'Lower bet', on: true },
    { chips: ['Shift', 'A'],          name: 'Autoplay',  on: features.autoplay != null },
    { chips: ['Shift', 'T'],          name: 'Turbo',     on: features.turbo > 0 },
    { chips: ['Shift', 'B'],          name: 'Buy bonus', on: features.buyBonus !== false },
    { chips: ['Shift', 'I'],          name: 'Game info', on: true },
    { chips: ['Shift', 'S'],          name: 'Menu',      on: true },
    { chips: ['Shift', 'M'],          name: 'Mute',      on: true },
    { chips: ['←', '→'],             name: 'Navigate',  on: true },
    { chips: ['Enter'],               name: 'Confirm',   on: true },
    { chips: ['Esc'],                 name: 'Close',     on: true },
  ];

  const block = card({ align: 'stretch', padding: 14, gap: 2 });
  block.setLayoutSize(inner, undefined);
  rows.filter((r) => r.on).forEach((r) => block.add(hkRow(host, r, inner - CARD_PAD)));
  sec.add(block);
  return sec;
}

/** Render a single hotkey row: keycap chip(s) on the left, action name on the right. The row is
 *  constrained to `inner` (chips left, label right). On narrow widths the chip combos stack onto
 *  their own lines and the label wraps within the leftover width, so nothing clips past the panel
 *  — the Pixi analogue of the HTML `.ge-gi-hk-chips { flex:0 1 auto; flex-wrap }` + label wrap. */
function hkRow(host: PixiComponentContext, r: HkRow, inner: number): FlexBox {
  const GAP = 14;
  const LABEL_MIN = 92; // reserve at least this much for the action label before wrapping the chips
  const chipKeys = buildChipKeys(r);

  // Lay the chips on one line and measure. If that leaves too little room for the label, stack the
  // combos (split at the '/') onto their own lines so the chips give up horizontal width.
  let chips: FlexBox = chipLine(host, chipKeys);
  let chipsW = chips.measureSize().w;
  if (chipsW > inner - GAP - LABEL_MIN) {
    chips = chipCombos(host, chipKeys);
    chipsW = chips.measureSize().w;
  }

  // The label takes the leftover width and WRAPS within it (never clips); right-aligned to sit
  // against the panel edge like the DOM `.ge-gi-hk-tx`.
  const labelW = Math.max(LABEL_MIN, inner - chipsW - GAP);
  const nameText = sBody(host.t(r.name), giEm(), S.fg, labelW, 'right');

  const row = new FlexBox({ direction: 'row', align: 'center', justify: 'space-between', gap: GAP, padding: { top: 8, bottom: 8 }, width: inner });
  row.add(chips);
  row.add(nameText);
  return row;
}

/** Chips on a single row, with '/' separators between the combos (as flattened by buildChipKeys). */
function chipLine(host: PixiComponentContext, chipKeys: string[]): FlexBox {
  const line = new FlexBox({ direction: 'row', align: 'center', gap: 4 });
  for (const key of chipKeys) {
    if (key === '/') line.add(sBody('/', 12, S.muted));
    else line.add(keycap(host, key));
  }
  return line;
}

/** Chips stacked as combos — split at the '/' separators, one combo per line (drops the inline
 *  '/', which reads as a line break once the combos are stacked). */
function chipCombos(host: PixiComponentContext, chipKeys: string[]): FlexBox {
  const col = new FlexBox({ direction: 'column', align: 'start', gap: 4 });
  let line = new FlexBox({ direction: 'row', align: 'center', gap: 4 });
  let filled = false;
  const flush = (): void => {
    if (!filled) return;
    col.add(line);
    line = new FlexBox({ direction: 'row', align: 'center', gap: 4 });
    filled = false;
  };
  for (const key of chipKeys) {
    if (key === '/') { flush(); continue; }
    line.add(keycap(host, key));
    filled = true;
  }
  flush();
  return col;
}

/** Flatten a row's chip list into display tokens — for bet rows, produce: Shift ↑ / Shift = style. */
function buildChipKeys(r: HkRow): string[] {
  if ((r.name === 'Raise bet' || r.name === 'Lower bet') && r.chips.length === 4) {
    const [k1, k2, k3, k4] = r.chips;
    return [k1, k2, '/', k3, k4];
  }
  return r.chips;
}

/** A flat track-coloured rect with the key label — the S "keycap chip". */
function keycap(_host: PixiComponentContext, label: string): Container {
  const c = new Container();
  const txt = sValue(label, 11, S.fg);
  const padH = 8, padV = 5;
  const w = txt.width + padH * 2, h = txt.height + padV * 2;
  c.addChild(new Graphics().rect(0, 0, w, h).fill(S.track), txt);
  txt.position.set(padH, padV);
  return c;
}

// ── paytable ───────────────────────────────────────────────────────────────────
function sectionPaytable(host: PixiComponentContext, rows: PaytableRow[], title: string, width: number): FlexBox {
  const sec = section(host, title, width);
  const gap = 12;
  const cols = 3; // always three across (the user's call) — the last row keeps third-width cards
  const cardW = (width - gap * (cols - 1)) / cols;
  const grid = new FlexBox({ direction: 'column', align: 'start', gap, width });
  for (let i = 0; i < rows.length; i += cols) {
    const row = new FlexBox({ direction: 'row', align: 'start', gap });
    row.label = 'pt-row';
    for (const r of rows.slice(i, i + cols)) row.add(paytableCard(host, r, cardW));
    row.layout();
    grid.add(row);
  }
  sec.add(grid);
  return sec;
}

function paytableCard(_host: PixiComponentContext, r: PaytableRow, w: number): FlexBox {
  const card = new FlexBox({
    direction: 'column',
    align: 'center',
    gap: 8,
    padding: { top: 14, bottom: 14, left: 12, right: 12 },
    width: w,
    background: { fill: S.panel, radius: 0 },
  });
  card.label = 'pt-card';
  const sym = new FlexBox({ direction: 'column', align: 'center', gap: 5 });
  if (r.symbol.image) sym.add(imageBox(r.symbol.image, 56, 56));
  if (r.symbol.text) sym.add(sLabel(r.symbol.text, 13, S.fg));
  card.add(sym);
  const wins = new FlexBox({ direction: 'column', align: 'stretch', gap: 2, width: w - 24 });
  for (const win of r.wins) {
    const wr = new FlexBox({ direction: 'row', align: 'center', justify: 'space-between' });
    wr.add(sBody(win.count ? String(win.count) : '', 13.5, S.muted));
    wr.add(new Spacer(), { grow: 1 });
    wr.add(sValue(`×${win.multiplier}`, 13.5, S.yellow));
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

function sectionWins(host: PixiComponentContext, s: WinSection, width: number): FlexBox {
  const inner = width - SECTION_PAD;
  const title = s.title ?? host.t(winFallbackTitle(s.kind));
  const sec = section(host, undefined, inner);
  // header (title plate + optional "min N" badge); the plate leaves the badge its room
  const header = new FlexBox({ direction: 'row', align: 'center', gap: 10, width: inner });
  const badge = (s.kind === 'cluster' || s.kind === 'anywhere') && 'minCount' in s ? badgePill(host, `min ${s.minCount}`) : null;
  header.add(new STitlePlate(title, Math.round(giEm() * 2.6), badge ? inner - badge.width - 10 : inner));
  if (badge) header.add(badge);
  sec.add(header);

  if (s.kind === 'classic') {
    if (s.description) sec.add(paragraph(host, s.description, inner, { size: giEm(), color: S.muted }));
    const gap = 12;
    const cols = Math.max(1, Math.floor((inner + gap) / (72 + gap)));
    const itemW = (inner - gap * (cols - 1)) / cols;
    const grid = new FlexBox({ direction: 'column', align: 'center', gap });
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
    if (s.description) row.add(paragraph(host, s.description, inner - 156, { size: giEm(), color: S.muted }));
    sec.add(row);
  } else if (s.kind === 'shapes') {
    if (s.description) sec.add(paragraph(host, s.description, inner, { size: giEm(), color: S.muted }));
    s.shapes.forEach((sh) => {
      const c = card({ align: 'stretch', padding: 12 });
      c.add(shapeRow(host, s.grid, sh, inner - 24));
      c.setLayoutSize(inner, undefined);
      sec.add(c);
    });
  } else {
    if (s.description) sec.add(paragraph(host, s.description, inner, { size: giEm(), color: S.muted }));
    // two example grids side by side; clamp each to the available width and stack them when both
    // won't fit on one row (mirrors the DOM `.ge-gi-win-two { flex-wrap:wrap }` — prevents the grids
    // running off-screen on mobile-s).
    const GAP = 22;
    const colW = Math.min(140, inner);
    const two = colW * 2 + GAP <= inner
      ? new FlexBox({ direction: 'row', align: 'start', gap: GAP })
      : new FlexBox({ direction: 'column', align: 'center', gap: 12 });
    two.add(waysCol(host, '✓ wins', S.winOk, s.grid, s.winExample ?? waysWin(s.grid), colW));
    two.add(waysCol(host, '✗ no win', S.winNo, s.grid, s.loseExample ?? waysLose(s.grid), colW));
    sec.add(two);
  }
  return sec;
}

function lineItem(host: PixiComponentContext, grid: { cols: number; rows: number }, on: CellRef[], n: number, w: number): FlexBox {
  const item = new FlexBox({ direction: 'column', align: 'center', gap: 6 });
  item.add(sValue(String(n), 13, S.fg));
  item.add(gridIllustration(host, grid, on, w));
  return item;
}

function waysCol(host: PixiComponentContext, tag: string, color: string, grid: { cols: number; rows: number }, cells: CellRef[], w = 140): FlexBox {
  const col = new FlexBox({ direction: 'column', align: 'center', gap: 6 });
  col.add(sLabel(tag, 12, color));
  col.add(gridIllustration(host, grid, cells, w));
  return col;
}

function shapeRow(host: PixiComponentContext, grid: { cols: number; rows: number }, sh: ShapeDef, inner: number): FlexBox {
  const row = new FlexBox({ direction: 'row', align: 'center', gap: 16 });
  row.add(gridIllustration(host, grid, sh.cells, 96));
  const tx = new FlexBox({ direction: 'column', align: 'start', gap: 4 });
  tx.add(sLabel(sh.name, 16, S.fg));
  if (sh.description) tx.add(paragraph(host, sh.description, inner - 112, { size: giEm(), color: S.muted, align: 'left' }));
  row.add(tx);
  return row;
}

/** A cols×rows grid of flat squares; `on` cells yellow, the rest track. */
function gridIllustration(_host: PixiComponentContext, grid: { cols: number; rows: number }, on: CellRef[], width: number): Container {
  const { cols, rows } = grid;
  const cell = width / cols;
  const gap = 2;
  const onSet = new Set(on.map(([c, r]) => `${c},${r}`));
  const g = new Graphics();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      g.rect(x * cell + gap / 2, y * cell + gap / 2, cell - gap, cell - gap).fill(onSet.has(`${x},${y}`) ? S.yellow : S.track);
    }
  }
  const c = new Container();
  c.addChild(g);
  return c;
}

// ── custom ─────────────────────────────────────────────────────────────────────
function sectionCustom(host: PixiComponentContext, s: Extract<GameInfoSection, { type: 'custom' }>, width: number): FlexBox {
  // Translate the heading (e.g. the host-built DISCLAIMER title) — the body stays verbatim. The
  // socialize-exemption for the disclaimer runs in the host before render, so its identity is intact.
  const sec = section(host, s.title != null ? host.t(s.title) : undefined, width);
  const inner = width - SECTION_PAD;
  if (s.node) {
    sec.add(persistentSlot(s.node as Container)); // game-supplied Pixi content owns its own layout
  } else if (s.html) {
    const text = s.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) sec.add(paragraph(host, text, inner, { size: giEm() }));
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
function badgePill(_host: PixiComponentContext, text: string): Container {
  const c = new Container();
  const label = sLabel(text, 11, S.ink);
  const w = label.width + 16;
  const h = label.height + 6;
  c.addChild(new Graphics().rect(0, 0, w, h).fill(S.yellow), label);
  label.position.set(8, 3);
  return c;
}

function spacerBox(w: number, h: number): Graphics {
  const g = new Graphics();
  g.rect(0, 0, w, h).fill({ color: 0xffffff, alpha: 0 });
  return g;
}

/** Wrap a GAME-supplied custom `node` so the shell BORROWS it instead of owning it. The page is
 *  torn down with `destroy({ children: true })` on every close; that would recursively destroy the
 *  game's node, so the section renders blank on reopen. This slot's `destroy` DETACHES the node
 *  (leaving it intact) and destroys only the empty wrapper — the SAME node instance is re-mounted,
 *  with all its drawing, the next time Game info opens. Mirrors the HTML shell, where the game's DOM
 *  node simply persists in config across open/close. The game owns the node's lifetime, not us. */
function persistentSlot(node: Container): Container {
  const slot = new Container();
  slot.addChild(node);
  const destroySelf = Container.prototype.destroy.bind(slot);
  slot.destroy = () => {
    if (node.parent === slot) slot.removeChild(node); // keep the game node alive for the next open
    destroySelf({ children: false });
  };
  return slot;
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
