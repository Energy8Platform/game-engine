// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { KeyboardController, type KeyboardHost } from '@/keyboard';

function mockHost(over: Partial<KeyboardHost> = {}): KeyboardHost {
  return {
    state: { mode: 'base', busy: false, autoplay: { active: false, remaining: 0 }, bet: 1, availableBets: [1,2], replay: false } as any,
    hotkeysEnabled: true, spacebarEnabled: true, turboLevels: 1, autoplayEnabled: true, buyBonusEnabled: true,
    hasOpenLayer: () => false, routeToLayer: () => false,
    spin: vi.fn(), stepBet: vi.fn(), toggleAutoplay: vi.fn(), cycleTurbo: vi.fn(),
    openBuyBonus: vi.fn(), openInfo: vi.fn(), openMenu: vi.fn(), toggleMute: vi.fn(), closeLayer: vi.fn(),
    ...over,
  };
}
const key = (init: Partial<KeyboardEvent>) => new KeyboardEvent('keydown', init as any);

describe('KeyboardController spin', () => {
  it('Space (no repeat) spins in base/idle', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(key({ code: 'Space' }));
    expect(h.spin).toHaveBeenCalledTimes(1); c.detach();
  });
  it('ignores Space when a layer is open (routes instead)', () => {
    const route = vi.fn(() => false);
    const h = mockHost({ hasOpenLayer: () => true, routeToLayer: route });
    const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(key({ code: 'Space' }));
    expect(route).toHaveBeenCalled(); expect(h.spin).not.toHaveBeenCalled(); c.detach();
  });
  it('respects spacebarEnabled=false', () => {
    const h1 = mockHost({ spacebarEnabled: false }); const c1 = new KeyboardController(h1, document); c1.attach();
    document.dispatchEvent(key({ code: 'Space' })); expect(h1.spin).not.toHaveBeenCalled(); c1.detach();
  });
  it('respects hotkeysEnabled=false', () => {
    const h = mockHost({ hotkeysEnabled: false }); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(key({ code: 'Space' })); expect(h.spin).not.toHaveBeenCalled(); c.detach();
  });
  it('ignores keys when an editable element is focused', () => {
    const input = document.createElement('input'); document.body.appendChild(input); input.focus();
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    input.dispatchEvent(Object.assign(key({ code: 'Space' }), {})); // target is input
    expect(h.spin).not.toHaveBeenCalled(); c.detach(); input.remove();
  });
});

describe('KeyboardController hold-to-step-bet', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('Shift+ArrowUp steps bet once on press, then repeats after 350ms', () => {
    vi.useFakeTimers();
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp', shiftKey: true }));
    expect(h.stepBet).toHaveBeenCalledWith(1); expect(h.stepBet).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(349); expect(h.stepBet).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);   expect(h.stepBet).toHaveBeenCalledTimes(2);  // first repeat at 350ms
    vi.advanceTimersByTime(90);  expect(h.stepBet).toHaveBeenCalledTimes(3);  // then every 90ms
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'ArrowUp' }));
    vi.advanceTimersByTime(500); expect(h.stepBet).toHaveBeenCalledTimes(3);
    c.detach(); vi.useRealTimers();
  });

  it('ArrowUp WITHOUT shift does not step bet on the bar', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'ArrowUp' }));
    expect(h.stepBet).not.toHaveBeenCalled(); c.detach();
  });
});

describe('KeyboardController hold-to-spin', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('held Space re-fires after spin completes, respecting the 120ms floor', () => {
    vi.useFakeTimers();
    const state: any = { mode: 'base', busy: false, autoplay: { active: false }, };
    const h = mockHost({ state, spin: vi.fn(() => { state.busy = true; }) });
    const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));   // spin #1, busy=true
    expect(h.spin).toHaveBeenCalledTimes(1);
    state.busy = false; c.notifyBusyChanged(false);                            // completes immediately
    vi.advanceTimersByTime(119); expect(h.spin).toHaveBeenCalledTimes(1);       // floor not reached
    vi.advanceTimersByTime(2);  expect(h.spin).toHaveBeenCalledTimes(2);        // spin #2 after 120ms
    document.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' }));      // release
    state.busy = false; c.notifyBusyChanged(false);
    vi.advanceTimersByTime(200); expect(h.spin).toHaveBeenCalledTimes(2);       // no more after release
    c.detach(); vi.useRealTimers();
  });
});
