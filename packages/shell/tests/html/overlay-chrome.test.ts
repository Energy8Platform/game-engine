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

  it('centres the title with a spacer when there is no back button (buy bonus)', () => {
    // The bar menu is a headless popover now (no header/spacer at all — see menu.test.ts), so the
    // "no back button" case of createOverlay's header chrome is exercised through another
    // createOverlay consumer that also omits onBack: the buy-bonus overlay.
    const c = cfg(mount);
    c.features = { ...c.features, buyBonus: [{ id: 'b', title: 'Bonus', description: 'd', priceMultiplier: 100 }] };
    const shell = createGameShell(c);
    shell.openBuyBonus();
    expect(q(mount, '[data-ge="buybonus-overlay"] .ge-ov-spacer')).toBeTruthy();
    expect(q(mount, '[data-ge="buybonus-overlay"] [data-ge="info-back"]')).toBeNull();
  });

  it('uses a back button (not a spacer) when the overlay can go back (game info)', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    expect(q(mount, '[data-ge="info-modal"] [data-ge="info-back"]')).toBeTruthy();
    expect(q(mount, '[data-ge="info-modal"] .ge-ov-spacer')).toBeNull();
  });

  it('renders the sound row with a glyph that swaps, and the toggle control aria-pressed flips', () => {
    const shell = createGameShell(cfg(mount));
    shell.openMenu();
    // The glyph lives in a sibling span (`.ge-mi-icon`) next to the toggle pill, not inside it —
    // see components/Menu.ts's toggle-row builder.
    const row = q(mount, '[data-ge="menu-row-sound"]')!;
    const btn = q(mount, '[data-ge="menu-item-sound"]')!;
    expect(row.querySelector('svg')).toBeTruthy();
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    const onGlyph = row.querySelector('.ge-mi-icon')!.innerHTML;
    btn.click();
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(row.querySelector('.ge-mi-icon')!.innerHTML).not.toBe(onGlyph); // soundOn → soundOff
  });
});
