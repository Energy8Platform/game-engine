/**
 * DevBridge debit-computation tests.
 *
 * Targets the contract that the platform's server enforces:
 *   - debit: 'bet'             → bet
 *   - debit: 'buy_bonus_cost'  → bet × buy_bonus.modes[mode].cost_multiplier
 *   - debit: 'ante_bet_cost'   → bet × ante_bet.cost_multiplier
 *   - debit: 'none'            → 0
 *   - regular bet with params.ante_bet=true → bet × ante_bet.cost_multiplier
 *   - unknown action / missing config → falls back to bet (with a warning)
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
  buy_bonus: {
    modes: {
      default: { cost_multiplier: 100 },
      super: { cost_multiplier: 200 },
    },
  },
  ante_bet: { cost_multiplier: 1.25 },
  actions: {
    spin: {
      stage: 'base_game',
      debit: 'bet',
      credit: 'win',
      transitions: [{ condition: 'always', next_actions: ['spin'] }],
    },
    buy_bonus: {
      stage: 'base_game',
      debit: 'buy_bonus_cost',
      buy_bonus_mode: 'default',
      transitions: [{ condition: 'always', next_actions: ['free_spin'] }],
    },
    buy_super: {
      stage: 'base_game',
      debit: 'buy_bonus_cost',
      buy_bonus_mode: 'super',
      transitions: [{ condition: 'always', next_actions: ['free_spin'] }],
    },
    free_spin: {
      stage: 'free_spins',
      debit: 'none',
      requires_session: true,
      transitions: [{ condition: 'always', next_actions: ['free_spin'] }],
    },
    ante_spin: {
      stage: 'base_game',
      debit: 'ante_bet_cost',
      credit: 'win',
      transitions: [{ condition: 'always', next_actions: ['ante_spin'] }],
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

describe('DevBridge.computeDebit', () => {
  beforeEach(() => {
    mockLuaFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('debit: "bet" → debits exactly the base bet', async () => {
    const bridge = makeBridge();
    await play(bridge, 'spin', 1);
    expect(bridge.balance).toBe(10000 - 1);
  });

  it('debit: "buy_bonus_cost" with default mode → debits bet × cost_multiplier', async () => {
    const bridge = makeBridge();
    await play(bridge, 'buy_bonus', 1);
    // default mode cost_multiplier = 100 → debit 100
    expect(bridge.balance).toBe(10000 - 100);
  });

  it('debit: "buy_bonus_cost" with super mode → uses the matching multiplier', async () => {
    const bridge = makeBridge();
    await play(bridge, 'buy_super', 1);
    // super mode cost_multiplier = 200 → debit 200
    expect(bridge.balance).toBe(10000 - 200);
  });

  it('debit: "buy_bonus_cost" scales linearly with bet amount', async () => {
    const bridge = makeBridge();
    await play(bridge, 'buy_bonus', 5);
    // 5 × 100 = 500 — guarding against the previous bug where DevBridge
    // would have only debited 5.
    expect(bridge.balance).toBe(10000 - 500);
  });

  it('debit: "none" → no balance movement (free spin continuation)', async () => {
    const bridge = makeBridge();
    await play(bridge, 'free_spin', 0);
    expect(bridge.balance).toBe(10000);
  });

  it('debit: "ante_bet_cost" → debits bet × ante_bet.cost_multiplier', async () => {
    const bridge = makeBridge();
    await play(bridge, 'ante_spin', 1);
    // 1 × 1.25 = 1.25
    expect(bridge.balance).toBeCloseTo(10000 - 1.25, 5);
  });

  it('debit: "bet" with params.ante_bet=true → applies ante multiplier', async () => {
    const bridge = makeBridge();
    await play(bridge, 'spin', 1, { ante_bet: true });
    expect(bridge.balance).toBeCloseTo(10000 - 1.25, 5);
  });

  it('unknown action → falls back to base bet', async () => {
    const bridge = makeBridge();
    await play(bridge, 'mystery_action', 7);
    expect(bridge.balance).toBe(10000 - 7);
  });
});
