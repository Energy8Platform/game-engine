import { describe, expect, it } from 'vitest';
import { withAmounts } from '../src/session';
import type { SpinResult } from '../src/spin';

// No `balance`/`winAmount`/`totalWinAmount` — proves those three stay
// optional on `SpinResult` (this fixture typechecks under
// `npm run typecheck -w @energy8engine/contracts`, same as every other
// consumer that builds a result without ever calling `withAmounts`).
const RESULT: SpinResult = {
  win: 2.5,
  totalWin: 2.5,
  bet: 0.2,
  stage: 'base_game',
  data: {},
  vars: {},
  nextActions: ['spin'],
  roundComplete: true,
  spinsRemaining: 0,
  spinsPlayed: 1,
  scriptSha256: 'deadbeef',
  roundId: 'session-test-1',
};

describe('withAmounts', () => {
  it('turns win/totalWin multipliers into currency amounts, leaving the rest untouched', () => {
    const r = withAmounts(RESULT);
    expect(r.winAmount).toBe(0.5);
    expect(r.totalWinAmount).toBe(0.5);
    // the spread: everything else survives unchanged.
    expect(r.win).toBe(2.5);
    expect(r.roundId).toBe('session-test-1');
  });

  it('rounds to 8 decimals — a multiplier × a currency amount is float arithmetic', () => {
    // Measured, not assumed: 3 * 0.29 is 0.8699999999999999 in IEEE 754,
    // not 0.87. Without `round8` this test would fail on the raw product.
    expect(3 * 0.29).not.toBe(0.87);
    const r = withAmounts({ ...RESULT, win: 3, totalWin: 3, bet: 0.29 });
    expect(r.winAmount).toBe(0.87);
    expect(r.totalWinAmount).toBe(0.87);
  });
});
