import { describe, it, expect, vi } from 'vitest';
import { createBalanceGate } from '@/host/balanceGate';

describe('createBalanceGate', () => {
  it('paints a balance change immediately when no present is in flight', () => {
    const paint = vi.fn();
    const gate = createBalanceGate(paint, 100);
    gate.onBalance(120);
    expect(paint).toHaveBeenCalledWith(120);
    expect(gate.balance).toBe(120);
  });

  it('suppresses the debit during play→present, then paints it at afterPresent', () => {
    const paint = vi.fn();
    const gate = createBalanceGate(paint, 1000);
    gate.beginPlay();
    gate.onBalance(900); // debit landed before the animation — must NOT flash
    expect(paint).not.toHaveBeenCalled();
    expect(gate.balance).toBe(900); // tracked for affordability even while suppressed
    gate.afterPresent();
    expect(paint).toHaveBeenCalledWith(900); // painted only after present
  });

  it('paints the async win credit that lands AFTER present (the bonus repro)', () => {
    const paint = vi.fn();
    const gate = createBalanceGate(paint, 9700);
    // play debits the buy cost (suppressed), present animates, afterPresent paints the debit.
    gate.beginPlay();
    gate.onBalance(9663.2); // post-debit
    gate.afterPresent();
    expect(paint).toHaveBeenLastCalledWith(9663.2);
    // end-round settles asynchronously after the final ack/afterPresent → credit must paint now.
    gate.onBalance(9708);
    expect(paint).toHaveBeenLastCalledWith(9708);
    expect(gate.balance).toBe(9708);
  });

  it('a credit that lands DURING present is already reflected by afterPresent (no double paint gap)', () => {
    const paint = vi.fn();
    const gate = createBalanceGate(paint, 50);
    gate.beginPlay();
    gate.onBalance(40); // debit
    gate.onBalance(60); // fast credit during the animation (still suppressed)
    expect(paint).not.toHaveBeenCalled();
    gate.afterPresent();
    expect(paint).toHaveBeenCalledTimes(1);
    expect(paint).toHaveBeenCalledWith(60); // latest value painted post-present
  });
});
