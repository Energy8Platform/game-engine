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
    features: { turbo: 0, autoplay: true, buyBonus: false },
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
