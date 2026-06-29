import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
// @vitest-environment jsdom
/**
 * Task 9: Keyboard navigation inside bet & autoplay pickers (Pixi shell).
 *
 * Tests that PickerModal.onKey (the real onKey path in pickers.ts buildSheet) correctly:
 * 1. ArrowRight / ArrowDown advance the highlight.
 * 2. ArrowLeft / ArrowUp retreat the highlight (clamped at start).
 * 3. Enter fires the correct event with the HIGHLIGHTED value.
 * 4. Space also confirms with the highlighted value.
 * 5. Escape calls host.closeLayer() and does NOT fire the event.
 * 6. Equal/Minus (+/-) keys also advance/retreat the highlight.
 * 7. Unknown keys return false (pass-through).
 */
import { describe, it, expect, vi } from 'vitest';
import type { PixiComponentContext, ShellLayer } from '@/ui/pixi/context';
import { createInitialState } from '@/core/state';
import { openBetPicker, openAutoplayPicker } from '@/ui/pixi/components/pickers';
import { KeyboardController, type KeyboardHost } from '@/core/keyboard';
import { makeContext, defaultConfig, type HostOverrides } from './_host';

function baseConfig(over: Record<string, unknown> = {}): any {
  return defaultConfig({ availableBets: [1, 2, 5, 10], defaultBet: 1, balance: 1000, features: { turbo: 0, autoplay: {}, buyBonus: false }, ...over });
}

function makeHost(
  emitSpy: ReturnType<typeof vi.fn>,
  closeLayerSpy: ReturnType<typeof vi.fn>,
  over: HostOverrides = {},
): PixiComponentContext {
  return makeContext({ config: over.config ?? baseConfig(), emit: emitSpy as never, closeLayer: closeLayerSpy, ...over });
}

const key = (code: string): KeyboardEvent =>
  new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true });

// ─── helpers ────────────────────────────────────────────────────────────────

function requireOnKey(layer: ShellLayer): (e: KeyboardEvent) => boolean {
  if (typeof layer.onKey !== 'function') throw new Error('Layer has no onKey method');
  return layer.onKey.bind(layer);
}

// ─── autoplay picker ────────────────────────────────────────────────────────

