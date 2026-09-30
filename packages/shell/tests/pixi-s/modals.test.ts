import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { SCardModal } from '@/ui/pixi-s/primitives/card';
import { SChip, STextButton, STitlePlate } from '@/ui/pixi-s/primitives/controls';
import { openSBetPicker, openSAutoplayPicker } from '@/ui/pixi-s/components/pickers';
import { buildSModal } from '@/ui/pixi-s/components/Modal';
import { buildSReplayModal } from '@/ui/pixi-s/components/ReplayModal';
import { S } from '@/ui/pixi-s/theme';
import { makeContext, defaultConfig } from '../pixi/_host';

function all<T>(n: Container, cls: abstract new (...a: never[]) => T, out: T[] = []): T[] {
  if (n instanceof cls) out.push(n as T);
  for (const c of n.children) all(c as Container, cls, out);
  return out;
}

describe('S card modal', () => {
  it('title plate rides the card top-left edge, ✕ top-right; the body has no title row', () => {
    const host = makeContext();
    const m = new SCardModal(host, { title: 'Bet', onClose: () => {} });
    m.build();
    expect(m.titlePlate.labelText.text).toBe('BET');
    expect(m.titlePlate.y).toBeLessThan(0); // overhangs the card's top edge
    expect(m.closeBtn).toBeDefined();
    expect(m.closeBtn!.x).toBeGreaterThan(m.titlePlate.x);
    expect(m.body.children.length).toBe(0);
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
