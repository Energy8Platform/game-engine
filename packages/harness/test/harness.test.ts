import { describe, it, expect } from 'vitest';

import { createHarness } from '../src/plugin';
import { renderWrapperHtml } from '../src/wrapper';
import { SCREEN_PRESETS, screenPreset } from '../src/screens';
import { LANGS } from '../src/langs';
import { buildLaunchUrl, buildReplayUrl, GAME_MARKER } from '../src/launch';
import type { WrapperData } from '../src/types';

const data: WrapperData = {
  title: 'demo-slot',
  version: '1',
  screens: SCREEN_PRESETS,
  langs: [{ code: 'en', label: 'en — English' }],
  balances: [{ value: 10_000, label: '10K' }],
  defaultBalance: 10_000,
  defaultCurrency: 'EUR',
  defaultLang: 'en',
  backend: {
    id: 'stake-rgs',
    currencies: ['USD', 'EUR'],
    betLevelsMajor: [0.2, 1, 5],
    modes: [{ name: 'BASE', cost: 1, count: 4242 }],
    launch: {
      base: { rgs_url: 'localhost:5173/__rgs', sessionID: 'dev' },
      replayBase: { replay: 'true', game: 'demo-slot', version: '1', rgs_url: 'localhost:5173/__rgs' },
    },
    controls: { setBalanceUrl: '/__rgs/__dev/balance', setCurrencyUrl: '/__rgs/__dev/currency' },
  },
  panels: [{ id: 'reels', title: 'Reels', placement: 'sidebar', clientUrl: '/__harness/panel/reels.js' }],
};

describe('createHarness', () => {
  it('is a serve-only vite plugin named "harness"', () => {
    const p = createHarness();
    expect(p.name).toBe('harness');
    expect(p.apply).toBe('serve');
    expect(typeof p.configureServer).toBe('function');
  });
});

describe('renderWrapperHtml', () => {
  it('embeds the data blob, the iframe, the brand and the client script', () => {
    const html = renderWrapperHtml(data, '/__harness/client.js');
    expect(html).toContain('id="harness-data"');
    expect(html).toContain('<iframe id="game"');
    expect(html).toContain('id="brand"');
    expect(html).toContain('· v1');
    expect(html).toContain('src="/__harness/client.js"');
    // dynamic data rides in the JSON blob (bar/panels are built client-side)
    expect(html).toContain('demo-slot');
    expect(html).toContain('"count":4242');
  });

  it('renders the docked sidebar container', () => {
    const html = renderWrapperHtml(data, '/__harness/client.js');
    expect(html).toContain('id="sidebar"');
    expect(html).toContain('id="sidebar-body"');
  });
});

describe('screens + langs', () => {
  it('exposes the 7 screen presets and looks them up by name', () => {
    expect(SCREEN_PRESETS).toHaveLength(7);
    expect(screenPreset('Desktop')?.w).toBe(1200);
    expect(screenPreset('nope')).toBeUndefined();
  });
  it('ships the language list including en and ru', () => {
    const codes = LANGS.map((l) => l.code);
    expect(codes).toContain('en');
    expect(codes).toContain('ru');
  });
});

describe('launch URLs', () => {
  const state = { currency: 'EUR', social: false, lang: 'en', device: 'desktop' };

  it('normal launch merges backend base + core state + the game marker', () => {
    const q = buildLaunchUrl({ rgs_url: 'localhost:5173/__rgs', sessionID: 'dev' }, state);
    const p = new URLSearchParams(q.slice(1));
    expect(p.get('rgs_url')).toBe('localhost:5173/__rgs');
    expect(p.get('sessionID')).toBe('dev');
    expect(p.get('currency')).toBe('EUR');
    expect(p.get(GAME_MARKER)).toBe('1');
  });

  it('replay launch carries mode/event/amount and the game marker', () => {
    const q = buildReplayUrl(
      { replay: 'true', game: 'demo-slot', version: '1', rgs_url: 'localhost:5173/__rgs' },
      state,
      { mode: 'BASE', event: 7, amount: 1_000_000 },
    );
    const p = new URLSearchParams(q.slice(1));
    expect(p.get('replay')).toBe('true');
    expect(p.get('mode')).toBe('BASE');
    expect(p.get('event')).toBe('7');
    expect(p.get('amount')).toBe('1000000');
    expect(p.get(GAME_MARKER)).toBe('1');
  });
});
