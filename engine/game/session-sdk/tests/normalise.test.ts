import { describe, expect, it } from 'vitest';
import type { PlayResultData } from '@energy8platform/game-sdk';
import { normalise } from '../src/normalise';

/** A `PlayResultData` the way `DevBridge`'s `onPlay` path shapes one — no session, `data` as given. */
function raw(over: Partial<PlayResultData> = {}): PlayResultData {
  return {
    roundId: 'r-1',
    action: 'spin',
    balanceAfter: 5001,
    totalWin: 1,
    currency: 'EUR',
    gameId: 'dev-game',
    data: { stage: 'base', win: 5, vars: { streak: 2 } },
    nextActions: [],
    session: null,
    ...over,
  };
}

describe('normalise — the spec §3 table, row by row', () => {
  it('no session, data.win present: every field lands where the table says', () => {
    expect(normalise(raw(), 0.2)).toEqual({
      bet: 0.2,
      win: 5,
      // The platform's `totalWin` 1 is money; 1 / 0.2 is the multiplier.
      totalWin: 5,
      stage: 'base',
      data: { stage: 'base', win: 5, vars: { streak: 2 } },
      vars: { streak: 2 },
      nextActions: [],
      roundComplete: true,
      spinsRemaining: 0,
      spinsPlayed: 0,
      scriptSha256: '',
      roundId: 'r-1',
      balance: 5001,
    });
  });

  it('data.win absent: win is totalWin / bet — the platform speaks money, the result speaks multipliers', () => {
    expect(normalise(raw({ totalWin: 3, data: {} }), 0.5).win).toBe(6);
  });

  it('bet 0: win and totalWin are 0, not NaN or Infinity', () => {
    const r = normalise(raw({ totalWin: 3, data: {} }), 0);
    expect(r.win).toBe(0);
    expect(r.totalWin).toBe(0);
  });

  it('data.win present but not a number is ignored the same as absent', () => {
    expect(normalise(raw({ totalWin: 2, data: { win: '5' } }), 1).win).toBe(2);
  });

  it('no session: roundComplete is "nothing left to do" — nextActions empty', () => {
    expect(normalise(raw({ nextActions: [] }), 1).roundComplete).toBe(true);
    expect(normalise(raw({ nextActions: ['free_spin'] }), 1).roundComplete).toBe(false);
  });

  it('with an open session: totalWin, spins and roundComplete all come from the session', () => {
    const r = normalise(
      raw({
        totalWin: 1,
        nextActions: [],
        session: { spinsRemaining: 3, spinsPlayed: 2, totalWin: 7, completed: false },
      }),
      1,
    );
    expect(r.totalWin).toBe(7);
    expect(r.spinsRemaining).toBe(3);
    expect(r.spinsPlayed).toBe(2);
    // nextActions is empty, yet the session says the round is still open —
    // the session wins.
    expect(r.roundComplete).toBe(false);
  });

  it('with a completed session: roundComplete is true even when nextActions is not empty', () => {
    const r = normalise(
      raw({
        nextActions: ['spin'],
        session: { spinsRemaining: 0, spinsPlayed: 5, totalWin: 9, completed: true },
      }),
      1,
    );
    expect(r.roundComplete).toBe(true);
    expect(r.totalWin).toBe(9);
  });

  it('a session with no `completed` flag reads as open', () => {
    const r = normalise(
      raw({ nextActions: [], session: { spinsRemaining: 1, spinsPlayed: 0, totalWin: 0 } }),
      1,
    );
    expect(r.roundComplete).toBe(false);
  });

  it('stage is data.stage when it is a string, else the action that ran', () => {
    expect(normalise(raw({ data: { stage: 'bonus' } }), 1).stage).toBe('bonus');
    expect(normalise(raw({ action: 'free_spin', data: {} }), 1).stage).toBe('free_spin');
    expect(normalise(raw({ action: 'spin', data: { stage: 3 } }), 1).stage).toBe('spin');
  });

  it('vars is data.vars when it is a record, else {}', () => {
    expect(normalise(raw({ data: { vars: { a: 1 } } }), 1).vars).toEqual({ a: 1 });
    expect(normalise(raw({ data: {} }), 1).vars).toEqual({});
    expect(normalise(raw({ data: { vars: [1, 2] } }), 1).vars).toEqual({});
    expect(normalise(raw({ data: { vars: 'x' } }), 1).vars).toEqual({});
  });

  it('a host that omits nextActions is read as [] — and, with no session, as a complete round', () => {
    const r = normalise(raw({ nextActions: undefined as unknown as string[] }), 1);
    expect(r.nextActions).toEqual([]);
    expect(r.roundComplete).toBe(true);
  });

  it('balance is balanceAfter and roundId is the platform round id', () => {
    const r = normalise(raw({ balanceAfter: 42.5, roundId: 'abc' }), 1);
    expect(r.balance).toBe(42.5);
    expect(r.roundId).toBe('abc');
  });
});
