// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement, over: Partial<ShellConfig> = {}): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5], defaultBet: 2, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 2, autoplay: true, buyBonus: false }, ...over,
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('BottomBar freeSpins/replay modes', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('freeSpins: no spin/bet/buy/autoplay, shows counter + turbo', () => {
    const shell = createGameShell(cfg(mount, { mode: 'freeSpins' }));
    shell.setFreeSpins({ current: 3, total: 10, totalWin: 25, lastWin: 4 });
    expect(q(mount, '[data-ge="spin"]')).toBeNull();
    expect(q(mount, '[data-ge="bet-up"]')).toBeNull();
    expect(q(mount, '[data-ge="autoplay"]')).toBeNull();
    expect(q(mount, '[data-ge="turbo"]')).toBeTruthy();
    expect(q(mount, '[data-ge="fs-counter"]')!.textContent).toContain('3');
    expect(q(mount, '[data-ge="fs-counter"]')!.textContent).toContain('10');
    expect(q(mount, '[data-ge="fs-totalwin"]')!.textContent).toContain('€25');
    expect(q(mount, '[data-ge="fs-lastwin"]')!.textContent).toContain('€4');
  });

  it('replay: read-only bet/win/turbo, no controls', () => {
    const shell = createGameShell(cfg(mount, { mode: 'replay', win: 12 }));
    expect(q(mount, '[data-ge="bet-value"]')!.textContent).toContain('€2');
    expect(q(mount, '[data-ge="win"]')!.textContent).toContain('€12');
    expect(q(mount, '[data-ge="bet-up"]')).toBeNull();
    expect(q(mount, '[data-ge="spin"]')).toBeNull();
    expect(q(mount, '[data-ge="buybonus"]')).toBeNull();
    expect(q(mount, '[data-ge="turbo"]')).toBeTruthy();
  });
});
