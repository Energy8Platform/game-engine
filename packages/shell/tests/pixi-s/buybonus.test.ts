import '../pixi/setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect, vi } from 'vitest';
import type { Container } from 'pixi.js';
import { openSBuyBonus, SBuyBonusPage } from '@/ui/pixi-s/components/BuyBonus';
import { makeContext, defaultConfig } from '../pixi/_host';

const OPTIONS = [
  { id: 'a1', type: 'feature', groupedBy: 'ante', title: 'Warrior', description: 'w', priceMultiplier: 1.25, volatility: 2 },
  { id: 'a2', type: 'feature', groupedBy: 'ante', title: 'Mage', description: 'm', priceMultiplier: 1.25, volatility: 4 },
  { id: 'fs', type: 'bonus', title: 'Free spins', description: 'f', priceMultiplier: 10, volatility: 5 },
];
function page(over: Record<string, unknown> = {}) {
  const emit = vi.fn();
  const host = makeContext({ emit, screenW: 1280, screenH: 720, config: defaultConfig({ balance: 1000, features: { turbo: 0, autoplay: false, buyBonus: OPTIONS } }), ...over });
  return { host, emit, page: openSBuyBonus(host) as SBuyBonusPage };
}
function byLabel(n: Container, label: string, out: Container[] = []): Container[] {
  if (n.label === label) out.push(n);
  for (const c of n.children) byLabel(c as Container, label, out);
  return out;
}

describe('S buy bonus page', () => {
  it('one card per slot; a grouped slot flips through its members with wrap', () => {
    const { page: p } = page();
    expect(p.slots.length).toBe(2);
    expect(p.current(0).id).toBe('a1');
    p.step(0, 1);
    expect(p.current(0).id).toBe('a2');
    p.step(0, 1);
    expect(p.current(0).id).toBe('a1');
    p.step(1, 1);
    expect(p.current(1).id).toBe('fs');
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
    expect((p as unknown as { confirm?: unknown }).confirm).toBeDefined();
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('buyBonusSelect', { id: 'fs' });
    expect(closeLayer).toHaveBeenCalled();
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
});
