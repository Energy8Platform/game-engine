import { describe, it, expect } from 'vitest';

import { stakeHarnessPlugin } from '../src/harness/plugin';
import { renderWrapperHtml } from '../src/harness/wrapper';
import { SCREEN_PRESETS } from '../src/harness/bar';

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
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.configureServer(fakeServer as any);
    expect(routes).toContain('/__rgs');
    expect(routes).toContain('/');
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
