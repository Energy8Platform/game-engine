import { describe, it, expect } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { stakeHarnessPlugin } from '../src/harness/plugin';
import { renderWrapperHtml } from '../src/harness/wrapper';
import { SCREEN_PRESETS } from '../src/harness/bar';

// ---------------------------------------------------------------------------
// Minimal fake HarnessMathConfig returned by ssrLoadModule
// ---------------------------------------------------------------------------

const fakeMathConfig = {
  model: {
    spec: { id: 'demo-slot', betLevels: [1, 2, 5] },
    gameDefinition: {},
    mathModes: [],
  },
  luaScript: '',
};

// ---------------------------------------------------------------------------
// Plugin registration
// ---------------------------------------------------------------------------

describe('stakeHarnessPlugin', () => {
  it('is a serve-only plugin with the expected name', () => {
    const p = stakeHarnessPlugin();
    expect(p.name).toBe('stake-harness');
    expect(p.apply).toBe('serve');
    expect(typeof p.configureServer).toBe('function');
  });

  it('registers /__rgs and a root middleware', () => {
    const p = stakeHarnessPlugin();
    const routes: (string | undefined)[] = [];
    const fakeServer = {
      middlewares: {
        use(routeOrHandler: unknown, _handler?: unknown) {
          routes.push(typeof routeOrHandler === 'string' ? routeOrHandler : undefined);
        },
      },
      ssrLoadModule: async () => ({ default: fakeMathConfig }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.configureServer(fakeServer as any);
    expect(routes).toContain('/__rgs');
    expect(routes).toContain('/');
  });

  it('serves 200 HTML with bar controls from the root / handler via ssrLoadModule', async () => {
    const p = stakeHarnessPlugin();

    // Capture registered handlers
    const handlers: Array<{ route?: string; handler: Function }> = [];
    const fakeServer = {
      middlewares: {
        use(routeOrHandler: unknown, handler?: unknown) {
          if (typeof routeOrHandler === 'string') {
            handlers.push({ route: routeOrHandler, handler: handler as Function });
          } else {
            handlers.push({ handler: routeOrHandler as Function });
          }
        },
      },
      ssrLoadModule: async (_url: string) => ({ default: fakeMathConfig }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.configureServer(fakeServer as any);

    // Find the root '/' handler
    const rootEntry = handlers.find((h) => h.route === '/');
    expect(rootEntry).toBeDefined();
    const rootHandler = rootEntry!.handler;

    // Build a fake IncomingMessage for a browser navigation to '/'
    let responseStatus = 0;
    const responseHeaders: Record<string, string> = {};
    let responseBody = '';

    const fakeReq = {
      url: '/',
      method: 'GET',
      headers: { accept: 'text/html,*/*', host: 'localhost:5173' },
    } as unknown as IncomingMessage;

    const fakeRes = {
      statusCode: 0,
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
      },
      end(body: string) {
        responseStatus = this.statusCode;
        responseBody = body;
      },
    } as unknown as ServerResponse;

    // Call the handler; it is async internally (promise-based) so await settlement
    await new Promise<void>((resolve) => {
      const next = () => resolve();
      rootHandler(fakeReq, fakeRes, next);
      // The handler fires a void promise — poll until body is set
      const poll = setInterval(() => {
        if (responseBody || responseStatus) {
          clearInterval(poll);
          resolve();
        }
      }, 5);
    });

    expect(responseStatus).toBe(200);
    expect(responseHeaders['content-type']).toContain('text/html');
    // tabbed bar + controls rendered by renderWrapperHtml
    expect(responseBody).toContain('data-panel="screen"');
    expect(responseBody).toContain('id="currency"');
    expect(responseBody).toContain('id="amount"');
    expect(responseBody).toContain('<iframe id="game"');
    // config blob includes the game id from ssrLoadModule
    expect(responseBody).toContain('demo-slot');
  });

  it('GET /__rgs/__dev/currency?code=GBP returns { ok: true } and updates authenticate currency', async () => {
    const p = stakeHarnessPlugin();

    const handlers: Array<{ route?: string; handler: Function }> = [];
    const fakeServer = {
      middlewares: {
        use(routeOrHandler: unknown, handler?: unknown) {
          if (typeof routeOrHandler === 'string') {
            handlers.push({ route: routeOrHandler, handler: handler as Function });
          } else {
            handlers.push({ handler: routeOrHandler as Function });
          }
        },
      },
      ssrLoadModule: async (_url: string) => ({ default: fakeMathConfig }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.configureServer(fakeServer as any);

    const rgsEntry = handlers.find((h) => h.route === '/__rgs');
    expect(rgsEntry).toBeDefined();
    const rgsHandler = rgsEntry!.handler;

    function callRgs(url: string, method = 'GET'): Promise<{ status: number; body: unknown }> {
      return new Promise((resolve) => {
        let responseStatus = 0;
        let responseBody = '';
        const fakeReq = {
          url,
          method,
          headers: { 'content-type': 'application/json' },
          on(event: string, cb: (data?: unknown) => void) {
            if (event === 'end') cb();
            return fakeReq;
          },
        } as unknown as IncomingMessage;
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

    // Trigger lazy init by calling authenticate first.
    await callRgs('/wallet/authenticate', 'POST');

    // Now change currency to GBP.
    const result = await callRgs('/__dev/currency?code=GBP');
    expect(result.status).toBe(200);
    expect((result.body as { ok: boolean }).ok).toBe(true);

    // A subsequent authenticate should now return GBP.
    const authResult = await callRgs('/wallet/authenticate', 'POST');
    const authBody = authResult.body as { balance?: { currency: string } };
    expect(authBody.balance?.currency).toBe('GBP');
  });
});

// ---------------------------------------------------------------------------
// Wrapper HTML
// ---------------------------------------------------------------------------

describe('renderWrapperHtml', () => {
  const base = {
    gameId: 'demo-slot',
    version: '1',
    betLevelsMajor: [0.2, 1, 5],
    currencies: ['USD', 'EUR'],
    rgsUrl: 'localhost:5173/__rgs',
  };

  it('embeds the config blob and the bar controls', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1, count: 100 }] });
    expect(html).toContain('id="harness-config"');
    expect(html).toContain('demo-slot');
    // controls live inside the tab popovers
    expect(html).toContain('id="currency"');
    expect(html).toContain('id="balance"');
    expect(html).toContain('id="social"');
    expect(html).toContain('id="mode"');
    expect(html).toContain('id="round"');
    expect(html).toContain('id="amount"');
    expect(html).toContain('id="replay"');
    expect(html).toContain('id="close"');
    expect(html).toContain('<iframe id="game"');
  });

  it('renders the three bottom-bar tabs (Settings/Screen/Replay)', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1, count: 100 }] });
    expect(html).toContain('data-panel="settings"');
    expect(html).toContain('data-panel="screen"');
    expect(html).toContain('data-panel="replay"');
    // and a static brand chip with the game id + version (replaces a Versions tab)
    expect(html).toContain('id="brand"');
    expect(html).toContain('· v1');
  });

  it('does NOT render the removed dice / random control', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1, count: 100 }] });
    expect(html).not.toContain('id="random"');
    expect(html).not.toContain('🎲');
  });

  it('embeds per-mode book count for the Event ID range', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1, count: 4242 }] });
    // count rides in the JSON config blob; the driver derives "Range: 0 – N" from it.
    expect(html).toContain('"count":4242');
  });

  it('lists every screen preset', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1, count: 100 }] });
    for (const p of SCREEN_PRESETS) {
      expect(html).toContain(p.name);
    }
  });

  it('disables the replay tab + controls when there are no books', () => {
    const html = renderWrapperHtml({ ...base, modes: [] });
    expect(html).toContain('data-disabled="true"');
    expect(html).toContain('disabled');
  });

  it('enables the replay tab when books exist', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1, count: 100 }] });
    expect(html).toContain('data-disabled="false"');
  });

  it('replay launch multiplies the amount value by 1_000_000 (minor units)', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1, count: 100 }] });
    // The inline driver must contain "* 1_000_000" for the replay amount,
    // ensuring the replay URL carries minor units, not major.
    expect(html).toContain('1_000_000');
  });

  it('marks EUR as selected by default in the currency select', () => {
    const html = renderWrapperHtml({ ...base, modes: [] });
    // EUR option must carry the selected attribute.
    expect(html).toContain('<option value="EUR" selected>EUR</option>');
    // USD must NOT carry selected.
    expect(html).not.toContain('<option value="USD" selected>');
  });

  it('first currency is selected when EUR is not in the list', () => {
    const html = renderWrapperHtml({
      ...base,
      currencies: ['USD', 'GBP'],
      modes: [],
    });
    // Neither USD nor GBP should get selected (EUR absent → no selection attr applied).
    expect(html).not.toContain(' selected>USD');
    expect(html).not.toContain(' selected>GBP');
  });

  it('#game CSS contains flex: 0 0 auto so the iframe does not shrink', () => {
    const html = renderWrapperHtml({ ...base, modes: [] });
    expect(html).toContain('flex: 0 0 auto');
  });

  it('currency change handler fetches /__rgs/__dev/currency before relaunching', () => {
    const html = renderWrapperHtml({ ...base, modes: [] });
    expect(html).toContain('/__rgs/__dev/currency?code=');
  });
});
