import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import { Container, Graphics, Point, type Rectangle } from 'pixi.js';
import { SButton } from '@/ui/pixi-s/widgets';
import { stripMetrics, closeCorner, SPage } from '@/ui/pixi-s/primitives/page';
import { SCardModal } from '@/ui/pixi-s/primitives/card';
import { STextButton, STitlePlate } from '@/ui/pixi-s/primitives/controls';
import { openSBuyBonus } from '@/ui/pixi-s/components/BuyBonus';
import { openSBetPicker, openSAutoplayPicker, type SPicker } from '@/ui/pixi-s/components/pickers';
import { buildSModal } from '@/ui/pixi-s/components/Modal';
import { buildSReplayModal } from '@/ui/pixi-s/components/ReplayModal';
import { S } from '@/ui/pixi-s/theme';
import { sBody } from '@/ui/pixi-s/text';
import { makeContext, defaultConfig } from '../pixi/_host';

function all<T>(n: Container, cls: abstract new (...a: never[]) => T, out: T[] = []): T[] {
  if (n instanceof cls) out.push(n as T);
  for (const c of n.children) all(c as Container, cls, out);
  return out;
}

describe('S card modal', () => {
  it('R3: no backing panel; the title plate is centred over the content; ✕ in the screen top-right corner', () => {
    const host = makeContext({ screenW: 1280, screenH: 720 });
    const m = new SCardModal(host, { title: 'Bet', onClose: () => {} });
    m.build();
    const root = m.children.find((c) => c !== m.closeBtn && (c as Container).children?.includes(m.body)) as Container;
    const panels = (root.children as Container[]).filter((c) => c instanceof Graphics && c.context.instructions.length > 0);
    expect(panels).toEqual([]);
    expect(m.titlePlate!.labelText.text).toBe('BET');
    expect(m.body.children.length).toBe(0); // the title is not a body row (§5.6)
    const t = m.titlePlate!;
    expect(t.x + t.measureSize().w / 2).toBeCloseTo(m.cardWidth / 2, 0);
    const c = closeCorner(1280, 720);
    expect(m.closeBtn!.parent).toBe(m);
    expect(m.closeBtn!.x).toBeCloseTo(c.x, 0);
    expect(m.closeBtn!.y).toBeCloseTo(c.y, 0);
  });

  it('R3: the ✕ plate is at least 44 (it is its own hit area)', () => {
    const m = new SCardModal(makeContext({ screenW: 390, screenH: 844 }), { title: 't', onClose: () => {} });
    m.build();
    expect((m.closeBtn as SButton).measureSize().w).toBeGreaterThanOrEqual(44);
  });

  it('an empty title draws no title plate', () => {
    const m = new SCardModal(makeContext(), { title: '  ', onClose: () => {} });
    m.build();
    expect(m.titlePlate).toBeUndefined();
    expect(all(m, STitlePlate)).toEqual([]);
  });

  it('R3: resize() rebuilds ✕ at the new strip size and inset', () => {
    const m = new SCardModal(makeContext({ screenW: 1280, screenH: 720 }), { title: 'Bet', onClose: () => {} });
    m.build();
    m.resize(390, 844);
    const c = closeCorner(390, 844);
    const b = m.closeBtn as unknown as SButton;
    expect(b.parent).toBe(m);
    expect(b.measureSize().w).toBe(Math.round(stripMetrics(390, 844).height));
    expect(b.x).toBeCloseTo(c.x, 0);
    expect(b.y).toBeCloseTo(c.y, 0);
  });

  it('M2: resize() at the laid-out size keeps the ✕ (a bar-driven resize mid-press must not destroy it)', () => {
    const m = new SCardModal(makeContext({ screenW: 1280, screenH: 720 }), { title: 'Bet', onClose: () => {} });
    m.build();
    const before = m.closeBtn;
    m.resize(1280, 720);
    expect(m.closeBtn === before).toBe(true); // identity (a failing toBe would serialise the pixi tree)
    expect(before!.destroyed).toBe(false);
  });

  it('fit(): a tall body on a short screen scales the content block down and keeps it on screen', () => {
    const host = makeContext({ screenW: 400, screenH: 225 });
    const m = new SCardModal(host, { title: 'Long', onClose: () => {} });
    for (let i = 0; i < 12; i++) m.body.add(new Graphics().rect(0, 0, 100, 40).fill(0xffffff));
    m.build();
    const root = m.children.find((c) => c !== m.closeBtn && (c as Container).children?.includes(m.body)) as Container;
    expect(root.scale.x).toBeLessThan(1);
    const bb = root.getBounds();
    expect(bb.y).toBeGreaterThanOrEqual(0);
    expect(bb.y + bb.height).toBeLessThanOrEqual(225);
    expect(bb.x).toBeGreaterThanOrEqual(0);
    expect(bb.x + bb.width).toBeLessThanOrEqual(400);
  });

  it('not closable: no ✕', () => {
    const m = new SCardModal(makeContext(), { title: 'Replay', closable: false });
    m.build();
    expect(m.closeBtn).toBeUndefined();
  });

  it('actions become S text buttons by kind', () => {
    const m = new SCardModal(makeContext(), { title: 't', onClose: () => {} });
    m.setActions([
      { label: 'Cancel', kind: 'ghost', onTap: () => {} },
      { label: 'Buy', kind: 'accent', onTap: () => {} },
      { label: 'Activate', kind: 'red', onTap: () => {} },
    ]);
    m.build();
    expect(all(m, STextButton).map((b) => b.kind)).toEqual(['ghost', 'accent', 'red']);
  });
});

