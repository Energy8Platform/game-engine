// test/resume-round.test.ts
//
// Regression test for the resume-of-a-1-segment-winning-round bug:
// when the page is refreshed during an unfinished *winning* base round,
// `authenticate` resumes the round (rgsActive:true, endRoundCalled:false)
// with the cursor pinned to the single/final segment. The game's
// continuation `play({ roundId })` must SETTLE that round (call
// /wallet/end-round and deliver the final PLAY_RESULT) instead of failing
// with NO_ACTIVE_SESSION.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookAdapter, BookSegment } from '../src/types';

// Shared RGS spies, hoisted so the vi.mock factory can close over them.
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

// Imported AFTER the mock declaration so StakeBridge wires up the fake RGS.
const { StakeBridge } = await import('../src/bridge');

const MILLION = 1_000_000;
const LIVE_URL =
  'https://game.example/?rgs_url=https://rgs.example&sessionID=sess-1&currency=USD';

/** A single winning base segment (the whole round is one player-visible spin). */
function singleWinSegment(): BookSegment {
  return {
    action: 'spin',
    data: { matrix: [], win: 10 },
    winThisSegment: 10,
    nextActions: ['spin'],
  };
}

const adapter: BookAdapter = {
  splitRound: () => [singleWinSegment()],
};

/** Minimal window so game-sdk's MemoryChannel (devMode) has somewhere to live. */
function installWindow(): void {
  (globalThis as { window?: unknown }).window = (globalThis as { window?: unknown })
    .window ?? {};
  delete (globalThis as { window: Record<string, unknown> }).window
    .__casinoBridgeChannel;
}

/** Let queued microtasks + the async message handlers drain. */
async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 10));
}

interface Captured {
  type: string;
  payload: unknown;
}

describe('StakeBridge resume of a 1-segment winning round', () => {
  let sb: { ready(): Promise<void>; destroy(): void };
  let received: Captured[];

  beforeEach(() => {
    installWindow();
    rgs.authenticate.mockReset();
    rgs.endRound.mockReset();
    rgs.balance.mockReset();
    rgs.event.mockReset();

    // Authenticate resumes an active WINNING round (still needs end-round).
    rgs.authenticate.mockResolvedValue({
      balance: { amount: 100 * MILLION, currency: 'USD' },
      round: {
        betID: 4242,
        payoutMultiplier: 10,
        costMultiplier: 1,
        active: true,
        mode: 'BASE',
        state: { events: ['win'] },
      },
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
    // end-round credits the 10-unit win on top of the 100 balance.
    rgs.endRound.mockResolvedValue({
      balance: { amount: 110 * MILLION, currency: 'USD' },
    });
    rgs.balance.mockResolvedValue({
      balance: { amount: 100 * MILLION, currency: 'USD' },
    });
    rgs.event.mockResolvedValue({ event: 'seg-0' });

    received = [];
  });

  afterEach(() => {
    sb?.destroy();
  });

  it('settles via end-round AFTER the final-segment ACK (not on delivery)', async () => {
    sb = new StakeBridge({
      devMode: true,
      url: LIVE_URL,
      adapter,
      modeMap: { spin: 'BASE', default: 'BASE' },
      gameId: 'test-game',
      balancePollMs: 0,
    });

    await sb.ready();

    // Act as the guest game over the in-memory channel.
    const channel = (globalThis as { window: { __casinoBridgeChannel: any } })
      .window.__casinoBridgeChannel;
    channel.onGuest((msg: Captured) => received.push(msg));

    // Boot handshake → INIT.
    channel.sendToHost('GAME_READY', {});
    await flush();

    // The game resumes the round it knows the id of, then sends a
    // continuation play to finish it.
    channel.sendToHost('PLAY_REQUEST', {
      action: 'spin',
      bet: 1,
      roundId: '4242',
    });
    await flush();

    const errors = received.filter((m) => m.type === 'PLAY_ERROR');
    const results = received.filter((m) => m.type === 'PLAY_RESULT');

    expect(errors).toHaveLength(0);
    expect(results).toHaveLength(1);
    // Settlement happens AFTER the win animation → not yet on delivery.
    expect(rgs.endRound).not.toHaveBeenCalled();
    const result = results[0].payload as {
      creditPending: boolean;
      totalWin: number;
      balanceAfter: number;
    };
    // Win not yet credited at delivery; the round is still pending settlement.
    expect(result.creditPending).toBe(true);
    expect(result.totalWin).toBe(10);
    expect(result.balanceAfter).toBe(100);

    // Game finishes animating and ACKs the final segment → settle now.
    channel.sendToHost('PLAY_RESULT_ACK', {
      roundId: '4242',
      action: 'spin',
      totalWin: 10,
      balanceAfter: 100,
    });
    await flush();

    expect(rgs.endRound).toHaveBeenCalledTimes(1);
    // The credited balance arrives via a post-settlement BALANCE_UPDATE.
    const balances = received.filter((m) => m.type === 'BALANCE_UPDATE');
    const lastBalance = balances[balances.length - 1].payload as {
      balance: number;
    };
    expect(lastBalance.balance).toBe(110);
  });

  it('unwedges the session: a fresh spin after the resumed round settles starts a new round', async () => {
    rgs.play.mockResolvedValue({
      balance: { amount: 109 * MILLION, currency: 'USD' },
      round: {
        betID: 4243,
        payoutMultiplier: 0,
        costMultiplier: 1,
        active: true,
        mode: 'BASE',
        state: { events: ['spin'] },
      },
    });

    sb = new StakeBridge({
      devMode: true,
      url: LIVE_URL,
      adapter,
      modeMap: { spin: 'BASE', default: 'BASE' },
      gameId: 'test-game',
      balancePollMs: 0,
    });
    await sb.ready();

    const channel = (globalThis as { window: { __casinoBridgeChannel: any } })
      .window.__casinoBridgeChannel;
    channel.onGuest((msg: Captured) => received.push(msg));

    channel.sendToHost('GAME_READY', {});
    await flush();

    // Deliver the resumed round's final segment.
    channel.sendToHost('PLAY_REQUEST', {
      action: 'spin',
      bet: 1,
      roundId: '4242',
    });
    await flush();

    // Game finishes animating and ACKs → resumed round settles via end-round.
    channel.sendToHost('PLAY_RESULT_ACK', {
      roundId: '4242',
      action: 'spin',
      totalWin: 10,
      balanceAfter: 100,
    });
    await flush();

    expect(rgs.endRound).toHaveBeenCalledTimes(1);

    // New spin — no roundId. Previously rejected (NO_ACTIVE_SESSION wedged the
    // round); now it must reach RGS as a brand-new play.
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();

    expect(rgs.play).toHaveBeenCalledTimes(1);
    const errors = received.filter((m) => m.type === 'PLAY_ERROR');
    expect(errors).toHaveLength(0);
    const results = received.filter((m) => m.type === 'PLAY_RESULT');
    // One PLAY_RESULT for the settled resume + one for the fresh spin.
    expect(results).toHaveLength(2);
  });
});
