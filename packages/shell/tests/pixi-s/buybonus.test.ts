import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Assets, Container, FillGradient, Graphics, Point, Sprite, Texture } from 'pixi.js';
import { openSBuyBonus, SBuyBonusPage } from '@/ui/pixi-s/components/BuyBonus';
import { stripMetrics } from '@/ui/pixi-s/primitives/page';
import { ScrollBox } from '@/ui/pixi-hb/primitives/scroll';
import { SReadout, SBet } from '@/ui/pixi-s/widgets';
import { Slab } from '@/ui/pixi-s/slab';
import { makeContext, defaultConfig } from '../pixi/_host';

const OPTIONS = [
  { id: 'a1', type: 'feature', groupedBy: 'ante', title: 'Warrior', description: 'w', priceMultiplier: 1.25, volatility: 2 },
  { id: 'a2', type: 'feature', groupedBy: 'ante', title: 'Mage', description: 'm', priceMultiplier: 1.25, volatility: 4 },
  { id: 'fs', type: 'bonus', title: 'Free spins', description: 'f', priceMultiplier: 10, volatility: 5 },
];
/** Four slots: a four-member ante group, a feature and two bonuses. */
const FOUR = [
  { id: 'w', type: 'feature', groupedBy: 'ante', title: 'Warrior Ante', description: 'Wilds hit harder', priceMultiplier: 1.25, volatility: 2 },
  { id: 'm', type: 'feature', groupedBy: 'ante', title: 'Mage Ante', description: 'Random multipliers', priceMultiplier: 1.25, volatility: 4 },
  { id: 'a', type: 'feature', groupedBy: 'ante', title: 'Archer Ante', description: 'Extra scatter', priceMultiplier: 1.25, volatility: 3 },
  { id: 'p', type: 'feature', groupedBy: 'ante', title: 'Priest Ante', description: 'A respin', priceMultiplier: 1.25, volatility: 1 },
  { id: 'boost', type: 'feature', title: 'Reel Boost', description: 'Boosted reels for the next 5 spins', priceMultiplier: 5, volatility: 3 },
  { id: 'fs', type: 'bonus', title: 'Buy Free Spins', description: '10 free spins, instant', priceMultiplier: 10, volatility: 5 },
  { id: 'sfs', type: 'bonus', title: 'Super Free Spins', description: '15 free spins with a guaranteed wild', priceMultiplier: 25, volatility: 4 },
];
function page(over: Record<string, unknown> = {}, buyBonus: unknown[] = OPTIONS) {
  const emit = vi.fn();
  const host = makeContext({ emit, screenW: 1280, screenH: 720, config: defaultConfig({ balance: 1000, features: { turbo: 0, autoplay: false, buyBonus } }), ...over });
  return { host, emit, page: openSBuyBonus(host) as SBuyBonusPage };
}
function byType<T>(n: Container, type: new (...a: never[]) => T, out: T[] = []): T[] {
  if (n instanceof type) out.push(n);
  for (const c of n.children) byType(c as Container, type, out);
  return out;
}
function byLabel(n: Container, label: string | RegExp, out: Container[] = []): Container[] {
  if (typeof label === 'string' ? n.label === label : label.test(n.label)) out.push(n);
  for (const c of n.children) byLabel(c as Container, label, out);
  return out;
}
const one = (n: Container, label: string): Container => byLabel(n, label)[0];

interface Parts {
  stage: Container;
  veil: Graphics;
  scroll: ScrollBox;
  band: Container;
  confirm?: unknown;
  cardEm(h: number): number;
  cardSize(): { w: number; h: number };
}
const parts = (p: SBuyBonusPage): Parts => p as unknown as Parts;
/** Card-local layout facts, from the size `buildCard` was given. */
function zone(p: SBuyBonusPage) {
  const { h } = parts(p).cardSize();
  const em = parts(p).cardEm(h);
  const pad = em * 1.2;
  const fade = one(p, 'bb-fade').getLocalBounds();
  return { h, em, pad, titleTop: Math.round(0.4 * h), zoneBottom: fade.y + fade.height, fade };
}

