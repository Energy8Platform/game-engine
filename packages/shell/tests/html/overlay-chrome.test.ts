// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';

function cfg(mount: HTMLElement): ShellConfig & { mount: HTMLElement } {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: null, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;

describe('overlay chrome', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = ''; mount = document.createElement('div');
    document.body.appendChild(mount); await removeGameShell();
  });

  it('centres the title with a spacer when there is no back button (settings)', () => {
    const shell = createGameShell(cfg(mount));
    shell.openSettings();
    expect(q(mount, '[data-ge="settings-modal"] .ge-ov-spacer')).toBeTruthy();
    expect(q(mount, '[data-ge="settings-modal"] [data-ge="info-back"]')).toBeNull();
  });

  it('uses a back button (not a spacer) when the overlay can go back (game info)', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    expect(q(mount, '[data-ge="info-modal"] [data-ge="info-back"]')).toBeTruthy();
    expect(q(mount, '[data-ge="info-modal"] .ge-ov-spacer')).toBeNull();
  });

  it('renders sound as an icon button that swaps glyph + aria-pressed on toggle', () => {
    const shell = createGameShell(cfg(mount));
    shell.openSettings();
    const btn = q(mount, '[data-ge="setting-sound"]')!;
    expect(btn.querySelector('svg')).toBeTruthy();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    const onGlyph = btn.innerHTML;
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.innerHTML).not.toBe(onGlyph); // soundOn → soundOff
  });
});
