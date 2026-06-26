// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5], defaultBet: 1, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: {}, buyBonus: false },
  };
}
const space = (init: KeyboardEventInit = {}, target: EventTarget = document) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true, ...init }));

describe('keyboard: Space → spin', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('emits spin when base, idle and no overlay is open', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('spin', spy);
    space();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('does not emit when features.spacebar is false', () => {
    const c = cfg(mount); c.features = { ...c.features, spacebar: false };
    const shell = createGameShell(c);
    const spy = vi.fn();
    shell.on('spin', spy);
    space();
    expect(spy).not.toHaveBeenCalled();
  });

  it('emits when features.spacebar is explicitly true', () => {
    const c = cfg(mount); c.features = { ...c.features, spacebar: true };
    const shell = createGameShell(c);
    const spy = vi.fn();
    shell.on('spin', spy);
    space();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('does not emit while a spin is running (busy)', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('spin', spy);
    shell.setBusy(true);
    space();
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not emit while autoplay is active', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('spin', spy);
    shell.setAutoplay({ active: true, remaining: 5 });
    space();
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not emit while an overlay/modal is open', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('spin', spy);
    shell.openInfo();
    space();
    expect(spy).not.toHaveBeenCalled();
  });

  // Regression: pressing Space while an overlay is open must swallow the browser default,
  // otherwise the focused trigger <button> (menu/buy/auto) gets natively re-activated and
  // the modal is torn down + rebuilt — a visible flicker.
  it('prevents the browser default while an overlay is open', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();
    const notPrevented = space(); // dispatchEvent → false when preventDefault() was called
    expect(notPrevented).toBe(false);
  });

  it('prevents the browser default on the spin path', () => {
    createGameShell(cfg(mount));
    expect(space()).toBe(false);
  });

  it('prevents the browser default while busy', () => {
    const shell = createGameShell(cfg(mount));
    shell.setBusy(true);
    expect(space()).toBe(false);
  });

  it('does NOT prevent default for Space typed into an input (must remain typeable)', () => {
    createGameShell(cfg(mount));
    const input = document.createElement('input');
    mount.appendChild(input);
    expect(space({}, input)).toBe(true);
  });

  it('ignores held-key repeats', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('spin', spy);
    space({ repeat: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('ignores Space typed into an input', () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('spin', spy);
    const input = document.createElement('input');
    mount.appendChild(input);
    space({}, input);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops listening after destroy', async () => {
    const shell = createGameShell(cfg(mount));
    const spy = vi.fn();
    shell.on('spin', spy);
    await shell.destroy();
    space();
    expect(spy).not.toHaveBeenCalled();
  });
});

// Enter (and Space) natively re-activate a focused <button> — so the menu/buy/auto control
// that opened an overlay must lose focus when the overlay opens, otherwise the keypress
// re-fires its click and the modal is rebuilt (flicker). Dropping focus covers every key,
// not just Space.
describe('focus: opening an overlay drops focus from the trigger control', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('blurs the focused shell control when a modal opens', () => {
    const shell = createGameShell(cfg(mount));
    const menuBtn = mount.querySelector('[data-ge="menu"]') as HTMLButtonElement;
    menuBtn.focus();
    expect(document.activeElement).toBe(menuBtn);
    shell.openMenu();
    expect(document.activeElement).not.toBe(menuBtn);
  });

  it('leaves focus outside the shell untouched (only drops focus it owns)', () => {
    const shell = createGameShell(cfg(mount));
    const outside2 = document.createElement('input');
    document.body.appendChild(outside2);
    outside2.focus();
    expect(document.activeElement).toBe(outside2);
    shell.openInfo();
    expect(document.activeElement).toBe(outside2);
  });
});

describe('keyboard: chrome hotkeys fall through an open overlay', () => {
  let mount: HTMLElement;
  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });
  const shifted = (code: string) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey: true, bubbles: true, cancelable: true }));
  const qge = (s: string) => mount.querySelector(s) as HTMLElement | null;

  it('Shift+I from the Settings page jumps to Game info', () => {
    const shell = createGameShell(cfg(mount));
    shell.openSettings();
    expect(qge('[data-ge="settings-modal"]')).toBeTruthy();
    shifted('KeyI');
    expect(qge('[data-ge="info-modal"]')).toBeTruthy();
  });

  it('Shift+M from the Settings page toggles the shared sound state', () => {
    const shell = createGameShell(cfg(mount));
    shell.openSettings();
    expect(shell.soundOn).toBe(true);
    shifted('KeyM');
    expect(shell.soundOn).toBe(false);
  });
});
