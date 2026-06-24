// test/settle-timing.test.ts
//
// Stake round-settlement timing: `/wallet/end-round` (the win settlement)
// must fire AFTER the game has animated the final segment (i.e. on its
// PLAY_RESULT_ACK), and ONLY when `payoutMultiplier > 0`. A losing round
// needs no settlement — the RGS closes it on `play()` — and must NOT leave a
// lingering open round that would block the next spin.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookAdapter, BookSegment } from '../src/types';

const rgs = vi.hoisted(() => ({
  authenticate: vi.fn(),
  play: vi.fn(),
  endRound: vi.fn(),
  event: vi.fn(),
  balance: vi.fn(),
  replay: vi.fn(),
}));

vi.mock('../src/rgs-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/rgs-client')>();
  return {
    ...actual,
    RGSClient: class {
      constructor(_opts: unknown) {}
      authenticate = rgs.authenticate;
      play = rgs.play;
      endRound = rgs.endRound;
      event = rgs.event;
      balance = rgs.balance;
      replay = rgs.replay;
    },
  };
});

const { StakeBridge } = await import('../src/bridge');

const MILLION = 1_000_000;
const LIVE_URL =
  'https://game.example/?rgs_url=https://rgs.example&sessionID=sess-1&currency=USD';

/** A single-segment round (one player-visible spin). */
function singleSegment(win: number): BookSegment {
  return {
    action: 'spin',
    data: { win },
    winThisSegment: win,
    nextActions: ['spin'],
  };
}

const adapter: BookAdapter = {
  splitRound: (_book, ctx) => [singleSegment(ctx.payoutMultiplier * ctx.betAmount)],
};

function installWindow(): void {
  (globalThis as { window?: unknown }).window =
    (globalThis as { window?: unknown }).window ?? {};
  delete (globalThis as { window: Record<string, unknown> }).window
    .__casinoBridgeChannel;
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

interface Captured {
  type: string;
  payload: unknown;
}

function setupAuth(): void {
  rgs.authenticate.mockResolvedValue({
    balance: { amount: 100 * MILLION, currency: 'USD' },
    round: null,
    config: {
      gameID: 'test-game',
      minBet: 1 * MILLION,
      maxBet: 100 * MILLION,
      stepBet: 1 * MILLION,
      defaultBetLevel: 1 * MILLION,
      betLevels: [1 * MILLION],
      betModes: { BASE: {} },
    },
  });
  rgs.balance.mockResolvedValue({
    balance: { amount: 100 * MILLION, currency: 'USD' },
  });
  rgs.event.mockResolvedValue({ event: 'seg-0' });
}

describe('StakeBridge settlement timing (after-ack + payout>0)', () => {
  let sb: { ready(): Promise<void>; destroy(): void };
  let received: Captured[];
  let channel: { sendToHost: (t: string, p: unknown) => void; onGuest: (cb: (m: Captured) => void) => void };

  beforeEach(async () => {
    installWindow();
    rgs.authenticate.mockReset();
    rgs.play.mockReset();
    rgs.endRound.mockReset();
    rgs.balance.mockReset();
    rgs.event.mockReset();
    setupAuth();
    received = [];

    sb = new StakeBridge({
      devMode: true,
      url: LIVE_URL,
      adapter,
      modeMap: { spin: 'BASE', default: 'BASE' },
      gameId: 'test-game',
      balancePollMs: 0,
    });
    await sb.ready();
    channel = (globalThis as { window: { __casinoBridgeChannel: any } }).window
      .__casinoBridgeChannel;
    channel.onGuest((msg: Captured) => received.push(msg));
    channel.sendToHost('GAME_READY', {});
    await flush();
  });

  afterEach(() => {
    sb?.destroy();
  });

  it('a WINNING round calls end-round only on the final-segment ACK', async () => {
    rgs.play.mockResolvedValue({
      balance: { amount: 99 * MILLION, currency: 'USD' },
      round: {
        betID: 1,
        payoutMultiplier: 10,
        costMultiplier: 1,
        active: true,
        mode: 'BASE',
        state: { events: ['win'] },
      },
    });
    rgs.endRound.mockResolvedValue({
      balance: { amount: 109 * MILLION, currency: 'USD' },
    });

    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();

    const result = received.find((m) => m.type === 'PLAY_RESULT')!
      .payload as { roundId: string; creditPending: boolean; totalWin: number };
    // Not settled yet — settlement is after the animation.
    expect(rgs.endRound).not.toHaveBeenCalled();
    expect(result.creditPending).toBe(true);
    expect(result.totalWin).toBe(10);

    // Animation done → ack → settle.
    channel.sendToHost('PLAY_RESULT_ACK', {
      roundId: result.roundId,
      action: 'spin',
      totalWin: 10,
      balanceAfter: 99,
    });
    await flush();

    expect(rgs.endRound).toHaveBeenCalledTimes(1);
    const balances = received.filter((m) => m.type === 'BALANCE_UPDATE');
    const last = balances[balances.length - 1].payload as { balance: number };
    expect(last.balance).toBe(109);
  });

  it('a 0-WIN round never calls end-round, and the next spin is not blocked', async () => {
    rgs.play.mockResolvedValue({
      balance: { amount: 99 * MILLION, currency: 'USD' },
      round: {
        betID: 1,
        payoutMultiplier: 0,
        costMultiplier: 1,
        active: true,
        mode: 'BASE',
        state: { events: ['lose'] },
      },
    });

    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();

    const first = received.find((m) => m.type === 'PLAY_RESULT')!.payload as {
      roundId: string;
    };

    // Ack the losing round → it closes locally, no end-round round-trip.
    channel.sendToHost('PLAY_RESULT_ACK', {
      roundId: first.roundId,
      action: 'spin',
      totalWin: 0,
      balanceAfter: 99,
    });
    await flush();

    expect(rgs.endRound).not.toHaveBeenCalled();

    // A fresh spin must NOT hit an open-round guard.
    rgs.play.mockResolvedValue({
      balance: { amount: 98 * MILLION, currency: 'USD' },
      round: {
        betID: 2,
        payoutMultiplier: 0,
        costMultiplier: 1,
        active: true,
        mode: 'BASE',
        state: { events: ['lose'] },
      },
    });
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();

    expect(received.filter((m) => m.type === 'PLAY_ERROR')).toHaveLength(0);
    expect(received.filter((m) => m.type === 'PLAY_RESULT')).toHaveLength(2);
    expect(rgs.play).toHaveBeenCalledTimes(2);
    expect(rgs.endRound).not.toHaveBeenCalled();
  });
});