describe('S pickers, modal, replay', () => {
  it('on a phone the picker slider runs nearly edge to edge (the user: "по краям большие паддинги, должно быть прижато")', () => {
    for (const [w, h] of [[452, 812], [390, 844], [320, 568]]) {
      const p = openSBetPicker(makeContext({ screenW: w, screenH: h, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 1 }) })) as unknown as SPicker;
      const s = p.slider.getBounds();
      expect(s.width).toBeGreaterThanOrEqual(w - 64 - 1);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x + s.width).toBeLessThanOrEqual(w);
    }
    // desktop keeps its 620 cap
    const d = openSBetPicker(makeContext({ screenW: 1280, screenH: 720, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 1 }) })) as unknown as SPicker;
    expect(Math.round(d.slider.getBounds().width)).toBe(620);
  });

  it('bet picker: a stepped slider over the bet levels at the current bet; → then Enter confirms the next', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, screenW: 1280, screenH: 720, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 1 }) });
    const p = openSBetPicker(host) as unknown as SPicker;
    expect(p.slider.index).toBe(1);
    expect(p.valuePlate.labelText.text).toBe('€1.00');
    p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    expect(p.valuePlate.labelText.text).toBe('€2.00');
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('betChange', 2);
  });

  it('picker layout (R4): title plate centred, ✕ in the corner, value plate over the thumb within the slider, no backing', () => {
    const host = makeContext({ screenW: 1280, screenH: 720, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 0.5 }) });
    const p = openSBetPicker(host) as unknown as SPicker;
    expect(p.titlePlate.toGlobal(new Point(p.titlePlate.measureSize().w / 2, 0)).x).toBeCloseTo(640, 0);
    expect(p.titlePlate.measureSize().h).toBe(Math.round(stripMetrics(1280, 720).height)); // M1: the ✕'s height
    expect(p.closeBtn.x).toBeCloseTo(closeCorner(1280, 720).x, 0);
    const s = p.slider.getBounds();
    const v = p.valuePlate.getBounds();
    expect(v.x).toBeGreaterThanOrEqual(s.x - 0.5); // index 0: clamped to the slider's left end
    expect(v.y + v.height).toBeLessThanOrEqual(s.y);
    p.onKey({ code: 'End' } as KeyboardEvent); // not a picker key — ignored
    for (let i = 0; i < 5; i++) p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    const v2 = p.valuePlate.getBounds();
    expect(v2.x + v2.width).toBeLessThanOrEqual(s.x + s.width + 3.5); // last index: clamped (+ shadow)
  });

  it('I1: on a 400×226 screen the picker block fit-scales — CONFIRM and the title are on screen', () => {
    const host = makeContext({ screenW: 400, screenH: 226, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 1 }) });
    const p = openSBetPicker(host) as unknown as SPicker;
    for (const n of [p.confirm, p.titlePlate, p.slider, p.valuePlate]) {
      const b = n.getBounds();
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(400);
      expect(b.y + b.height).toBeLessThanOrEqual(226);
    }
    const s = p.slider.getBounds();
    const v = p.valuePlate.getBounds();
    expect(v.y + v.height).toBeLessThanOrEqual(s.y + 0.5); // the plate still rides above the slider
    const t = p.titlePlate.getBounds();
    expect(t.x + t.width).toBeLessThanOrEqual(p.closeBtn.x); // level with the ✕, the title keeps clear of it
    // on a phone the title sits well below the ✕, so it keeps its full 3h width
    const phone = openSBetPicker(makeContext({ screenW: 390, screenH: 844 })) as unknown as SPicker;
    expect(phone.titlePlate.measureSize().w).toBe(Math.round(3 * stripMetrics(390, 844).height));
  });

  it('I2: an off-list bet shows the nearest level; Confirm without moving keeps the bet; a step then confirms the level', () => {
    const emit = vi.fn();
    const config = defaultConfig({ availableBets: [0.2, 0.5, 1, 2, 5], defaultBet: 1 });
    const host = makeContext({ emit, screenW: 1280, screenH: 720, config });
    host.state.bet = 1_000_000;
    const p = openSBetPicker(host) as unknown as SPicker;
    expect(p.slider.index).toBe(4);
    expect(p.valuePlate.labelText.text).toBe('€5.00');
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).not.toHaveBeenCalledWith('betChange', expect.anything());
    expect(host.state.bet).toBe(1_000_000);
    const q = openSBetPicker(host) as unknown as SPicker;
    q.onKey({ code: 'ArrowRight' } as KeyboardEvent); // already at the end — still a deliberate step
    q.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('betChange', 5);
    host.state.bet = 0.7; // nearest is 0.5
    const r = openSBetPicker(host) as unknown as SPicker;
    expect(r.valuePlate.labelText.text).toBe('€0.50');
  });

  it('I2: the autoplay picker shows the nearest count; ∞ only when the remaining count is ∞', () => {
    const host = makeContext({ screenW: 1280, screenH: 720, config: defaultConfig({ features: { turbo: 0, autoplay: {}, buyBonus: false } }) });
    host.state.autoplay = { active: true, remaining: 37 };
    expect((openSAutoplayPicker(host) as unknown as SPicker).valuePlate.labelText.text).toBe('25');
    host.state.autoplay = { active: true, remaining: 5000 };
    expect((openSAutoplayPicker(host) as unknown as SPicker).valuePlate.labelText.text).toBe('2000');
    host.state.autoplay = { active: true, remaining: Infinity };
    expect((openSAutoplayPicker(host) as unknown as SPicker).valuePlate.labelText.text).toBe('∞');
  });

  it('M2: resize() at the laid-out size keeps the slider (a bar-driven resize mid-drag must not destroy it)', () => {
    const host = makeContext({ screenW: 1280, screenH: 720 });
    const p = openSBetPicker(host) as unknown as SPicker;
    const slider = p.slider;
    p.resize(1280, 720);
    expect(p.slider === slider).toBe(true);
    expect(slider.destroyed).toBe(false);
    p.resize(390, 844);
    expect(p.slider === slider).toBe(false);
  });

  it('autoplay picker: counts incl. ∞ on the slider; START confirms', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, screenW: 1280, screenH: 720, config: defaultConfig({ features: { turbo: 0, autoplay: {}, buyBonus: false } }) });
    const p = openSAutoplayPicker(host) as unknown as SPicker;
    expect(p.titlePlate.labelText.text).toBe('AUTOPLAY');
    (p.slider as unknown as { setFromX(x: number): void }).setFromX(1e6); // a drag to the far end
    expect(p.slider.index).toBe(8);
    expect(p.valuePlate.labelText.text).toBe('∞');
    p.confirm.emit('pointertap', {});
    expect(emit).toHaveBeenCalledWith('autoplayStart', { active: true, remaining: Infinity });
  });

  it('a single bet level: slider at the start, confirm still works', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, config: defaultConfig({ availableBets: [1], defaultBet: 1 }) });
    const p = openSBetPicker(host) as unknown as SPicker;
    expect(p.slider.index).toBe(0);
    p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    expect(p.slider.index).toBe(0);
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(host.state.bet).toBe(1);
  });

  it('generic modal: an action runs, then the modal closes', () => {
    const closeLayer = vi.fn();
    const on = vi.fn();
    const layer = buildSModal(makeContext({ closeLayer }), { title: 'Oops', body: 'Try again', actions: [{ title: 'OK', color: 'yellow', on }] } as never);
    all(layer, STextButton)[0].emit('pointertap', {});
    expect(on).toHaveBeenCalled();
    expect(closeLayer).toHaveBeenCalled();
  });

  it('replay: not closable; START REPLAY closes, runs onReplay, then reopens', async () => {
    const closeLayer = vi.fn();
    const reopen = vi.fn();
    const onReplay = vi.fn(() => Promise.resolve());
    const layer = buildSReplayModal(makeContext({ closeLayer }), { bonusId: 'x', bet: 1, payoutMultiplier: 2, onReplay }, reopen);
    expect((layer as SCardModal).closeBtn).toBeUndefined();
    all(layer, STextButton)[0].emit('pointertap', {});
    expect(closeLayer).toHaveBeenCalled();
    expect(onReplay).toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    expect(reopen).toHaveBeenCalled();
  });
});

