// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';

function cfg(mount: HTMLElement, over: Partial<ShellConfig> = {}): ShellConfig & { mount: HTMLElement } {
  return {
    mount,
    gameInfo: {},
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5],
    defaultBet: 2,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    features: { turbo: 2, autoplay: {}, buyBonus: [] },
    ...over,
  };
}

describe('provider BUY BONUS icon (html)', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it("bonusIcon: 'energy8' draws the provider's icon on the accent disc instead of the coin", () => {
    createGameShell(cfg(mount, { bonusIcon: 'energy8' }));
    const buy = mount.querySelector('[data-ge="buybonus"]')!;
    expect(buy.classList.contains('ge-bb-coin')).toBe(false);
    expect(buy.querySelector('.ge-bb-tk svg path[fill-rule="evenodd"]')).not.toBeNull();
  });

  it('an unknown provider falls back to the skin coin', () => {
    createGameShell(cfg(mount, { bonusIcon: 'nope' as never }));
    const buy = mount.querySelector('[data-ge="buybonus"]')!;
    expect(buy.classList.contains('ge-bb-coin')).toBe(true);
    expect(buy.querySelector('.ge-bb-tk')).toBeNull();
  });
});
