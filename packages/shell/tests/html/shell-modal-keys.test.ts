// @vitest-environment jsdom
/**
 * Task 8: ShellLayer.onKey routing to top layer
 *
 * Tests that:
 * 1. When a modal is open and it has an onKey handler, ArrowDown is routed to that handler
 *    and bar actions (spin) are NOT fired.
 * 2. When a modal is open and its onKey returns false, pressing Escape closes the modal.
 * 3. Controller-level: routeToLayer returning true prevents bar actions.
 * 4. Controller-level: routeToLayer returning false + Escape → closeLayer called.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import { KeyboardController, type KeyboardHost } from '@/core/keyboard';
import type { ShellConfig } from '@/core/types';

function cfg(mount: HTMLElement): ShellConfig {
  return {
    mount, gameInfo: {}, language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2, 5], defaultBet: 1, currentBet: null,
    balance: 1000, win: 0, mode: 'base',
    features: { turbo: 0, autoplay: {}, buyBonus: false },
  };
}

const key = (code: string, extra: Partial<KeyboardEventInit> = {}) =>
  document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...extra }));

// ── DOM shell integration tests ────────────────────────────────────────────

describe('DOM GameShell: modal onKey routing', () => {
  let mount: HTMLElement;

  beforeEach(async () => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
    await removeGameShell();
  });

  it('ArrowDown routed to modal onKey when a modal is open (returns true → no bar action)', () => {
    const shell = createGameShell(cfg(mount));
    const spinSpy = vi.fn();
    shell.on('spin', spinSpy);

    // Open a modal that consumes ArrowDown
    const onKey = vi.fn((e: KeyboardEvent) => e.code === 'ArrowDown');
    shell.openModal({ availableClose: true, title: 'T', body: 'B', onKey });

    key('ArrowDown');
    expect(onKey).toHaveBeenCalledOnce();
    expect(spinSpy).not.toHaveBeenCalled();
  });

  it('Escape closes the modal when modal onKey returns false for Escape', () => {
    const shell = createGameShell(cfg(mount));

    // onKey that only consumes ArrowDown, not Escape
    const onKey = vi.fn((e: KeyboardEvent) => e.code === 'ArrowDown');
    shell.openModal({ availableClose: true, title: 'T', body: 'B', onKey });

    expect(mount.querySelector('[data-ge="modal"]')).toBeTruthy();
    key('Escape');
    expect(mount.querySelector('[data-ge="modal"]')).toBeFalsy();
  });

  it('Escape closes the modal even when no onKey is registered', () => {
    const shell = createGameShell(cfg(mount));
    shell.openInfo();

    expect(mount.querySelector('.ge-shell-modalhost')!.childElementCount).toBeGreaterThan(0);
    key('Escape');
    expect(mount.querySelector('.ge-shell-modalhost')!.childElementCount).toBe(0);
  });

  it('ArrowDown without a modal open does NOT trigger onKey of any closed modal', () => {
    const shell = createGameShell(cfg(mount));
    const onKey = vi.fn((_e: KeyboardEvent) => true);
    shell.openModal({ availableClose: true, title: 'T', body: 'B', onKey });
    shell.closeModal();

    key('ArrowDown');
    // onKey was registered but the modal is gone — should not be called
    expect(onKey).not.toHaveBeenCalled();
  });
});

// ── Controller-level unit tests (mock host) ────────────────────────────────

function mockHost(over: Partial<KeyboardHost> = {}): KeyboardHost {
  return {
    state: { mode: 'base', busy: false, autoplay: { active: false, remaining: 0 }, bet: 1, availableBets: [1, 2], replay: false } as any,
    hotkeysEnabled: true, spacebarEnabled: true, turboLevels: 1, autoplayEnabled: true, buyBonusEnabled: true,
    hasOpenLayer: () => false, routeToLayer: () => false,
    spin: vi.fn(), stepBet: vi.fn(), toggleAutoplay: vi.fn(), cycleTurbo: vi.fn(),
    openBuyBonus: vi.fn(), openInfo: vi.fn(), openMenu: vi.fn(), toggleMute: vi.fn(), closeLayer: vi.fn(),
    ...over,
  };
}

describe('KeyboardController: routeToLayer contract', () => {
  it('when layer is open and routeToLayer returns true, spin is NOT called', () => {
    const routeToLayer = vi.fn(() => true);
    const h = mockHost({ hasOpenLayer: () => true, routeToLayer });
    const c = new KeyboardController(h, document); c.attach();
    key('Space');
    expect(routeToLayer).toHaveBeenCalled();
    expect(h.spin).not.toHaveBeenCalled();
    c.detach();
  });

  it('when layer is open and routeToLayer returns false + Escape, closeLayer is called', () => {
    const routeToLayer = vi.fn(() => false);
    const h = mockHost({ hasOpenLayer: () => true, routeToLayer });
    const c = new KeyboardController(h, document); c.attach();
    key('Escape');
    expect(routeToLayer).toHaveBeenCalled();
    expect(h.closeLayer).toHaveBeenCalledOnce();
    c.detach();
  });

  it('when layer is open and routeToLayer returns true for Escape, closeLayer is NOT called', () => {
    const routeToLayer = vi.fn(() => true); // modal consumed Escape itself
    const h = mockHost({ hasOpenLayer: () => true, routeToLayer });
    const c = new KeyboardController(h, document); c.attach();
    key('Escape');
    expect(routeToLayer).toHaveBeenCalled();
    expect(h.closeLayer).not.toHaveBeenCalled();
    c.detach();
  });

  it('when layer is open and routeToLayer returns false for non-Escape, closeLayer is NOT called', () => {
    const routeToLayer = vi.fn(() => false);
    const h = mockHost({ hasOpenLayer: () => true, routeToLayer });
    const c = new KeyboardController(h, document); c.attach();
    key('KeyA');
    expect(routeToLayer).toHaveBeenCalled();
    expect(h.closeLayer).not.toHaveBeenCalled();
    c.detach();
  });
});
