// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { KeyboardController, type KeyboardHost } from '@/core/keyboard';

function mockHost(over: Partial<KeyboardHost> = {}): KeyboardHost {
  return {
    state: { mode: 'base', busy: false, autoplay: { active: false, remaining: 0 }, bet: 1, availableBets: [1,2], replay: false, buyBonusEnabled: true } as any,
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

describe('KeyboardController Shift-hotkeys', () => {
  it('Shift+A toggles autoplay; bare A does nothing', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA' }));
    expect(h.toggleAutoplay).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', shiftKey: true }));
    expect(h.toggleAutoplay).toHaveBeenCalledTimes(1); c.detach();
  });

  it('Shift+A is inert when autoplayEnabled=false', () => {
    const h = mockHost({ autoplayEnabled: false }); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', shiftKey: true }));
    expect(h.toggleAutoplay).not.toHaveBeenCalled(); c.detach();
  });

  it('Shift+T cycles turbo; bare T does nothing', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT' }));
    expect(h.cycleTurbo).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', shiftKey: true }));
    expect(h.cycleTurbo).toHaveBeenCalledTimes(1); c.detach();
  });

  it('Shift+T is inert when turboLevels=0', () => {
    const h = mockHost({ turboLevels: 0 }); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', shiftKey: true }));
    expect(h.cycleTurbo).not.toHaveBeenCalled(); c.detach();
  });

  it('Shift+B opens buy bonus; bare B does nothing', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB' }));
    expect(h.openBuyBonus).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', shiftKey: true }));
    expect(h.openBuyBonus).toHaveBeenCalledTimes(1); c.detach();
  });

  it('Shift+B is inert when buyBonusEnabled=false', () => {
    const h = mockHost({ buyBonusEnabled: false }); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', shiftKey: true }));
    expect(h.openBuyBonus).not.toHaveBeenCalled(); c.detach();
  });

  it('Shift+B is inert when not in base mode', () => {
    const h = mockHost({ state: { mode: 'freeSpins', busy: false, autoplay: { active: false, remaining: 0 }, bet: 1, availableBets: [1,2], replay: false } as any });
    const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', shiftKey: true }));
    expect(h.openBuyBonus).not.toHaveBeenCalled(); c.detach();
  });

  it('Shift+I opens info; bare I does nothing', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI' }));
    expect(h.openInfo).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', shiftKey: true }));
    expect(h.openInfo).toHaveBeenCalledTimes(1); c.detach();
  });

  it('Shift+S opens menu; bare S does nothing', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS' }));
    expect(h.openMenu).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', shiftKey: true }));
    expect(h.openMenu).toHaveBeenCalledTimes(1); c.detach();
  });

  it('Shift+M toggles mute; bare M does nothing', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
    expect(h.toggleMute).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', shiftKey: true }));
    expect(h.toggleMute).toHaveBeenCalledTimes(1); c.detach();
  });

  it('Shift+I and Shift+S and Shift+M work in replay mode', () => {
    const h = mockHost({ state: { mode: 'replay', busy: false, autoplay: { active: false, remaining: 0 }, bet: 1, availableBets: [1,2], replay: true } as any });
    const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyI', shiftKey: true }));
    expect(h.openInfo).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', shiftKey: true }));
    expect(h.openMenu).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', shiftKey: true }));
    expect(h.toggleMute).toHaveBeenCalledTimes(1);
    c.detach();
  });

  it('replay mode makes play hotkeys inert', () => {
    const h = mockHost({ state: { mode: 'base', busy: false, autoplay: { active: false, remaining: 0 }, bet: 1, availableBets: [1,2], replay: true } as any });
    const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', shiftKey: true }));
    expect(h.toggleAutoplay).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', shiftKey: true }));
    expect(h.cycleTurbo).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyB', shiftKey: true }));
    expect(h.openBuyBonus).not.toHaveBeenCalled();
    c.detach();
  });

  it('all hotkeys are inert when hotkeysEnabled=false', () => {
    const h = mockHost({ hotkeysEnabled: false }); const c = new KeyboardController(h, document); c.attach();
    for (const code of ['KeyA', 'KeyT', 'KeyB', 'KeyI', 'KeyS', 'KeyM']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { code, shiftKey: true }));
    }
    expect(h.toggleAutoplay).not.toHaveBeenCalled();
    expect(h.cycleTurbo).not.toHaveBeenCalled();
    expect(h.openBuyBonus).not.toHaveBeenCalled();
    expect(h.openInfo).not.toHaveBeenCalled();
    expect(h.openMenu).not.toHaveBeenCalled();
    expect(h.toggleMute).not.toHaveBeenCalled();
    c.detach();
  });

  it('Escape with no layer open is a no-op', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }));
    expect(h.closeLayer).not.toHaveBeenCalled(); c.detach();
  });
});

