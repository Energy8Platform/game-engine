// @vitest-environment jsdom
/**
 * Runtime-bug fix: the Settings volume sliders were stateless — every open rebuilt them hardcoded to
 * value '1' (100%), stored the position nowhere, and offered no API for the game to set it. Now the
 * shell holds master/music/sfx in state (seeded from config.volumes), the slider reads it back on
 * open, drag routes through `setVolume` (emits settingChange), and `shell.setVolume()` is the public
 * API that also live-updates an open overlay. Driven end-to-end through the real GameShell + DOM.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';

const base = (over: Record<string, unknown> = {}) => ({
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
  ...over,
});

const master = () => document.querySelector('[data-ge="setting-master"]') as HTMLInputElement | null;

describe('Settings volume sliders', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    removeGameShell();
  });

  it('defaults each slider to 100% and emits settingChange on drag', () => {
    const shell = createGameShell(base());
    const onSetting = vi.fn();
    shell.on('settingChange', onSetting);
    shell.openSettings();

    expect(master()!.value).toBe('1');
    expect(shell.getVolume('master')).toBe(1);

    const input = master()!;
    input.value = '0.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onSetting).toHaveBeenLastCalledWith({ key: 'master', value: 0.5 });
    expect(shell.getVolume('master')).toBe(0.5);
  });

  it('reopening the overlay reflects the last-set position (not a reset to 100%)', () => {
    const shell = createGameShell(base());
    shell.openSettings();
    const input = master()!;
    input.value = '0.3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    shell.closeModal();

    shell.openSettings();
    expect(master()!.value).toBe('0.3');
  });

  it('seeds slider positions from config.volumes', () => {
    const shell = createGameShell(base({ volumes: { master: 0.2, music: 0.8 } }));
    expect(shell.getVolume('master')).toBe(0.2);
    expect(shell.getVolume('music')).toBe(0.8);
    expect(shell.getVolume('sfx')).toBe(1); // unset → full
    shell.openSettings();
    expect(master()!.value).toBe('0.2');
  });

  it('shell.setVolume is the public API: clamps, stores, emits, and live-updates an open slider', () => {
    const shell = createGameShell(base());
    const onSetting = vi.fn();
    shell.on('settingChange', onSetting);
    shell.openSettings();

    shell.setVolume('master', 0.75);
    expect(shell.getVolume('master')).toBe(0.75);
    expect(master()!.value).toBe('0.75'); // open overlay moved live
    expect(onSetting).toHaveBeenLastCalledWith({ key: 'master', value: 0.75 });

    shell.setVolume('master', 5); // out of range
    expect(shell.getVolume('master')).toBe(1);
  });
});
