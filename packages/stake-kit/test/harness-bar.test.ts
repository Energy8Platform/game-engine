import { describe, it, expect } from 'vitest';

import { SCREEN_PRESETS, screenPreset, buildLaunchUrl } from '../src/harness/bar';

// ---------------------------------------------------------------------------
// SCREEN_PRESETS
// ---------------------------------------------------------------------------

describe('SCREEN_PRESETS', () => {
  it('has exactly 7 presets', () => {
    expect(SCREEN_PRESETS).toHaveLength(7);
  });

  it('contains each preset with exact dimensions', () => {
    const byName = Object.fromEntries(SCREEN_PRESETS.map((p) => [p.name, p]));

    expect(byName['Desktop']).toEqual({ name: 'Desktop',  w: 1200, h: 675 });
    expect(byName['Laptop']).toEqual({ name: 'Laptop',    w: 1024, h: 576 });
    expect(byName['Popout S']).toEqual({ name: 'Popout S', w: 400,  h: 225 });
    expect(byName['Popout L']).toEqual({ name: 'Popout L', w: 800,  h: 450 });
    expect(byName['Mobile L']).toEqual({ name: 'Mobile L', w: 425,  h: 812 });
    expect(byName['Mobile M']).toEqual({ name: 'Mobile M', w: 375,  h: 667 });
    expect(byName['Mobile S']).toEqual({ name: 'Mobile S', w: 320,  h: 568 });
  });
});

// ---------------------------------------------------------------------------
// screenPreset
// ---------------------------------------------------------------------------

describe('screenPreset', () => {
  it('returns the correct preset for "Mobile M"', () => {
    expect(screenPreset('Mobile M')).toEqual({ name: 'Mobile M', w: 375, h: 667 });
  });

  it('returns undefined for an unknown name', () => {
    expect(screenPreset('Tablet XL')).toBeUndefined();
  });

  it('returns the correct preset for "Desktop"', () => {
    const p = screenPreset('Desktop');
    expect(p).toBeDefined();
    expect(p?.w).toBe(1200);
    expect(p?.h).toBe(675);
  });
});

// ---------------------------------------------------------------------------
// buildLaunchUrl — normal (live)
// ---------------------------------------------------------------------------

describe('buildLaunchUrl — normal mode', () => {
  it('emits rgs_url, sessionID=dev, currency, social, lang, device', () => {
    const qs = buildLaunchUrl({
      rgsUrl: 'localhost:5173/__rgs',
      currency: 'USD',
      social: false,
      lang: 'en',
      device: 'desktop',
    });

    expect(qs.startsWith('?')).toBe(true);
    const params = new URLSearchParams(qs.slice(1));

    expect(params.get('rgs_url')).toBe('localhost:5173/__rgs');
    expect(params.get('sessionID')).toBe('dev');
    expect(params.get('currency')).toBe('USD');
    expect(params.get('social')).toBe('false');
    expect(params.get('lang')).toBe('en');
    expect(params.get('device')).toBe('desktop');
  });

  it('does NOT include replay-related keys', () => {
    const qs = buildLaunchUrl({
      rgsUrl: 'localhost:5173/__rgs',
      currency: 'EUR',
      social: true,
    });
    const params = new URLSearchParams(qs.slice(1));

    expect(params.has('replay')).toBe(false);
    expect(params.has('game')).toBe(false);
    expect(params.has('version')).toBe(false);
    expect(params.has('mode')).toBe(false);
    expect(params.has('event')).toBe(false);
    expect(params.has('amount')).toBe(false);
  });

  it('defaults lang to "en" and device to "desktop"', () => {
    const qs = buildLaunchUrl({
      rgsUrl: 'localhost/__rgs',
      currency: 'GBP',
      social: false,
    });
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('lang')).toBe('en');
    expect(params.get('device')).toBe('desktop');
  });
});

// ---------------------------------------------------------------------------
// buildLaunchUrl — replay
// ---------------------------------------------------------------------------

describe('buildLaunchUrl — replay mode', () => {
  it('emits replay=true, game, version, mode, event, amount, rgs_url', () => {
    const qs = buildLaunchUrl({
      rgsUrl: 'localhost:5173/__rgs',
      currency: 'USD',
      social: false,
      replay: {
        game: 'abc-uuid',
        version: '2',
        mode: 'BASE',
        event: 42,
        amount: 1000000,
      },
    });

    expect(qs.startsWith('?')).toBe(true);
    const params = new URLSearchParams(qs.slice(1));

    expect(params.get('replay')).toBe('true');
    expect(params.get('game')).toBe('abc-uuid');
    expect(params.get('version')).toBe('2');
    expect(params.get('mode')).toBe('BASE');
    expect(params.get('event')).toBe('42');
    expect(params.get('amount')).toBe('1000000');
    expect(params.get('rgs_url')).toBe('localhost:5173/__rgs');
  });

  it('threads currency/social/lang into the replay launch (bridge reads social for socialMode)', () => {
    const qs = buildLaunchUrl({
      rgsUrl: 'localhost/__rgs',
      currency: 'EUR',
      social: true,
      lang: 'de',
      replay: { game: 'g', version: '1', mode: 'BASE', event: 3, amount: 200000 },
    });
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('currency')).toBe('EUR');
    expect(params.get('social')).toBe('true');
    expect(params.get('lang')).toBe('de');
  });

  it('does NOT include sessionID in replay mode', () => {
    const qs = buildLaunchUrl({
      rgsUrl: 'localhost/__rgs',
      currency: 'EUR',
      social: false,
      replay: {
        game: 'g',
        version: '1',
        mode: 'BONUS',
        event: 'round-7',
        amount: 500000,
      },
    });
    const params = new URLSearchParams(qs.slice(1));
    expect(params.has('sessionID')).toBe(false);
  });

  it('accepts string event IDs', () => {
    const qs = buildLaunchUrl({
      rgsUrl: 'localhost/__rgs',
      currency: 'USD',
      social: false,
      replay: { game: 'g', version: '1', mode: 'BASE', event: 'round-99', amount: 0 },
    });
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('event')).toBe('round-99');
  });
});
