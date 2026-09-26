import { describe, expect, it } from 'vitest';
import type { SessionInit } from '@energy8engine/contracts';
import { Config } from '../src/schema';
import { toShellConfig } from '../src/config';

const INIT: SessionInit = {
  balance: 1000,
  currency: { code: 'EUR', symbol: '€', decimals: 2, position: 'right' },
  betLevels: [1, 2, 5],
  defaultBet: 2,
};

describe('toShellConfig — the session feeds the shell, the row config dresses it', () => {
  it('an empty Config({}) plus init is a complete ShellConfig', () => {
    expect(toShellConfig(Config({}), INIT)).toEqual({
      availableBets: [1, 2, 5],
      defaultBet: 2,
      currentBet: 2,
      balance: 1000,
      win: 0,
      mode: 'base',
      currency: { symbol: '€', position: 'right', maxDecimals: 2 },
      language: 'en',
      version: '1.0.0',
      features: { turbo: 1, autoplay: {}, buyBonus: false, hotkeys: undefined, spacebar: undefined },
      gameInfo: { sections: [] },
      menu: undefined,
      theme: undefined,
    });
  });

  it('language: the row config wins, then init, then en', () => {
    expect(toShellConfig(Config({ language: 'de' }), { ...INIT, language: 'fr' }).language).toBe('de');
    expect(toShellConfig(Config({}), { ...INIT, language: 'fr' }).language).toBe('fr');
    expect(toShellConfig(Config({}), INIT).language).toBe('en');
  });

  it('features: turbo level, buyBonus list or false, autoplay object or null', () => {
    const on = toShellConfig(
      Config({ features: { turbo: 3, buyBonus: [{ id: 'b', title: 'Bonus', cost: 100 }], autoplay: { maxCount: 50 } } }),
      INIT,
    ).features;
    expect(on.turbo).toBe(3);
    expect(on.buyBonus).toEqual([{ id: 'b', title: 'Bonus', cost: 100 }]);
    expect(on.autoplay).toEqual({ maxCount: 50 });

    // `false` is how a YAML config switches a feature off (schemastery
    // turns a `null` into the field's default, so `null` cannot say it).
    const off = toShellConfig(Config({ features: { buyBonus: false, autoplay: false } }), INIT).features;
    expect(off.buyBonus).toBe(false);
    expect(off.autoplay).toBeNull();
  });

  it('turbo is bounded to 0..3 whole levels — 4, -1 and 1.5 are refused at validation', () => {
    expect(Config({ features: { turbo: 0 } }).features.turbo).toBe(0);
    expect(Config({ features: { turbo: 3 } }).features.turbo).toBe(3);
    for (const turbo of [4, -1, 1.5]) expect(() => Config({ features: { turbo } })).toThrow();
  });

  it('a missing or blank `features` resolves the inner defaults — no `.default()` on the object needed', () => {
    const inner = { turbo: 1, autoplay: {}, buyBonus: false };
    expect(Config({}).features).toEqual(inner);
    expect(Config({ features: null }).features).toEqual(inner);
    expect(Config({ features: {} }).features).toEqual(inner);
  });

  it('a blank YAML value (null) for theme, menu, hotkeys or spacebar reaches the shell as undefined', () => {
    // Validation keeps a `null` on a field with no default (measured) —
    // and the shell's `resolveTheme(theme = {})` would dereference it.
    const cfg = Config({ theme: null, menu: null, features: { hotkeys: null, spacebar: null } });
    expect(cfg.theme).toBeNull();
    const shell = toShellConfig(cfg, INIT);
    expect(shell.theme).toBeUndefined();
    expect(shell.menu).toBeUndefined();
    expect(shell.features.hotkeys).toBeUndefined();
    expect(shell.features.spacebar).toBeUndefined();
  });

  it('hotkeys: a mobile session turns them off over the author; otherwise the author, else the shell decides', () => {
    const mobile = { ...INIT, device: 'mobile' as const };
    expect(toShellConfig(Config({}), mobile).features.hotkeys).toBe(false);
    expect(toShellConfig(Config({ features: { hotkeys: true } }), mobile).features.hotkeys).toBe(false);

    const desktop = { ...INIT, device: 'desktop' as const };
    expect(toShellConfig(Config({}), desktop).features.hotkeys).toBeUndefined();
    expect(toShellConfig(Config({}), INIT).features.hotkeys).toBeUndefined();
    expect(toShellConfig(Config({ features: { hotkeys: false } }), desktop).features.hotkeys).toBe(false);
    expect(toShellConfig(Config({ features: { hotkeys: true } }), INIT).features.hotkeys).toBe(true);
  });

  it('maps session.social to the shell isSocial', () => {
    expect(toShellConfig(Config({}), { ...INIT, social: true }).isSocial).toBe(true);
    expect(toShellConfig(Config({}), INIT).isSocial).toBeUndefined();
  });

  it('gameInfo, menu, theme and version pass through; i18n is not a ShellConfig field; an unknown key survives and reaches nothing', () => {
    const cfg = Config({
      version: '2.1.0',
      gameInfo: { sections: [{ type: 'rules', text: 'x' }] },
      menu: [{ id: 'sound' }],
      theme: { accent: '#f00' },
      i18n: { de: { Spin: 'Drehen' } },
      tiers: [{ id: 'big', threshold: 20 }],
    });
    // Not refused: schemastery keeps a key the schema never named.
    expect(cfg).toHaveProperty('tiers');
    const shell = toShellConfig(cfg, INIT);
    expect(shell.version).toBe('2.1.0');
    expect(shell.gameInfo).toEqual({ sections: [{ type: 'rules', text: 'x' }] });
    expect(shell.menu).toEqual([{ id: 'sound' }]);
    expect(shell.theme).toEqual({ accent: '#f00' });
    expect(shell).not.toHaveProperty('i18n');
    expect(shell).not.toHaveProperty('tiers');
  });
});
