import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import { Graphics, type Container } from 'pixi.js';
import { SButton } from '@/ui/pixi-s/widgets';
import { stripMetrics } from '@/ui/pixi-s/primitives/page';
import { SCardModal } from '@/ui/pixi-s/primitives/card';
import { SChip, STextButton, STitlePlate } from '@/ui/pixi-s/primitives/controls';
import { openSBetPicker, openSAutoplayPicker } from '@/ui/pixi-s/components/pickers';
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
  it('bet picker: one S chip per bet, the current one selected (yellow); Enter confirms', () => {
    const emit = vi.fn();
    const host = makeContext({ emit, config: defaultConfig({ availableBets: [0.5, 1, 2, 5], defaultBet: 1 }) });
    const layer = openSBetPicker(host) as unknown as { onKey(e: KeyboardEvent): boolean } & Container;
    const chips = all(layer, SChip);
    expect(chips.map((c) => c.id)).toEqual(['0.5', '1', '2', '5']);
    expect(chips.filter((c) => c.selected).map((c) => c.id)).toEqual(['1']);
    expect(chips[1].labelText.style.fill).toBe(S.ink);
    layer.onKey({ code: 'ArrowRight' } as KeyboardEvent);
    layer.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('betChange', 2);
  });

  it('autoplay picker: counts as chips; the title plate says AUTOPLAY', () => {
    const host = makeContext({ config: defaultConfig({ features: { turbo: 0, autoplay: {}, buyBonus: false } }) });
    const layer = openSAutoplayPicker(host);
    expect(all(layer, SChip).length).toBeGreaterThan(3);
    expect(all(layer, STitlePlate)[0].labelText.text).toBe('AUTOPLAY');
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
