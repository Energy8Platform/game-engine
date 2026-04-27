/**
 * DevBridge debit-computation tests (v5 action-driven cost contract).
 *
 * Mirrors the server's ActionDefinition.DebitAmount:
 *   - debit: 'bet'             → bet × (cost_multiplier || 1)
 *   - debit: 'none'/missing    → 0
 *
 * v4 fields (top-level buy_bonus/ante_bet, debit: 'buy_bonus_cost'/'ante_bet_cost',
 * action.buy_bonus_mode, params.ante_bet/buy_bonus) are removed in v5.
 *
 * We test computeDebit indirectly by observing balance transitions.
 * The browser-style MemoryChannel needs `window`, so install a globalThis
 * shim before the suite runs (the same shim PlatformSession.test.ts uses).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { DevBridge } from '../src/dev-bridge/DevBridge';
import type { GameDefinition } from '../src/lua/types';

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = globalThis;
  }
});

const GAME_DEF: GameDefinition = {
  id: 'debit-test',
  type: 'SLOT',
  bet_levels: [0.2, 0.5, 1, 2, 5, 10],
  max_win: { multiplier: 5000 },
  actions: {
    spin: {
      stage: 'base_game',
      debit: 'bet',
      credit: 'win',
      transitions: [{ condition: 'always', next_actions: ['spin'] }],
    },
    // v5: cost lives on the action itself; opaque feature_data is exposed
    // to Lua via state.action_config.feature_data. No top-level buy_bonus block.
    buy_bonus: {
      stage: 'base_game',
      debit: 'bet',
      cost_multiplier: 100,
      feature_data: { scatter_distribution: { '4': 60, '5': 30, '6': 10 } },
      transitions: [{ condition: 'always', next_actions: ['free_spin'] }],
    },
    buy_super: {
      stage: 'base_game',
      debit: 'bet',
      cost_multiplier: 200,
      feature_data: { scatter_distribution: { '5': 70, '6': 30 } },
      transitions: [{ condition: 'always', next_actions: ['free_spin'] }],
    },
    free_spin: {
      stage: 'free_spins',
      debit: 'none',
      requires_session: true,
      transitions: [{ condition: 'always', next_actions: ['free_spin'] }],
    },
    // v5: ante is a separate action with its own cost_multiplier — no more
    // top-level ante_bet block, no more params.ante_bet flag.
    ante_spin: {
      stage: 'base_game',
      debit: 'bet',
      cost_multiplier: 1.25,
      credit: 'win',
      transitions: [{ condition: 'always', next_actions: ['ante_spin'] }],
    },
    // Table-game style continuation: action exists but has no debit
    // (server returns decimal.Zero for empty/missing debit). Used to assert
    // computeDebit's default branch matches the server contract.
    no_debit: {
      stage: 'base_game',
      // debit deliberately omitted — exercises the default branch
      transitions: [{ condition: 'always', next_actions: ['spin'] }],
    } as GameDefinition['actions'][string],
    // Action whose debit field carries a (now-removed) v4 mode — must be
    // treated as default → 0, since v5 ignores anything other than 'bet'.
    legacy_buy_bonus_cost: {
      stage: 'base_game',
      // @ts-expect-error — intentionally invalid v5 debit mode
      debit: 'buy_bonus_cost',
      cost_multiplier: 50,
      transitions: [{ condition: 'always', next_actions: ['free_spin'] }],
    },
  },
};

// We don't need the Lua server to test debits; mock fetch so executeLuaOnServer
// resolves with a no-op result and the play handler runs through computeDebit.
function mockLuaFetch(totalWin = 0) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        roundId: 'r1',
        action: 'spin',
        totalWin,
        balanceAfter: 0, // overwritten by DevBridge
        data: {},
        nextActions: ['spin'],
        session: null,
      }),
    })),
  );
}

function makeBridge(overrides: Partial<Parameters<typeof DevBridge.prototype.constructor>[0]> = {}) {
  return new DevBridge({
    balance: 10000,
    currency: 'EUR',
    networkDelay: 0,
    debug: false,
    luaScript: 'function execute(state) return { total_win = 0, data = {} } end',
    gameDefinition: GAME_DEF,
    ...overrides,
  });
}

// Drive a play through the bridge's PLAY_REQUEST handler. We can poke
// handlePlayRequest directly via the type system since DevBridge is the
// unit under test.
async function play(bridge: DevBridge, action: string, bet: number, params?: Record<string, unknown>) {
  // Access handlePlayRequest by casting — DevBridge keeps it private but
  // testing the debit math without the Bridge round-trip is the cleanest
  // way to assert computeDebit's behavior.
  (bridge as unknown as {
    handlePlayRequest: (p: { action: string; bet: number; roundId?: string; params?: unknown }) => void;
  }).handlePlayRequest({ action, bet, params });
  // Allow the mocked fetch promise + balance update to settle.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

interface CapturedSend {
  type: string;
  payload: unknown;
  id?: string;
}

/**
 * Start the bridge and replace its inner Bridge.send with a recorder so we
 * can assert the wire shape (PLAY_RESULT payload, PLAY_ERROR payload,
 * STATE_RESPONSE shape, etc.) without going through the SDK round-trip.
 */
