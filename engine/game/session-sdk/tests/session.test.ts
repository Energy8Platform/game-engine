import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { MemoryChannel } from '@energy8platform/game-sdk';
import type { SessionService } from '@energy8engine/contracts';
import * as sessionSdk from '../src/index';
import type { SessionSdkConfig } from '../src/index';

/**
 * The platform here is `DevBridge` over the SDK's `devMode` memory channel
 * (spec §9) — the same harness `packages/platform-core/tests/
 * PlatformSession.test.ts` boots, which is why the `window` shim below is
 * copied from it: `MemoryChannel.getGlobal` keys its singleton off
 * `window`, and this suite runs under vitest's node environment.
 */
beforeAll(() => {
  if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as { window?: unknown }).window = globalThis;
  }
});

// The channel is a singleton on `window` and `PlatformSession.destroy()`
// does not clear it — a host handler left over from one test would answer
// the next test's handshake with the previous test's wallet.
afterEach(() => {
  MemoryChannel.clearGlobal();
});

const DEV: SessionSdkConfig['dev'] = {
  balance: 5000,
  currency: 'EUR',
  gameConfig: { betLevels: [0.2, 0.5] },
  // No `nextActions` on purpose: DevBridge then answers its default `['spin']`,
  // the same "next round's entry action" every real host lists on a
  // completed round — the suite has to prove that reads as complete.
  onPlay: () => ({ totalWin: 1, data: { stage: 'base', win: 5 } }),
  networkDelay: 0,
  debug: false,
};

/** Lets the channel's `queueMicrotask` dispatch land. */
const tick = () => new Promise((r) => setTimeout(r, 0));

async function boot(config: SessionSdkConfig = { dev: DEV, sdk: { devMode: true } }) {
  const ctx = new Context();
  const report = vi.fn();
  const provideRoot = vi.fn((_name: string, _getter: () => unknown) => () => {});
  ctx.provide('diagnostics', { report });
  ctx.provide('flow', { provideRoot });
  await ctx.plugin(sessionSdk, config);
  const session = ctx.get('session') as SessionService;
  const root = () => provideRoot.mock.calls[0][1]() as Record<string, unknown>;
  return { ctx, report, provideRoot, session, root };
}

describe('session-sdk — init from the handshake', () => {
  it('balance, a code-only currency, the ladder and its first rung as the default', async () => {
    const { ctx, session, report } = await boot();
    expect(session.init).toEqual({
      balance: 5000,
      currency: { code: 'EUR', symbol: 'EUR', decimals: 2, position: 'left' },
      betLevels: [0.2, 0.5],
      defaultBet: 0.2,
    });
    expect(report).not.toHaveBeenCalled();
    await ctx.fiber.dispose();
  });

  it("currency meta when the host sends one; stake's default bet snapped to the nearest rung", async () => {
    const { ctx, session } = await boot({
      dev: {
        ...DEV,
        gameConfig: {
          betLevels: [0.2, 0.5, 1],
          currency: { code: 'PLN', symbol: 'zł', decimals: 2, symbolAfter: true },
          stake: { defaultBetLevel: 0.6 },
        },
      },
      sdk: { devMode: true },
    });
    expect(session.init.currency).toEqual({
      code: 'PLN',
      symbol: 'zł',
      decimals: 2,
      position: 'right',
    });
    expect(session.init.defaultBet).toBe(0.5);
    await ctx.fiber.dispose();
  });

  it("Artube's currencyMinimalUnit (a rounding step) becomes decimals; defaultBetIndex picks the rung", async () => {
    const { ctx, session } = await boot({
      dev: {
        ...DEV,
        gameConfig: {
          betLevels: [0.2, 0.5, 1],
          currency: { code: 'PLN', symbol: 'zł', decimals: 2 },
          artube: { currencyMinimalUnit: 0.001, defaultBetIndex: 2 },
        },
      },
      sdk: { devMode: true },
    });
    expect(session.init.currency.decimals).toBe(3);
    expect(session.init.defaultBet).toBe(1);
    await ctx.fiber.dispose();
  });

  it('Artube fields that make no sense are ignored, not trusted', async () => {
    const { ctx, session } = await boot({
      dev: {
        ...DEV,
        gameConfig: {
          betLevels: [0.2, 0.5, 1],
          artube: { currencyMinimalUnit: 'cent', defaultBetIndex: 7 },
        },
      },
      sdk: { devMode: true },
    });
    expect(session.init.currency.decimals).toBe(2);
    expect(session.init.defaultBet).toBe(0.2);
    await ctx.fiber.dispose();
  });

  it('no bet levels from the platform: one warning, and [1] so the shell still has a ladder', async () => {
    const { ctx, session, report } = await boot({
      dev: { ...DEV, gameConfig: {} },
      sdk: { devMode: true },
    });
    expect(session.init.betLevels).toEqual([1]);
    expect(session.init.defaultBet).toBe(1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', plugin: 'session-sdk', where: 'init' }),
    );
    await ctx.fiber.dispose();
  });
});

