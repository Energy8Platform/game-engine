// @vitest-environment jsdom
/**
 * Task 9: Keyboard navigation inside bet & autoplay pickers (DOM shell).
 *
 * Tests that:
 * 1. Autoplay picker: ArrowRight moves highlight, Enter confirms with the highlighted count.
 * 2. Autoplay picker: ArrowLeft moves highlight back; Escape closes without firing autoplayStart.
 * 3. Bet picker: ArrowRight moves highlight, Enter applies the highlighted bet (betChange fired).
 * 4. Bet picker: confirm via click still works (regression guard).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/shell';
import type { ShellConfig } from '@/shell/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount,
    gameInfo: {},
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5, 10],
    defaultBet: 1,
    currentBet: null,
    balance: 1000,
    win: 0,
    mode: 'base',
    features: { turbo: 0, autoplay: {}, buyBonus: false },
  };
}

const key = (code: string, extra: Partial<KeyboardEventInit> = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...extra }));

describe('Picker keyboard navigation (DOM shell)', () => {
  let mount: HTMLElement;

  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  // ─── autoplay picker ────────────────────────────────────────────────────────

  it('autoplay: ArrowRight moves highlight; Enter confirms with highlighted count', () => {
    const shell = createGameShell(cfg(mount));
    const autoplaySpy = vi.fn();
    shell.on('autoplayStart', autoplaySpy);

    // Open the autoplay picker (default selection: first count = 10)
    shell.openAutoplayPicker();

    // The picker should be in the modal host
    expect(mount.querySelector('[data-ge="autoplay-modal"]')).toBeTruthy();

    // ArrowRight: move highlight from index 0 to index 1
    key('ArrowRight');
    // ArrowRight again: index 1 → 2
    key('ArrowRight');

    // Enter: confirm — should fire autoplayStart with the counts[2] value (50)
    key('Enter');

    // Modal should be closed
    expect(mount.querySelector('[data-ge="autoplay-modal"]')).toBeFalsy();

    // autoplayStart should have been fired with the HIGHLIGHTED count, not the original
    expect(autoplaySpy).toHaveBeenCalledOnce();
    const payload = autoplaySpy.mock.calls[0][0] as { active: boolean; remaining: number };
    expect(payload.active).toBe(true);
    expect(payload.remaining).toBe(50); // counts[2]
  });

  it('autoplay: ArrowLeft clamps at start; Escape closes without firing autoplayStart', () => {
    const shell = createGameShell(cfg(mount));
    const autoplaySpy = vi.fn();
    shell.on('autoplayStart', autoplaySpy);

    shell.openAutoplayPicker();
    expect(mount.querySelector('[data-ge="autoplay-modal"]')).toBeTruthy();

    // ArrowLeft on first item — should clamp (stay at index 0)
    key('ArrowLeft');
    key('ArrowLeft');

    // Escape — closes picker
    key('Escape');

    expect(mount.querySelector('[data-ge="autoplay-modal"]')).toBeFalsy();
    expect(autoplaySpy).not.toHaveBeenCalled();
  });

  it('autoplay: Space also confirms with highlighted count', () => {
    const shell = createGameShell(cfg(mount));
    const autoplaySpy = vi.fn();
    shell.on('autoplayStart', autoplaySpy);

    shell.openAutoplayPicker();
    key('ArrowRight'); // highlight index 1 (count=25)
    key('Space');

    expect(autoplaySpy).toHaveBeenCalledOnce();
    const payload = autoplaySpy.mock.calls[0][0] as { active: boolean; remaining: number };
    expect(payload.remaining).toBe(25);
  });

  // ─── bet picker ─────────────────────────────────────────────────────────────

  it('bet: ArrowRight moves highlight; Enter fires betChange with highlighted bet', () => {
    const shell = createGameShell(cfg(mount));
    const betSpy = vi.fn();
    shell.on('betChange', betSpy);

    // Default bet is 1 (availableBets[0])
    shell.openBetPicker();
    expect(mount.querySelector('[data-ge="bet-modal"]')).toBeTruthy();

    // Move right twice: highlight goes to index 2 (bet=5)
    key('ArrowRight');
    key('ArrowRight');
    key('Enter');

    expect(mount.querySelector('[data-ge="bet-modal"]')).toBeFalsy();
    expect(betSpy).toHaveBeenCalledOnce();
    expect(betSpy.mock.calls[0][0]).toBe(5);
  });

  it('bet: click on a chip then Enter confirms that chip (pointer still works)', () => {
    const shell = createGameShell(cfg(mount));
    const betSpy = vi.fn();
    shell.on('betChange', betSpy);

    shell.openBetPicker();

    // Click on the second chip (bet=2)
    const chips = mount.querySelectorAll('[data-ge="bet-modal"] .ge-chip') as NodeListOf<HTMLButtonElement>;
    chips[1].click(); // select bet=2 via pointer

    key('Enter'); // confirm via keyboard

    expect(betSpy).toHaveBeenCalledOnce();
    expect(betSpy.mock.calls[0][0]).toBe(2);
  });

  it('bet: + key moves highlight forward, - key moves back', () => {
    const shell = createGameShell(cfg(mount));
    const betSpy = vi.fn();
    shell.on('betChange', betSpy);

    shell.openBetPicker();
    // Start at index 0 (bet=1). + → index 1, + → index 2, - → index 1
    key('Equal');   // +
    key('Equal');   // +
    key('Minus');   // -
    key('Enter');

    expect(betSpy).toHaveBeenCalledOnce();
    expect(betSpy.mock.calls[0][0]).toBe(2); // index 1
  });

  it('bet: modalOnKey is cleared after the picker closes (no stale routing)', () => {
    const shell = createGameShell(cfg(mount));
    const spinSpy = vi.fn();
    shell.on('spin', spinSpy);

    shell.openBetPicker();
    key('Enter'); // confirm with default selection (index 0), closes picker

    // Now modal is gone and autoplay is NOT active — Space should NOT be swallowed; it fires spin
    key('Space');
    expect(spinSpy).toHaveBeenCalledOnce();
  });
});
