// @vitest-environment jsdom
/**
 * Runtime-bug fix: the Settings volume sliders were stateless — every open rebuilt them hardcoded to
 * value '1' (100%), stored the position nowhere, and offered no API for the game to set it. Now the
 * shell holds music/sfx in state (seeded from config.volumes), the slider reads it back on
 * open, drag routes through `setVolume` (emits settingChange), and `shell.setVolume()` is the public
 * API that also live-updates an open overlay. Driven end-to-end through the real GameShell + DOM.
 *
 * The master slider/key is gone (Task 4 of the bar-menu-popover plan); the drag/reopen/live-update
 * cases that used to demonstrate this fix through it were removed with it — Task 5 rewrites this
 * file wholesale for the new popover. This one surviving case keeps the config-seeding path covered
 * in the meantime.
 */
import { describe, it, expect, beforeEach } from 'vitest';
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

describe('Settings volume sliders', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    removeGameShell();
  });

  it('seeds slider positions from config.volumes', () => {
    const shell = createGameShell(base({ volumes: { music: 0.8 } }));
    expect(shell.getVolume('music')).toBe(0.8);
    expect(shell.getVolume('sfx')).toBe(1); // unset → full
  });
});
