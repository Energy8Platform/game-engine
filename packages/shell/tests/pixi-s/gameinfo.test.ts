import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { openSGameInfo } from '@/ui/pixi-s/components/GameInfo';
import { SPage, pageColumn, stripMetrics } from '@/ui/pixi-s/primitives/page';
import { STitlePlate } from '@/ui/pixi-s/primitives/controls';
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
  it('covers the whole screen; title plate at the column left, ✕ at the column right', () => {
    const p = info([PAYTABLE(3)]);
    expect(p.veil.hitArea).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
    const col = pageColumn(1280, 720);
    expect(p.titlePlate!.x).toBeCloseTo(col.x, 0);
    expect(p.titlePlate!.labelText.text).toBe('GAME INFO');
    expect(p.closeBtn!.x + stripMetrics(720).height).toBeCloseTo(col.x + col.width, 0);
  });

  it('section titles are yellow title plates', () => {
    const p = info([PAYTABLE(3), { type: 'controls' }]);
    const plates = all(p.scrollContent.content, STitlePlate);
    expect(plates.map((t) => t.labelText.text)).toEqual(expect.arrayContaining(['PAYTABLE', 'CONTROLS']));
    for (const t of plates) expect(t.slab.face).toBe(S.yellow);
  });

  it('a wins section title plate sits at the column left, like the paytable plate', () => {
    const p = info([PAYTABLE(3), { type: 'wins', kind: 'classic', grid: { cols: 5, rows: 3 }, lines: [[1, 1, 1, 1, 1]] }]);
    const plates = all(p.scrollContent.content, STitlePlate);
    const pay = plates.find((t) => t.labelText.text === 'PAYTABLE')!;
    const wins = plates.find((t) => t.labelText.text === 'PAYLINES')!;
    expect(wins.getGlobalPosition().x).toBeCloseTo(pay.getGlobalPosition().x, 0);
  });

  it('the paytable is always 3 per row across the column: 7 rows → 3, 3, 1, each card a third', () => {
    const p = info([PAYTABLE(7)]);
    const width = pageColumn(1280, 720).width;
    const rows = byLabel(p.scrollContent.content, 'pt-row');
    expect(rows.map((r) => byLabel(r, 'pt-card').length)).toEqual([3, 3, 1]);
    const cards = byLabel(p.scrollContent.content, 'pt-card') as unknown as Array<{ measureSize(): { w: number } }>;
    for (const c of cards) expect(c.measureSize().w).toBeCloseTo((width - 24) / 3, 1);
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
