/**
 * Gate for WHEN a balance change is painted to the shell readout.
 *
 * The wallet emits balance changes at two moments: the DEBIT lands when `play()` is called (before
 * the scene animates), and the CREDIT (win) lands when the round settles — `/wallet/end-round`
 * fires asynchronously AFTER the final segment's ack, i.e. after `present()`. The HUD-timing rule is
 * "balance updates only after present()", so:
 *   - while a segment is between `beginPlay()` and `afterPresent()`, balance changes are BUFFERED
 *     (the debit must not flash before the animation),
 *   - `afterPresent()` paints the latest buffered value (the debit),
 *   - any later change (the async win credit) paints immediately, because the gate is open again.
 *
 * `balance` always reflects the true latest wallet value (regardless of gating) so an affordability
 * guard can read it. Pure + unit-testable: the shell paint is injected.
 */
export interface BalanceGate {
  /** Record a wallet balance change. Paints it now unless a present is in flight. */
  onBalance(amount: number): void;
  /** A play() was issued — suppress painting until the matching afterPresent() (debit must wait). */
  beginPlay(): void;
  /** A segment finished animating — paint the latest balance and re-open the gate. */
  afterPresent(): void;
  /** The latest wallet balance, painted or not (for affordability checks). */
  readonly balance: number;
}

export function createBalanceGate(paint: (amount: number) => void, initial = 0): BalanceGate {
  let latest = initial;
  let suppressed = false;
  return {
    onBalance(amount: number): void {
      latest = amount;
      if (!suppressed) paint(amount);
    },
    beginPlay(): void {
      suppressed = true;
    },
    afterPresent(): void {
      paint(latest);
      suppressed = false;
    },
    get balance(): number {
      return latest;
    },
  };
}
