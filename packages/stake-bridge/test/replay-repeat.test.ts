// test/replay-repeat.test.ts
//
// Regression test for "can't replay again": after a replay round finishes, pressing START
// REPLAY a second time must re-stream the SAME cached book as a brand-new round — NOT error
// with NO_ACTIVE_SESSION. Replay rounds never settle (rgsActive:false), so `this.active` is
// never cleared by the ACK path; a second play must still be treated as a fresh round.

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

const REPLAY_URL =
  'https://game.example/?replay=true&game=test-game&version=1&mode=BASE&event=7' +
  '&rgs_url=https://x.stake-engine.com&currency=USD&amount=1000000';

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

// One winning segment — the whole replay round is a single player-visible spin.
const adapter: BookAdapter = {
  splitRound: (): BookSegment[] => [
    { action: 'spin', data: { win: 0.3 }, winThisSegment: 0.3, nextActions: ['spin'] },
  ],
};

describe('StakeBridge replay can be replayed again', () => {
  let sb: { ready(): Promise<void>; destroy(): void };
  let received: Captured[];
  let channel: {
    onGuest(cb: (m: Captured) => void): void;
    sendToHost(type: string, payload: unknown): void;
  };

  beforeEach(() => {
    installWindow();
    rgs.replay.mockReset();
    rgs.replay.mockResolvedValue({
      payoutMultiplier: 0.3,
      costMultiplier: 1,
      state: [{ type: 'spin', spin: { total_win: 0.3 } }],
    });
    received = [];
  });

  afterEach(() => {
    sb?.destroy();
  });

  /** Play one replay round to completion (deliver + ack its single/final segment). */
  async function playOneReplayRound(): Promise<void> {
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 }); // first segment: no roundId
    await flush();
    const last = received.filter((m) => m.type === 'PLAY_RESULT').pop();
    const roundId = (last?.payload as { roundId?: string } | undefined)?.roundId;
    channel.sendToHost('PLAY_RESULT_ACK', { roundId, action: 'spin', totalWin: 0.3, balanceAfter: 0 });
    await flush();
  }

  it('a second START REPLAY streams the round again instead of NO_ACTIVE_SESSION', async () => {
    sb = new StakeBridge({
      devMode: true,
      url: REPLAY_URL,
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

    // Round 1.
    await playOneReplayRound();
    // Round 2 — the repeat that used to wedge.
    received = [];
    await playOneReplayRound();

    const errors = received.filter((m) => m.type === 'PLAY_ERROR');
    const results = received.filter((m) => m.type === 'PLAY_RESULT');
    expect(errors).toHaveLength(0);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
