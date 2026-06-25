import { describe, it, expect, vi } from 'vitest';
import { createDoubleTapSkip } from '@/host/skipGesture';

describe('double-tap skip', () => {
  it('fires onSkip on two quick taps when enabled+active', () => {
    const onSkip = vi.fn();
    const d = createDoubleTapSkip({ enabled: () => true, active: () => true, onSkip, thresholdMs: 300 });
    d.tap(1000); d.tap(1200);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
  it('does not fire when taps are too far apart', () => {
    const onSkip = vi.fn();
    const d = createDoubleTapSkip({ enabled: () => true, active: () => true, onSkip });
    d.tap(1000); d.tap(2000);
    expect(onSkip).not.toHaveBeenCalled();
  });
  it('respects enabled() and active() gates', () => {
    const onSkip = vi.fn();
    let on = false, act = true;
    const d = createDoubleTapSkip({ enabled: () => on, active: () => act, onSkip });
    d.tap(1000); d.tap(1100);
    expect(onSkip).not.toHaveBeenCalled(); // disabled
    on = true; act = false;
    d.tap(1200); d.tap(1300);
    expect(onSkip).not.toHaveBeenCalled(); // not presenting
  });
});
