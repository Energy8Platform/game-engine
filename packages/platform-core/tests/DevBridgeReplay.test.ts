/**
 * DevBridge replay-mode tests (SDK 2.7.3 historical-round replay).
 *
 * In production the casino backend is the replay host; in dev the DevBridge
 * IS the host. When launched as a replay it must:
 *   - flip config.replayMode = true in INIT (so sdk.isReplay is true)
 *   - take balance/currency from the recorded results
 *   - serve results[cursor] on each PLAY_REQUEST, no wallet movement
 *   - reset the cursor to 0 on the first spin past the end ("Play Again")
 *
 * The recorded rounds come from a user-supplied resolver — DevBridge stays
 * agnostic about where they live (fetch, static, localStorage, …).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { DevBridge } from '../src/dev-bridge/DevBridge';
import type { PlayResultData } from '@energy8platform/game-sdk';

beforeAll(() => {
  if (typeof (globalThis as any).window === 'undefined') {
    (globalThis as any).window = globalThis;
  }
});

function makeResult(over: Partial<PlayResultData> = {}): PlayResultData {
  return {
    roundId: 'rec-round',
    action: 'spin',
    balanceAfter: 1000,
    totalWin: 0,
    currency: 'EUR',
    gameId: 'replay-game',
    data: {},
    nextActions: ['spin'],
    session: null,
    creditPending: false,
    ...over,
  };
}

interface CapturedSend {
  type: string;
  payload: unknown;
  id?: string;
}

function startWithCapture(bridge: DevBridge): CapturedSend[] {
  bridge.start();
  const sends: CapturedSend[] = [];
  const inner = (bridge as unknown as { _bridge: { send: (t: string, p: unknown, i?: string) => void } })._bridge;
  inner.send = (type, payload, id) => {
    sends.push({ type, payload, id });
  };
  return sends;
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

async function gameReady(bridge: DevBridge, id?: string) {
  (bridge as unknown as { handleGameReady: (id?: string) => void }).handleGameReady(id);
  await flush();
}

async function play(bridge: DevBridge, action: string, bet: number, id?: string) {
  (bridge as unknown as {
    handlePlayRequest: (p: { action: string; bet: number }, id?: string) => void;
  }).handlePlayRequest({ action, bet }, id);
  await flush();
}

async function getBalance(bridge: DevBridge, id?: string) {
  (bridge as unknown as { handleGetBalance: (id?: string) => void }).handleGetBalance(id);
  await flush();
}

describe('DevBridge replay mode', () => {
  let bridge: DevBridge | null = null;

  afterEach(() => {
    bridge?.destroy();
    bridge = null;
  });

  it('INIT flips replayMode=true and takes balance/currency from recorded results', async () => {
    bridge = new DevBridge({
      balance: 99999, // must be ignored in replay — balance comes from records
      currency: 'USD',
      networkDelay: 0,
      debug: false,
      replay: {
        detect: () => ({ mode: 'BASE', roundId: 'r1' }),
        resolve: () => [makeResult({ balanceAfter: 1234, currency: 'EUR' })],
      },
    });
    const sends = startWithCapture(bridge);
    await gameReady(bridge, 'gr-1');

    const init = sends.find((s) => s.type === 'INIT');
    expect(init).toBeDefined();
    const payload = init!.payload as { balance: number; currency: string; config: { replayMode?: boolean }; session: unknown };
    expect(payload.config.replayMode).toBe(true);
    expect(payload.balance).toBe(1234);
    expect(payload.currency).toBe('EUR');
    expect(payload.session).toBeNull();
  });

  it('serves recorded rounds in order by cursor without moving the wallet', async () => {
    const results = [
      makeResult({ roundId: 'a', balanceAfter: 900 }),
      makeResult({ roundId: 'b', balanceAfter: 950 }),
    ];
    bridge = new DevBridge({
      networkDelay: 0,
      debug: false,
      replay: { detect: () => ({}), resolve: () => results },
    });
    const sends = startWithCapture(bridge);

    await play(bridge, 'spin', 1, 'p1');
    await play(bridge, 'spin', 1, 'p2');

    const played = sends.filter((s) => s.type === 'PLAY_RESULT');
    expect(played).toHaveLength(2);
    expect((played[0].payload as PlayResultData).roundId).toBe('a');
    expect((played[1].payload as PlayResultData).roundId).toBe('b');
    // No bet_levels / debit logic touched the wallet — balance mirrors the record.
    expect(bridge.balance).toBe(950);
  });

  it('first spin past the end resets the cursor to 0 ("Play Again")', async () => {
    const results = [makeResult({ roundId: 'only' })];
    bridge = new DevBridge({
      networkDelay: 0,
      debug: false,
      replay: { detect: () => ({}), resolve: () => results },
    });
    const sends = startWithCapture(bridge);

    await play(bridge, 'spin', 1, 'p1'); // serves 'only', cursor → 1 (past end)
    await play(bridge, 'spin', 1, 'p2'); // Play Again: resets to 0, serves 'only'

    const played = sends.filter((s) => s.type === 'PLAY_RESULT');
    expect(played).toHaveLength(2);
    expect((played[0].payload as PlayResultData).roundId).toBe('only');
    expect((played[1].payload as PlayResultData).roundId).toBe('only');
  });

  it('empty recorded list → PLAY_ERROR NO_ACTIVE_SESSION, no PLAY_RESULT', async () => {
    bridge = new DevBridge({
      networkDelay: 0,
      debug: false,
      replay: { detect: () => ({}), resolve: () => [] },
    });
    const sends = startWithCapture(bridge);
    await play(bridge, 'spin', 1, 'p1');

    const errors = sends.filter((s) => s.type === 'PLAY_ERROR');
    const played = sends.filter((s) => s.type === 'PLAY_RESULT');
    expect(played).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].payload).toMatchObject({ code: 'NO_ACTIVE_SESSION' });
  });

  it('passes mode + roundId from detect() to the resolver', async () => {
    const calls: Array<[string | undefined, string | undefined]> = [];
    bridge = new DevBridge({
      networkDelay: 0,
      debug: false,
      replay: {
        detect: () => ({ mode: 'BONUS', roundId: 'abc123' }),
        resolve: (mode, roundId) => {
          calls.push([mode, roundId]);
          return [makeResult()];
        },
      },
    });
    startWithCapture(bridge);
    await gameReady(bridge);

    expect(calls).toContainEqual(['BONUS', 'abc123']);
  });

  it('supports an async resolver (e.g. fetch)', async () => {
    bridge = new DevBridge({
      networkDelay: 0,
      debug: false,
      replay: {
        detect: () => ({}),
        resolve: async () => [makeResult({ roundId: 'fetched', balanceAfter: 777 })],
      },
    });
    const sends = startWithCapture(bridge);
    await play(bridge, 'spin', 1, 'p1');

    const played = sends.filter((s) => s.type === 'PLAY_RESULT');
    expect(played).toHaveLength(1);
    expect((played[0].payload as PlayResultData).roundId).toBe('fetched');
    expect(bridge.balance).toBe(777);
  });

  it('GET_BALANCE returns the recorded balance at the current cursor', async () => {
    const results = [makeResult({ balanceAfter: 555 })];
    bridge = new DevBridge({
      balance: 99999,
      networkDelay: 0,
      debug: false,
      replay: { detect: () => ({}), resolve: () => results },
    });
    const sends = startWithCapture(bridge);
    await play(bridge, 'spin', 1, 'p1');
    await getBalance(bridge, 'bal-1');

    const bal = sends.filter((s) => s.type === 'BALANCE_UPDATE').pop();
    expect((bal!.payload as { balance: number }).balance).toBe(555);
  });

  it('detect() returning null → normal mode, replayMode not set', async () => {
    bridge = new DevBridge({
      balance: 5000,
      currency: 'USD',
      networkDelay: 0,
      debug: false,
      onPlay: () => ({ totalWin: 0 }),
      replay: { detect: () => null, resolve: () => [makeResult()] },
    });
    const sends = startWithCapture(bridge);
    await gameReady(bridge, 'gr-1');

    const init = sends.find((s) => s.type === 'INIT');
    const payload = init!.payload as { balance: number; config: { replayMode?: boolean } };
    expect(payload.config.replayMode).toBeFalsy();
    expect(payload.balance).toBe(5000);
  });
});
