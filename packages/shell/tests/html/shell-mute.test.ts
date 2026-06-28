// @vitest-environment jsdom
/**
 * Runtime-bug fix: Shift+M (and the Settings speaker) toggle a SHARED `soundOn` state and emit
 * `settingChange({ key: 'sound', value: <boolean> })` — the event the game's audio actually listens
 * to. Previously toggleMute emitted `{ key: 'muted', value: 'toggle' }`, which nothing handled, and
 * there was no shared state for any icon to reflect. Driven end-to-end through the real GameShell +
 * its KeyboardController (the integration the prior unit tests skipped).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';

const base = () => ({
  mount: document.body,
  gameInfo: { sections: [] },
  language: 'en',
  currency: { symbol: '€', position: 'left' as const },
  availableBets: [1, 2],
  defaultBet: 1,
  currentBet: 1,
  balance: 100,
  win: 0,
  mode: 'base' as const,
  features: { turbo: 1 as const, buyBonus: false as const },
});

const shiftM = () => new KeyboardEvent('keydown', { code: 'KeyM', shiftKey: true, bubbles: true });

describe('Shift+M mute', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    removeGameShell();
  });

  it('flips the shared soundOn state and emits settingChange{key:"sound"}', () => {
    const shell = createGameShell(base());
    const onSetting = vi.fn();
    shell.on('settingChange', onSetting);

    expect(shell.soundOn).toBe(true);

    document.dispatchEvent(shiftM());
    expect(shell.soundOn).toBe(false);
    expect(onSetting).toHaveBeenLastCalledWith({ key: 'sound', value: false });

    document.dispatchEvent(shiftM());
    expect(shell.soundOn).toBe(true);
    expect(onSetting).toHaveBeenLastCalledWith({ key: 'sound', value: true });
  });

  it('setSound is idempotent in its emitted value and reflects state', () => {
    const shell = createGameShell(base());
    const onSetting = vi.fn();
    shell.on('settingChange', onSetting);

    shell.setSound(false);
    expect(shell.soundOn).toBe(false);
    expect(onSetting).toHaveBeenLastCalledWith({ key: 'sound', value: false });
  });

  it('the Settings speaker button toggles the shared sound state (parity with Shift+M)', () => {
    const shell = createGameShell(base());
    const onSetting = vi.fn();
    shell.on('settingChange', onSetting);
    shell.openSettings();
    const btn = document.querySelector('[data-ge="setting-sound"]') as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(shell.soundOn).toBe(true);

    btn!.click();
    expect(shell.soundOn).toBe(false);
    expect(onSetting).toHaveBeenLastCalledWith({ key: 'sound', value: false });

    btn!.click();
    expect(shell.soundOn).toBe(true);
    expect(onSetting).toHaveBeenLastCalledWith({ key: 'sound', value: true });
  });
});
