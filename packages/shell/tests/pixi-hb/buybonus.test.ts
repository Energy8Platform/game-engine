import '../pixi/setup-canvas';
import { describe, it, expect, vi } from 'vitest';
import { openBuyBonus, BuyBonusPage } from '@/ui/pixi-hb/components/BuyBonus';
import { makeContext, defaultConfig } from '../pixi/_host';

const OPTIONS = [
  { id: 'a1', type: 'feature', groupedBy: 'ante', title: 'Warrior', description: 'w', priceMultiplier: 1.25, volatility: 2 },
  { id: 'a2', type: 'feature', groupedBy: 'ante', title: 'Mage', description: 'm', priceMultiplier: 1.25, volatility: 4 },
  { id: 'fs', type: 'bonus', title: 'Free spins', description: 'f', priceMultiplier: 10, volatility: 5 },
];
function page(over: Record<string, unknown> = {}) {
  const emit = vi.fn();
  const host = makeContext({ emit, config: defaultConfig({ balance: 1000, features: { turbo: 0, autoplay: false, buyBonus: OPTIONS } }), ...over });
  return { host, emit, page: openBuyBonus(host) as BuyBonusPage };
}

describe('hb buy bonus page', () => {
  it('flattens groups: the arrows walk every option and wrap', () => {
    const { page: p } = page();
    expect(p.current.id).toBe('a1');
    p.step(1);
    expect(p.current.id).toBe('a2');
    p.step(1);
    p.step(1);
    expect(p.current.id).toBe('a1');
    p.step(-1);
    expect(p.current.id).toBe('fs');
  });

  it('feature options get the red Activate CTA, bonus options the orange Buy', () => {
    const { page: p } = page();
    expect(p.cta!.labelText.text).toBe('ACTIVATE');
    p.step(-1);
    expect(p.cta!.labelText.text).toBe('BUY');
  });

  it('Enter opens the confirm and a second Enter commits the current option', () => {
    const { page: p, emit, host } = page();
    const closeLayer = vi.spyOn(host, 'closeLayer');
    p.step(-1); // fs
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect((p as unknown as { confirm?: unknown }).confirm).toBeDefined();
    p.onKey({ code: 'Enter' } as KeyboardEvent);
    expect(emit).toHaveBeenCalledWith('buyBonusSelect', { id: 'fs' });
    expect(closeLayer).toHaveBeenCalled();
  });

  it('an unaffordable option disables the CTA', () => {
    const { page: p, host } = page();
    host.state.balance = 1;
    p.step(-1);
    expect(p.cta!.disabled).toBe(true);
  });
});
