import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';

import {
  API_MULTIPLIER,
  type RGSAuthenticateResponse,
  type RGSPlayResponse,
  type RGSEndRoundResponse,
  type RGSEventResponse,
  type RGSReplayResponse,
  type RGSBalance,
} from '@energy8platform/stake-bridge';

import { createDevRgs, NoBooksError } from '../src/harness/dev-rgs';

// ---------------------------------------------------------------------------
// Fixture setup — index.json + lookUpTable_BASE_0.csv + books_BASE.jsonl.zst
// ---------------------------------------------------------------------------

let dir: string;

// Books: id 0 = lose, id 1 = 2.5x win (payoutCents 250), id 2 = 50x (5000).
// Curated books carry the round's `events[]`, each event's `data.total_win` = that spin's
// bet-multiplier — dev-RGS passes them through verbatim so the adapter splits them into segments.
const JSONL_LINES =
  [
    '{"id":0,"payoutMultiplier":0,"events":[]}',
    '{"id":1,"payoutMultiplier":250,"events":[{"type":"spin","spin":{"total_win":2.5}}]}',
    '{"id":2,"payoutMultiplier":5000,"events":[]}',
  ].join('\n') + '\n';

// A BONUS mode whose single book (id 0) is ONE round of 3 events — a trigger + two free spins.
// dev-RGS must pass these through so the bridge streams them as separate segments.
const BONUS_JSONL =
  '{"id":0,"payoutMultiplier":700,"events":[' +
  '{"type":"spin","spin":{"total_win":0}},' +
  '{"type":"free_spin","spin":{"total_win":2}},' +
  '{"type":"free_spin","spin":{"total_win":5}}]}\n';
const BONUS_LUT = '0,1,700\n';

// LUT: sim, weight, payoutCents. Row 1 has overwhelming weight (1000).
const LUT_CSV = '0,1,0\n1,1000,250\n2,1,5000\n';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'dev-rgs-'));

  const index = {
    modes: [
      {
        name: 'BASE',
        cost: 1,
        events: 'books_BASE.jsonl.zst',
        weights: 'lookUpTable_BASE_0.csv',
      },
      {
        name: 'BONUS',
        cost: 100,
        events: 'books_BONUS.jsonl.zst',
        weights: 'lookUpTable_BONUS_0.csv',
      },
    ],
  };
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index));
  writeFileSync(join(dir, 'lookUpTable_BASE_0.csv'), LUT_CSV);
  writeFileSync(
    join(dir, 'books_BASE.jsonl.zst'),
    zstdCompressSync(Buffer.from(JSONL_LINES)),
  );
  writeFileSync(join(dir, 'lookUpTable_BONUS_0.csv'), BONUS_LUT);
  writeFileSync(
    join(dir, 'books_BONUS.jsonl.zst'),
    zstdCompressSync(Buffer.from(BONUS_JSONL)),
  );
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeRgs() {
  // Seeded rng that returns 0.5 always → pickWeighted selects the
  // overwhelming-weight row (sim=1, payoutCents=250). See harness-books.test.
  return createDevRgs({
    booksDir: dir,
    gameId: 'g',
    betLevelsMajor: [1, 2, 5],
    currency: 'USD',
    startingBalanceMajor: 1000,
    rng: () => 0.5,
  });
}

function makeRgsDefaultCurrency() {
  // No currency supplied → should default to EUR.
  return createDevRgs({
    booksDir: dir,
    gameId: 'g',
    betLevelsMajor: [1, 2, 5],
    startingBalanceMajor: 1000,
    rng: () => 0.5,
  });
}

// ---------------------------------------------------------------------------
// authenticate
// ---------------------------------------------------------------------------

