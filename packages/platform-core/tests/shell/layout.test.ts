// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: null, buyBonus: false },
  };
}

describe('GameShell layout', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('defaults to wide layout (no ResizeObserver dimensions in jsdom)', () => {
    const shell = createGameShell(cfg(mount));
    expect(shell.layout).toBe('wide');
    expect(mount.querySelector('#__ge-game-shell__')!.classList.contains('ge-mobile')).toBe(false);
  });

  it('setLayout("mobile") adds the ge-mobile class and re-renders', () => {
    const shell = createGameShell(cfg(mount));
    shell.setLayout('mobile');
    expect(shell.layout).toBe('mobile');
    expect(mount.querySelector('#__ge-game-shell__')!.classList.contains('ge-mobile')).toBe(true);
  });

  it('opening the menu opens the Settings overlay', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    expect(mount.querySelector('[data-ge="settings-modal"]')).toBeTruthy();
  });

  // Regression: on mobile-s, large balance/win/total-win values must not run off the screen.
  // jsdom has no layout, so stub the geometry the fit pass reads, then invoke it directly.
  it('mobile: scales the stack to fully fit oversized numbers (anchored bottom-left, no 0.7 clamp)', () => {
    const shell = createGameShell(cfg(mount));
    shell.setLayout('mobile');
    const host = mount.querySelector('.ge-shell-barhost') as HTMLElement;
    const bar = host.querySelector('.ge-shell-bottom') as HTMLElement;
    Object.defineProperty(bar, 'clientWidth', { configurable: true, get: () => 300 });
    const info = bar.querySelector('.ge-m-info') as HTMLElement; // [balance · bet · win] pill row
    Object.defineProperty(info, 'scrollWidth', { configurable: true, get: () => 600 }); // 2× too wide
    (shell as unknown as { applyFitScale(): void }).applyFitScale();
    const s = host.style.transform.match(/scale\(([0-9.]+)\)/);
    expect(s).toBeTruthy();
    expect(Number(s![1])).toBeCloseTo(0.5, 4);          // 600 → 300 fits at 0.5 (old floor stuck at 0.7)
    expect(host.style.transformOrigin).toBe('bottom left'); // left-anchored so the right edge fits
  });
});