describe('Pixi picker keyboard navigation — autoplay picker', () => {
  // Default counts: [10, 25, 50, 100, 250, 500, 1000, 2000, Infinity]
  // Default selection: first count = 10 (remaining=0 → counts[0])

  it('ArrowRight moves highlight; Enter fires autoplayStart with highlighted count', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openAutoplayPicker(host);
    const onKey = requireOnKey(layer);

    // ArrowRight twice: highlight 0 → 1 → 2 (counts[2] = 50)
    expect(onKey(key('ArrowRight'))).toBe(true);
    expect(onKey(key('ArrowRight'))).toBe(true);

    // Enter: confirm
    expect(onKey(key('Enter'))).toBe(true);

    // autoplayStart should have fired with remaining=50
    expect(emitSpy).toHaveBeenCalledWith('autoplayStart', { active: true, remaining: 50 });
    expect(closeLayerSpy).toHaveBeenCalledOnce();
  });

  it('ArrowDown also advances highlight', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openAutoplayPicker(host);
    const onKey = requireOnKey(layer);

    onKey(key('ArrowDown')); // highlight 0 → 1 (counts[1] = 25)
    onKey(key('Enter'));

    expect(emitSpy).toHaveBeenCalledWith('autoplayStart', { active: true, remaining: 25 });
  });

  it('ArrowLeft retreats highlight; clamps at index 0', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openAutoplayPicker(host);
    const onKey = requireOnKey(layer);

    // Move right to index 2, then back past start
    onKey(key('ArrowRight'));
    onKey(key('ArrowRight'));
    onKey(key('ArrowLeft'));
    onKey(key('ArrowLeft'));
    onKey(key('ArrowLeft')); // clamped — still index 0
    onKey(key('Enter'));

    // Should confirm with counts[0] = 10
    expect(emitSpy).toHaveBeenCalledWith('autoplayStart', { active: true, remaining: 10 });
  });

  it('ArrowUp retreats highlight', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openAutoplayPicker(host);
    const onKey = requireOnKey(layer);

    onKey(key('ArrowRight'));
    onKey(key('ArrowRight')); // index 2 (50)
    onKey(key('ArrowUp'));    // back to index 1 (25)
    onKey(key('Enter'));

    expect(emitSpy).toHaveBeenCalledWith('autoplayStart', { active: true, remaining: 25 });
  });

  it('Space also confirms with highlighted count', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openAutoplayPicker(host);
    const onKey = requireOnKey(layer);

    onKey(key('ArrowRight')); // index 1 (25)
    expect(onKey(key('Space'))).toBe(true);

    expect(emitSpy).toHaveBeenCalledWith('autoplayStart', { active: true, remaining: 25 });
  });

  it('Escape calls closeLayer and does NOT fire autoplayStart', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openAutoplayPicker(host);
    const onKey = requireOnKey(layer);

    onKey(key('ArrowRight')); // move highlight so we'd get a different count if confirmed
    const result = onKey(key('Escape'));

    expect(result).toBe(true);
    expect(closeLayerSpy).toHaveBeenCalledOnce();
    expect(emitSpy).not.toHaveBeenCalledWith('autoplayStart', expect.anything());
  });

  it('unknown key returns false (pass-through)', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openAutoplayPicker(host);
    const onKey = requireOnKey(layer);

    expect(onKey(key('KeyX'))).toBe(false);
    expect(emitSpy).not.toHaveBeenCalled();
    expect(closeLayerSpy).not.toHaveBeenCalled();
  });
});

// ─── bet picker ─────────────────────────────────────────────────────────────

describe('Pixi picker keyboard navigation — bet picker', () => {
  // availableBets: [1, 2, 5, 10], defaultBet: 1 → initial highlight index 0

  it('ArrowRight moves highlight; Enter fires betChange with highlighted bet', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBetPicker(host);
    const onKey = requireOnKey(layer);

    // ArrowRight twice: index 0 (1) → 1 (2) → 2 (5)
    expect(onKey(key('ArrowRight'))).toBe(true);
    expect(onKey(key('ArrowRight'))).toBe(true);
    expect(onKey(key('Enter'))).toBe(true);

    expect(emitSpy).toHaveBeenCalledWith('betChange', 5);
    expect(closeLayerSpy).toHaveBeenCalledOnce();
  });

  it('ArrowLeft retreats highlight; clamped at start', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBetPicker(host);
    const onKey = requireOnKey(layer);

    onKey(key('ArrowRight')); // index 1 (2)
    onKey(key('ArrowLeft'));  // back to index 0 (1)
    onKey(key('ArrowLeft'));  // clamped at 0
    onKey(key('Enter'));

    // bet 1 is same as defaultBet — no betChange (pickers.ts only emits if v !== state.bet)
    expect(emitSpy).not.toHaveBeenCalledWith('betChange', expect.anything());
    expect(closeLayerSpy).toHaveBeenCalledOnce();
  });

  it('Equal (+) key advances highlight; Minus (-) key retreats', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBetPicker(host);
    const onKey = requireOnKey(layer);

    expect(onKey(key('Equal'))).toBe(true);  // index 0 → 1 (2)
    expect(onKey(key('Equal'))).toBe(true);  // index 1 → 2 (5)
    expect(onKey(key('Minus'))).toBe(true);  // index 2 → 1 (2)
    onKey(key('Enter'));

    expect(emitSpy).toHaveBeenCalledWith('betChange', 2);
  });

  it('NumpadAdd advances; NumpadSubtract retreats', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBetPicker(host);
    const onKey = requireOnKey(layer);

    onKey(key('NumpadAdd'));      // index 0 → 1 (2)
    onKey(key('NumpadAdd'));      // index 1 → 2 (5)
    onKey(key('NumpadSubtract')); // index 2 → 1 (2)
    onKey(key('Enter'));

    expect(emitSpy).toHaveBeenCalledWith('betChange', 2);
  });

  it('ArrowRight clamps at the last bet', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBetPicker(host);
    const onKey = requireOnKey(layer);

    // Slam right 10 times — should clamp at index 3 (bet=10)
    for (let i = 0; i < 10; i++) onKey(key('ArrowRight'));
    onKey(key('Enter'));

    expect(emitSpy).toHaveBeenCalledWith('betChange', 10);
  });

  it('Space confirms with the highlighted bet', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBetPicker(host);
    const onKey = requireOnKey(layer);

    onKey(key('ArrowRight')); // index 1 (2)
    expect(onKey(key('Space'))).toBe(true);

    expect(emitSpy).toHaveBeenCalledWith('betChange', 2);
  });

  it('Escape closes without firing betChange', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBetPicker(host);
    const onKey = requireOnKey(layer);

    onKey(key('ArrowRight')); // move away from default
    expect(onKey(key('Escape'))).toBe(true);

    expect(closeLayerSpy).toHaveBeenCalledOnce();
    expect(emitSpy).not.toHaveBeenCalledWith('betChange', expect.anything());
  });

  it('unknown key returns false', () => {
    const emitSpy = vi.fn();
    const closeLayerSpy = vi.fn();
    const host = makeHost(emitSpy, closeLayerSpy);
    const layer = openBetPicker(host);
    const onKey = requireOnKey(layer);

    expect(onKey(key('Tab'))).toBe(false);
  });
});