describe('authenticate', () => {
  it('returns starting balance, null round, and spec-derived config', async () => {
    const rgs = makeRgs();
    const res: RGSAuthenticateResponse = await rgs.authenticate();

    expect(res.balance.amount).toBe(1000 * API_MULTIPLIER);
    expect(res.balance.currency).toBe('USD');
    expect(res.round).toBeNull();

    expect(res.config.gameID).toBe('g');
    expect(res.config.betLevels).toEqual([
      1 * API_MULTIPLIER,
      2 * API_MULTIPLIER,
      5 * API_MULTIPLIER,
    ]);
    expect(res.config.minBet).toBe(1 * API_MULTIPLIER);
    expect(res.config.maxBet).toBe(5 * API_MULTIPLIER);
    expect(res.config.defaultBetLevel).toBe(1 * API_MULTIPLIER);
    expect(res.config.stepBet).toBe(1 * API_MULTIPLIER);
    // betModes keyed by index.json mode names with cost.
    expect(res.config.betModes).toBeDefined();
    expect(res.config.betModes!.BASE).toBeDefined();
  });

  it('surfaces a lingering (un-settled) winning round so a reload can resume it', async () => {
    const rgs = makeRgs();
    await rgs.authenticate();

    // A winning play that is NOT followed by end-round leaves the round open.
    const bet = 1 * API_MULTIPLIER;
    await rgs.play({ mode: 'BASE', amount: bet });

    const res = await rgs.authenticate();
    expect(res.round).not.toBeNull();
    expect(res.round!.active).toBe(true);
    expect(res.round!.payoutMultiplier).toBe(2.5);
    // amount surfaced in MINOR units (converted from the MAJOR value stored internally).
    expect(res.round!.amount).toBe(1 * API_MULTIPLIER);

    // Once settled, authenticate reports no open round again.
    await rgs.endRound();
    expect((await rgs.authenticate()).round).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// play + end-round  (the critical units arithmetic)
// ---------------------------------------------------------------------------

describe('play + endRound', () => {
  it('picks the weighted book, debits the bet, then credits the win', async () => {
    const rgs = makeRgs();
    await rgs.authenticate();

    const bet = 1 * API_MULTIPLIER; // 1 major
    const play: RGSPlayResponse = await rgs.play({ mode: 'BASE', amount: bet });

    // Seeded rng (0.5) selects sim=1 → payoutCents 250 → multiplier 2.5x.
    expect(play.round.payoutMultiplier).toBe(2.5);
    expect(play.round.active).toBe(true);
    expect(play.round.mode).toBe('BASE');
    expect(play.round.amount).toBe(1 * API_MULTIPLIER); // bet in MINOR units (Stake style)
    expect(play.round.costMultiplier).toBe(1); // BASE cost from index.json

    // Balance debited by the bet.
    expect(play.balance.amount).toBe(1000 * API_MULTIPLIER - bet);

    // endRound credits win = (payoutCents/100) * betMajor = 2.5 * 1 = 2.5 major.
    const end: RGSEndRoundResponse = await rgs.endRound();
    const expectedMinor =
      1000 * API_MULTIPLIER - bet + 2.5 * 1 * API_MULTIPLIER;
    expect(end.balance.amount).toBe(expectedMinor);
    expect(end.balance.amount).toBe(1001.5 * API_MULTIPLIER);
  });

  it('state has a non-empty events array with [0].spin.total_win === payoutCents/100', async () => {
    const rgs = makeRgs();
    const play: RGSPlayResponse = await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    // Seeded rng → sim=1, payoutCents=250 → total_win = 2.5.
    const state = play.round.state as { events: { spin: { total_win: number } }[] };
    expect(Array.isArray(state.events)).toBe(true);
    expect(state.events.length).toBeGreaterThan(0);
    expect(state.events[0].spin.total_win).toBe(2.5); // 250 / 100
  });

  it('passes a multi-event bonus book through as the round state (one event per segment)', async () => {
    const rgs = makeRgs();
    const play: RGSPlayResponse = await rgs.play({ mode: 'BONUS', amount: API_MULTIPLIER });
    // The book's 3 events (trigger + 2 free spins) flow through verbatim — the adapter splits
    // them into segments; the bridge streams them one play at a time.
    const state = play.round.state as { events: { type: string; spin: { total_win: number } }[] };
    expect(state.events).toHaveLength(3);
    expect(state.events.map((e) => e.type)).toEqual(['spin', 'free_spin', 'free_spin']);
    expect(state.events.map((e) => e.spin.total_win)).toEqual([0, 2, 5]);
    // payoutMultiplier is the LUT cents / 100 = 7×.
    expect(play.round.payoutMultiplier).toBe(7);
  });

  it('assigns incrementing betIDs across rounds', async () => {
    const rgs = makeRgs();
    const a = await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    await rgs.endRound();
    const b = await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    expect(b.round.betID).toBeGreaterThan(a.round.betID);
  });

  it('rejects a play whose stake exceeds the balance — never goes negative', async () => {
    const { InsufficientBalanceError } = await import('../src/harness/dev-rgs');
    const rgs = makeRgs(); // starting balance 1000 major
    await rgs.authenticate();
    const before = (await rgs.balance()).balance.amount;
    // Buy bonus 100× on a 50-major bet = 5000 stake > 1000 balance → reject.
    await expect(
      rgs.playWithOutcome('BONUS', 50 * API_MULTIPLIER, { payoutCents: 0, state: {}, cost: 100 }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
    // Balance untouched.
    expect((await rgs.balance()).balance.amount).toBe(before);
  });

  it('playWithOutcome debits bet × cost (buy/ante stake), but credits the win on the BASE bet', async () => {
    const rgs = makeRgs();
    await rgs.authenticate();
    const bet = 1 * API_MULTIPLIER;
    // A buy bonus costing 100×: debit 100, win = payout(2×) × base bet = 2.
    const play = await rgs.playWithOutcome('BONUS', bet, { payoutCents: 200, state: {}, cost: 100 });
    expect(play.round.costMultiplier).toBe(100);
    expect(play.balance.amount).toBe(1000 * API_MULTIPLIER - 100 * bet); // debited 100 × bet
    const end = await rgs.endRound();
    // Credit = 2 × base bet (NOT × cost): 1000 - 100 + 2 = 902.
    expect(end.balance.amount).toBe((1000 - 100 + 2) * API_MULTIPLIER);
  });
});

// ---------------------------------------------------------------------------
// event
// ---------------------------------------------------------------------------

describe('event', () => {
  it('records the event on the active round and echoes it back', async () => {
    const rgs = makeRgs();
    await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    const res: RGSEventResponse = await rgs.event('seg-0');
    expect(res.event).toBe('seg-0');
  });
});

// ---------------------------------------------------------------------------
// replay
// ---------------------------------------------------------------------------

describe('replay', () => {
  it('returns the Stake replay shape: payoutMultiplier (×bet multiplier), costMultiplier, state array', async () => {
    const rgs = makeRgs();
    const res: RGSReplayResponse = await rgs.replay({ mode: 'BASE', event: '1' });
    // Stake returns payoutMultiplier as the ×bet MULTIPLIER (2.5), not cents — the same scale
    // /wallet/play uses; the bridge surfaces it verbatim. (book cents 250 / 100 = 2.5×.)
    expect(res.payoutMultiplier).toBe(2.5);
    expect(res.costMultiplier).toBe(1); // BASE cost from index.json
    // state is the EVENTS ARRAY directly (not wrapped in { events }).
    const state = res.state as { spin: { total_win: number } }[];
    expect(Array.isArray(state)).toBe(true);
    expect(state.length).toBeGreaterThan(0);
    expect(state[0].spin.total_win).toBe(2.5); // decimal ×bet multiplier in the event
  });

  it('replays the 50x book (id 2) — payoutMultiplier 50 (×bet), event total_win 50', async () => {
    const rgs = makeRgs();
    const res = await rgs.replay({ mode: 'BASE', event: '2' });
    expect(res.payoutMultiplier).toBe(50); // book cents 5000 / 100 = 50×
    const state = res.state as { spin: { total_win: number } }[];
    expect(state[0].spin.total_win).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// no-books signal
// ---------------------------------------------------------------------------

describe('no books for mode', () => {
  it('hasBooksFor returns false for an unknown mode', () => {
    const rgs = makeRgs();
    expect(rgs.hasBooksFor('NOPE')).toBe(false);
    expect(rgs.hasBooksFor('BASE')).toBe(true);
  });

  it('play throws NoBooksError when the mode has no books', async () => {
    const rgs = makeRgs();
    await expect(rgs.play({ mode: 'NOPE', amount: API_MULTIPLIER })).rejects.toBeInstanceOf(
      NoBooksError,
    );
  });

  it('replay throws NoBooksError when the mode has no books', async () => {
    const rgs = makeRgs();
    await expect(rgs.replay({ mode: 'NOPE', event: '1' })).rejects.toBeInstanceOf(
      NoBooksError,
    );
  });
});

// ---------------------------------------------------------------------------
// open-round guard
// ---------------------------------------------------------------------------

describe('open-round guard', () => {
  it('play() while a round is active rejects with the open-round error', async () => {
    const rgs = makeRgs();
    await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    await expect(rgs.play({ mode: 'BASE', amount: API_MULTIPLIER })).rejects.toThrow(
      'dev-RGS: play called while a round is still active — call end-round first',
    );
  });

  it('play() → endRound() → play() succeeds (guard clears on end-round)', async () => {
    const rgs = makeRgs();
    await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    await rgs.endRound();
    // Should not throw.
    const second = await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    expect(second.round.active).toBe(true);
  });

  it('a 0-payout play() is self-closing (active:false) and does NOT block the next play', async () => {
    // rng 0.9995 forces pickWeighted to the sim=0 / payoutCents=0 LUT row.
    const rgs = createDevRgs({
      booksDir: dir,
      gameId: 'g',
      betLevelsMajor: [1, 2, 5],
      currency: 'USD',
      startingBalanceMajor: 1000,
      rng: () => 0.9995,
    });
    const lose = await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    expect(lose.round.payoutMultiplier).toBe(0);
    expect(lose.round.active).toBe(false);
    // No lingering active round → next play must not hit the open-round guard.
    const next = await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    expect(next.round.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// balance
// ---------------------------------------------------------------------------

describe('balance', () => {
  it('reflects the current in-memory balance', async () => {
    const rgs = makeRgs();
    const before: { balance: RGSBalance } = await rgs.balance();
    expect(before.balance.amount).toBe(1000 * API_MULTIPLIER);
    await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    const after = await rgs.balance();
    expect(after.balance.amount).toBe(1000 * API_MULTIPLIER - API_MULTIPLIER);
  });
});

// ---------------------------------------------------------------------------
// setBalance
// ---------------------------------------------------------------------------

describe('setBalance', () => {
  it('overrides the in-memory balance (minor units)', async () => {
    const rgs = makeRgs();
    rgs.setBalance(500 * API_MULTIPLIER);
    const { balance } = await rgs.balance();
    expect(balance.amount).toBe(500 * API_MULTIPLIER);
  });

  it('clears an active round so the next play() proceeds without open-round guard error', async () => {
    const rgs = makeRgs();
    await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    // Round is now active — setBalance clears it.
    rgs.setBalance(200 * API_MULTIPLIER);
    // Should not throw.
    const second = await rgs.play({ mode: 'BASE', amount: API_MULTIPLIER });
    expect(second.round.active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// playWithOutcome
// ---------------------------------------------------------------------------

describe('playWithOutcome', () => {
  it('debits the bet from the shared balance', async () => {
    const rgs = makeRgs();
    const bet = 1 * API_MULTIPLIER;
    const play: RGSPlayResponse = await rgs.playWithOutcome('BASE', bet, {
      payoutCents: 250,
      state: { custom: true },
    });
    expect(play.balance.amount).toBe(1000 * API_MULTIPLIER - bet);
  });

  it('round carries the supplied state (wrapped in events) and payoutMultiplier = payoutCents / 100', async () => {
    const rgs = makeRgs();
    const bet = 2 * API_MULTIPLIER;
    const play: RGSPlayResponse = await rgs.playWithOutcome('BASE', bet, {
      payoutCents: 350,
      state: { foo: 'bar' },
    });
    // state is wrapped as a one-event book.
    const state = play.round.state as { events: { spin: Record<string, unknown> }[] };
    expect(Array.isArray(state.events)).toBe(true);
    expect(state.events.length).toBeGreaterThan(0);
    expect(state.events[0].spin.foo).toBe('bar');
    // total_win should be injected because the caller-supplied state lacked it.
    expect(state.events[0].spin.total_win).toBe(3.5); // 350 / 100
    expect(play.round.payoutMultiplier).toBe(3.5); // 350 / 100
    expect(play.round.active).toBe(true);
    expect(play.round.mode).toBe('BASE');
    expect(play.round.amount).toBe(2 * API_MULTIPLIER); // bet in MINOR units (Stake style)
  });

  it('preserves caller-supplied total_win when present in the state', async () => {
    const rgs = makeRgs();
    const play: RGSPlayResponse = await rgs.playWithOutcome('BASE', API_MULTIPLIER, {
      payoutCents: 200,
      state: { total_win: 5, custom: 42 },
    });
    const state = play.round.state as { events: { spin: Record<string, unknown> }[] };
    // Caller supplied total_win: 5 — should NOT be overwritten by payoutCents/100 = 2.
    expect(state.events[0].spin.total_win).toBe(5);
    expect(state.events[0].spin.custom).toBe(42);
  });

  it('open-round guard fires when a WINNING round is already active', async () => {
    const rgs = makeRgs();
    await rgs.playWithOutcome('BASE', API_MULTIPLIER, { payoutCents: 250, state: {} });
    await expect(
      rgs.playWithOutcome('BASE', API_MULTIPLIER, { payoutCents: 250, state: {} }),
    ).rejects.toThrow('dev-RGS: play called while a round is still active — call end-round first');
  });

  it('a 0-payout round is self-closing: active:false and no lingering active round', async () => {
    const rgs = makeRgs();
    const lose = await rgs.playWithOutcome('BASE', API_MULTIPLIER, {
      payoutCents: 0,
      state: {},
    });
    expect(lose.round.active).toBe(false);
    // No active round retained → a following play must NOT hit the guard.
    const next = await rgs.playWithOutcome('BASE', API_MULTIPLIER, {
      payoutCents: 0,
      state: {},
    });
    expect(next.round.active).toBe(false);
  });

  it('endRound credits the win through the same balance (exact minor balance after play→endRound)', async () => {
    const rgs = makeRgs();
    const bet = 1 * API_MULTIPLIER; // 1 major → 1_000_000 minor
    // payoutCents = 250 → win = 250/100 * 1 major = 2.5 major
    await rgs.playWithOutcome('BASE', bet, { payoutCents: 250, state: {} });
    const end: RGSEndRoundResponse = await rgs.endRound();
    // expected: 1000 major start − 1 major bet + 2.5 major win = 1001.5 major
    const expectedMinor = 1000 * API_MULTIPLIER - bet + 2.5 * API_MULTIPLIER;
    expect(end.balance.amount).toBe(expectedMinor);
    expect(end.balance.amount).toBe(1001.5 * API_MULTIPLIER);
  });

  it('open-round guard also blocks play() while a playWithOutcome round is active', async () => {
    const rgs = makeRgs();
    await rgs.playWithOutcome('BASE', API_MULTIPLIER, { payoutCents: 100, state: {} });
    await expect(rgs.play({ mode: 'BASE', amount: API_MULTIPLIER })).rejects.toThrow(
      'dev-RGS: play called while a round is still active — call end-round first',
    );
  });
});

// ---------------------------------------------------------------------------
// setCurrency
// ---------------------------------------------------------------------------

describe('setCurrency', () => {
  it('default currency is EUR when none is supplied', async () => {
    const rgs = makeRgsDefaultCurrency();
    const auth = await rgs.authenticate();
    expect(auth.balance.currency).toBe('EUR');
  });

  it('changes the currency returned by authenticate', async () => {
    const rgs = makeRgs(); // starts as USD
    const before = await rgs.authenticate();
    expect(before.balance.currency).toBe('USD');

    rgs.setCurrency('GBP');
    const after = await rgs.authenticate();
    expect(after.balance.currency).toBe('GBP');
  });

  it('changes the currency returned by balance()', async () => {
    const rgs = makeRgs();
    rgs.setCurrency('JPY');
    const { balance } = await rgs.balance();
    expect(balance.currency).toBe('JPY');
  });
});