describe('KeyboardController onBlur', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('blur clears spaceHeld so notifyBusyChanged does not re-spin', () => {
    vi.useFakeTimers();
    const state: any = { mode: 'base', busy: false, autoplay: { active: false } };
    const h = mockHost({ state, spin: vi.fn(() => { state.busy = true; }) });
    const c = new KeyboardController(h, document); c.attach();
    document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    expect(h.spin).toHaveBeenCalledTimes(1);
    // blur while space is held
    window.dispatchEvent(new Event('blur'));
    state.busy = false; c.notifyBusyChanged(false);
    vi.advanceTimersByTime(200);
    expect(h.spin).toHaveBeenCalledTimes(1); // no extra spin after blur
    c.detach(); vi.useRealTimers();
  });
});

/**
 * Shift+B must obey the same locks the bar's coin does.
 *
 * Reported from QA: "press spin and you can still manage to hit buy bonus." The coin itself was
 * never the hole — both bars gate it on `busy || autoplay || !state.buyBonusEnabled` and re-apply
 * that on every rebuild. The hotkey was the way in: it checked only the CONFIG flag
 * (`features.buyBonus !== false`), the mode and replay, so it opened the overlay mid-round — and a
 * bonus bought there is a second bet placed on top of a round already in flight.
 */
describe('KeyboardController Shift+B respects the same locks as the coin', () => {
  const shiftB = () => document.dispatchEvent(key({ code: 'KeyB', shiftKey: true }));

  it('opens the buy-bonus overlay when idle', () => {
    const h = mockHost(); const c = new KeyboardController(h, document); c.attach();
    shiftB();
    expect(h.openBuyBonus).toHaveBeenCalledTimes(1); c.detach();
  });

  it('does NOT open it mid-round — the reported bug', () => {
    const h = mockHost({
      state: { mode: 'base', busy: true, autoplay: { active: false, remaining: 0 }, bet: 1, availableBets: [1, 2], replay: false, buyBonusEnabled: true } as any,
    });
    const c = new KeyboardController(h, document); c.attach();
    shiftB();
    expect(h.openBuyBonus).not.toHaveBeenCalled(); c.detach();
  });

  it('does NOT open it during an autoplay run', () => {
    const h = mockHost({
      state: { mode: 'base', busy: false, autoplay: { active: true, remaining: 5 }, bet: 1, availableBets: [1, 2], replay: false, buyBonusEnabled: true } as any,
    });
    const c = new KeyboardController(h, document); c.attach();
    shiftB();
    expect(h.openBuyBonus).not.toHaveBeenCalled(); c.detach();
  });

  it('honours the host turning buying off at runtime, not just the config flag', () => {
    // setBuyBonusEnabled(false) is how a host says "not right now" (e.g. an open round on resume).
    // The coin obeys it; the hotkey read the config flag instead and never saw it.
    const h = mockHost({
      state: { mode: 'base', busy: false, autoplay: { active: false, remaining: 0 }, bet: 1, availableBets: [1, 2], replay: false, buyBonusEnabled: false } as any,
    });
    const c = new KeyboardController(h, document); c.attach();
    shiftB();
    expect(h.openBuyBonus).not.toHaveBeenCalled(); c.detach();
  });
});
