import { describe, it, expect, vi } from 'vitest';

import type {
  RGSAuthenticateResponse,
  RGSPlayResponse,
  RGSEndRoundResponse,
  RGSEventResponse,
  RGSReplayResponse,
  RGSBalance,
} from '@energy8platform/stake-bridge';
import { API_MULTIPLIER } from '@energy8platform/stake-bridge';

import { handleRgsRequest } from '../src/harness/rgs-http';
import type { DevRgs } from '../src/harness/dev-rgs';
import { NoBooksError } from '../src/harness/dev-rgs';

// ---------------------------------------------------------------------------
// Fake DevRgs stub
// ---------------------------------------------------------------------------

const FAKE_BALANCE: RGSBalance = { amount: 1000 * API_MULTIPLIER, currency: 'USD' };

const FAKE_AUTH: RGSAuthenticateResponse = {
  balance: FAKE_BALANCE,
  round: null,
  config: {
    gameID: 'test-game',
    minBet: API_MULTIPLIER,
    maxBet: 5 * API_MULTIPLIER,
    stepBet: API_MULTIPLIER,
    defaultBetLevel: API_MULTIPLIER,
    betLevels: [API_MULTIPLIER, 2 * API_MULTIPLIER, 5 * API_MULTIPLIER],
  },
};

const FAKE_BOOK = { id: 1, payoutMultiplier: 250, events: [] };

const FAKE_PLAY_RESPONSE: RGSPlayResponse = {
  balance: FAKE_BALANCE,
  round: {
    betID: 1,
    payoutMultiplier: 2.5,
    active: true,
    mode: 'BASE',
    state: FAKE_BOOK,
    amount: 1,
  },
};

const FAKE_END_ROUND: RGSEndRoundResponse = {
  balance: { amount: 1001.5 * API_MULTIPLIER, currency: 'USD' },
};

const FAKE_EVENT: RGSEventResponse = { event: 'seg-0' };

const FAKE_REPLAY: RGSReplayResponse = {
  state: FAKE_BOOK,
  payoutMultiplier: 2.5,
  mode: 'BASE',
  amount: API_MULTIPLIER,
};

function makeStub(overrides?: Partial<DevRgs>): DevRgs {
  return {
    authenticate: vi.fn().mockResolvedValue(FAKE_AUTH),
    balance: vi.fn().mockResolvedValue({ balance: FAKE_BALANCE }),
    play: vi.fn().mockResolvedValue(FAKE_PLAY_RESPONSE),
    endRound: vi.fn().mockResolvedValue(FAKE_END_ROUND),
    event: vi.fn().mockResolvedValue(FAKE_EVENT),
    replay: vi.fn().mockResolvedValue(FAKE_REPLAY),
    hasBooksFor: vi.fn().mockReturnValue(true),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /wallet/authenticate
// ---------------------------------------------------------------------------

describe('POST /wallet/authenticate', () => {
  it('calls devRgs.authenticate and returns 200 with the response', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'POST',
      path: '/wallet/authenticate',
    });
    expect(stub.authenticate).toHaveBeenCalledOnce();
    expect(result.status).toBe(200);
    expect(result.json).toEqual(FAKE_AUTH);
  });

  it('works with a /__rgs prefix', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'POST',
      path: '/__rgs/wallet/authenticate',
    });
    expect(result.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /wallet/balance
// ---------------------------------------------------------------------------

describe('POST /wallet/balance', () => {
  it('calls devRgs.balance and returns 200', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, { method: 'POST', path: '/wallet/balance' });
    expect(stub.balance).toHaveBeenCalledOnce();
    expect(result.status).toBe(200);
    expect(result.json).toEqual({ balance: FAKE_BALANCE });
  });
});

// ---------------------------------------------------------------------------
// POST /wallet/play
// ---------------------------------------------------------------------------