describe('the strip scales with the screen\'s short side (the user, 2026-10-01: "заголовки в модалках и закрыть огромные" on popout S / Stake S / mobile S)', () => {
  it('small screens get a small strip; desktop keeps its size; the ✕ stays tappable', () => {
    expect(stripMetrics(1280, 720).top).toBeCloseTo(21.6, 5); // desktop: unchanged
    expect(stripMetrics(1280, 720).height).toBeCloseTo(64.8, 5);
    expect(stripMetrics(400, 225).height).toBe(30); // was 44 — a fifth of the screen
    expect(stripMetrics(480, 270).height).toBe(30);
    expect(stripMetrics(320, 568).height).toBeCloseTo(38.4, 5); // the short side rules a portrait phone
    expect(stripMetrics(390, 844).height).toBeCloseTo(46.8, 5);
    expect(stripMetrics(400, 225).top).toBe(8);
    // a small ✕ still has a 44px hit box
    const host = makeContext({ screenW: 400, screenH: 225 });
    const card = new SCardModal(host, { title: 'Bet', onClose: () => {} });
    card.build();
    const hit = (card.closeBtn as unknown as SButton).hitArea as Rectangle;
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
  });
});

describe('the shared ✕ corner (I4)', () => {
  it('card modal, pickers, the page and buy bonus put ✕ at closeCorner(), inboard of the scrollbar gutter', () => {
    for (const [W, H] of [[1280, 720], [390, 844], [400, 226]]) {
      const host = makeContext({
        screenW: W,
        screenH: H,
        config: defaultConfig({ balance: 1000, features: { turbo: 0, autoplay: {}, buyBonus: [{ id: 'fs', type: 'bonus', title: 'FS', description: 'd', priceMultiplier: 10 }] } }),
      });
      const card = new SCardModal(host, { title: 'Bet', onClose: () => {} });
      card.build();
      const page = new SPage(host, { tag: 'p', title: 'Info', onClose: () => {}, build: () => new Container() });
      const btns = [
        card.closeBtn!,
        (openSBetPicker(host) as unknown as SPicker).closeBtn,
        (openSAutoplayPicker(host) as unknown as SPicker).closeBtn,
        page.closeBtn!,
        (openSBuyBonus(host) as unknown as { closeBtn: Container }).closeBtn,
      ];
      const c = closeCorner(W, H);
      for (const b of btns) {
        expect(b.x).toBeCloseTo(c.x, 5);
        expect(b.y).toBeCloseTo(c.y, 5);
        expect((b as SButton).measureSize().w).toBe(Math.round(c.size));
      }
    }
  });
});
