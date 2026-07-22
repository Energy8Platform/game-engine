/**
 * Gate for WHEN a balance change is painted to the shell readout.
 *
 * The wallet emits balance changes at two moments: the DEBIT lands when `play()` is called (before
 * the scene animates), and the CREDIT (win) lands when the round settles — `/wallet/end-round`
 * fires asynchronously AFTER the final segment's ack, i.e. after `present()`. The HUD-timing rule is
 * "the stake leaves your balance the instant you spin; the win is only added after the animation":
 *   - a DEBIT (balance goes DOWN) paints IMMEDIATELY, even between `beginPlay()` and
 *     `afterPresent()` — the player must see the stake deducted the moment they press spin,
 *   - a CREDIT (balance goes UP) that lands DURING that window is BUFFERED — the win must not
 *     update the balance before the animation plays out,
 *   - `afterPresent()` flushes any buffered credit,
 *   - a credit that lands after the window (the usual case — end-round settles after the final ack)
 *     paints immediately, because the gate is open again.
 *
 * `balance` always reflects the true latest wallet value (regardless of gating) so an affordability
 * guard can read it. Pure + unit-testable: the shell paint is injected.
 */
export interface BalanceGate {
  /** Record a wallet balance change. Debits paint now; a credit mid-present waits for afterPresent. */
  onBalance(amount: number): void;
  /** A play() was issued — buffer credits until the matching afterPresent() (debits still paint). */
  beginPlay(): void;
  /** A segment finished animating — flush any buffered credit and re-open the gate. */
  afterPresent(): void;
  /** The latest wallet balance, painted or not (for affordability checks). */
  readonly balance: number;
}

export function createBalanceGate(paint: (amount: number) => void, initial = 0): BalanceGate {
  let latest = initial;
  let painted = initial;
  let suppressed = false;
  const show = (amount: number): void => {
    painted = amount;
    paint(amount);
  };
  return {
    onBalance(amount: number): void {
      latest = amount;
      // During play→present, hold a CREDIT (balance rising) back so the win doesn't post before the
      // animation. A DEBIT (balance falling — the stake) always paints now: spin deducts instantly.
      if (suppressed && amount > painted) return;
      show(amount);
    },
    beginPlay(): void {
      suppressed = true;
    },
    afterPresent(): void {
      if (latest !== painted) show(latest); // flush a credit that landed mid-present
      suppressed = false;
    },
    get balance(): number {
      return latest;
    },
  };
}
