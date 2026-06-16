// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5, 10], defaultBet: 1, currentBet: null,
    balance: 100, win: 0, mode: 'base',
    features: { turbo: 2, autoplay: true, buyBonus: false },
  };
}
const q = (m: HTMLElement, s: string) => m.querySelector(s) as HTMLElement | null;
const qa = (m: HTMLElement, s: string) => [...m.querySelectorAll(s)] as HTMLElement[];
const chip = (modal: HTMLElement, id: string) => qa(modal, '.ge-chip').find((c) => c.dataset.id === id)!;

describe('bet picker', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('tapping the stake opens a bet modal listing every bet', () => {
    createGameShell(cfg(mount));
    q(mount, '[data-ge="bet-value"]')!.click();
    const modal = q(mount, '[data-ge="bet-modal"]');
    expect(modal).toBeTruthy();
    expect(qa(modal!, '.ge-chip')).toHaveLength(4);
  });

  it('selecting a bet + Confirm emits betChange and updates the readout', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('betChange', spy);
    q(mount, '[data-ge="bet-value"]')!.click();
    const modal = q(mount, '[data-ge="bet-modal"]')!;
    chip(modal, '5').click();
    q(modal, '[data-ge="sheet-confirm"]')!.click();
    expect(spy).toHaveBeenCalledWith(5);
    expect(q(mount, '[data-ge="bet-value"]')!.textContent).toContain('€5');
  });
});

describe('autoplay', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('clicking autoplay opens the count modal', () => {
    createGameShell(cfg(mount));
    q(mount, '[data-ge="autoplay"]')!.click();
    expect(q(mount, '[data-ge="autoplay-modal"]')).toBeTruthy();
  });

  it('Start emits autoplayStart; spin becomes STOP+counter and autoplay glows', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn(); shell.on('autoplayStart', spy);
    q(mount, '[data-ge="autoplay"]')!.click();
    const modal = q(mount, '[data-ge="autoplay-modal"]')!;
    chip(modal, '25').click();
    q(modal, '[data-ge="sheet-confirm"]')!.click();
    expect(spy).toHaveBeenCalledWith({ active: true, remaining: 25 });
    const spin = q(mount, '[data-ge="spin"]')!;
    expect(spin.classList.contains('ge-stop')).toBe(true);
    expect(q(spin, '.ge-spin-count')!.textContent).toBe('25');
    expect(q(mount, '[data-ge="autoplay"]')!.classList.contains('ge-glow')).toBe(true);
  });

  it('the ∞ choice shows the infinity glyph', () => {
    createGameShell(cfg(mount));
    q(mount, '[data-ge="autoplay"]')!.click();
    const modal = q(mount, '[data-ge="autoplay-modal"]')!;
    chip(modal, 'Infinity').click();
    q(modal, '[data-ge="sheet-confirm"]')!.click();
    expect(q(mount, '[data-ge="spin"] .ge-spin-count')!.textContent).toBe('∞');
  });

  it('clicking the STOP disc stops autoplay', () => {
    const shell = createGameShell(cfg(mount));
    const stopSpy = vi.fn(); shell.on('autoplayStop', stopSpy);
    shell.setAutoplay({ active: true, remaining: 10 });
    q(mount, '[data-ge="spin"]')!.click(); // disc is the STOP button now
    expect(stopSpy).toHaveBeenCalledOnce();
    expect(q(mount, '[data-ge="spin"]')!.classList.contains('ge-stop')).toBe(false);
  });

  it('disables buy bonus for the whole autoplay run (no flicker)', () => {
    const c = cfg(mount);
    c.features = { ...c.features, buyBonus: [{ id: 'b', title: 'B', description: 'd', priceMultiplier: 100 }] };
    const shell = createGameShell(c);
    expect((q(mount, '[data-ge="buybonus"]') as HTMLButtonElement).disabled).toBe(false);
    shell.setAutoplay({ active: true, remaining: 10 });
    expect((q(mount, '[data-ge="buybonus"]') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('spin rotation', () => {
  let mount: HTMLElement;
  beforeEach(async () => { document.body.innerHTML = ''; mount = document.createElement('div'); document.body.appendChild(mount); await removeGameShell(); });

  it('spin disc carries ge-spinning while busy', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBusy(true);
    expect(q(mount, '[data-ge="spin"]')!.classList.contains('ge-spinning')).toBe(true);
    shell.setBusy(false);
    expect(q(mount, '[data-ge="spin"]')!.classList.contains('ge-spinning')).toBe(false);
  });
});