// ─── controller-driven (end-to-end: document keydown → controller → routeToLayer → onKey) ──────
// The tests above call layer.onKey() directly. These dispatch a REAL keydown through a
// KeyboardController whose host routes to the open layer — the path the live shell uses, and the
// coverage gap behind the "Enter does nothing" bug report.
describe('Pixi picker — Enter routed through the KeyboardController', () => {
  function controllerFor(layer: ShellLayer): { ctrl: KeyboardController; detach: () => void } {
    const noop = () => {};
    const kbHost: KeyboardHost = {
      state: createInitialState(baseConfig()),
      hotkeysEnabled: true,
      spacebarEnabled: true,
      turboLevels: 0,
      autoplayEnabled: true,
      buyBonusEnabled: false,
      hasOpenLayer: () => true,
      routeToLayer: (e) => layer.onKey?.(e) ?? false,
      spin: noop,
      stepBet: noop,
      toggleAutoplay: noop,
      cycleTurbo: noop,
      openBuyBonus: noop,
      openInfo: noop,
      openMenu: noop,
      toggleMute: noop,
      closeLayer: noop,
    };
    const ctrl = new KeyboardController(kbHost, document);
    ctrl.attach();
    return { ctrl, detach: () => ctrl.detach() };
  }

  it('autoplay picker: ArrowRight then a real Enter keydown fires autoplayStart', () => {
    const emitSpy = vi.fn();
    const host = makeHost(emitSpy, vi.fn());
    const layer = openAutoplayPicker(host);
    const { detach } = controllerFor(layer);

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));

    expect(emitSpy).toHaveBeenCalledWith('autoplayStart', { active: true, remaining: 25 });
    detach();
  });

  it('bet picker: a real Enter keydown applies the highlighted bet', () => {
    const emitSpy = vi.fn();
    const host = makeHost(emitSpy, vi.fn(), { config: baseConfig({ availableBets: [1, 2, 5], currentBet: 1 }) });
    const layer = openBetPicker(host);
    const { detach } = controllerFor(layer);

    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowRight' })); // 1 → 2
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));

    expect(emitSpy).toHaveBeenCalledWith('betChange', 2);
    detach();
  });
});