function startWithCapture(bridge: DevBridge): CapturedSend[] {
  bridge.start();
  const sends: CapturedSend[] = [];
  const inner = (bridge as unknown as { _bridge: { send: (t: string, p: unknown, i?: string) => void } })._bridge;
  inner.send = (type, payload, id) => {
    sends.push({ type, payload, id });
  };
  return sends;
}

async function callPlay(bridge: DevBridge, action: string, bet: number, opts: { id?: string; params?: Record<string, unknown>; roundId?: string } = {}) {
  (bridge as unknown as {
    handlePlayRequest: (p: { action: string; bet: number; roundId?: string; params?: unknown }, id?: string) => void;
  }).handlePlayRequest({ action, bet, roundId: opts.roundId, params: opts.params }, opts.id);
  // Two microtask flushes cover both fetch resolution and the inner await chain.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function callGetState(bridge: DevBridge, id?: string) {
  (bridge as unknown as { handleGetState: (id?: string) => void }).handleGetState(id);
  await new Promise((r) => setTimeout(r, 0));
}

describe('DevBridge.computeDebit (v5 action-driven cost)', () => {
  beforeEach(() => {
    mockLuaFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('debit: "bet" with no cost_multiplier → debits exactly the base bet', async () => {
    const bridge = makeBridge();
    await play(bridge, 'spin', 1);
    expect(bridge.balance).toBe(10000 - 1);
  });

  it('debit: "bet" with cost_multiplier 100 → debits bet × 100', async () => {
    // v5: buy bonus is just an action with `debit: 'bet'` + `cost_multiplier: 100`.
    // No top-level buy_bonus block, no buy_bonus_mode field on the action.
    const bridge = makeBridge();
    await play(bridge, 'buy_bonus', 1);
    expect(bridge.balance).toBe(10000 - 100);
  });

  it('different actions carry their own cost_multiplier', async () => {
    // `buy_super` action has `cost_multiplier: 200`. v5 doesn't need a
    // shared modes map — each action is self-contained.
    const bridge = makeBridge();
    await play(bridge, 'buy_super', 1);
    expect(bridge.balance).toBe(10000 - 200);
  });

  it('cost_multiplier scales linearly with bet amount', async () => {
    const bridge = makeBridge();
    await play(bridge, 'buy_bonus', 5);
    // 5 × 100 = 500
    expect(bridge.balance).toBe(10000 - 500);
  });

  it('debit: "none" → no balance movement even when client passes a non-zero bet', async () => {
    // The platform contract is: client sends the triggering bet (bet=0 is
    // rejected by bet_levels validation upstream); the action's debit:'none'
    // is what keeps the wallet still. Mirror that here — a free_spin with
    // bet=1 must NOT decrement the balance.
    const bridge = makeBridge();
    await play(bridge, 'free_spin', 1);
    expect(bridge.balance).toBe(10000);
  });

  it('ante action with cost_multiplier 1.25 → debits bet × 1.25', async () => {
    // v5: ante is a regular action (`ante_spin`) with its own cost_multiplier.
    // No params.ante_bet flag, no top-level ante_bet block.
    const bridge = makeBridge();
    await play(bridge, 'ante_spin', 1);
    expect(bridge.balance).toBeCloseTo(10000 - 1.25, 5);
  });

  it('debit: missing/empty → no balance movement (matches server default)', async () => {
    // Server's ActionDefinition.DebitAmount returns decimal.Zero for any
    // debit other than "bet". DevBridge must mirror that so table-game
    // continuations (e.g. blackjack hit/stand) don't get a phantom bet debit.
    const bridge = makeBridge();
    await play(bridge, 'no_debit', 1);
    expect(bridge.balance).toBe(10000);
  });

  it('legacy v4 debit mode "buy_bonus_cost" → no balance movement (v5 only knows "bet")', async () => {
    // v5 collapses all cost logic into `cost_multiplier` on the action.
    // Old configs that still carry `debit: "buy_bonus_cost"` no longer
    // resolve and must be treated as default → 0, surfacing the config
    // breakage instead of silently debiting bet.
    const bridge = makeBridge();
    await play(bridge, 'legacy_buy_bonus_cost', 1);
    expect(bridge.balance).toBe(10000);
  });

  it('unknown action → balance unchanged (rejected before debit, see PLAY_ERROR contract)', async () => {
    // The platform returns 400 INVALID_INPUT for unknown actions before
    // the wallet is touched. DevBridge must not silently debit anything.
    const bridge = makeBridge();
    await play(bridge, 'mystery_action', 7);
    expect(bridge.balance).toBe(10000);
  });
});

describe('DevBridge.PLAY_ERROR contract', () => {
  beforeEach(() => {
    mockLuaFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('unknown action → emits PLAY_ERROR with INVALID_INPUT and no PLAY_RESULT', async () => {
    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'mystery_action', 1, { id: 'req-1' });

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    const results = sends.filter((s) => s.type === 'PLAY_RESULT');

    expect(errors).toHaveLength(1);
    expect(results).toHaveLength(0);
    expect(errors[0].id).toBe('req-1');
    expect(errors[0].payload).toMatchObject({
      code: 'INVALID_INPUT',
      message: expect.stringMatching(/unknown action/i),
    });
    expect(bridge.balance).toBe(10000);

    bridge.destroy();
  });

  it('insufficient funds → PLAY_ERROR INSUFFICIENT_FUNDS, balance unchanged, no fetch', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const bridge = makeBridge({ balance: 50 });
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'buy_bonus', 1, { id: 'req-2' }); // 1 × 100 = 100, exceeds 50

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe('req-2');
    expect(errors[0].payload).toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    expect(bridge.balance).toBe(50);
    expect(fetchMock).not.toHaveBeenCalled();

    bridge.destroy();
  });

  it('lua execution failure → rolls back debit, emits PLAY_ERROR ENGINE_ERROR (not PLAY_RESULT)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'lua boom' }),
      })),
    );

    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'spin', 1, { id: 'req-3' });

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    const results = sends.filter((s) => s.type === 'PLAY_RESULT');

    expect(errors).toHaveLength(1);
    expect(results).toHaveLength(0);
    expect(errors[0].id).toBe('req-3');
    expect(errors[0].payload).toMatchObject({ code: 'ENGINE_ERROR' });
    // Debit must be rolled back on lua failure.
    expect(bridge.balance).toBe(10000);

    bridge.destroy();
  });
});

