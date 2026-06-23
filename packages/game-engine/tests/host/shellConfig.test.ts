// packages/game-engine/tests/host/shellConfig.test.ts
import { describe, it, expect } from 'vitest';
import { buildShellConfig, defaultGameInfo, toBonusOptions, currencyConfigFromCode } from '../../src/host/shellConfig';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const model = {
  spec: {
    betLevels: [0.1, 1, 5], defaultBet: 1, currency: 'EUR', maxWin: 5000,
    grid: { cols: 5, rows: 3 }, mechanic: 'lines',
    actions: {
      spin: { role: 'base' },
      ante: { role: 'feature', cost: 1.5, title: 'ANTE', description: 'boost' },
      free_spin: { role: 'free' },
      buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'buy spins' },
    },
  },
  paytable: {
    symbols: [
      { id: 'H1', name: 'CROWN', kind: 'high', pay: { 3: 5, 4: 20, 5: 100 } },
      { id: 'L1', name: 'TEN', kind: 'low', pay: { 3: 1, 5: 10 } },
      { id: 'WILD', name: 'WILD', kind: 'wild', pay: {} },
    ],
  },
} as unknown as GameModel;

describe('toBonusOptions', () => {
  it('maps buy→bonus card and feature→ante toggle, from the spec', () => {
    const opts = toBonusOptions(model);
    expect(opts).toEqual([
      { id: 'ante', type: 'feature', title: 'ANTE', description: 'boost', priceMultiplier: 1.5 },
      { id: 'buy_bonus', type: 'bonus', title: 'BUY BONUS', description: 'buy spins', priceMultiplier: 100 },
    ]);
  });
});

describe('currencyConfigFromCode', () => {
  it('maps known codes to a symbol, defaults position left, falls back to the code', () => {
    expect(currencyConfigFromCode('EUR')).toEqual({ symbol: '€', position: 'left' });
    expect(currencyConfigFromCode('USD')).toEqual({ symbol: '$', position: 'left' });
    expect(currencyConfigFromCode('ZZZ')).toEqual({ symbol: 'ZZZ', position: 'left' });
  });
});

describe('buildShellConfig (runtime ctx)', () => {
  it('derives currency from runtime, buyBonus from the model', () => {
    const c = buildShellConfig({}, model, { balance: 1000, currency: 'USD', language: 'de', mode: 'base' });
    expect(c.currency).toEqual({ symbol: '$', position: 'left' });
    expect(c.language).toBe('de');
    expect(c.balance).toBe(1000);
    expect(c.features.buyBonus).toEqual(toBonusOptions(model));
  });
  it('falls back to spec.currency then neutral; opts.currency overrides', () => {
    expect(buildShellConfig({}, model, { balance: 0, mode: 'base' }).currency).toEqual({ symbol: '€', position: 'left' });
    const o = buildShellConfig({ currency: { symbol: '₿', position: 'right' } }, model, { balance: 0, mode: 'base' });
    expect(o.currency).toEqual({ symbol: '₿', position: 'right' });
  });

  it('threads runtime.social into isSocial (defaults false)', () => {
    expect(buildShellConfig({}, model, { balance: 0, mode: 'base' }).isSocial).toBe(false);
    expect(buildShellConfig({}, model, { balance: 0, mode: 'base', social: true }).isSocial).toBe(true);
  });

  it('derives a non-empty gameInfo (max win + paytable) and adds a disclaimer section when present', () => {
    const c = buildShellConfig({}, model, { balance: 0, mode: 'base', disclaimerLines: ['Malfunction voids all wins.', 'RTP over many plays.'] });
    const sections = c.gameInfo.sections ?? [];
    expect(sections.length).toBeGreaterThan(1);
    const disclaimer = sections.find((s) => s.type === 'custom' && s.title === 'DISCLAIMER');
    expect(disclaimer).toBeDefined();
    expect((disclaimer as { html?: string }).html).toContain('Malfunction voids all wins.');
    expect(sections.some((s) => s.type === 'paytable')).toBe(true);
    expect(sections.some((s) => s.type === 'custom' && s.title === 'MAX WIN')).toBe(true);
  });

  it('omits the disclaimer section gracefully when no lines (non-stake/dev)', () => {
    const sections = buildShellConfig({}, model, { balance: 0, mode: 'base' }).gameInfo.sections ?? [];
    expect(sections.some((s) => s.type === 'custom' && s.title === 'DISCLAIMER')).toBe(false);
    // still non-empty: base info derived from the spec
    expect(sections.length).toBeGreaterThan(0);
  });

  it('opts.gameInfo replaces the derived content (documented override)', () => {
    const override = { sections: [{ type: 'controls' as const }] };
    const c = buildShellConfig({ gameInfo: override }, model, { balance: 0, mode: 'base', disclaimerLines: ['x'] });
    expect(c.gameInfo).toBe(override);
  });
});

describe('defaultGameInfo', () => {
  it('builds paytable rows from the model paytable, dropping pay-less symbols', () => {
    const info = defaultGameInfo(model, { balance: 0, mode: 'base' });
    const pay = (info.sections ?? []).find((s) => s.type === 'paytable') as { rows: Array<{ symbol: { text?: string } }> };
    expect(pay.rows.map((r) => r.symbol.text)).toEqual(['CROWN', 'TEN']); // WILD has no pay → dropped
  });
});
