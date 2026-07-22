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

  it('paints the DEBIT immediately during play→present (stake leaves the balance on spin)', () => {
    const paint = vi.fn();
    const gate = createBalanceGate(paint, 1000);
    gate.beginPlay();
    gate.onBalance(900); // debit landed on play — must show NOW, not after the animation
    expect(paint).toHaveBeenCalledWith(900);
    expect(gate.balance).toBe(900);
    gate.afterPresent();
    // Already painted — no redundant repaint of the same value.
    expect(paint).toHaveBeenCalledTimes(1);
  });

  it('paints the async win credit that lands AFTER present (the bonus repro)', () => {
    const paint = vi.fn();
    const gate = createBalanceGate(paint, 9700);
    // play debits the buy cost (paints immediately), present animates, afterPresent opens the gate.
    gate.beginPlay();
    gate.onBalance(9663.2); // post-debit → painted now
    expect(paint).toHaveBeenLastCalledWith(9663.2);
    gate.afterPresent();
    // end-round settles asynchronously after the final ack/afterPresent → credit must paint now.
    gate.onBalance(9708);
    expect(paint).toHaveBeenLastCalledWith(9708);
    expect(gate.balance).toBe(9708);
  });

  it('buffers a CREDIT that lands DURING present, flushing it at afterPresent', () => {
    const paint = vi.fn();
    const gate = createBalanceGate(paint, 50);
    gate.beginPlay();
    gate.onBalance(40); // debit → paints immediately
    expect(paint).toHaveBeenLastCalledWith(40);
    gate.onBalance(60); // fast credit during the animation → held back (win must wait)
    expect(paint).toHaveBeenLastCalledWith(40); // NOT 60 yet
    gate.afterPresent();
    expect(paint).toHaveBeenLastCalledWith(60); // credit posts after present
    expect(gate.balance).toBe(60);
  });
});
