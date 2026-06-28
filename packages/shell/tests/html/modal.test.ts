// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';

function cfg(mount: HTMLElement): ShellConfig & { mount: HTMLElement } {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: null, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;
const qa = (m: HTMLElement, s: string) => [...m.querySelectorAll(s)] as HTMLElement[];

describe('openModal (generic modal API)', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('renders title + body and a ✕ when availableClose is true', () => {
    const shell = createGameShell(cfg(mount));
    shell.openModal({ availableClose: true, title: 'Heads up', body: 'Something happened.' });
    const modal = q(mount, '[data-ge="modal"]')!;
    expect(modal).toBeTruthy();
    expect(q(modal, '.ge-modal-title')!.textContent).toBe('Heads up');
    expect(q(modal, '[data-ge="modal-body"]')!.textContent).toBe('Something happened.');
    expect(q(modal, '[data-ge="modal-close"]')).toBeTruthy();
  });

  it('omits the ✕ when availableClose is false', () => {
    const shell = createGameShell(cfg(mount));
    shell.openModal({ availableClose: false, title: 'Locked', body: 'No close.' });
    expect(q(mount, '[data-ge="modal-close"]')).toBeFalsy();
  });

  it('the ✕ closes the modal', () => {
    const shell = createGameShell(cfg(mount));
    shell.openModal({ availableClose: true, title: 'T', body: 'B' });
    q(mount, '[data-ge="modal-close"]')!.click();
    expect(q(mount, '[data-ge="modal"]')).toBeFalsy();
  });

  it('renders actions in order; clicking one runs its on() then closes', () => {
    const shell = createGameShell(cfg(mount));
    const onYes = vi.fn();
    shell.openModal({
      availableClose: false, title: 'Confirm', body: 'Proceed?',
      actions: [{ title: 'No' }, { title: 'Yes', color: '#8b5cf6', on: onYes }],
    });
    const btns = qa(mount, '[data-ge="modal-action"]');
    expect(btns.map((b) => b.textContent)).toEqual(['No', 'Yes']);
    btns[1].click();
    expect(onYes).toHaveBeenCalledOnce();
    expect(q(mount, '[data-ge="modal"]')).toBeFalsy();
  });

  it('an action without on() still closes the modal', () => {
    const shell = createGameShell(cfg(mount));
    shell.openModal({ availableClose: false, title: 'T', body: 'B', actions: [{ title: 'OK' }] });
    q(mount, '[data-ge="modal-action"]')!.click();
    expect(q(mount, '[data-ge="modal"]')).toBeFalsy();
  });

  it('clicking the backdrop does NOT close the modal', () => {
    const shell = createGameShell(cfg(mount));
    shell.openModal({ availableClose: true, title: 'T', body: 'B' });
    q(mount, '[data-ge="modal"]')!.click(); // backdrop
    expect(q(mount, '[data-ge="modal"]')).toBeTruthy();
  });

  it('applies blurLevel to the overlay backdrop', () => {
    const shell = createGameShell(cfg(mount));
    shell.openModal({ availableClose: true, title: 'T', body: 'B', blurLevel: 8 });
    expect(q(mount, '[data-ge="modal"]')!.style.getPropertyValue('--ge-sheet-blur')).toBe('8px');
  });
});