describe('POST /wallet/play', () => {
  it('passes mode and amount from body, returns 200', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'POST',
      path: '/wallet/play',
      body: { mode: 'BASE', amount: API_MULTIPLIER },
    });
    expect(stub.play).toHaveBeenCalledWith({ mode: 'BASE', amount: API_MULTIPLIER });
    expect(result.status).toBe(200);
    expect(result.json).toEqual(FAKE_PLAY_RESPONSE);
  });

  it('accepts body as a JSON string', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'POST',
      path: '/wallet/play',
      body: JSON.stringify({ mode: 'BONUS', amount: 2 * API_MULTIPLIER }),
    });
    expect(stub.play).toHaveBeenCalledWith({ mode: 'BONUS', amount: 2 * API_MULTIPLIER });
    expect(result.status).toBe(200);
  });

  it('returns 503 on NoBooksError when no luaPlay provided', async () => {
    const stub = makeStub({
      play: vi.fn().mockRejectedValue(new NoBooksError('BASE')),
    });
    const result = await handleRgsRequest(stub, {
      method: 'POST',
      path: '/wallet/play',
      body: { mode: 'BASE', amount: API_MULTIPLIER },
    });
    expect(result.status).toBe(503);
    expect((result.json as { error: string }).error).toBe('ERR_NO_BOOKS');
  });

  it('calls luaPlay and returns 200 on NoBooksError when luaPlay is provided', async () => {
    const stub = makeStub({
      play: vi.fn().mockRejectedValue(new NoBooksError('BASE')),
    });
    const luaPlayResult: RGSPlayResponse = { ...FAKE_PLAY_RESPONSE };
    const luaPlay = vi.fn().mockResolvedValue(luaPlayResult);

    const result = await handleRgsRequest(
      stub,
      { method: 'POST', path: '/wallet/play', body: { mode: 'BASE', amount: API_MULTIPLIER } },
      luaPlay,
    );

    expect(luaPlay).toHaveBeenCalledWith({ mode: 'BASE', amount: API_MULTIPLIER });
    expect(result.status).toBe(200);
    expect(result.json).toEqual(luaPlayResult);
  });
});

// ---------------------------------------------------------------------------
// POST /wallet/end-round
// ---------------------------------------------------------------------------

describe('POST /wallet/end-round', () => {
  it('calls devRgs.endRound and returns 200', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'POST',
      path: '/wallet/end-round',
    });
    expect(stub.endRound).toHaveBeenCalledOnce();
    expect(result.status).toBe(200);
    expect(result.json).toEqual(FAKE_END_ROUND);
  });
});

// ---------------------------------------------------------------------------
// POST /bet/event
// ---------------------------------------------------------------------------

describe('POST /bet/event', () => {
  it('forwards the event value and returns 200', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'POST',
      path: '/bet/event',
      body: { event: 'seg-0' },
    });
    expect(stub.event).toHaveBeenCalledWith('seg-0');
    expect(result.status).toBe(200);
    expect(result.json).toEqual(FAKE_EVENT);
  });
});

// ---------------------------------------------------------------------------
// GET /bet/replay/{game}/{version}/{mode}/{event}
// ---------------------------------------------------------------------------

describe('GET /bet/replay', () => {
  it('parses 4 path segments and calls devRgs.replay', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'GET',
      path: '/bet/replay/abc-game/2/BASE/42',
    });
    expect(stub.replay).toHaveBeenCalledWith({ mode: 'BASE', event: '42' });
    expect(result.status).toBe(200);
    expect(result.json).toEqual(FAKE_REPLAY);
  });

  it('works with a /__rgs prefix', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'GET',
      path: '/__rgs/bet/replay/g/1/BONUS/7',
    });
    expect(stub.replay).toHaveBeenCalledWith({ mode: 'BONUS', event: '7' });
    expect(result.status).toBe(200);
  });

  it('returns 404 on NoBooksError from replay', async () => {
    const stub = makeStub({
      replay: vi.fn().mockRejectedValue(new NoBooksError('BASE')),
    });
    const result = await handleRgsRequest(stub, {
      method: 'GET',
      path: '/bet/replay/g/1/BASE/42',
    });
    expect(result.status).toBe(404);
    expect((result.json as { error: string }).error).toBe('ERR_NO_BOOKS');
  });
});

// ---------------------------------------------------------------------------
// Unknown path → 404
// ---------------------------------------------------------------------------

describe('unknown path', () => {
  it('returns 404 for an unrecognised POST path', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'POST',
      path: '/wallet/unknown-endpoint',
    });
    expect(result.status).toBe(404);
  });

  it('returns 404 for a GET to a non-replay path', async () => {
    const stub = makeStub();
    const result = await handleRgsRequest(stub, {
      method: 'GET',
      path: '/some/random/path',
    });
    expect(result.status).toBe(404);
  });
});
