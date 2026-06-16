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
    features: { turbo: 2, autoplay: {}, buyBonus: false }, ...over,
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

  it('freeSpins: Free Spins + Total Win on the left, no controls, no Last win', () => {
    const shell = createGameShell(cfg(mount, { mode: 'freeSpins' }));
    shell.setFreeSpins({ current: 3, total: 10, totalWin: 25 });
    expect(q(mount, '[data-ge="spin"]')).toBeNull();
    expect(q(mount, '[data-ge="bet-up"]')).toBeNull();
    expect(q(mount, '[data-ge="autoplay"]')).toBeNull();
    expect(q(mount, '[data-ge="turbo"]')).toBeTruthy();
    expect(q(mount, '[data-ge="balance"]')).toBeTruthy();
    expect(q(mount, '[data-ge="fs-counter"]')!.textContent).toContain('3');
    expect(q(mount, '[data-ge="fs-counter"]')!.textContent).toContain('10');
    expect(q(mount, '[data-ge="fs-totalwin"]')!.textContent).toContain('25');
    expect(q(mount, '[data-ge="fs-lastwin"]')).toBeNull(); // Last win dropped
  });

  it('freeSpins: Total Win shows even at €0; win uses the base WIN pill', () => {
    const shell = createGameShell(cfg(mount, { mode: 'freeSpins' }));
    shell.setFreeSpins({ current: 0, total: 10, totalWin: 0 });
    expect(q(mount, '[data-ge="fs-totalwin"]')!.textContent).toContain('0'); // €0 still shown
    expect(q(mount, '[data-ge="win"]')).toBeNull();                          // no win yet
    shell.setWin(7);
    const win = q(mount, '[data-ge="win"]')!;
    expect(win.textContent).toContain('€7');
    expect(win.classList.contains('ge-winpill')).toBe(true);                 // base pattern
  });

  it('replay: read-only bet + win (base pill) + turbo, no controls', () => {
    const shell = createGameShell(cfg(mount, { mode: 'replay', win: 12 }));
    expect(q(mount, '[data-ge="bet-value"]')!.textContent).toContain('€2');
    const win = q(mount, '[data-ge="win"]')!;
    expect(win.textContent).toContain('€12');
    expect(win.classList.contains('ge-winpill')).toBe(true);
    expect(q(mount, '[data-ge="bet-up"]')).toBeNull();
    expect(q(mount, '[data-ge="spin"]')).toBeNull();
    expect(q(mount, '[data-ge="buybonus"]')).toBeNull();
    expect(q(mount, '[data-ge="turbo"]')).toBeTruthy();
  });

  it('replay: Free Spins + Total Win only for a free-spins replay (total > 0)', () => {
    const shell = createGameShell(cfg(mount, { mode: 'replay', win: 12 }));
    expect(q(mount, '[data-ge="fs-counter"]')).toBeNull();   // plain replay → no FS blocks
    expect(q(mount, '[data-ge="fs-totalwin"]')).toBeNull();
    shell.setFreeSpins({ current: 8, total: 8, totalWin: 40 });
    expect(q(mount, '[data-ge="fs-counter"]')!.textContent).toContain('8');
    expect(q(mount, '[data-ge="fs-totalwin"]')!.textContent).toContain('40');
  });
});