describe('session-sdk — play, ack, the live root', () => {
  it('play normalises the platform result and fills the amounts; the root follows balanceAfter', async () => {
    const { ctx, session, root } = await boot();
    expect(root()).toEqual({ ...session.init, balance: 5000 });

    const { result, diagnostics } = await session.play({ action: 'spin', betLevel: 0.2 });
    expect(diagnostics).toEqual([]);
    // `data.win` 5 is the multiplier; the platform's `totalWin` 1 is money
    // (5 × 0.2) — both land as multipliers, and `withAmounts` gives the
    // money back.
    expect(result).toMatchObject({
      bet: 0.2,
      win: 5,
      winAmount: 1,
      totalWin: 5,
      totalWinAmount: 1,
      stage: 'base',
      nextActions: ['spin'],
      roundComplete: true,
      roundId: 'dev-round-1',
    });
    // DevBridge's `onPlay` path credits the win and never debits the bet.
    expect(result!.balance).toBe(5001);
    expect(root()).toMatchObject({ balance: 5001 });
    await ctx.fiber.dispose();
  });

  it('betLevel absent: the session default is what gets played', async () => {
    let played: unknown;
    const { ctx, session } = await boot({
      dev: {
        ...DEV,
        onPlay: (p) => {
          played = p;
          return { totalWin: 0, data: {} };
        },
      },
      sdk: { devMode: true },
    });
    await session.play({ action: 'spin', params: { x: 1 } });
    expect(played).toMatchObject({ action: 'spin', bet: 0.2, params: { x: 1 } });
    await ctx.fiber.dispose();
  });

  it("a step plays at the bet its round was started with; a completed round's bet is forgotten", async () => {
    const played: unknown[] = [];
    const open = { spinsRemaining: 1, spinsPlayed: 0, totalWin: 0, completed: false };
    const { ctx, session } = await boot({
      dev: {
        ...DEV,
        onPlay: (p) => {
          played.push(p);
          // The fresh play opens a session; the step (a `roundId` on the
          // wire) closes it — no session on that answer.
          return p.roundId ? { totalWin: 0, data: {} } : { totalWin: 0, data: {}, session: open };
        },
      },
      sdk: { devMode: true },
    });

    const first = (await session.play({ action: 'spin', betLevel: 0.5 })).result!;
    expect(first).toMatchObject({ bet: 0.5, roundComplete: false, roundId: 'dev-round-1' });

    const step = (await session.play({ action: 'free_spin', roundId: first.roundId })).result!;
    expect(played[1]).toMatchObject({ action: 'free_spin', bet: 0.5, roundId: 'dev-round-1' });
    expect(step).toMatchObject({ bet: 0.5, roundComplete: true });

    // The round completed, so its bet is gone: a step naming it again
    // (nothing a flow should do) falls back to the session default.
    await session.play({ action: 'free_spin', roundId: first.roundId });
    expect(played[2]).toMatchObject({ bet: 0.2, roundId: 'dev-round-1' });
    await ctx.fiber.dispose();
  });

  it('ack sends PLAY_RESULT_ACK for the raw result once; an unknown or already-acked result is a no-op', async () => {
    const { ctx, session } = await boot();
    const acks: unknown[] = [];
    MemoryChannel.getGlobal().onHost((m) => {
      if (m.type === 'PLAY_RESULT_ACK') acks.push(m.payload);
    });

    const { result } = await session.play({ action: 'spin', betLevel: 0.2 });
    session.ack!(result!);
    await tick();
    expect(acks).toEqual([
      { roundId: 'dev-round-1', action: 'spin', totalWin: 1, balanceAfter: 5001 },
    ]);

    session.ack!(result!);
    session.ack!({ ...result!, roundId: 'never-played' });
    await tick();
    expect(acks).toHaveLength(1);

    // One stash, the LAST result: once a second play ran, the first can no
    // longer be acked — only the second can.
    const { result: second } = await session.play({ action: 'spin', betLevel: 0.2 });
    session.ack!(result!);
    await tick();
    expect(acks).toHaveLength(1);
    session.ack!(second!);
    await tick();
    expect(acks).toHaveLength(2);
    expect(acks[1]).toMatchObject({ roundId: 'dev-round-2' });
    await ctx.fiber.dispose();
  });

  it('a BALANCE_UPDATE from the host moves the root, not init', async () => {
    const { ctx, session, root } = await boot();
    // What `DevBridge.setBalance()` sends, put on the same wire directly —
    // the row never exposes its PlatformSession, so the wire is the seam.
    MemoryChannel.getGlobal().sendToGuest('BALANCE_UPDATE', { balance: 4200 });
    await tick();
    expect(root()).toMatchObject({ balance: 4200 });
    expect(session.init.balance).toBe(5000);
    await ctx.fiber.dispose();
  });

  it('dispose destroys the platform session — a play after it is one error diagnostic naming the SDK code', async () => {
    const { ctx, session } = await boot();
    await ctx.fiber.dispose();

    const { result, diagnostics } = await session.play({ action: 'spin', betLevel: 0.2 });
    expect(result).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        plugin: 'session-sdk',
        where: 'play',
        message: 'BRIDGE_DESTROYED: SDK has been destroyed',
      }),
    ]);
  });
});

