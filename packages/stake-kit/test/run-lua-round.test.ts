import { describe, it, expect } from 'vitest';
import { runLuaRound } from '../src/harness/plugin';

/**
 * `runLuaRound` drives a fake LuaEngine through ONE round and collects every spin (the trigger +
 * all free spins of a bonus) into a single `events` array — the kitsune full-event book shape the
 * dev-RGS no-books path feeds to the bridge for segment-by-segment playback.
 *
 * Per-spin win nuance: a mid-session execute returns that spin's own win, but the spin that
 * COMPLETES the session returns the SESSION total — so its own win is `total − alreadyCollected`.
 */

/** A scripted LuaEngine: returns the queued results in order, one per execute(). */
function scriptedEngine(results: Array<Record<string, unknown>>) {
  let i = 0;
  return {
    execute(): Record<string, unknown> {
      return results[i++] ?? {};
    },
  };
}

describe('runLuaRound', () => {
  it('a plain spin with no session is a single-event round', () => {
    const engine = scriptedEngine([{ totalWin: 4, data: { matrix: [] }, session: null }]);
    const { payoutCents, events } = runLuaRound(engine, 'spin', 1);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('spin');
    // Canonical Stake event: { type, spin } only; the win lives in spin.total_win.
    expect(Object.keys(events[0]).sort()).toEqual(['spin', 'type']);
    expect((events[0].spin as { total_win: number }).total_win).toBe(4);
    expect(payoutCents).toBe(400); // 4× × 100
  });

  it('collects a buy_bonus trigger + every free spin into one round; payout = session total', () => {
    const engine = scriptedEngine([
      // buy_bonus opens the session, no base win.
      { totalWin: 0, data: { free_spins: { awarded: 3 } }, nextActions: ['free_spin'], session: { completed: false } },
      // free spins (mid-session): each returns its OWN win.
      { totalWin: 2, data: {}, nextActions: ['free_spin'], session: { completed: false } },
      { totalWin: 5, data: {}, nextActions: ['free_spin'], session: { completed: false } },
      // completing spin: returns the SESSION total (0 + 2 + 5 + own=0 = 7).
      { totalWin: 7, data: {}, nextActions: ['spin'], session: { completed: true } },
    ]);
    const { payoutCents, events } = runLuaRound(engine, 'buy_bonus', 1);

    // 1 trigger + 3 free spins.
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.type)).toEqual(['spin', 'free_spin', 'free_spin', 'free_spin']);

    // Per-spin wins in spin.total_win: trigger 0, fs 2, fs 5, completing spin's OWN win = total(7) − collected(7) = 0.
    expect(events.map((e) => (e.spin as { total_win: number }).total_win)).toEqual([0, 2, 5, 0]);

    // payout = the session total (bet-multiplier) × 100.
    expect(payoutCents).toBe(700);
  });

  it('scales per-spin win by the bet (win_x is a bet-multiplier)', () => {
    const engine = scriptedEngine([{ totalWin: 10, data: {}, session: null }]);
    const { payoutCents, events } = runLuaRound(engine, 'spin', 2); // bet 2 → win 10 ⇒ 5×
    expect((events[0].spin as { total_win: number }).total_win).toBe(5);
    expect(payoutCents).toBe(500);
  });
});
