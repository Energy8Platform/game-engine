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
    // bar controls rendered by renderWrapperHtml
    expect(responseBody).toContain('id="screen"');
    expect(responseBody).toContain('id="currency"');
    expect(responseBody).toContain('id="bet"');
    expect(responseBody).toContain('<iframe id="game"');
    // config blob includes the game id from ssrLoadModule
    expect(responseBody).toContain('demo-slot');
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
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1 }] });
    expect(html).toContain('id="harness-config"');
    expect(html).toContain('demo-slot');
    // bar controls
    expect(html).toContain('id="screen"');
    expect(html).toContain('id="currency"');
    expect(html).toContain('id="social"');
    expect(html).toContain('id="mode"');
    expect(html).toContain('id="round"');
    expect(html).toContain('id="bet"');
    expect(html).toContain('id="replay"');
    expect(html).toContain('id="close"');
    expect(html).toContain('<iframe id="game"');
  });

  it('lists every screen preset', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1 }] });
    for (const p of SCREEN_PRESETS) {
      expect(html).toContain(p.name);
    }
  });

  it('disables the replay group when there are no books', () => {
    const html = renderWrapperHtml({ ...base, modes: [] });
    expect(html).toContain('data-disabled="true"');
    expect(html).toContain('disabled');
  });

  it('enables the replay group when books exist', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1 }] });
    expect(html).toContain('data-disabled="false"');
  });

  it('replay launch multiplies the bet select value by 1_000_000 (minor units)', () => {
    const html = renderWrapperHtml({ ...base, modes: [{ name: 'BASE', cost: 1 }] });
    // The inline driver must contain "* 1_000_000" (or equivalent) for the replay amount.
    // This ensures the replay URL carries minor units, not major.
    expect(html).toContain('1_000_000');
  });
});
