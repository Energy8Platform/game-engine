/**
 * Boot-check: node-level DevBridge↔SDK handshake test.
 *
 * Proves the boot chain works in node, renderer-free:
 *   - build a GameModel via defineGame
 *   - createPlatformSession with a dev (DevBridge) config
 *   - assert session reaches initData (handshake succeeded)
 *   - assert play({ action: 'spin', bet: 1 }) returns a numeric totalWin
 *
 * NOTE: DevBridge's `luaScript` path routes play requests via
 * `fetch('/__lua-play')` — the Vite dev server endpoint — so it cannot
 * run in a pure-node test. We use an `onPlay` callback instead, which
 * exercises the full DevBridge↔SDK handshake without a Vite process.
 *
 * MemoryChannel (used by CasinoGameSDK in devMode) keys its singleton off
 * `window`. Install a minimal globalThis shim before the suite so the
 * in-memory channel can attach without a DOM.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { defineGame } from '../src/game-spec';
import { createPlatformSession, type PlatformSession } from '../src/index';

beforeAll(() => {
  if (typeof (globalThis as Record<string, unknown>).window === 'undefined') {
    (globalThis as Record<string, unknown>).window = globalThis;
  }
});

// Minimal one-action model: base spin only, no free-spin session complexity.
const model = defineGame({
  id: 'boot',
  type: 'slot',
  grid: { cols: 6, rows: 6 },
  betLevels: [1],
  defaultBet: 1,
  maxWin: 1000,
  currency: 'EUR',
  symbols: [{ id: 'H1', kind: 'high', pay: { 3: 10 } }],
  actions: {
    spin: { role: 'base' },
  },
});

describe('boot handshake (DevBridge ↔ SDK, renderer-free)', () => {
  let session: PlatformSession | null = null;

  afterEach(() => {
    session?.destroy();
    session = null;
  });

  it('createPlatformSession(dev) reaches initData and a spin returns a result', async () => {
    session = await createPlatformSession({
      dev: {
        balance: 1000,
        currency: 'EUR',
        gameConfig: {
          id: model.spec.id,
          type: 'slot',
          version: '1.0.0',
          viewport: { width: 1920, height: 1080 },
          betLevels: model.spec.betLevels,
        },
        gameDefinition: model.gameDefinition,
        // Use onPlay callback — luaScript routes via Vite's /__lua-play
        // endpoint which is unavailable in a pure-node test environment.
        onPlay: () => ({ totalWin: 0, nextActions: ['spin'] }),
        networkDelay: 0,
        debug: false,
      },
      sdk: { devMode: true },
    });

    // Handshake must succeed: initData is populated from the DevBridge INIT message.
    expect(session.initData).toBeTruthy();
    expect(session.balance).toBe(1000);
    expect(session.currency).toBe('EUR');

    // A spin must return a well-formed result with a numeric totalWin.
    const result = await session.play({ action: 'spin', bet: 1 });
    expect(typeof result.totalWin).toBe('number');
    expect(result.action).toBe('spin');
  });
});
