// packages/game-engine/tests/host/shellConfig.test.ts
import { describe, it, expect } from 'vitest';
import { buildShellConfig, toBonusOptions, currencyConfigFromCode } from '../../src/host/shellConfig';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

const model = {
  spec: {
    betLevels: [0.1, 1, 5], defaultBet: 1, currency: 'EUR',
    actions: {
      spin: { role: 'base' },
      ante: { role: 'feature', cost: 1.5, title: 'ANTE', description: 'boost' },
      free_spin: { role: 'free' },
      buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'buy spins' },
    },
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
});
