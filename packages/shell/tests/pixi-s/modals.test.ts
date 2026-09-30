import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import { Graphics, type Container } from 'pixi.js';
import { SButton } from '@/ui/pixi-s/widgets';
import { stripMetrics } from '@/ui/pixi-s/primitives/page';
import { SCardModal } from '@/ui/pixi-s/primitives/card';
import { SChip, STextButton, STitlePlate } from '@/ui/pixi-s/primitives/controls';
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
    const strip = stripMetrics(720);
    expect(m.closeBtn!.parent).toBe(m);
    expect(m.closeBtn!.x + strip.height).toBeCloseTo(1280 - strip.top, 0);
    expect(m.closeBtn!.y).toBeCloseTo(strip.top, 0);
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
    const strip = stripMetrics(844);
    const b = m.closeBtn as unknown as SButton;
    expect(b.parent).toBe(m);
    expect(b.measureSize().w).toBe(strip.height);
    expect(b.x + strip.height).toBeCloseTo(390 - strip.top, 0);
    expect(b.y).toBeCloseTo(strip.top, 0);
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
  it('bet picker: a stepped slider over the bet levels at the current bet; → then Enter confirms the next', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, screenW: 1280, screenH: 720, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 1 }) });
    const p = openSBetPicker(host) as unknown as SPicker;
    expect(p.slider.index).toBe(1);
    expect(p.valuePlate.labelText.text).toBe('€1.00');
    expect(all(p, SChip).length).toBe(0); // no chips any more
    p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    expect(p.valuePlate.labelText.text).toBe('€2.00');
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('betChange', 2);
  });

  it('picker layout (R4): title plate centred, ✕ in the corner, value plate over the thumb within the slider, no backing', () => {
    const host = makeContext({ screenW: 1280, screenH: 720, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 0.5 }) });
    const p = openSBetPicker(host) as unknown as SPicker;
    expect(p.titlePlate.x + p.titlePlate.measureSize().w / 2).toBeCloseTo(640, 0);
    const strip = stripMetrics(720);
    expect(p.closeBtn.x + p.closeBtn.measureSize().w).toBeCloseTo(1280 - strip.top, 0);
    const s = p.slider.getBounds();
    const v = p.valuePlate.getBounds();
    expect(v.x).toBeGreaterThanOrEqual(s.x - 0.5); // index 0: clamped to the slider's left end
    expect(v.y + v.height).toBeLessThanOrEqual(s.y);
    p.onKey({ code: 'End' } as KeyboardEvent); // not a picker key — ignored
    for (let i = 0; i < 5; i++) p.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    const v2 = p.valuePlate.getBounds();
    expect(v2.x + v2.width).toBeLessThanOrEqual(s.x + s.width + 3.5); // last index: clamped (+ shadow)
  });

  it('autoplay picker: counts incl. ∞ on the slider; START confirms', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, screenW: 1280, screenH: 720, config: defaultConfig({ features: { turbo: 0, autoplay: {}, buyBonus: false } }) });
    const p = openSAutoplayPicker(host) as unknown as SPicker;
    expect(p.titlePlate.labelText.text).toBe('AUTOPLAY');
    p.slider.setIndex(8);
    (p as unknown as { sync(): void }).sync();
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
