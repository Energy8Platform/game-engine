import { Assets, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import {
  PACKAGE_VERSION,
  type CellRef,
  type GameInfoSection,
  type GameMode,
  type PaylineDef,
  type PaytableRow,
  type WinSection,
} from '@energy8platform/shell';
import type { IconName } from '../assets';
import { Bubble, glyph } from '../components';
import type { BmCtx, Layer } from '../context';
import { ScrollBox } from '../scroll';
import { body, display, fitWidth, num } from '../text';
import { C, TYPE } from '../theme';
import { CONTENT_MAX_W, EDGE_X, Panel } from './panel';

// §5.3 Game Info: the Panel frame, a row of tab bubbles (PAYTABLE / MODES / CONTROLS / RULES) under the title,
// the selected tab's content in a vertical ScrollBox. Section order and behaviour follow the S skin's
// game info (hotkeys auto-injected, paytable amounts, borrowed custom node, version footer).

type TabKind = 'paytable' | 'modes' | 'controls' | 'rules';
interface Tab {
  kind: TabKind;
  label: string;
  sections: GameInfoSection[];
}
type Grid = { cols: number; rows: number };

const TAB_H = 72;
const RULES_W = 1000;
const BOTTOM = 40;
const SECTION_GAP = 48;
const STEP = 80;

export function openGameInfo(ctx: BmCtx): Layer {
  const tabs = buildTabs(ctx);
  let tab = 0;
  let scroll: ScrollBox | undefined;
  let viewH = 0;

  const panel: Panel = new Panel(ctx, {
    title: ctx.t('Game info'),
    onClose: () => ctx.closeLayer(),
    layout(root, w, h, top) {
      // tabs: active lime / ink text, the rest ink / grey400 text; tappable
      const row = new Container();
      let x = 0;
      tabs.forEach((t, i) => {
        const on = i === tab;
        const label = display(t.label, TYPE.tab, on ? C.ink : C.grey400);
        const b = new Bubble({ variant: on ? 'lime' : 'ink', tail: 'l', width: label.width + 56, height: TAB_H });
        b.addChild(label);
        b.centre(label);
        b.x = x;
        x += b.w + 16;
        if (!on) {
          b.eventMode = 'static';
          b.cursor = 'pointer';
          b.on('pointertap', () => select(i));
        }
        row.addChild(b);
      });
      const maxW = w - 2 * EDGE_X;
      if (row.width > maxW) row.scale.set(maxW / row.width);
      row.position.set((w - row.width) / 2, top);
      root.addChild(row);

      // content
      const t = tabs[tab];
      const rules = t.kind === 'rules' || t.kind === 'controls';
      const colW = Math.min(maxW, rules ? RULES_W : CONTENT_MAX_W);
      const y0 = top + TAB_H + 24;
      viewH = Math.max(120, h - y0 - BOTTOM);
      scroll = new ScrollBox(ctx.canvas, 'y');
      scroll.position.set((w - colW) / 2, y0);
      const s = stack(scroll.content, colW);
      t.sections.forEach((sec, i) => renderSection(ctx, sec, s, colW, i === 0 ? 0 : SECTION_GAP));
      if (tab === tabs.length - 1) {
        const gameVersion = ctx.config.version ?? '1.0.0';
        s.add(body(`${gameVersion}.${PACKAGE_VERSION.split('.').join('')}`, 16, C.grey500), s.y ? SECTION_GAP : 0);
      }
      root.addChild(scroll);
      scroll.setViewport(colW, viewH);
    },
  });

  function select(i: number): void {
    if (i === tab) return;
    tab = i;
    panel.resize(ctx.screenW, ctx.screenH);
  }

  return Object.assign(panel, {
    onKey(e: KeyboardEvent): boolean {
      switch (e.code) {
        case 'ArrowUp':
          scroll?.scrollBy(-STEP);
          return true;
        case 'ArrowDown':
          scroll?.scrollBy(STEP);
          return true;
        case 'PageUp':
          scroll?.scrollBy(-viewH * 0.9);
          return true;
        case 'PageDown':
          scroll?.scrollBy(viewH * 0.9);
          return true;
        case 'ArrowLeft':
        case 'ArrowRight':
          if (tabs.length < 2) return false;
          select((tab + (e.code === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length);
          return true;
      }
      return false;
    },
  });
}

/** Sections sorted (as S: `order`, else modes first, the rest in declaration order; controls before
 *  hotkeys) and split into the tabs — CONTROLS takes controls + hotkeys, RULES the custom sections; an
 *  empty tab is dropped. */
function buildTabs(ctx: BmCtx): Tab[] {
  const all = ctx.config.gameInfo.sections ?? [];
  // hotkeys off (jurisdiction / touchscreen): no keyboard to document, a game-supplied section too
  const keys = ctx.config.features.hotkeys !== false;
  const sections: GameInfoSection[] = keys ? [...all] : all.filter((s) => s.type !== 'hotkeys');
  if (keys && !sections.some((s) => s.type === 'hotkeys')) sections.push({ type: 'hotkeys' });
  const key = (s: GameInfoSection, i: number): number =>
    s.order ?? (s.type === 'modes' ? -2 : s.type === 'controls' ? 1e6 : s.type === 'hotkeys' ? 1e6 + 1 : i);
  const sorted = sections
    .map((s, i) => ({ s, i, k: key(s, i) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.s);
  const kindOf = (s: GameInfoSection): TabKind =>
    s.type === 'paytable' || s.type === 'wins'
      ? 'paytable'
      : s.type === 'modes'
        ? 'modes'
        : s.type === 'controls' || s.type === 'hotkeys'
          ? 'controls'
          : 'rules';
  const tabs: Tab[] = (
    [
      ['paytable', 'Paytable'],
      ['modes', 'Modes'],
      ['controls', 'Controls'],
      ['rules', 'Rules'],
    ] as const
  ).map(([kind, label]) => ({ kind, label: ctx.t(label), sections: sorted.filter((s) => kindOf(s) === kind) }));
  const shown = tabs.filter((t) => t.sections.length);
  return shown.length ? shown : [tabs[3]]; // nothing at all: RULES with just the version
}

// ── layout helper ────────────────────────────────────────────────────────────
interface Stack {
  readonly y: number;
  /** Append `n` below the last node after `gap`, centred in the column or flush left. */
  add<T extends Container>(n: T, gap?: number, center?: boolean): T;
}

function stack(c: Container, w: number): Stack {
  let y = 0;
  return {
    get y() {
      return y;
    },
    add(n, gap = 0, center = true) {
      y += gap;
      const b = n.getLocalBounds();
      n.position.set((center ? (w - b.width) / 2 : 0) - b.x, y - b.y);
      c.addChild(n);
      y += b.height;
      return n;
    },
  };
}

function heading(s: Stack, text: string, gap: number): void {
  s.add(display(text, TYPE.tab), gap);
}

/** Description copy: body 20, paper at 80%, centred. */
function copy(text: string, w: number): Container {
  const t = body(text, 20, C.paper, { wrap: w, align: 'center' });
  t.alpha = 0.8;
  return t;
}

function renderSection(ctx: BmCtx, sec: GameInfoSection, s: Stack, w: number, gap: number): void {
  switch (sec.type) {
    case 'paytable':
      if (sec.title) {
        heading(s, sec.title, gap);
        gap = 24;
      }
      s.add(paytable(ctx, sec.rows, w, sec.amounts), gap);
      return;
    case 'wins':
      wins(ctx, sec, s, w, gap);
      return;
    case 'modes':
      if (sec.title) {
        heading(s, sec.title, gap);
        gap = 24;
      }
      sec.modes.forEach((m, i) => modeBlock(ctx, m, s, w, i ? 36 : gap));
      return;
    case 'controls':
      heading(s, sec.title ?? ctx.t('Controls'), gap);
      s.add(controls(ctx, w), 16);
      return;
    case 'hotkeys':
      heading(s, sec.title ?? ctx.t('Hotkeys'), gap);
      s.add(hotkeys(ctx, w), 16);
      return;
    case 'custom':
      if (sec.title != null) {
        heading(s, ctx.t(sec.title), gap);
        gap = 16;
      }
      if (sec.node) s.add(borrow(sec.node as Container), gap);
      else if (sec.html) {
        const text = sec.html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text) s.add(body(text, TYPE.body, C.paper, { wrap: w, align: 'center' }), gap);
      }
      return;
  }
}

// ── paytable ─────────────────────────────────────────────────────────────────
const IMG = 96;
const PT_ROW = 26;

function paytable(ctx: BmCtx, rows: PaytableRow[], w: number, amounts?: boolean): Container {
  const grid = new Container();
  const cellW = w / 3;
  let y = 0;
  for (let i = 0; i < rows.length; i += 3) {
    let rowH = 0;
    rows.slice(i, i + 3).forEach((r, j) => {
      const card = paytableCard(ctx, r, cellW, amounts);
      card.position.set(j * cellW + cellW / 2, y);
      grid.addChild(card);
      rowH = Math.max(rowH, card.height);
    });
    y += rowH + 48;
  }
  return grid;
}

/** A symbol card centred on x = 0: image 96, name display 22, then count (grey400) ↔ win (lime). */
function paytableCard(ctx: BmCtx, r: PaytableRow, cellW: number, amounts?: boolean): Container {
  const c = new Container();
  let y = 0;
  if (r.symbol.image) {
    const img = imageBox(r.symbol.image, IMG, IMG);
    img.position.set(-IMG / 2, 0);
    c.addChild(img);
    y = IMG + 8;
  }
  if (r.symbol.text) {
    const name = fitWidth(display(r.symbol.text, 22), cellW - 16);
    name.position.set(-name.width / 2, y);
    c.addChild(name);
    y += name.height + 6;
  }
  const tw = Math.min(cellW - 32, 200);
  r.wins.forEach((win) => {
    const count = body(win.count ?? '', TYPE.tableCount, C.grey400);
    const mult = num(amounts ? ctx.formatCurrency(win.multiplier * ctx.state.bet, true) : `×${win.multiplier}`, TYPE.tableMult, C.lime);
    fitWidth(mult, tw * 0.7);
    count.position.set(-tw / 2, y + (PT_ROW - count.height) / 2);
    mult.position.set(tw / 2 - mult.width, y + (PT_ROW - mult.height) / 2);
    c.addChild(count, mult);
    y += PT_ROW;
  });
  return c;
}

/** A fixed box that loads an image into it (contain-fit) once the texture resolves. */
function imageBox(url: string, w: number, h: number): Container {
  const c = new Container();
  c.addChild(new Graphics().rect(0, 0, w, h).fill({ color: 0, alpha: 0 }));
  Assets.load(url)
    .then((tex: Texture) => {
      if (c.destroyed) return;
      const sp = new Sprite(tex);
      const k = Math.min(w / tex.width, h / tex.height);
      sp.scale.set(k);
      sp.position.set((w - tex.width * k) / 2, (h - tex.height * k) / 2);
      c.addChild(sp);
    })
    .catch(() => {
      /* missing image → empty box */
    });
  return c;
}

// ── wins ─────────────────────────────────────────────────────────────────────
const WIN_TITLE: Record<WinSection['kind'], string> = {
  classic: 'Paylines',
  cluster: 'Cluster pays',
  anywhere: 'Pays anywhere',
  ways: 'Ways to win',
  shapes: 'Winning shapes',
};

function wins(ctx: BmCtx, sec: WinSection, s: Stack, w: number, gap: number): void {
  heading(s, sec.title ?? ctx.t(WIN_TITLE[sec.kind]), gap);
  const desc = (): void => {
    if (sec.description) s.add(copy(sec.description, w), 16);
  };
  if (sec.kind === 'classic') {
    desc();
    const itemW = 140;
    const g = 24;
    const cols = Math.max(1, Math.floor((w + g) / (itemW + g)));
    const lines = sec.lines;
    for (let i = 0; i < lines.length; i += cols) {
      const row = new Container();
      lines.slice(i, i + cols).forEach((line, j) => {
        const def: PaylineDef = Array.isArray(line) ? { pattern: line } : line;
        const item = new Container();
        const n = num(String(i + j + 1), 16, C.grey400);
        n.position.set((itemW - n.width) / 2, 0);
        const ill = gridIllustration(sec.grid, def.pattern.map((r, c): CellRef => [c, r]), itemW);
        ill.y = n.height + 6;
        item.addChild(n, ill);
        item.x = j * (itemW + g);
        row.addChild(item);
      });
      s.add(row, i ? g : 20);
    }
  } else if (sec.kind === 'cluster' || sec.kind === 'anywhere') {
    s.add(metaLine([[ctx.t('Min'), String(sec.minCount)]], w), 12);
    const ex = sec.example ?? (sec.kind === 'cluster' ? clusterExample(sec.grid, sec.minCount) : anywhereExample(sec.grid, sec.minCount));
    s.add(gridIllustration(sec.grid, ex, Math.min(w, 240)), 20);
    desc();
  } else if (sec.kind === 'shapes') {
    desc();
    sec.shapes.forEach((sh) => {
      const row = new Container();
      const ill = gridIllustration(sec.grid, sh.cells, 120);
      const tx = 120 + 24;
      const name = fitWidth(display(sh.name, 22), w - tx);
      name.x = tx;
      row.addChild(ill, name);
      if (sh.description) {
        const d = body(sh.description, 18, C.grey400, { wrap: w - tx });
        d.position.set(tx, name.height + 4);
        row.addChild(d);
      }
      s.add(row, 20, false);
    });
  } else {
    desc();
    const colW = Math.min(200, w);
    const both = colW * 2 + 40 <= w;
    const col = (tag: string, color: number, cells: CellRef[]): Container => {
      const c = new Container();
      const t = display(tag, 18, color);
      t.position.set((colW - t.width) / 2, 0);
      const ill = gridIllustration(sec.grid, cells, colW);
      ill.y = t.height + 8;
      c.addChild(t, ill);
      return c;
    };
    const win = col(`✓ ${ctx.t('Wins')}`, C.lime, sec.winExample ?? waysWin(sec.grid));
    const lose = col(`✗ ${ctx.t('No win')}`, C.grey400, sec.loseExample ?? waysLose(sec.grid));
    if (both) {
      const row = new Container();
      lose.x = colW + 40;
      row.addChild(win, lose);
      s.add(row, 20);
    } else {
      s.add(win, 20);
      s.add(lose, 20);
    }
  }
}

/** A cols×rows grid of rounded squares: lit cells lime, the rest grey700. */
function gridIllustration(grid: Grid, on: CellRef[], width: number): Container {
  const cell = width / grid.cols;
  const gap = Math.max(2, cell * 0.1);
  const lit = new Set(on.map(([c, r]) => `${c},${r}`));
  const g = new Graphics();
  for (let y = 0; y < grid.rows; y++)
    for (let x = 0; x < grid.cols; x++)
      g.roundRect(x * cell + gap / 2, y * cell + gap / 2, cell - gap, cell - gap, cell * 0.18).fill(lit.has(`${x},${y}`) ? C.lime : C.grey700);
  return g;
}

function clusterExample(grid: Grid, n: number): CellRef[] {
  const w = Math.min(grid.cols, Math.max(1, Math.ceil(Math.sqrt(n))));
  const cells: CellRef[] = [];
  for (let y = 0; y < grid.rows && cells.length < n; y++) for (let x = 0; x < w && cells.length < n; x++) cells.push([x, y]);
  return cells;
}
function anywhereExample(grid: Grid, n: number): CellRef[] {
  const count = Math.min(n, grid.cols * grid.rows);
  const cells: CellRef[] = [];
  for (let i = 0; i < count; i++) cells.push([Math.floor((i * grid.cols) / count), (i * 2 + 1) % grid.rows]);
  return cells;
}
function waysWin(grid: Grid): CellRef[] {
  const cells: CellRef[] = [];
  for (let c = 0; c < grid.cols; c++) cells.push([c, c % grid.rows]);
  return cells;
}
function waysLose(grid: Grid): CellRef[] {
  const gap = Math.floor(grid.cols / 2);
  return waysWin(grid).filter(([c]) => c !== gap);
}

// ── modes ────────────────────────────────────────────────────────────────────
function modeBlock(ctx: BmCtx, m: GameMode, s: Stack, w: number, gap: number): void {
  s.add(fitWidth(display(m.title, TYPE.tab), w), gap);
  const pairs: Array<[string, string]> = [];
  if (m.price != null) pairs.push([ctx.t('Price'), m.price]);
  if (typeof m.rtp === 'number') pairs.push([ctx.t('RTP'), `${m.rtp}%`]);
  if (m.maxWin != null) pairs.push([ctx.t('Max win'), m.maxWin]);
  if (pairs.length) s.add(metaLine(pairs, w), 6);
  if (m.description) s.add(copy(m.description, w), 8);
}

/** «LABEL value» pairs (label body 16 grey400 caps, value num 18 lime), packed into centred lines no
 *  wider than `w` — a minimal flex-wrap. */
function metaLine(pairs: Array<[string, string]>, w: number): Container {
  const GAP = 28;
  const cells = pairs.map(([label, value]) => {
    const c = new Container();
    const l = body(label.toUpperCase(), TYPE.caption, C.grey400);
    const v = num(value, TYPE.tableMult, C.lime);
    const h = Math.max(l.height, v.height);
    l.y = (h - l.height) / 2;
    v.position.set(l.width + 8, (h - v.height) / 2);
    c.addChild(l, v);
    return c;
  });
  const out = new Container();
  const lines: Container[][] = [[]];
  let lineW = 0;
  for (const c of cells) {
    if (lineW > 0 && lineW + GAP + c.width > w) {
      lines.push([]);
      lineW = 0;
    }
    lines[lines.length - 1].push(c);
    lineW += (lineW > 0 ? GAP : 0) + c.width;
  }
  const ls = stack(out, w);
  for (const cs of lines) {
    const line = new Container();
    let x = 0;
    for (const c of cs) {
      c.x = x;
      x += c.width + GAP;
      line.addChild(c);
    }
    ls.add(line, ls.y ? 6 : 0);
  }
  return out;
}

// ── controls / hotkeys ───────────────────────────────────────────────────────
// Rows flush left inside one block; the caller centres the block in the column.
function controls(ctx: BmCtx, w: number): Container {
  const f = ctx.config.features;
  const rows: Array<[IconName, string, string, boolean]> = [
    ['spin', 'Spin', 'Start a spin at the current bet.', true],
    ['plus', 'Raise bet', 'Increase your stake.', true],
    ['minus', 'Lower bet', 'Decrease your stake.', true],
    ['autoplay', 'Autoplay', 'Spin automatically a set number of times.', f.autoplay != null],
    ['turbo', 'Turbo', 'Speed up spin animations.', f.turbo > 0],
    ['buy', 'Buy bonus', 'Pay a fixed cost to enter a bonus feature.', f.buyBonus !== false],
    ['menu', 'Menu', 'Open settings and game info.', true],
    ['sound-on', 'Sound', 'Mute or unmute the game.', true],
    ['music', 'Music', 'Mute or unmute the music.', true],
    ['info', 'Game info', 'Open the paytable and rules.', true],
    ['close', 'Close', 'Dismiss the current overlay.', true],
  ];
  const TX = 64;
  const out = new Container();
  const s = stack(out, w);
  rows
    .filter((r) => r[3])
    .forEach(([icon, name, desc], i) => {
      const row = new Container();
      const g = glyph(icon, 40, icon === 'spin' || icon === 'buy' ? C.lime : C.paper);
      g.position.set(20, 22);
      const n = fitWidth(display(ctx.t(name), 22), w - TX);
      n.x = TX;
      const d = body(ctx.t(desc), 18, C.grey400, { wrap: w - TX });
      d.position.set(TX, n.height + 2);
      row.addChild(g, n, d);
      s.add(row, i ? 18 : 0, false);
    });
  return out;
}

function hotkeys(ctx: BmCtx, w: number): Container {
  const f = ctx.config.features;
  const out = new Container();
  const s = stack(out, w);
  const rows: Array<[string[], string, boolean]> = [
    [['Space'], 'Spin', true],
    [['Shift', '↑', '/', 'Shift', '='], 'Raise bet', true],
    [['Shift', '↓', '/', 'Shift', '-'], 'Lower bet', true],
    [['Shift', 'A'], 'Autoplay', f.autoplay != null],
    [['Shift', 'T'], 'Turbo', f.turbo > 0],
    [['Shift', 'B'], 'Buy bonus', f.buyBonus !== false],
    [['Shift', 'I'], 'Game info', true],
    [['Shift', 'S'], 'Menu', true],
    [['Shift', 'M'], 'Mute', true],
    [['←', '→'], 'Navigate', true],
    [['Enter'], 'Confirm', true],
    [['Esc'], 'Close', true],
  ];
  const visible = rows.filter((r) => r[2]);
  const chips = visible.map(([keys]) => chipRow(keys));
  const chipCol = Math.min(w * 0.55, Math.max(...chips.map((c) => c.width)));
  chips.forEach((c, i) => {
    if (c.width > chipCol) c.scale.set(chipCol / c.width);
    const row = new Container();
    const n = fitWidth(display(ctx.t(visible[i][1]), 22), w - chipCol - 32);
    const h = Math.max(c.height, n.height);
    c.y = (h - c.height) / 2;
    n.position.set(chipCol + 32, (h - n.height) / 2);
    row.addChild(c, n);
    s.add(row, i ? 12 : 0, false);
  });
  return out;
}

/** Key chips (num 16 on a grey700 rounded rect); '/' between combos as grey400 copy. */
function chipRow(keys: string[]): Container {
  const c = new Container();
  let x = 0;
  for (const k of keys) {
    if (k === '/') {
      const sl = body('/', 16, C.grey400);
      sl.position.set(x, 4);
      c.addChild(sl);
      x += sl.width + 6;
      continue;
    }
    const t = num(k, 16);
    const cw = Math.max(36, t.width + 20);
    const ch = t.height + 8;
    const plate = new Graphics().roundRect(0, 0, cw, ch, 6).fill(C.grey700);
    plate.x = x;
    t.position.set(x + (cw - t.width) / 2, 4);
    c.addChild(plate, t);
    x += cw + 6;
  }
  return c;
}

// ── custom node ──────────────────────────────────────────────────────────────
/** Borrow a GAME-owned custom `node`: the panel is torn down with `destroy({ children: true })` on
 *  every resize / close, which would destroy the game's node; this slot detaches it instead, so the
 *  same node re-mounts intact on the next open. */
function borrow(node: Container): Container {
  const slot = new Container();
  slot.addChild(node);
  const destroySelf = Container.prototype.destroy.bind(slot);
  slot.destroy = () => {
    if (node.parent === slot) slot.removeChild(node);
    destroySelf({ children: false });
  };
  return slot;
}
