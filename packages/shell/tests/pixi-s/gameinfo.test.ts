import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { openSGameInfo } from '@/ui/pixi-s/components/GameInfo';
import { SPage, pageColumn, stripMetrics } from '@/ui/pixi-s/primitives/page';
import { STitlePlate } from '@/ui/pixi-s/primitives/controls';
import { ScrollBox } from '@/ui/pixi-hb/primitives/scroll';
import { S } from '@/ui/pixi-s/theme';
import { makeContext, defaultConfig } from '../pixi/_host';

function all<T>(n: Container, cls: abstract new (...a: never[]) => T, out: T[] = []): T[] {
  if (n instanceof cls) out.push(n as T);
  for (const c of n.children) all(c as Container, cls, out);
  return out;
}
function byLabel(n: Container, label: string, out: Container[] = []): Container[] {
  if (n.label === label) out.push(n);
  for (const c of n.children) byLabel(c as Container, label, out);
  return out;
}
const PAYTABLE = (n: number) => ({
  type: 'paytable',
  rows: Array.from({ length: n }, (_, i) => ({ symbol: { text: `S${i}` }, wins: [{ count: '5', multiplier: 10 * (i + 1) }] })),
});
function info(sections: unknown[], over: Record<string, unknown> = {}): SPage {
  const host = makeContext({ screenW: 1280, screenH: 720, config: defaultConfig({ gameInfo: { sections }, features: { turbo: 2, autoplay: {}, buyBonus: [], hotkeys: false } }), ...over });
  return openSGameInfo(host) as SPage;
}

