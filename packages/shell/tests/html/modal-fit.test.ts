// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';
import type { HtmlRenderer } from '@/ui/html/HtmlRenderer';

function cfg(mount: HTMLElement): ShellConfig & { mount: HTMLElement } {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [0.2, 0.5, 1, 2, 5], defaultBet: 1, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: {}, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;
// jsdom has no layout — stub the geometry fitSheet() reads.
const geom = (el: HTMLElement, w: number, h: number) => {
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => w });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => h });
  Object.defineProperty(el, 'offsetWidth', { configurable: true, get: () => w });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, get: () => h });
};

/** Access the renderer's fitModals() through the ShellController's private renderer field. */
const fitModals = (shell: ReturnType<typeof createGameShell>): void =>
  (shell as unknown as { renderer: HtmlRenderer }).renderer.fitModals();

describe('card modal fit-scale', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('scales a picker (bet/autoplay) card down to leave a margin in a small popout', () => {
    const shell = createGameShell(cfg(mount));
    shell.openAutoplayPicker();
    const sheet = q(mount, '.ge-sheet')!;
    const card = q(mount, '.ge-modal-card')!;
    geom(sheet, 480, 270); // popout-s frame
    geom(card, 420, 360); // a tall-ish picker card
    fitModals(shell);
    expect(card.style.transform).toMatch(/scale\(0\.\d+\)/);
  });

  it('does not scale (or upscale) when the card fits within the fit margin', () => {
    const shell = createGameShell(cfg(mount));
    shell.openBetPicker();
    const sheet = q(mount, '.ge-sheet')!;
    const card = q(mount, '.ge-modal-card')!;
    geom(sheet, 1200, 675); // roomy desktop frame
    geom(card, 360, 240); // comfortably within 86% of the frame
    fitModals(shell);
    expect(card.style.transform).toBe('');
  });
});
