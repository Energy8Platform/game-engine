// @vitest-environment jsdom
/**
 * Runtime-bug fix: the Settings volume sliders were stateless — every open rebuilt them hardcoded to
 * value '1' (100%), stored the position nowhere, and offered no API for the game to set it. Now the
 * shell holds music/sfx in state (seeded from config.volumes), the slider reads it back on
 * open, drag routes through `setVolume` (emits settingChange), and `shell.setVolume()` is the public
 * API that also live-updates an open overlay. Driven end-to-end through the real GameShell + DOM.
 *
 * The master slider/key is gone (Task 4 of the bar-menu-popover plan). The drag/reopen/live-update
 * cases below used to run through `master`; they are retargeted to `music` (the exact same mechanism
 * — one combined `setMenuRefresh` callback drives every slider) so this file keeps covering the path
 * Task 4 itself rewired (`ui/html/components/Settings.ts`'s merged sound+volume refresher). Task 5
 * still rewrites this file wholesale for the new popover.
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

const music = () => document.querySelector('[data-ge="setting-music"]') as HTMLInputElement | null;

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

    expect(music()!.value).toBe('1');
    expect(shell.getVolume('music')).toBe(1);

    const input = music()!;
    input.value = '0.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(onSetting).toHaveBeenLastCalledWith({ key: 'music', value: 0.5 });
    expect(shell.getVolume('music')).toBe(0.5);
  });

  it('reopening the overlay reflects the last-set position (not a reset to 100%)', () => {
    const shell = createGameShell(base());
    shell.openSettings();
    const input = music()!;
    input.value = '0.3';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    shell.closeModal();

    shell.openSettings();
    expect(music()!.value).toBe('0.3');
  });

  it('seeds slider positions from config.volumes', () => {
    const shell = createGameShell(base({ volumes: { music: 0.8 } }));
    expect(shell.getVolume('music')).toBe(0.8);
    expect(shell.getVolume('sfx')).toBe(1); // unset → full
  });

  it('shell.setVolume is the public API: clamps, stores, emits, and live-updates an open slider', () => {
    const shell = createGameShell(base());
    const onSetting = vi.fn();
    shell.on('settingChange', onSetting);
    shell.openSettings();

    shell.setVolume('music', 0.75);
    expect(shell.getVolume('music')).toBe(0.75);
    expect(music()!.value).toBe('0.75'); // open overlay moved live
    expect(onSetting).toHaveBeenLastCalledWith({ key: 'music', value: 0.75 });

    shell.setVolume('music', 5); // out of range
    expect(shell.getVolume('music')).toBe(1);
  });
});