describe('S game info page', () => {
  it('R1: title plate top-left corner, ✕ top-right corner (clear of the scrollbar), scroll area the whole screen', () => {
    const p = info([PAYTABLE(3)]);
    expect(p.veil.hitArea).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
    expect(p.titlePlate!.labelText.text).toBe('GAME INFO');
    const strip = stripMetrics(720);
    expect(p.titlePlate!.x).toBeCloseTo(strip.top, 0);
    expect(p.titlePlate!.y).toBeCloseTo(strip.top, 0);
    expect(p.closeBtn!.x + strip.height).toBeCloseTo(1280 - strip.top - ScrollBox.GUTTER, 0);
    expect([p.scrollContent.x, p.scrollContent.y]).toEqual([0, 0]);
    expect(p.getChildIndex(p.closeBtn!)).toBeGreaterThan(p.getChildIndex(p.scrollContent));
    const col = pageColumn(1280, 720);
    const content = p.scrollContent.content.children[0] as Container;
    expect(content.x).toBeCloseTo((1280 - ScrollBox.GUTTER - col.width) / 2, 0);
    expect(content.y).toBeGreaterThanOrEqual(strip.top + strip.height);
  });

  it('section titles are yellow title plates', () => {
    const p = info([PAYTABLE(3), { type: 'controls' }]);
    const plates = all(p.scrollContent.content, STitlePlate);
    expect(plates.map((t) => t.labelText.text)).toEqual(expect.arrayContaining(['PAYTABLE', 'CONTROLS']));
    for (const t of plates) expect(t.slab.face).toBe(S.yellow);
  });

  it('section title plates are centred in the column (wins too, with a cluster badge)', () => {
    const p = info([
      PAYTABLE(3),
      { type: 'wins', kind: 'classic', grid: { cols: 5, rows: 3 }, lines: [[1, 1, 1, 1, 1]] },
      { type: 'wins', kind: 'cluster', title: 'Clusters', grid: { cols: 6, rows: 5 }, minCount: 8 },
    ]);
    const col = pageColumn(1280, 720);
    const cx = col.x + col.width / 2;
    const plates = all(p.scrollContent.content, STitlePlate);
    expect(plates.length).toBeGreaterThanOrEqual(3);
    for (const t of plates) {
      const g = t.getGlobalPosition().x;
      const sibs = t.parent!.children as Container[];
      const badge = t.labelText.text === 'CLUSTERS' ? sibs[sibs.indexOf(t) + 1] : undefined;
      const left = g;
      const right = badge ? badge.getGlobalPosition().x + badge.width : g + t.slab.w;
      expect(Math.abs((left + right) / 2 - cx)).toBeLessThanOrEqual(1.5);
    }
  });

  it('R2: no backing panels anywhere in the content', () => {
    const p = info([PAYTABLE(3), { type: 'controls' }, { type: 'modes', modes: [{ title: 'Base', description: 'd' }] }]);
    const bg: unknown[] = [];
    const walk = (n: Container): void => {
      const style = (n as unknown as { bgStyle?: { fill?: string } }).bgStyle;
      if (style?.fill) bg.push(style.fill);
      n.children.forEach((c) => walk(c as Container));
    };
    walk(p.scrollContent.content);
    expect(bg).toEqual([]);
  });

  it('R2: controls has no GAME / MENU & INFO sub-headings', () => {
    const p = info([{ type: 'controls' }]);
    const texts: string[] = [];
    const walk = (n: Container): void => {
      const t = (n as unknown as { text?: string }).text;
      if (typeof t === 'string') texts.push(t);
      n.children.forEach((c) => walk(c as Container));
    };
    walk(p.scrollContent.content);
    expect(texts).not.toContain('GAME');
    expect(texts).not.toContain('MENU & INFO');
    expect(texts).toContain('SPIN');
  });

  it('the paytable is always 3 per row across the column: 7 rows → 3, 3, 1, each card a third', () => {
    const p = info([PAYTABLE(7)]);
    const width = pageColumn(1280, 720).width;
    const rows = byLabel(p.scrollContent.content, 'pt-row');
    expect(rows.map((r) => byLabel(r, 'pt-card').length)).toEqual([3, 3, 1]);
    const cards = byLabel(p.scrollContent.content, 'pt-card') as unknown as Array<{ measureSize(): { w: number } }>;
    for (const c of cards) expect(c.measureSize().w).toBeCloseTo((width - 24) / 3, 1);
  });

  it('I5: each paytable wins column is at most 120 wide and centred in its card', () => {
    for (const [W, H] of [[1280, 720], [390, 844]]) {
      const p = info([PAYTABLE(4)], { screenW: W, screenH: H });
      const cards = byLabel(p.scrollContent.content, 'pt-card') as unknown as Array<Container & { measureSize(): { w: number } }>;
      expect(cards.length).toBe(4);
      for (const card of cards) {
        const [wins] = byLabel(card, 'pt-wins') as unknown as Array<Container & { measureSize(): { w: number } }>;
        const ww = wins.measureSize().w;
        expect(ww).toBeLessThanOrEqual(120);
        expect(Math.abs(wins.x + ww / 2 - card.measureSize().w / 2)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('a 2-row paytable keeps third-width cards, left-aligned', () => {
    const p = info([PAYTABLE(2)]);
    const width = pageColumn(1280, 720).width;
    const cards = byLabel(p.scrollContent.content, 'pt-card') as unknown as Array<{ x: number; measureSize(): { w: number } }>;
    expect(cards.length).toBe(2);
    expect(cards[0].measureSize().w).toBeCloseTo((width - 24) / 3, 1);
    expect(cards[0].x).toBeCloseTo(0, 0);
  });

  it('no sections: still a titled page with ✕', () => {
    const p = info([]);
    expect(p.titlePlate).toBeDefined();
    expect(p.closeBtn).toBeDefined();
  });

  it('✕ closes; scroll keys are consumed, Escape is left to the controller', () => {
    const closeLayer = vi.fn();
    const p = info([PAYTABLE(30)], { closeLayer });
    p.closeBtn!.emit('pointertap', {});
    expect(closeLayer).toHaveBeenCalled();
    expect(p.onKey({ code: 'ArrowDown' } as KeyboardEvent)).toBe(true);
    expect(p.onKey({ code: 'End' } as KeyboardEvent)).toBe(true);
    expect(p.onKey({ code: 'Escape' } as KeyboardEvent)).toBe(false);
  });
});

describe('S game info on a phone', () => {
  const LONG = 'An extraordinarily long section title that cannot possibly fit on a phone';
  it('a long section title plate stays inside the column; a cluster badge too', () => {
    const host = makeContext({
      screenW: 390,
      screenH: 844,
      layout: 'mobile',
      config: defaultConfig({
        gameInfo: { sections: [{ type: 'custom', title: LONG, html: 'x' }, { type: 'wins', kind: 'cluster', title: LONG, grid: { cols: 6, rows: 5 }, minCount: 8 }] },
        features: { turbo: 2, autoplay: {}, buyBonus: [], hotkeys: false },
      }),
    });
    const p = openSGameInfo(host) as SPage;
    const col = pageColumn(390, 844);
    const right = col.x + col.width;
    const plates = all(p.scrollContent.content, STitlePlate).filter((t) => t.labelText.text === LONG.toUpperCase());
    expect(plates.length).toBe(2);
    for (const t of plates) expect(t.getGlobalPosition().x + t.slab.w).toBeLessThanOrEqual(right);
    const wins = plates[1];
    const header = wins.parent!;
    const badge = header.children[header.children.indexOf(wins) + 1] as Container;
    expect(badge).toBeDefined();
    expect(badge.getGlobalPosition().x + badge.width).toBeLessThanOrEqual(right);
  });
});