describe('DevBridge.creditPending semantics', () => {
  beforeEach(() => {
    mockLuaFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mid-session play → creditPending=false (only true on real credit failure)', async () => {
    // Server-side credit_pending=true means "wallet credit failed, queued
    // for retry". A normal session round (where credit is naturally deferred
    // until the session completes) MUST NOT set creditPending=true — that
    // would make the client show a "wins still being credited" state forever.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          totalWin: 0,
          data: {},
          nextActions: ['free_spin'],
          // Active, not-yet-completed session.
          session: { spinsRemaining: 3, spinsPlayed: 1, totalWin: 0, completed: false, betAmount: 1 },
        }),
      })),
    );

    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'spin', 1, { id: 'mid' });

    const results = sends.filter((s) => s.type === 'PLAY_RESULT');
    expect(results).toHaveLength(1);
    const payload = results[0].payload as { creditPending?: boolean; session: unknown };
    expect(payload.creditPending).toBe(false);
    expect(payload.session).not.toBeNull();

    bridge.destroy();
  });

  it('non-session play → creditPending=false', async () => {
    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'spin', 1, { id: 'plain' });

    const payload = sends.find((s) => s.type === 'PLAY_RESULT')?.payload as { creditPending?: boolean };
    expect(payload?.creditPending).toBe(false);

    bridge.destroy();
  });
});