afterEach(() => vi.restoreAllMocks());

describe('S buy bonus page', () => {
  it('R1: the BUY BONUS plate and ✕ sit in the screen corners', () => {
    const { page: p } = page();
    const strip = stripMetrics(720);
    expect(p.titlePlate!.x).toBeCloseTo(strip.top, 0);
    expect((p as unknown as { closeBtn: { x: number } }).closeBtn.x + strip.height).toBeCloseTo(1280 - strip.top - ScrollBox.GUTTER, 0);
  });

  it('one card per slot; ‹ › flips a grouped slot through its members with wrap', () => {
    const { page: p } = page();
    expect(p.slots.length).toBe(2);
    expect(p.current(0).id).toBe('a1');
    one(p, 'bb-next-0').emit('pointertap', {});
    expect(p.current(0).id).toBe('a2');
    one(p, 'bb-next-0').emit('pointertap', {});
    expect(p.current(0).id).toBe('a1');
    one(p, 'bb-prev-0').emit('pointertap', {});
    expect(p.current(0).id).toBe('a2');
    expect(byLabel(p, 'bb-next-1').length).toBe(0); // a single option has no arrows
  });

  it('feature cards get the red ACTIVATE CTA, bonus cards the accent BUY', () => {
    const { page: p } = page();
    expect([p.ctas[0].labelText.text, p.ctas[0].kind]).toEqual(['ACTIVATE', 'red']);
    expect([p.ctas[1].labelText.text, p.ctas[1].kind]).toEqual(['BUY', 'accent']);
  });

  it('tapping a CTA opens the confirm; Enter commits it', () => {
    const { page: p, emit, host } = page();
    const closeLayer = vi.spyOn(host, 'closeLayer');
    p.ctas[1].emit('pointertap', {});
    expect(parts(p).confirm).toBeDefined();
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('buyBonusSelect', { id: 'fs' });
    expect(closeLayer).toHaveBeenCalled();
  });

  it('I3: while the confirm is open the list, band, title plate and ✕ are hidden; Escape brings them back', () => {
    const { page: p } = page();
    const q = p as unknown as { scroll: Container; band: Container; titlePlate: Container; closeBtn: Container; confirm?: unknown };
    const shown = () => [q.scroll.visible, q.band.visible, q.titlePlate.visible, q.closeBtn.visible];
    expect(shown()).toEqual([true, true, true, true]);
    p.ctas[1].emit('pointertap', {});
    expect(q.confirm).toBeDefined();
    expect(shown()).toEqual([false, false, false, false]);
    p.onKey({ code: 'Escape' } as KeyboardEvent);
    expect(q.confirm).toBeUndefined();
    expect(shown()).toEqual([true, true, true, true]);
    p.ctas[1].emit('pointertap', {});
    p.resize(1280, 720); // a resize drops the confirm and rebuilds the page — visible again
    expect(shown()).toEqual([true, true, true, true]);
  });

  it('an unaffordable option disables its CTA', () => {
    const { page: p, host } = page();
    host.state.balance = 1;
    (p as unknown as { rebuild(): void }).rebuild();
    expect(p.ctas[1].disabled).toBe(true);
  });

  it('a BUY BONUS title plate; the hero face is red for a feature, yellow for a bonus', () => {
    const { page: p } = page();
    expect(p.titlePlate!.labelText.text).toBe('BUY BONUS');
    expect(byLabel(p, 'bb-hero-red').length).toBe(1);
    expect(byLabel(p, 'bb-hero-yellow').length).toBe(1);
  });

  it('on a phone the balance readout ends before the bet slab starts', () => {
    const { page: p } = page({ screenW: 390, screenH: 844, layout: 'mobile' });
    const [balance] = byType(p, SReadout);
    const [bet] = byType(p, SBet);
    expect(balance.x + balance.measureSize().w).toBeLessThanOrEqual(bet.x);
  });

  // ── the portrait row ──────────────────────────────────────────────────────
  it('aspect: every card body is half as wide as it is tall (and ≤ 0.62 of a phone)', () => {
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      const { page: p } = page({ screenW: w, screenH: h }, FOUR);
      const bodies = byLabel(p, 'bb-body');
      expect(bodies.length).toBe(4);
      for (const b of bodies) {
        const r = b.getLocalBounds();
        expect(Math.abs(r.width - r.height / 2)).toBeLessThanOrEqual(1);
        if (w === 390) expect(r.width).toBeLessThanOrEqual(0.62 * 390 + 1);
      }
    }
  });

  it('fits, so centred: four slots at 1280×720 (and one slot) do not scroll and sit in the middle', () => {
    for (const opts of [FOUR, [FOUR[5]]]) {
      const { page: p } = page({}, opts);
      expect(parts(p).scroll.maxScrollY).toBe(0);
      const bodies = byLabel(p, 'bb-body').map((b) => b.getBounds());
      const left = Math.min(...bodies.map((b) => b.x));
      const right = 1280 - Math.max(...bodies.map((b) => b.x + b.width));
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    }
  });

  it('overflows, so it peeks: on a phone the second card is cut by the viewport edge', () => {
    const { page: p } = page({ screenW: 390, screenH: 844, layout: 'mobile' });
    const { scroll } = parts(p);
    expect(scroll.maxScrollY).toBeGreaterThan(0);
    const viewRight = scroll.x + (scroll as unknown as { viewW: number }).viewW;
    const second = one(p, 'bb-card-1');
    const x = scroll.x + second.x;
    expect(x).toBeLessThan(viewRight);
    expect(x + parts(p).cardSize().w).toBeGreaterThan(viewRight);
  });

  it('card order: hero, fade over the title zone, title in it, then volatility < price < CTA at the bottom', () => {
    const { page: p } = page();
    const card = one(p, 'bb-card-1'); // the free-spins card, no thumbnail
    const z = zone(p);
    expect(z.fade.y).toBeCloseTo(z.titleTop, 5);
    const fade = one(card, 'bb-fade') as Graphics;
    const fill = fade.context.instructions.find((i) => i.action === 'fill')!;
    expect((fill.data.style as { fill: unknown }).fill).toBeInstanceOf(FillGradient);
    const local = (n: Container) => {
      const b = n.getBounds();
      const o = card.getGlobalPosition();
      return { top: b.y - o.y, bottom: b.y + b.height - o.y };
    };
    expect(local(one(card, 'bb-hero-yellow')).bottom).toBeLessThanOrEqual(z.zoneBottom + 0.5);
    const title = local(one(card, 'bb-title'));
    expect(title.top).toBeGreaterThanOrEqual(z.titleTop - 0.5);
    expect(title.bottom).toBeLessThanOrEqual(z.zoneBottom + 0.5);
    const vol = local(one(card, 'bb-vol'));
    const price = local(one(card, 'bb-price'));
    const cta = p.ctas[1];
    expect(vol.bottom).toBeLessThan(price.top);
    expect(price.top).toBeLessThan(cta.y);
    expect(Math.abs(cta.y + cta.slab.h - (z.h - z.pad))).toBeLessThanOrEqual(1);
    // z-order: hero under the fade, the title over it
    const idx = (n: Container) => card.getChildIndex(n);
    expect(idx(one(card, 'bb-hero'))).toBeLessThan(idx(fade));
    expect(idx(fade)).toBeLessThan(idx(one(card, 'bb-title')));
  });

  it('‹ › sit at the title zone centre; next ×4 wraps a four-member group', () => {
    const { page: p } = page({}, FOUR);
    const z = zone(p);
    const mid = z.titleTop + (z.zoneBottom - z.titleTop) / 2;
    for (const l of ['bb-prev-0', 'bb-next-0']) {
      const b = one(p, l) as unknown as { y: number; measureSize(): { h: number } };
      expect(Math.abs(b.y + b.measureSize().h / 2 - mid)).toBeLessThanOrEqual(1);
    }
    for (let i = 0; i < 4; i++) one(p, 'bb-next-0').emit('pointertap', {});
    expect(p.current(0).id).toBe('w');
  });

  it('no band backing: every Graphics in the band belongs to a plate', () => {
    const { page: p } = page();
    const inPlate = (n: Container): boolean => !!n.parent && (n.parent instanceof Slab || n.parent instanceof SReadout || n.parent instanceof SBet || inPlate(n.parent));
    const gs = byType(parts(p).band, Graphics);
    expect(gs.length).toBeGreaterThan(0);
    for (const g of gs) expect(inPlate(g)).toBe(true);
  });

  it('a thumbnail resolving after a rebuild is dropped, not added to the destroyed card', async () => {
    let resolve!: (t: Texture) => void;
    const load = new Promise<Texture>((r) => (resolve = r));
    vi.spyOn(Assets, 'load').mockReturnValue(load as never);
    const { page: p } = page({}, [{ ...OPTIONS[2], thumbnail: '/art.svg' }]);
    const stale = one(p, 'bb-thumb');
    p.resize(1280, 720);
    expect(stale.destroyed).toBe(true);
    resolve(Texture.WHITE);
    await load;
    await Promise.resolve();
    expect(stale.children.length).toBe(0);
    expect(byType(p, Sprite).length).toBe(1); // the live card got its art
  });

  it('drag then tap: a CTA released after dragging the row does not open the confirm', () => {
    const { page: p } = page({ screenW: 390, screenH: 844, layout: 'mobile' });
    const { scroll } = parts(p);
    scroll.emit('pointerdown', { global: new Point(200, 400) } as never);
    scroll.emit('globalpointermove', { global: new Point(160, 400) } as never);
    scroll.emit('pointerup', { global: new Point(160, 400) } as never);
    p.ctas[1].emit('pointertap', {});
    expect(parts(p).confirm).toBeUndefined();
  });

  it('keys: → scrolls one card, Shift+↑ steps the bet', () => {
    const { page: p, host } = page({ screenW: 390, screenH: 844, layout: 'mobile' }, FOUR);
    const { scroll } = parts(p);
    const before = scroll.content.x;
    expect(p.onKey({ code: 'ArrowRight' } as KeyboardEvent)).toBe(true);
    expect(scroll.content.x).toBeCloseTo(before - (parts(p).cardSize().w + 14), 5);
    p.onKey({ code: 'ArrowLeft' } as KeyboardEvent);
    expect(scroll.content.x).toBeCloseTo(before, 5);
    const bet = host.state.bet;
    p.onKey({ code: 'ArrowUp', shiftKey: true } as KeyboardEvent);
    expect(host.state.bet).toBeGreaterThan(bet);
  });

  it('short screen: 400×225 scales the page by 225/440 and keeps it on screen', () => {
    const { page: p } = page({ screenW: 400, screenH: 225 }, FOUR);
    const { stage, band, scroll, veil } = parts(p);
    expect(stage.scale.x).toBeCloseTo(225 / 440, 5);
    for (const n of [...byLabel(p, /^bb-card-/), band]) {
      const b = n.getBounds();
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height).toBeLessThanOrEqual(225);
    }
    const x0 = scroll.getGlobalPosition().x;
    const x1 = x0 + (scroll as unknown as { viewW: number }).viewW * stage.scale.x;
    expect(x0).toBeGreaterThanOrEqual(0);
    expect(x1).toBeLessThanOrEqual(400);
    const v = veil.getBounds();
    expect([v.x, v.y, v.width, v.height]).toEqual([0, 0, 400, 225]);
  });
});
