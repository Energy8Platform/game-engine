import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { stakeRgsPlugin } from '../src/harness/plugin';

// ---------------------------------------------------------------------------
// Minimal fake HarnessMathConfig returned by ssrLoadModule
// ---------------------------------------------------------------------------

const fakeMathConfig = {
  model: {
    spec: { id: 'demo-slot', betLevels: [1, 2, 5], currency: 'EUR' },
    gameDefinition: {},
    mathModes: [],
  },
  luaScript: '',
};

/** Wire the backend against a fake harness server context, capturing mounted routes. */
function setup() {
  const handlers: Array<{ route?: string; handler: Function }> = [];
  const ctx = {
    server: {
      middlewares: {
        use(routeOrHandler: unknown, handler?: unknown) {
          if (typeof routeOrHandler === 'string') {
            handlers.push({ route: routeOrHandler, handler: handler as Function });
          } else {
            handlers.push({ handler: routeOrHandler as Function });
          }
        },
      },
      ssrLoadModule: async () => ({ default: fakeMathConfig }),
    },
    readBody: async () => '',
    sendJson: (res: ServerResponse, status: number, json: unknown) => {
      res.statusCode = status;
      res.end(JSON.stringify(json));
    },
  };
  const { backend } = stakeRgsPlugin();
  expect(backend).toBeDefined();
  backend!.configureServer(ctx as never);
  return { backend: backend!, handlers };
}

describe('stakeRgsPlugin — backend contract', () => {
  it('exposes a backend with id "stake-rgs"', () => {
    const { backend } = stakeRgsPlugin();
    expect(backend?.id).toBe('stake-rgs');
    expect(typeof backend?.configureServer).toBe('function');
    expect(typeof backend?.describe).toBe('function');
  });

  it('mounts the /__rgs middleware in configureServer', () => {
    const { handlers } = setup();
    expect(handlers.map((h) => h.route)).toContain('/__rgs');
  });

  it('describe() reports launch base, controls and currencies (rgs_url derived from host)', async () => {
    const { backend } = setup();
    const info = await backend.describe({ host: 'localhost:5173' });
    expect(info.launch.base.rgs_url).toBe('localhost:5173/__rgs');
    expect(info.launch.base.sessionID).toBe('dev');
    expect(info.launch.replayBase?.game).toBe('demo-slot');
    expect(info.controls?.setBalanceUrl).toBe('/__rgs/__dev/balance');
    expect(info.controls?.setCurrencyUrl).toBe('/__rgs/__dev/currency');
    expect(info.betLevelsMajor).toEqual([1, 2, 5]);
    expect(info.currencies).toContain('EUR');
    // No books dir in the test cwd → no modes (Replay hidden).
    expect(Array.isArray(info.modes)).toBe(true);
  });

  it('GET /__rgs/__dev/currency?code=GBP updates the authenticate currency', async () => {
    const { handlers } = setup();
    const rgsHandler = handlers.find((h) => h.route === '/__rgs')!.handler;

    function callRgs(url: string, method = 'GET'): Promise<{ status: number; body: unknown }> {
      return new Promise((resolve) => {
        let responseStatus = 0;
        let responseBody = '';
        const fakeReq = { url, method, headers: {} } as unknown as IncomingMessage;
        const fakeRes = {
          statusCode: 0,
          setHeader() {},
          end(body: string) {
            responseStatus = this.statusCode;
            responseBody = body;
          },
        } as unknown as ServerResponse;
        rgsHandler(fakeReq, fakeRes);
        const poll = setInterval(() => {
          if (responseBody || responseStatus) {
            clearInterval(poll);
            resolve({ status: responseStatus, body: JSON.parse(responseBody) });
          }
        }, 5);
      });
    }

    await callRgs('/wallet/authenticate', 'POST');
    const result = await callRgs('/__dev/currency?code=GBP');
    expect(result.status).toBe(200);
    expect((result.body as { ok: boolean }).ok).toBe(true);

    const authResult = await callRgs('/wallet/authenticate', 'POST');
    const authBody = authResult.body as { balance?: { currency: string } };
    expect(authBody.balance?.currency).toBe('GBP');
  });
});