describe('session-sdk — a handshake that never lands', () => {
  const FALLBACK = {
    balance: 0,
    currency: { code: 'USD', symbol: '$', decimals: 2, position: 'left' },
    betLevels: [1],
    defaultBet: 1,
  };

  it('a rejected handshake (no host answers GAME_READY): one error, the fallback init, play says why', async () => {
    const { ctx, session, report } = await boot({ sdk: { devMode: true, timeout: 50 } });
    expect(session.init).toEqual(FALLBACK);
    expect(report).toHaveBeenCalledTimes(1);
    const [reported] = report.mock.calls[0];
    expect(reported).toMatchObject({
      severity: 'error',
      plugin: 'session-sdk',
      where: 'handshake',
    });

    const { result, diagnostics } = await session.play({ action: 'spin', betLevel: 1 });
    expect(result).toBeUndefined();
    expect(diagnostics).toEqual([reported]);
    await ctx.fiber.dispose();
  });

  it('handshakeMs is the SDK timeout: a page outside a casino frame falls back that soon', async () => {
    const t0 = Date.now();
    const { ctx, session, report } = await boot({ handshakeMs: 50, sdk: { devMode: true } });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(session.init).toEqual(FALLBACK);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ where: 'handshake', message: expect.stringContaining('50ms') }),
    );
    await ctx.fiber.dispose();
  });

  it('sdk: false (no handshake at all) is the same fallback', async () => {
    const { ctx, session, report } = await boot({ dev: DEV, sdk: false });
    expect(session.init).toEqual(FALLBACK);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', plugin: 'session-sdk', where: 'handshake' }),
    );
    expect((await session.play({ action: 'spin' })).result).toBeUndefined();
    await ctx.fiber.dispose();
  });
});