describe('DevBridge.bet validation (server bet_levels parity)', () => {
  beforeEach(() => {
    mockLuaFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('explicit bet_levels list: rejects bet not in the list with INVALID_AMOUNT', async () => {
    const bridge = makeBridge(); // bet_levels: [0.2, 0.5, 1, 2, 5, 10]
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'spin', 0.3, { id: 'bv-1' });

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].payload).toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(bridge.balance).toBe(10000);

    bridge.destroy();
  });

  it('explicit bet_levels list: accepts allowed bet', async () => {
    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'spin', 1, { id: 'bv-2' });

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    const results = sends.filter((s) => s.type === 'PLAY_RESULT');
    expect(errors).toHaveLength(0);
    expect(results).toHaveLength(1);

    bridge.destroy();
  });

  it('bet_levels range: rejects bet outside min/max', async () => {
    const def: GameDefinition = {
      ...GAME_DEF,
      bet_levels: { min: 0.5, max: 10 },
    };
    const bridge = makeBridge({ gameDefinition: def });
    const sends = startWithCapture(bridge);

    await callPlay(bridge, 'spin', 0.4, { id: 'low' });
    await callPlay(bridge, 'spin', 11, { id: 'high' });

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    expect(errors).toHaveLength(2);
    expect(errors[0].payload).toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(errors[1].payload).toMatchObject({ code: 'INVALID_AMOUNT' });
    expect(bridge.balance).toBe(10000);

    bridge.destroy();
  });
});

describe('DevBridge.roundId (server-generated, client value ignored)', () => {
  beforeEach(() => {
    mockLuaFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('non-session play: emitted roundId is a fresh UUID, not the client value', async () => {
    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'spin', 1, { id: 'p1', roundId: 'CLIENT-ATTEMPT' });

    const result = sends.find((s) => s.type === 'PLAY_RESULT');
    expect(result).toBeDefined();
    const payload = result!.payload as { roundId: string };
    expect(payload.roundId).not.toBe('CLIENT-ATTEMPT');
    // UUID v4-ish: 8-4-4-4-12 hex
    expect(payload.roundId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

    bridge.destroy();
  });

  it('session-based play: roundId stays the same as the session-creating play', async () => {
    // First play creates a session and gets a roundId. Subsequent session
    // plays must echo that same roundId — server keeps the round_id pinned
    // to the session for BET/WIN transaction correlation.
    let callIndex = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        callIndex++;
        return {
          ok: true,
          json: async () => ({
            totalWin: 0,
            data: {},
            nextActions: callIndex < 2 ? ['free_spin'] : ['spin'],
            session: callIndex < 2
              ? { spinsRemaining: 1, spinsPlayed: 1, totalWin: 0, completed: false, betAmount: 1, history: [] }
              : { spinsRemaining: 0, spinsPlayed: 2, totalWin: 0, completed: true, betAmount: 1, history: [] },
          }),
        };
      }),
    );

    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'spin', 1, { id: 'p1' });
    await callPlay(bridge, 'free_spin', 1, { id: 'p2' });

    const results = sends.filter((s) => s.type === 'PLAY_RESULT');
    expect(results).toHaveLength(2);
    const r1 = results[0].payload as { roundId: string };
    const r2 = results[1].payload as { roundId: string };
    expect(r2.roundId).toBe(r1.roundId);

    bridge.destroy();
  });
});

