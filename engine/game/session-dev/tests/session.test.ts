import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { startE8Server, type E8Handle } from '../src/e8server';

// A round on e8-server is `StartRound` then `Step(round_id, action)` until
// `round_complete`. `first-slot` (what `spin.test.ts` drives) can never show
// that half: every one of its rounds completes on the first response, so
// `play()` calling `StartRound` unconditionally was indistinguishable from a
// correct client. `session-fixture` is the other case, deterministically —
// its base spin ALWAYS opens a two-spin `free_spins` session.
const GAME = join(__dirname, 'fixtures', 'session');

let e8: E8Handle;
beforeAll(async () => {
  e8 = await startE8Server({ gamesDir: GAME, port: 0 });
}, 30_000);
afterAll(async () => {
  await e8?.stop();
});

const start = () => e8.play({ gameId: 'session-fixture', action: 'spin', betLevel: 1.0 });
const step = (roundId: string) =>
  e8.play({ gameId: 'session-fixture', action: 'free_spin', betLevel: 1.0, roundId });

describe('a round that does not complete on the first response', () => {
  it('the opening spin leaves the round open and names what it accepts next', async () => {
    const r = await start();
    expect(r.roundComplete).toBe(false);
    expect(r.nextActions).toEqual(['free_spin']);
    expect(r.spinsRemaining).toBe(2);
    expect(r.stage).toBe('base_game');
    expect(r.roundId).toBeTruthy();
  });

  it('two Steps finish it, on the same round', async () => {
    const opened = await start();

    const first = await step(opened.roundId);
    expect(first.roundId).toBe(opened.roundId);
    expect(first.stage).toBe('free_spins');
    expect(first.roundComplete).toBe(false);
    expect(first.spinsRemaining).toBe(1);

    const second = await step(opened.roundId);
    expect(second.roundId).toBe(opened.roundId);
    expect(second.stage).toBe('free_spins');
    expect(second.roundComplete).toBe(true);
    expect(second.spinsRemaining).toBe(0);
    // The round's running total, not this one spin's — spinsPlayed counts
    // the opening spin too, which is how a Step is told from a StartRound
    // on the wire without reading our own request back.
    expect(second.spinsPlayed).toBe(3);
  });

  // The whole point of threading roundId: without it every call is a fresh
  // StartRound, and a game-side bug that sends a stale/unknown id would be
  // silently answered with a brand-new round instead of an error.
  it('a Step against an unknown round is the server saying so, not a new round', async () => {
    await expect(step('nope')).rejects.toThrow('[session-dev] e8-server:');
  });

  it('a spin with no roundId still starts a round of its own', async () => {
    const a = await start();
    const b = await start();
    expect(b.roundId).not.toBe(a.roundId);
    expect(b.spinsPlayed).toBe(1);
  });
});
