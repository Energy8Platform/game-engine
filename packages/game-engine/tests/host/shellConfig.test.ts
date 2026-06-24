// packages/game-engine/tests/host/shellConfig.test.ts
import { describe, it, expect } from 'vitest';
import { buildShellConfig, defaultGameInfo, toBonusOptions, resolveCurrency, mergeGameInfo } from '../../src/host/shellConfig';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { GameInfoContent, GameInfoSection } from '@energy8platform/platform-core/shell';

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

describe('resolveCurrency (single source of truth — initData.config.currency)', () => {
  it('derives symbol + position from the CurrencyMetaData the bridge surfaces', () => {
    // symbolAfter:false → left
    expect(resolveCurrency({ code: 'EUR', symbol: '€', decimals: 2 })).toEqual({ symbol: '€', position: 'left' });
    // symbolAfter:true → right (e.g. PLN 'zł')
    expect(resolveCurrency({ code: 'PLN', symbol: 'zł', decimals: 2, symbolAfter: true })).toEqual({ symbol: 'zł', position: 'right' });
  });
  it('falls back to the spec currency code, then neutral euro, when meta is absent (dev/devBridge)', () => {
    expect(resolveCurrency(null, 'ZZZ')).toEqual({ symbol: 'ZZZ', position: 'left' });
    expect(resolveCurrency(undefined, undefined)).toEqual({ symbol: '€', position: 'left' });
  });
});

