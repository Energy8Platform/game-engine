/**
 * Smoke test for the renderer-agnostic surface of platform-core.
 *
 * Imports nothing from @energy8platform/game-engine and nothing from
 * pixi.js. The Phaser/Three/custom-engine integration story lives or
 * dies on these imports continuing to work without touching either.
 *
 * If anything in this file ever needs a pixi import to resolve, the
 * isolation contract has regressed and the test will surface that.
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import {
  createPlatformSession,
  PlatformSession,
  LuaEngine,
  DevBridge,
  type GameDefinition,
} from '../src/index';

// MemoryChannel (used by DevBridge in devMode) keys its singleton off
// `window`. This test runs under vitest's node environment; install a
// minimal globalThis stand-in so the channel can attach without pulling
// in a real DOM. This shim is the only "browser-flavored" code in the
// test — actual rendering / DOM APIs are NOT exercised.
beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = globalThis;
  }
});

const SIMPLE_GAME_DEF: GameDefinition = {
  id: 'smoke-test-slot',
  type: 'SLOT',
  actions: {
    spin: {
      stage: 'base_game',
      debit: 'bet',
      credit: 'win',
      transitions: [
        { condition: 'always', next_actions: ['spin'] },
      ],
    },
  },
  bet_levels: [0.2, 0.5, 1, 2, 5],
  max_win: { multiplier: 10000 },
};

const SIMPLE_LUA = `
function execute(state)
    local bet = state.variables.bet or 1
    local matrix = {}
    for col = 1, 3 do
        matrix[col] = {}
        for row = 1, 3 do
            matrix[col][row] = engine.random(1, 9)
        end
    end
    return {
        total_win = bet * 0.5,
        data = { matrix = matrix },
    }
end
`;

describe('platform-core smoke test (no pixi)', () => {
  let session: PlatformSession | null = null;

  afterEach(() => {
    session?.destroy();
    session = null;
  });

  it('exposes the renderer-agnostic public API', () => {
    expect(typeof createPlatformSession).toBe('function');
    expect(typeof PlatformSession).toBe('function');
    expect(typeof LuaEngine).toBe('function');
    expect(typeof DevBridge).toBe('function');
  });

  it('creates a session with the dev bridge + lua + sdk handshake', async () => {
    session = await createPlatformSession({
      dev: {
        balance: 5000,
        currency: 'EUR',
        gameConfig: {
          id: SIMPLE_GAME_DEF.id,
          type: 'slot',
          version: '1.0.0',
          viewport: { width: 1920, height: 1080 },
          betLevels: [0.2, 0.5, 1, 2, 5],
        },
        luaScript: SIMPLE_LUA,
        gameDefinition: SIMPLE_GAME_DEF,
        networkDelay: 0,
        debug: false,
      },
      sdk: { devMode: true },
    });

    expect(session.sdk).not.toBeNull();
    expect(session.devBridge).not.toBeNull();
    expect(session.initData).not.toBeNull();
    expect(session.balance).toBe(5000);
    expect(session.currency).toBe('EUR');
  });

  it('throws on play() when constructed with sdk: false', async () => {
    session = await createPlatformSession({ sdk: false });

    expect(session.sdk).toBeNull();
    expect(session.initData).toBeNull();
    expect(session.devBridge).toBeNull();

    await expect(session.play({ action: 'spin', bet: 1 })).rejects.toThrow(
      /requires an active SDK/i,
    );
  });
});
