import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import { diagnostic, type SessionInit, type SpinResult } from '@energy8engine/contracts';
import * as sessionHost from '../src/index';

const INIT: SessionInit = {
  balance: 1000,
  currency: { code: 'USD', symbol: '$', decimals: 2, position: 'left' },
  betLevels: [1, 2, 5],
  defaultBet: 1,
};

/** `win`/`totalWin` are 2× `bet` 1 — `withAmounts` turns that into `winAmount`/`totalWinAmount` 2. */
const SPIN_RESULT: SpinResult = {
  win: 2,
  totalWin: 2,
  bet: 1,
  stage: 'base_game',
  data: {},
  vars: {},
  nextActions: ['spin'],
  roundComplete: true,
  spinsRemaining: 0,
  spinsPlayed: 1,
  scriptSha256: 'deadbeef',
  roundId: 'r-1',
};

/** A `Response`-shaped stand-in — the same minimal shape `@energy8engine/flow`'s own `runtime.test.ts` fakes `fetch` with. */
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });
const failNoBody = (status: number) => ({
  ok: false,
  status,
  json: async () => {
    throw new SyntaxError('Unexpected end of JSON input');
  },
});

/** Dispatches on the two routes this row calls; `spin` sees the parsed POST body. */
function fakeFetch(opts: { session?: () => unknown; spin?: (body: Record<string, unknown>) => unknown }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/session') return (opts.session ?? (() => ok(INIT)))();
    if (url === '/api/spin') {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return (opts.spin ?? (() => ok(SPIN_RESULT)))(body);
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as unknown as typeof fetch;
}

async function boot(fetchFn: typeof fetch): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(sessionHost, { fetchFn });
  return ctx;
}

describe('session-host', () => {
  it('init comes from GET /api/session', async () => {
    const ctx = await boot(fakeFetch({ session: () => ok(INIT) }));
    expect(ctx.get('session')!.init).toEqual(INIT);
    await ctx.fiber.dispose();
  });

  it('a failed GET falls back to the built-in init and reports one warning', async () => {
    const report = vi.fn();
    const ctx = new Context();
    ctx.provide('diagnostics', { report });
    await ctx.plugin(sessionHost, { fetchFn: fakeFetch({ session: () => fail(500, {}) }) });

    expect(ctx.get('session')!.init).toEqual({
      balance: 0,
      currency: { code: 'USD', symbol: '$', decimals: 2, position: 'left' },
      betLevels: [1],
      defaultBet: 1,
    });
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warning', plugin: 'session-host', where: '/api/session' }),
    );
    await ctx.fiber.dispose();
  });

  it('play posts { action, betLevel, roundId, params }, omitting what is undefined', async () => {
    let posted: unknown;
    const ctx = await boot(
      fakeFetch({
        spin: (body) => {
          posted = body;
          return ok(SPIN_RESULT);
        },
      }),
    );

    await ctx.get('session')!.play({ action: 'spin', betLevel: 1 });
    expect(posted).toEqual({ action: 'spin', betLevel: 1 });

    await ctx.get('session')!.play({ action: 'free_spin', roundId: 'r-1', params: { x: 1 } });
    expect(posted).toEqual({ action: 'free_spin', roundId: 'r-1', params: { x: 1 } });

    await ctx.fiber.dispose();
  });

  it('a fresh round charges betLevel and credits winAmount — balance 1000 − 1 + winAmount', async () => {
    const ctx = await boot(fakeFetch({}));

    const { result, diagnostics } = await ctx.get('session')!.play({ action: 'spin', betLevel: 1 });
    expect(diagnostics).toEqual([]);
    expect(result!.winAmount).toBe(2);
    expect(result!.totalWinAmount).toBe(2);
    expect(result!.balance).toBe(1001);

    await ctx.fiber.dispose();
  });

  it('a roundId play does not charge — only the win credits', async () => {
    const ctx = await boot(fakeFetch({}));

    // Same fresh 1000 balance, but this play carries a roundId (a step of
    // an already-charged round): 1000 + winAmount 2, no − 1.
    const { result } = await ctx.get('session')!.play({ action: 'step', roundId: 'r-1' });
    expect(result!.balance).toBe(1002);

    await ctx.fiber.dispose();
  });

  it('a 502 with { diagnostics } returns those diagnostics, no result', async () => {
    const provided = [diagnostic('error', 'session-dev', 'session', 'the math engine is not running')];
    const ctx = await boot(fakeFetch({ spin: () => fail(502, { diagnostics: provided }) }));

    const { result, diagnostics } = await ctx.get('session')!.play({ action: 'spin', betLevel: 1 });
    expect(result).toBeUndefined();
    expect(diagnostics).toEqual(provided);

    await ctx.fiber.dispose();
  });

  it('charges the wallet even when the play fails — the spec says every play, not only a successful one', async () => {
    const ctx = new Context();
    const provideRoot = vi.fn((_name: string, _getter: () => unknown) => () => {});
    ctx.provide('flow', { provideRoot });
    const failure = [diagnostic('error', 'session-dev', 'session', 'the math engine is not running')];
    await ctx.plugin(sessionHost, {
      fetchFn: fakeFetch({ spin: () => fail(502, { diagnostics: failure }) }),
    });
    const getter = provideRoot.mock.calls[0][1];
    expect(getter()).toMatchObject({ balance: 1000 });

    const { result, diagnostics } = await ctx.get('session')!.play({ action: 'spin', betLevel: 1 });
    expect(result).toBeUndefined();
    expect(diagnostics).toEqual(failure);
    // No win to credit, but the bet was still spent — 1000 − 1.
    expect(getter()).toMatchObject({ balance: 999 });

    await ctx.fiber.dispose();
  });

  it('a 500 with no JSON body is one error diagnostic naming the status', async () => {
    const ctx = await boot(fakeFetch({ spin: () => failNoBody(500) }));

    const { result, diagnostics } = await ctx.get('session')!.play({ action: 'spin', betLevel: 1 });
    expect(result).toBeUndefined();
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        plugin: 'session-host',
        where: '/api/spin',
        message: expect.stringContaining('500'),
      }),
    ]);

    await ctx.fiber.dispose();
  });

  it('a thrown fetch is one error diagnostic carrying the thrown message', async () => {
    const ctx = await boot(
      fakeFetch({
        spin: () => {
          throw new Error('network down');
        },
      }),
    );

    const { result, diagnostics } = await ctx.get('session')!.play({ action: 'spin', betLevel: 1 });
    expect(result).toBeUndefined();
    expect(diagnostics).toEqual([expect.objectContaining({ message: expect.stringContaining('network down') })]);

    await ctx.fiber.dispose();
  });

  it('registers a live "session" root on flow — reads init merged with the current balance', async () => {
    const ctx = new Context();
    const provideRoot = vi.fn((_name: string, _getter: () => unknown) => () => {});
    ctx.provide('flow', { provideRoot });
    await ctx.plugin(sessionHost, { fetchFn: fakeFetch({}) });

    expect(provideRoot).toHaveBeenCalledWith('session', expect.any(Function));
    const getter = provideRoot.mock.calls[0][1];
    expect(getter()).toEqual({ ...INIT, balance: 1000 });

    // Live, not a snapshot: the SAME getter reflects the play that just ran.
    await ctx.get('session')!.play({ action: 'spin', betLevel: 1 });
    expect(getter()).toMatchObject({ balance: 1001 });

    await ctx.fiber.dispose();
  });
});