describe('buildShellConfig (runtime ctx)', () => {
  it('uses the resolved runtime.currency, buyBonus from the model', () => {
    const c = buildShellConfig({}, model, { balance: 1000, currency: { symbol: '$', position: 'left' }, language: 'de', mode: 'base' });
    expect(c.currency).toEqual({ symbol: '$', position: 'left' });
    expect(c.language).toBe('de');
    expect(c.balance).toBe(1000);
    expect(c.features.buyBonus).toEqual(toBonusOptions(model));
  });
  it('falls back to spec.currency then neutral; opts.currency overrides', () => {
    expect(buildShellConfig({}, model, { balance: 0, mode: 'base' }).currency).toEqual({ symbol: 'EUR', position: 'left' });
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

  it('MERGES opts.gameInfo over the derived set: replaces same-type, adds new types, keeps the rest', () => {
    const authorPaytable: GameInfoSection = { type: 'paytable', title: 'MY PAYS', rows: [{ symbol: { text: 'A' }, wins: [{ count: '3', multiplier: 9 }] }] };
    const authorModes: GameInfoSection = { type: 'modes', title: 'MODES', modes: [{ title: 'Base' }] };
    const override: GameInfoContent = { sections: [authorPaytable, authorModes] };
    const c = buildShellConfig({ gameInfo: override }, model, { balance: 0, mode: 'base', disclaimerLines: ['Malfunction voids all wins.'] });
    const sections = c.gameInfo.sections ?? [];
    // the author's paytable replaced the derived one (same type)
    const pay = sections.filter((s) => s.type === 'paytable');
    expect(pay).toHaveLength(1);
    expect((pay[0] as { title?: string }).title).toBe('MY PAYS');
    // the new type (modes) was added
    expect(sections.some((s) => s.type === 'modes' && (s as { title?: string }).title === 'MODES')).toBe(true);
    // other derived sections are KEPT
    expect(sections.some((s) => s.type === 'custom' && (s as { title?: string }).title === 'MAX WIN')).toBe(true);
    expect(sections.some((s) => s.type === 'custom' && (s as { title?: string }).title === 'DISCLAIMER')).toBe(true);
    expect(sections.some((s) => s.type === 'controls')).toBe(true);
    expect(sections.some((s) => s.type === 'wins')).toBe(true);
  });

  it('undefined opts.gameInfo → pure derived set (unchanged)', () => {
    const derived = defaultGameInfo(model, { balance: 0, mode: 'base' });
    const c = buildShellConfig({}, model, { balance: 0, mode: 'base' });
    expect(c.gameInfo).toEqual(derived);
  });

  it('social mode socializes the WHOLE merged set — host-derived AND author content', () => {
    const author: GameInfoContent = { sections: [{ type: 'custom', title: 'Our Paytable Rules', html: '<p>Read the paytable.</p>' }] };
    const c = buildShellConfig({ gameInfo: author }, model, {
      balance: 0, mode: 'base', social: true,
      disclaimerLines: ['These bets pay out at the listed odds.'],
    });
    expect(c.isSocial).toBe(true);
    const sections = c.gameInfo.sections ?? [];
    // host-derived disclaimer socialized: "bets pay out" → "plays win"
    const disc = sections.find((s) => s.type === 'custom' && (s as { html?: string }).html?.toLowerCase().includes('listed odds')) as { html?: string } | undefined;
    expect(disc?.html).not.toContain('pay out');
    // author 'custom' section (different identity → appended) is NOW socialized too:
    // "Paytable" → "Win table" in both title and html, so forbidden words can't slip through.
    const authorSec = sections.find((s) => s.type === 'custom' && (s as { title?: string }).title?.includes('Rules')) as { title?: string; html?: string } | undefined;
    expect(authorSec).toBeDefined();
    expect(authorSec?.title?.toLowerCase()).not.toContain('paytable');
    expect(authorSec?.html?.toLowerCase()).not.toContain('paytable');
    expect(authorSec?.html?.toLowerCase()).toContain('win table');
  });
});

describe('social mode — buy-bonus cards', () => {
  it('socializes host-derived AND author buy-bonus card copy (BUY BONUS → GET BONUS)', () => {
    const social = buildShellConfig({}, model, { balance: 0, mode: 'base', social: true });
    const derivedBuy = (social.features.buyBonus as Array<{ id: string; title: string }>).find((o) => o.id === 'buy_bonus');
    expect(derivedBuy?.title).toBe('GET BONUS'); // socialized from spec 'BUY BONUS'

    const author = [{ id: 'x', title: 'BUY BONUS', description: 'buy spins', priceMultiplier: 50 }];
    const c = buildShellConfig({ buyBonus: author }, model, { balance: 0, mode: 'base', social: true });
    expect((c.features.buyBonus as typeof author)[0].title).toBe('GET BONUS'); // author socialized too
    expect((c.features.buyBonus as typeof author)[0].description).not.toContain('buy');
  });

  it('leaves author buy-bonus copy verbatim when NOT social', () => {
    const author = [{ id: 'x', title: 'BUY BONUS', description: 'buy spins', priceMultiplier: 50 }];
    const c = buildShellConfig({ buyBonus: author }, model, { balance: 0, mode: 'base', social: false });
    expect((c.features.buyBonus as typeof author)[0].title).toBe('BUY BONUS');
  });
});

describe('mergeGameInfo', () => {
  it('keys wins sections by kind so different mechanics coexist', () => {
    const derived: GameInfoContent = { sections: [{ type: 'wins', kind: 'anywhere', minCount: 3, grid: { cols: 5, rows: 3 } } as GameInfoSection] };
    const override: GameInfoContent = { sections: [{ type: 'wins', kind: 'cluster', minCount: 5, grid: { cols: 5, rows: 3 } } as GameInfoSection] };
    const out = mergeGameInfo(derived, override).sections ?? [];
    expect(out).toHaveLength(2); // appended, not replaced
  });
});

describe('defaultGameInfo', () => {
  it('builds paytable rows from the model paytable, dropping pay-less symbols', () => {
    const info = defaultGameInfo(model, { balance: 0, mode: 'base' });
    const pay = (info.sections ?? []).find((s) => s.type === 'paytable') as { rows: Array<{ symbol: { text?: string } }> };
    expect(pay.rows.map((r) => r.symbol.text)).toEqual(['CROWN', 'TEN']); // WILD has no pay → dropped
  });
});