describe('DevBridge.session conflict + expiry (matches server 409/410 paths)', () => {
  beforeEach(() => {
    // Default fetch: session-creating spin that opens a 5-spin free spin session.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          totalWin: 0,
          data: {},
          nextActions: ['free_spin'],
          session: { spinsRemaining: 5, spinsPlayed: 1, totalWin: 0, completed: false, betAmount: 1, history: [] },
        }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('non-session action while session is active → ACTIVE_SESSION_EXISTS', async () => {
    const bridge = makeBridge();
    const sends = startWithCapture(bridge);

    await callPlay(bridge, 'spin', 1, { id: 's1' }); // creates session
    await callPlay(bridge, 'spin', 1, { id: 's2' }); // non-session over active session

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe('s2');
    expect(errors[0].payload).toMatchObject({ code: 'ACTIVE_SESSION_EXISTS' });

    bridge.destroy();
  });

  it('session-required action with no active session → NO_ACTIVE_SESSION', async () => {
    // Use a non-session-creating fetch so no session exists.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          totalWin: 0,
          data: {},
          nextActions: ['spin'],
          session: null,
        }),
      })),
    );

    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'free_spin', 1, { id: 'fs-orphan' });

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].payload).toMatchObject({ code: 'NO_ACTIVE_SESSION' });

    bridge.destroy();
  });

  it('session-required action after TTL expiry → SESSION_EXPIRED', async () => {
    // Tiny TTL so we can advance Date.now past it without fake timers.
    const def: GameDefinition = { ...GAME_DEF, session_ttl: '5ms' };
    const bridge = makeBridge({ gameDefinition: def });
    const sends = startWithCapture(bridge);

    await callPlay(bridge, 'spin', 1, { id: 'open' }); // creates session
    // Advance real wall-clock past the TTL.
    await new Promise((r) => setTimeout(r, 20));

    await callPlay(bridge, 'free_spin', 1, { id: 'late' });

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    expect(errors).toHaveLength(1);
    expect(errors[0].id).toBe('late');
    expect(errors[0].payload).toMatchObject({ code: 'SESSION_EXPIRED' });

    bridge.destroy();
  });
});

describe('DevBridge.STATE_RESPONSE shape', () => {
  beforeEach(() => {
    mockLuaFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('with no session → STATE_RESPONSE { session: null }', async () => {
    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callGetState(bridge, 'state-1');

    const resp = sends.find((s) => s.type === 'STATE_RESPONSE');
    expect(resp?.id).toBe('state-1');
    expect(resp?.payload).toEqual({ session: null });

    bridge.destroy();
  });

  it('after a session-creating play → STATE_RESPONSE.session is shaped like PlayResultData', async () => {
    // Server's GET /games/{id}/session returns the same PlayResult shape
    // (round_id/action/total_win/data/next_actions/session.history). The SDK's
    // getState() reads payload.session.session and payload.session.balanceAfter,
    // so the inner PlayResultData fields are required.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          totalWin: 0,
          data: { matrix: [[1, 2, 3]] },
          nextActions: ['free_spin'],
          session: { spinsRemaining: 3, spinsPlayed: 1, totalWin: 0, completed: false, betAmount: 1 },
        }),
      })),
    );

    const bridge = makeBridge();
    const sends = startWithCapture(bridge);
    await callPlay(bridge, 'spin', 1, { id: 'p1' });
    await callGetState(bridge, 'state-2');

    const resp = sends.find((s) => s.type === 'STATE_RESPONSE');
    expect(resp).toBeDefined();
    const payload = resp!.payload as { session: Record<string, unknown> | null };
    expect(payload.session).not.toBeNull();
    // Required PlayResultData fields the SDK reads from payload.session.
    expect(payload.session).toMatchObject({
      roundId: expect.any(String),
      action: 'spin',
      balanceAfter: expect.any(Number),
      totalWin: expect.any(Number),
      data: expect.any(Object),
      nextActions: ['free_spin'],
      session: expect.objectContaining({ spinsRemaining: 3, spinsPlayed: 1 }),
    });

    bridge.destroy();
  });
});
