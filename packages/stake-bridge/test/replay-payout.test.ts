// test/replay-payout.test.ts
//
// Regression test for the replay payout-multiplier scale bug.
//
// Stake's `/bet/replay` returns `payoutMultiplier` ALREADY as the ×bet
// multiplier (e.g. 0.3 for a 0.3× round), the SAME scale `/wallet/play`
// uses for `round.payoutMultiplier`. The bridge must surface it verbatim.
// A stray `/ 100` (introduced when replay was mistakenly assumed to return
// CENTS) made the replay start-modal show 0.003× instead of 0.3× — every
// replay win/multiplier rendered 100× too small.

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
// A 0.3× round on a 1.00 bet. amount is in minor units (× API_MULTIPLIER).
const REPLAY_URL =
  'https://game.example/?replay=true&game=test-game&version=1&mode=BASE&event=7' +
  '&rgs_url=https://x.stake-engine.com&currency=USD&amount=1000000';

function installWindow(): void {
  (globalThis as { window?: unknown }).window =
    (globalThis as { window?: unknown }).window ?? {};
  delete (globalThis as { window: Record<string, unknown> }).window
    .__casinoBridgeChannel;
}

/** One winning segment; win = total_win (×bet multiplier) × bet. */
const adapter: BookAdapter = {
  splitRound: (): BookSegment[] => [
    { action: 'spin', data: { win: 0.3 }, winThisSegment: 0.3, nextActions: ['spin'] },
  ],
};

describe('StakeBridge replay payoutMultiplier scale', () => {
  let sb: { ready(): Promise<void>; destroy(): void; replayPayoutMultiplier: number };

  beforeEach(() => {
    installWindow();
    rgs.replay.mockReset();
    // Stake `/bet/replay` — payoutMultiplier is the ×bet multiplier, NOT cents.
    rgs.replay.mockResolvedValue({
      payoutMultiplier: 0.3,
      costMultiplier: 1,
      state: [{ type: 'spin', spin: { total_win: 0.3 } }],
    });
  });

  afterEach(() => {
    sb?.destroy();
  });

  it('surfaces the replay payout multiplier verbatim (0.3×, not 0.003×)', async () => {
    sb = new StakeBridge({
      devMode: true,
      url: REPLAY_URL,
      adapter,
      modeMap: { spin: 'BASE', default: 'BASE' },
      gameId: 'test-game',
      balancePollMs: 0,
    }) as unknown as typeof sb;

    await sb.ready();

    // The value fed to the replay modal's "Win multiplier" / "Total win" rows.
    expect(sb.replayPayoutMultiplier).toBe(0.3);
  });
});
