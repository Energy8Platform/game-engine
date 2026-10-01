import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Assets, Container, FillGradient, Graphics, Point, Sprite, Texture, type Ticker } from 'pixi.js';
import { openSBuyBonus, SBuyBonusPage } from '@/ui/pixi-s/components/BuyBonus';
import { stripMetrics, closeCorner } from '@/ui/pixi-s/primitives/page';
import { ScrollBox } from '@/ui/pixi-hb/primitives/scroll';
import { SReadout, SBet } from '@/ui/pixi-s/widgets';
import { Slab, SHADOW_OFFSET } from '@/ui/pixi-s/slab';
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
  titlePlate: Container;
  closeBtn: Container;
  flyer?: Container;
  actions?: Container;
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
    const strip = stripMetrics(1280, 720);
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
    expect(parts(p).flyer).toBeDefined();
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('buyBonusSelect', { id: 'fs' });
    expect(closeLayer).toHaveBeenCalled();
  });

  it('I3: while the confirm is open nothing under the flyer shows but the ✕', () => {
    const { page: p } = page();
    const q = parts(p);
    p.ctas[1].emit('pointertap', {});
    const shown = (n: Container) => n.visible && n.alpha > 0;
    const onPage = p.children.filter((c) => c !== q.veil && c !== q.stage && shown(c as Container));
    expect(onPage.map((c) => c === q.closeBtn)).toEqual([true]);
    expect(q.stage.children.filter((c) => c !== q.flyer && c !== q.actions && shown(c as Container)).length).toBe(0);
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
  it('aspect: every card body is half as wide as it is tall (and ≤ 0.70 of a phone)', () => {
    for (const [w, h] of [[1280, 720], [390, 844]]) {
      const { page: p } = page({ screenW: w, screenH: h }, FOUR);
      const bodies = byLabel(p, 'bb-body');
      expect(bodies.length).toBe(4);
      for (const b of bodies) {
        const r = b.getLocalBounds();
        expect(Math.abs(r.width - r.height / 2)).toBeLessThanOrEqual(1);
        if (w === 390) expect(Math.abs(r.width - 0.7 * 390)).toBeLessThanOrEqual(1); // the width cap binds on a phone
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

  it('the band\'s plates line up with the card row\'s edges — no extra inset now the panel is gone', () => {
    for (const [w, h] of [[452, 812], [390, 844], [1280, 720]]) {
      const { page: p } = page({ screenW: w, screenH: h });
      const { band } = parts(p);
      const plates = band.children[0].children as Container[]; // [balance, bet]
      const left = plates[0].getBounds().x;
      const right = plates[1].getBounds().x + plates[1].getBounds().width;
      if (w < 900) {
        // the row overflows on a phone, so its first card sits at the row's left edge; the row is symmetric
        const rowLeft = one(p, 'bb-card-0').getBounds().x;
        expect(Math.abs(left - rowLeft)).toBeLessThan(4);
        expect(Math.abs(right - (w - rowLeft))).toBeLessThan(6); // the slab shadow pokes out a few px
      } else {
        expect(right - left).toBeGreaterThan(0);
      }
    }
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
    expect(parts(p).flyer).toBeUndefined();
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

  it('short screen: the ✕ and the BUY BONUS plate stay at screen size, in the screen corners', () => {
    const { page: p } = page({ screenW: 400, screenH: 225 }, FOUR);
    const q = p as unknown as { closeBtn: Container; titlePlate: Container; stage: Container };
    const c = closeCorner(400, 225);
    const b = q.closeBtn.getBounds();
    expect(b.x).toBeCloseTo(c.x, 5);
    expect(b.y).toBeCloseTo(c.y, 5);
    expect(b.width - SHADOW_OFFSET).toBeCloseTo(Math.round(c.size), 5);
    const plate = q.titlePlate.getBounds();
    expect(plate.y).toBeCloseTo(stripMetrics(400, 225).top, 5);
    // above the scaled stage, and the row starts under the plate
    expect(p.getChildIndex(q.closeBtn)).toBeGreaterThan(p.getChildIndex(q.stage));
    expect(p.getChildIndex(q.titlePlate)).toBeGreaterThan(p.getChildIndex(q.stage));
    for (const card of byLabel(p, /^bb-card-/)) expect(card.getBounds().y).toBeGreaterThanOrEqual(plate.y + plate.height - SHADOW_OFFSET);
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

describe('S buy bonus: the fly-in confirm', () => {
  const realMM = (globalThis as { matchMedia?: unknown }).matchMedia;
  afterEach(() => {
    (globalThis as { matchMedia?: unknown }).matchMedia = realMM;
  });
  /** FOUR at 1280×720 (k = 1) on a manual ticker, with motion on. */
  function animated(over: Record<string, unknown> = {}) {
    (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });
    const fns = new Set<(t: { deltaMS: number }) => void>();
    const ticker = { add: (f: never) => fns.add(f), remove: (f: never) => fns.delete(f) } as unknown as Ticker;
    const tick = (ms: number) => {
      for (let t = 0; t < ms; t += 50) for (const f of [...fns]) f({ deltaMS: 50 });
    };
    return { ...page({ ticker, ...over }, FOUR), tick };
  }
  /** Where the flyer lands at 1280×720 (k = 1, spec §3): between the ✕ strip and the bottom margin. */
  function target(p: SBuyBonusPage) {
    const { w, h } = parts(p).cardSize();
    const em = parts(p).cardEm(h);
    const strip = stripMetrics(1280, 720);
    const m = strip.top;
    const top = strip.top * 2 + strip.height;
    const s = Math.min(1.3, (720 - top - m) / h, (1280 - 2 * m) / w);
    return { w, h, s, em, pad: em * 1.2, top, m };
  }
  const flyer = (p: SBuyBonusPage) => byLabel(p, 'bb-flyer')[0];
  const actions = (p: SBuyBonusPage) => byLabel(p, 'bb-confirm-actions')[0];
  const alphas = (p: SBuyBonusPage) => [parts(p).scroll.alpha, parts(p).band.alpha, parts(p).titlePlate.alpha];

  it('open: the card flies to the centre and grows, the page fades, then CANCEL | BUY fade in and take taps', () => {
    const { page: p, tick } = animated();
    const q = parts(p);
    const card = one(p, 'bb-card-2');
    const cta = p.ctas[2];
    const from = q.stage.toLocal(card.getGlobalPosition());
    const t = target(p);
    one(p, 'bb-cta-2').emit('pointertap', {});
    tick(150);
    const f = flyer(p);
    expect(f.scale.x).toBeGreaterThan(1);
    expect(f.scale.x).toBeLessThan(t.s);
    const toX = (1280 - t.w * t.s) / 2;
    expect((f.x - from.x) * (toX - f.x)).toBeGreaterThan(0); // strictly between start and target
    expect(!actions(p) || actions(p).eventMode === 'none').toBe(true);
    tick(150);
    tick(150);
    expect(Math.abs(f.x + (t.w * f.scale.x) / 2 - 640)).toBeLessThanOrEqual(1);
    expect(f.scale.x).toBeCloseTo(t.s, 5);
    expect(alphas(p)).toEqual([0, 0, 0]);
    expect(q.closeBtn.visible).toBe(true);
    expect(q.closeBtn.alpha).toBe(1);
    expect(card.visible).toBe(false);
    expect(one(f, 'bb-cta-2').visible).toBe(false); // the copy's own CTA
    expect(p.ctas[2]).toBe(cta); // still the row card's
    expect(Math.abs(f.y + (t.h * f.scale.x) / 2 - (t.top + 720 - t.m) / 2)).toBeLessThanOrEqual(1);
    const a = actions(p);
    expect([a.alpha, a.eventMode]).toEqual([1, 'passive']);
    // CANCEL | BUY replace the CTA inside the flyer, in card units: (cardW − 2·pad − em/2) / 2 each
    const fcta = one(f, 'bb-cta-2');
    expect(a.parent === f).toBe(true);
    expect([a.x, a.y]).toEqual([fcta.x, fcta.y]);
    const [cancel, buy] = a.children as unknown as Array<{ x: number; measureSize(): { w: number; h: number }; kind: string }>;
    const bw = (t.w - 2 * t.pad - t.em * 0.5) / 2;
    expect(Math.abs(cancel.measureSize().w - bw)).toBeLessThanOrEqual(1); // slabs round their size
    expect(buy.x).toBeCloseTo(bw + t.em * 0.5, 5);
    expect(Math.abs(cancel.measureSize().h - t.em * 2.8)).toBeLessThanOrEqual(1);
    expect([cancel.kind, buy.kind]).toEqual(['dim', 'accent']); // a ghost is bare text on the black card
    // the rest of the flyer takes no taps
    expect(f.children.filter((c) => c !== a).every((c) => c.eventMode === 'none')).toBe(true);
  });

  it('cancel: Escape flies it back over 250ms; a second cancel mid-way is a no-op; the ✕ cancels, not closes', () => {
    const { page: p, host, tick } = animated();
    const closeLayer = vi.spyOn(host, 'closeLayer');
    const card = one(p, 'bb-card-2');
    p.ctas[2].emit('pointertap', {});
    tick(450);
    p.onKey({ code: 'Escape' } as KeyboardEvent);
    expect(actions(p)).toBeUndefined(); // the row goes at once
    tick(100);
    expect(flyer(p)).toBeDefined();
    p.onKey({ code: 'Escape' } as KeyboardEvent);
    tick(150);
    expect(flyer(p)).toBeUndefined();
    expect(card.destroyed).toBe(true); // the end of a cancel rebuilds the page
    expect(one(p, 'bb-card-2').visible).toBe(true);
    expect(alphas(p)).toEqual([1, 1, 1]);
    // the ✕ during the confirm
    p.ctas[2].emit('pointertap', {});
    tick(450);
    parts(p).closeBtn.emit('pointertap', {});
    tick(250);
    expect(flyer(p)).toBeUndefined();
    expect(closeLayer).not.toHaveBeenCalled();
  });

  it('reduced motion (no matchMedia): open and cancel land at once', () => {
    const { page: p } = page({}, FOUR);
    const t = target(p);
    p.ctas[2].emit('pointertap', {});
    expect(flyer(p).scale.x).toBeCloseTo(t.s, 5);
    expect(alphas(p)).toEqual([0, 0, 0]);
    expect([actions(p).alpha, actions(p).eventMode]).toEqual([1, 'passive']);
    p.ctas[3].emit('pointertap', {}); // another card's CTA while one is out does nothing
    expect(byLabel(p, 'bb-flyer').length).toBe(1);
    p.onKey({ code: 'Escape' } as KeyboardEvent);
    expect(flyer(p)).toBeUndefined();
    expect(alphas(p)).toEqual([1, 1, 1]);
    expect(one(p, 'bb-card-2').visible).toBe(true);
  });

  it('Enter mid-tween commits exactly once; later ticks do not throw', () => {
    const { page: p, host, emit, tick } = animated();
    const closeLayer = vi.spyOn(host, 'closeLayer');
    p.ctas[2].emit('pointertap', {});
    tick(100);
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(() => tick(600)).not.toThrow();
    expect(emit.mock.calls.filter(([e]) => e === 'buyBonusSelect')).toEqual([['buyBonusSelect', { id: 'fs' }]]);
    expect(closeLayer).toHaveBeenCalledTimes(1);
  });

  it('the CANCEL button cancels', () => {
    const { page: p } = page({}, FOUR);
    p.ctas[2].emit('pointertap', {});
    actions(p).children[0].emit('pointertap', {});
    expect(flyer(p)).toBeUndefined();
    expect(actions(p)).toBeUndefined();
  });

  it('a same-size resize (a bar refresh) keeps an open confirm and its tweens', () => {
    const { page: p, tick } = animated();
    p.ctas[2].emit('pointertap', {});
    tick(150);
    const f = flyer(p);
    p.resize(1280, 720);
    expect(flyer(p) === f).toBe(true);
    tick(300);
    expect(actions(p)?.eventMode).toBe('passive');
    p.resize(1200, 675);
    expect(byLabel(p, 'bb-flyer').length).toBe(0);
  });

  it('F1: a same-size resize after a state change drops the stale confirm and rebuilds', () => {
    const cases: Array<[string, (s: Record<string, unknown>) => void]> = [
      ['bet', (s) => (s.bet = 2)],
      ['balance', (s) => (s.balance = 5)],
      ['busy', (s) => (s.busy = true)],
      ['buyBonusEnabled', (s) => (s.buyBonusEnabled = false)],
      ['activeFeature', (s) => (s.activeFeature = FOUR[4])],
    ];
    for (const [name, mutate] of cases) {
      const { page: p, host, tick } = animated();
      p.ctas[2].emit('pointertap', {});
      tick(450);
      expect(flyer(p), name).toBeDefined();
      mutate(host.state as unknown as Record<string, unknown>);
      p.resize(1280, 720);
      expect(byLabel(p, 'bb-flyer').length, name).toBe(0);
      expect(byLabel(p, 'bb-confirm-actions').length, name).toBe(0);
      expect(alphas(p), name).toEqual([1, 1, 1]);
      for (const c of byLabel(p, /^bb-card-/)) expect(c.visible, name).toBe(true);
      expect(() => tick(600)).not.toThrow();
      expect(byLabel(p, 'bb-flyer').length, name).toBe(0);
    }
  });

  it('F2: the wheel does not scroll the hidden row during a confirm', () => {
    const canvas = document.createElement('canvas');
    const { page: p, tick } = animated({ screenW: 390, screenH: 844, layout: 'mobile', canvas });
    expect(parts(p).scroll.maxScrollY).toBeGreaterThan(0);
    p.ctas[1].emit('pointertap', {});
    const wheel = () => {
      const e = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
      canvas.dispatchEvent(e);
      return e;
    };
    tick(150); // mid-flight: the row still draws at half alpha
    const x = parts(p).scroll.content.x;
    expect(wheel().defaultPrevented).toBe(true);
    expect(parts(p).scroll.content.x).toBe(x);
    tick(300); // fully open: the row is hidden
    wheel();
    expect(parts(p).scroll.content.x).toBe(x);
  });

  it('F4: the flyer shows no ‹ › and its CANCEL is a dim plate', () => {
    const { page: p } = page({}, FOUR);
    p.ctas[0].emit('pointertap', {}); // the four-member ante group has ‹ ›
    const f = flyer(p);
    const shown = (n: Container | null): boolean => !n || (n.visible && shown(n.parent));
    expect(byLabel(f, /^bb-(prev|next)-/).length).toBeGreaterThan(0); // built, then hidden
    expect(byLabel(f, /^bb-(prev|next)-/).filter((n) => shown(n)).length).toBe(0);
    const [cancel] = actions(p).children as unknown as Array<{ kind: string }>;
    expect(cancel.kind).toBe('dim');
  });

  it('resize while open drops the confirm without animation', () => {
    const { page: p, tick } = animated();
    p.ctas[2].emit('pointertap', {});
    tick(150);
    p.resize(1200, 675);
    const check = () => {
      expect(byLabel(p, 'bb-flyer').length).toBe(0);
      expect(byLabel(p, 'bb-confirm-actions').length).toBe(0);
      expect(alphas(p)).toEqual([1, 1, 1]);
      for (const c of byLabel(p, /^bb-card-/)) expect(c.visible).toBe(true);
    };
    check();
    expect(() => tick(600)).not.toThrow();
    check();
  });

  it('the feature card confirms with a red ACTIVATE', () => {
    const { page: p } = page({}, FOUR);
    p.ctas[1].emit('pointertap', {});
    const ok = actions(p).children[1] as unknown as { kind: string; labelText: { text: string } };
    expect([ok.kind, ok.labelText.text]).toEqual(['red', 'ACTIVATE']);
  });

  it('on a phone the flyer clears the ✕ strip and stays on screen', () => {
    const { page: p } = page({ screenW: 390, screenH: 844, layout: 'mobile' });
    p.ctas[0].emit('pointertap', {});
    const f = flyer(p).getBounds();
    const x = parts(p).closeBtn.getBounds();
    const hit = f.x < x.x + x.width && x.x < f.x + f.width && f.y < x.y + x.height && x.y < f.y + f.height;
    expect(hit).toBe(false);
    expect(f.x).toBeGreaterThanOrEqual(0);
    expect(f.y + f.height).toBeLessThanOrEqual(844);
  });

  it('a custom hero borrowed by the flyer is back in its row card after a cancel', () => {
    const node = new Container();
    node.addChild(new Graphics().rect(0, 0, 40, 40).fill(0xffffff));
    const { page: p } = page({}, [{ ...OPTIONS[2], custom: () => node }]);
    p.ctas[0].emit('pointertap', {});
    p.onKey({ code: 'Escape' } as KeyboardEvent);
    const card = one(p, 'bb-card-0');
    let n: Container | null = node;
    while (n && n !== card) n = n.parent;
    expect(n === card).toBe(true);
  });
});

describe('S buy bonus: a rebuild keeps the row scrolled', () => {
  it('a bet step keeps the row where it was', () => {
    const { page: p } = page({ screenW: 390, screenH: 844, layout: 'mobile' }, FOUR);
    p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    const x = parts(p).scroll.content.x;
    expect(x).toBeLessThan(0);
    one(p, 'bb-bet-up').emit('pointertap', {});
    expect(Math.abs(parts(p).scroll.content.x - x)).toBeLessThanOrEqual(1);
  });
});
