// packages/game-engine/tests/host/shellConfig.test.ts
import { describe, it, expect } from 'vitest';
import { buildShellConfig, defaultGameInfo, toBonusOptions, resolveCurrency, mergeGameInfo, stakeForAction, applyJurisdiction } from '../../src/host/shellConfig';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { GameInfoContent, GameInfoSection, ShellFeatures, MenuItem } from '@energy8platform/shell/pixi';

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

  it('forwards each action\'s volatility (1–5 bolts) to its buy/feature card; omits it when unset', () => {
    const volModel = {
      spec: {
        ...model.spec,
        actions: {
          spin: { role: 'base' },
          ante: { role: 'feature', cost: 1.5, title: 'ANTE', description: 'boost', volatility: 2 },
          buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'buy spins', volatility: 5 },
          buy_lite: { role: 'buy', cost: 50, title: 'LITE', description: 'cheaper' }, // no volatility
        },
      },
    } as unknown as GameModel;
    const opts = toBonusOptions(volModel);
    expect(opts.find((o) => o.id === 'ante')!.volatility).toBe(2);
    expect(opts.find((o) => o.id === 'buy_bonus')!.volatility).toBe(5);
    expect('volatility' in opts.find((o) => o.id === 'buy_lite')!).toBe(false); // unset → key absent
  });

  it('forwards each action\'s hero art to its card thumbnail (verbatim); omits it when unset', () => {
    const artModel = {
      spec: {
        ...model.spec,
        actions: {
          spin: { role: 'base' },
          ante: { role: 'feature', cost: 1.5, title: 'ANTE', description: 'boost', art: '/assets/ante.png' },
          buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'buy spins' }, // no art
        },
      },
    } as unknown as GameModel;
    const opts = toBonusOptions(artModel);
    expect(opts.find((o) => o.id === 'ante')!.thumbnail).toBe('/assets/ante.png'); // passed as-is
    expect('thumbnail' in opts.find((o) => o.id === 'buy_bonus')!).toBe(false); // unset → key absent
  });
});

describe('bet ladder + default bet from /wallet/authenticate', () => {
  it('runtime betLevels + defaultBet override the spec (currency-specific Stake ladder)', () => {
    const c = buildShellConfig({}, model, { balance: 0, mode: 'base', betLevels: [0.2, 1, 2, 4], defaultBet: 2 });
    expect(c.availableBets).toEqual([0.2, 1, 2, 4]); // NOT the spec's [0.1, 1, 5]
    expect(c.defaultBet).toBe(2);
    expect(c.currentBet).toBe(2);
  });
  it('falls back to the spec ladder/default when authenticate provides none (dev/devBridge)', () => {
    const c = buildShellConfig({}, model, { balance: 0, mode: 'base' });
    expect(c.availableBets).toEqual([0.1, 1, 5]); // spec.betLevels
    expect(c.defaultBet).toBe(1);                  // spec.defaultBet
  });
});

describe('Game Info modes section (derived from the spec — SSOT)', () => {
  // A model carrying mathModes (what defineGame produces) with per-mode rtp/maxWin.
  const m = {
    ...model,
    mathModes: [
      { action: 'spin', mode: 'BASE', costMultiplier: 1, rtp: 0.965, maxWin: 5000 },
      { action: 'ante', mode: 'ANTE', costMultiplier: 1.5, rtp: 0.965, maxWin: 5000 },
      { action: 'buy_bonus', mode: 'BUY_BONUS', costMultiplier: 100, rtp: 0.97, maxWin: 12000 },
    ],
  } as unknown as GameModel;

  it('derives a per-mode table (cost/rtp/maxWin) from mathModes + spec titles', () => {
    const sections = buildShellConfig({}, m, { balance: 0, mode: 'base' }).gameInfo.sections ?? [];
    const modes = sections.find((s) => s.type === 'modes') as { modes: Array<{ title: string; price?: string; rtp?: number; maxWin?: string; description?: string }> } | undefined;
    expect(modes).toBeDefined();
    expect(modes!.modes).toEqual([
      { title: 'Base game', maxWin: '5,000×', rtp: 96.5 },                                   // base: no price (1×)
      { title: 'ANTE', maxWin: '5,000×', price: '1.5×', rtp: 96.5, description: 'boost' },
      { title: 'BUY BONUS', maxWin: '12,000×', price: '100×', rtp: 97, description: 'buy spins' },
    ]);
  });

  it('socializes the modes table titles/descriptions in social mode', () => {
    const sections = buildShellConfig({}, m, { balance: 0, mode: 'base', social: true }).gameInfo.sections ?? [];
    const modes = sections.find((s) => s.type === 'modes') as { modes: Array<{ title: string }> };
    // 'BUY BONUS' → 'GET BONUS' (length-sorted phrase swap), as for the buy cards.
    expect(modes.modes.some((r) => r.title === 'GET BONUS')).toBe(true);
    expect(modes.modes.some((r) => r.title === 'BUY BONUS')).toBe(false);
  });
});

describe('resolveCurrency (single source of truth — initData.config.currency)', () => {
  it('derives symbol + position from the CurrencyMetaData the bridge surfaces', () => {
    // symbolAfter:false → left; minDecimals = currency decimals, maxDecimals = up to 4 for wins.
    expect(resolveCurrency({ code: 'EUR', symbol: '€', decimals: 2 })).toEqual({ symbol: '€', position: 'left', minDecimals: 2, maxDecimals: 4 });
    // symbolAfter:true → right (e.g. PLN 'zł')
    expect(resolveCurrency({ code: 'PLN', symbol: 'zł', decimals: 2, symbolAfter: true })).toEqual({ symbol: 'zł', position: 'right', minDecimals: 2, maxDecimals: 4 });
  });
  it('a 0-decimal currency (e.g. JPY) is floored to 2 display decimals so sub-unit bets render', () => {
    // Stake lowered bet levels below one unit for these too — a 0-decimal display can't show 0.50.
    expect(resolveCurrency({ code: 'JPY', symbol: '¥', decimals: 0 })).toEqual({ symbol: '¥', position: 'left', minDecimals: 2, maxDecimals: 4 });
  });
  it('falls back to the spec currency code, then neutral euro, when meta is absent (dev/devBridge)', () => {
    expect(resolveCurrency(null, 'ZZZ')).toEqual({ symbol: 'ZZZ', position: 'left', minDecimals: 2, maxDecimals: 4 });
    expect(resolveCurrency(undefined, undefined)).toEqual({ symbol: '€', position: 'left', minDecimals: 2, maxDecimals: 4 });
  });
});

describe('buildShellConfig (runtime ctx)', () => {
  it('uses the resolved runtime.currency, buyBonus from the model', () => {
    const c = buildShellConfig({}, model, { balance: 1000, currency: { symbol: '$', position: 'left' }, language: 'de', mode: 'base' });
    expect(c.currency).toEqual({ symbol: '$', position: 'left' });
    expect(c.language).toBe('de');
    expect(c.balance).toBe(1000);
    // With language:'de' the shell's built-in LOCALES translate action titles, so compare
    // id/type/priceMultiplier (spec-derived, language-neutral) rather than the full object.
    const buyBonus = c.features.buyBonus as Array<{ id: string; type: string; priceMultiplier: number }>;
    expect(buyBonus.map((o) => ({ id: o.id, type: o.type, priceMultiplier: o.priceMultiplier }))).toEqual(
      toBonusOptions(model).map((o) => ({ id: o.id, type: o.type, priceMultiplier: o.priceMultiplier })),
    );
  });
  it('falls back to spec.currency then neutral; opts.currency overrides', () => {
    expect(buildShellConfig({}, model, { balance: 0, mode: 'base' }).currency).toEqual({ symbol: 'EUR', position: 'left', minDecimals: 2, maxDecimals: 4 });
    const o = buildShellConfig({ currency: { symbol: '₿', position: 'right' } }, model, { balance: 0, mode: 'base' });
    expect(o.currency).toEqual({ symbol: '₿', position: 'right' });
  });

  it('threads runtime.social into isSocial (defaults false)', () => {
    expect(buildShellConfig({}, model, { balance: 0, mode: 'base' }).isSocial).toBe(false);
    expect(buildShellConfig({}, model, { balance: 0, mode: 'base', social: true }).isSocial).toBe(true);
  });

  it('derives a non-empty gameInfo (paytable) and adds a disclaimer section when present; NO MAX WIN', () => {
    const c = buildShellConfig({}, model, { balance: 0, mode: 'base', disclaimerLines: ['Malfunction voids all wins.', 'RTP over many plays.'] });
    const sections = c.gameInfo.sections ?? [];
    expect(sections.length).toBeGreaterThan(1);
    const disclaimer = sections.find((s) => s.type === 'custom' && s.title === 'DISCLAIMER');
    expect(disclaimer).toBeDefined();
    expect((disclaimer as { html?: string }).html).toContain('Malfunction voids all wins.');
    expect(sections.some((s) => s.type === 'paytable')).toBe(true);
    // MAX WIN section is no longer derived by the host.
    expect(sections.some((s) => s.type === 'custom' && s.title === 'MAX WIN')).toBe(false);
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
    expect(sections.some((s) => s.type === 'custom' && (s as { title?: string }).title === 'DISCLAIMER')).toBe(true);
    expect(sections.some((s) => s.type === 'controls')).toBe(true);
    expect(sections.some((s) => s.type === 'wins')).toBe(true);
  });

  it('the DISCLAIMER is always the LAST section, even when authors merge/add sections after it', () => {
    const author: GameInfoContent = { sections: [
      { type: 'custom', title: 'How to play', html: '<p>spin</p>' },
      { type: 'modes', title: 'MODES', modes: [{ title: 'Base' }] },
    ] };
    const c = buildShellConfig({ gameInfo: author }, model, { balance: 0, mode: 'base', disclaimerLines: ['Malfunction voids all wins.'] });
    const sections = c.gameInfo.sections ?? [];
    const last = sections[sections.length - 1] as { type?: string; title?: string };
    expect(last.type).toBe('custom');
    expect(last.title).toBe('DISCLAIMER');
    // exactly one disclaimer, and nothing follows it
    expect(sections.filter((s) => s.type === 'custom' && (s as { title?: string }).title === 'DISCLAIMER')).toHaveLength(1);
  });

  it('undefined opts.gameInfo → pure derived set (unchanged)', () => {
    const derived = defaultGameInfo(model, { balance: 0, mode: 'base' });
    const c = buildShellConfig({}, model, { balance: 0, mode: 'base' });
    expect(c.gameInfo).toEqual(derived);
  });

  // A scaffolded game (npm create @energy8platform/slot) has no other way to reach the bar-menu
  // popover's item list — SlotShellOptions.menu is a straight passthrough, exactly like `currency`:
  // no host-derived default to merge with, so an omitted value stays undefined and the shell package
  // applies its own DEFAULT_MENU.
  it('passes opts.menu straight through; omitted stays undefined (shell applies its own default)', () => {
    const c = buildShellConfig({}, model, { balance: 0, mode: 'base' });
    expect(c.menu).toBeUndefined();
    const menu: MenuItem[] = [
      { id: 'sound' },
      { id: 'speed', type: 'range', label: 'Speed', min: 1, max: 5, value: 2 },
    ];
    const c2 = buildShellConfig({ menu }, model, { balance: 0, mode: 'base' });
    expect(c2.menu).toBe(menu); // passthrough, not a copy or transform
  });

  it('social mode socializes PAYTABLE symbol names (from spec symbols[].name)', () => {
    // A spec symbol whose name carries a restricted word ('CASH' → 'COINS').
    const m = {
      spec: { betLevels: [1], defaultBet: 1, currency: 'EUR', maxWin: 100, grid: { cols: 5, rows: 3 }, mechanic: 'lines', actions: { spin: { role: 'base' } } },
      paytable: { symbols: [{ id: 'C', name: 'CASH', kind: 'high', pay: { 3: 5 } }] },
    } as unknown as GameModel;
    const c = buildShellConfig({}, m, { balance: 0, mode: 'base', social: true });
    const pay = (c.gameInfo.sections ?? []).find((s) => s.type === 'paytable') as { rows?: { symbol: { text?: string } }[] } | undefined;
    const texts = (pay?.rows ?? []).map((r) => r.symbol.text);
    expect(texts).toContain('COINS');   // socialized
    expect(texts).not.toContain('CASH'); // original forbidden word gone
  });

  it('social mode socializes author + host content, but NEVER the legal DISCLAIMER (verbatim)', () => {
    const author: GameInfoContent = { sections: [{ type: 'custom', title: 'Our Paytable Rules', html: '<p>Read the paytable.</p>' }] };
    const c = buildShellConfig({ gameInfo: author }, model, {
      balance: 0, mode: 'base', social: true,
      disclaimerLines: ['These bets pay out at the listed odds.'],
    });
    expect(c.isSocial).toBe(true);
    const sections = c.gameInfo.sections ?? [];
    // The DISCLAIMER is legal copy → left verbatim ("bets pay out" stays, NOT socialized).
    const disc = sections.find((s) => s.type === 'custom' && (s as { title?: string }).title === 'DISCLAIMER') as { html?: string } | undefined;
    expect(disc?.html).toContain('bets pay out at the listed odds');
    // author 'custom' section (different identity → appended) IS socialized:
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

  it('accepts gameInfo as a (t) => content factory; t socializes in social mode, identity otherwise', () => {
    const factory = (t: (s: string) => string) => ({
      sections: [{ type: 'custom' as const, title: t('How to Play'), html: `<p>${t('Buy bonus to win')}</p>` }],
    });
    // social: t rewrites "Buy bonus" → "Get bonus", "win" stays
    const social = buildShellConfig({ gameInfo: factory }, model, { balance: 0, mode: 'base', social: true });
    const sSec = (social.gameInfo.sections ?? []).find((s) => s.type === 'custom' && (s as { html?: string }).html?.includes('onus')) as { html?: string } | undefined;
    expect(sSec?.html?.toLowerCase()).not.toContain('buy bonus');
    // non-social: identity t — copy verbatim
    const plain = buildShellConfig({ gameInfo: factory }, model, { balance: 0, mode: 'base', social: false });
    const pSec = (plain.gameInfo.sections ?? []).find((s) => s.type === 'custom' && (s as { title?: string }).title === 'How to Play');
    expect(pSec).toBeDefined();
  });

  it('leaves author buy-bonus copy verbatim when NOT social', () => {
    const author = [{ id: 'x', title: 'BUY BONUS', description: 'buy spins', priceMultiplier: 50 }];
    const c = buildShellConfig({ buyBonus: author }, model, { balance: 0, mode: 'base', social: false });
    expect((c.features.buyBonus as typeof author)[0].title).toBe('BUY BONUS');
  });
});

describe('stakeForAction (host affordability guard)', () => {
  it('multiplies bet by the action cost (1 for base, the cost for buy/ante)', () => {
    expect(stakeForAction(model, 'spin', 2)).toBe(2);      // base: cost 1
    expect(stakeForAction(model, 'buy_bonus', 2)).toBe(200); // buy: cost 100
  });
  it('defaults to bet when the action has no explicit cost', () => {
    expect(stakeForAction(model, 'unknown_action', 5)).toBe(5);
  });
});

describe('mergeGameInfo', () => {
  it('keys wins sections by kind so different mechanics coexist', () => {
    const derived: GameInfoContent = { sections: [{ type: 'wins', kind: 'anywhere', minCount: 3, grid: { cols: 5, rows: 3 } } as GameInfoSection] };
    const override: GameInfoContent = { sections: [{ type: 'wins', kind: 'cluster', minCount: 5, grid: { cols: 5, rows: 3 } } as GameInfoSection] };
    const out = mergeGameInfo(derived, override).sections ?? [];
    expect(out).toHaveLength(2); // appended, not replaced
  });

  it('keeps every author custom section, even when they share (or omit) a title', () => {
    // Keying custom sections by title must not collapse distinct game-supplied sections — a game
    // that adds two untitled (or same-titled) custom blocks must see BOTH rendered.
    const derived: GameInfoContent = { sections: [{ type: 'controls' } as GameInfoSection] };
    const override: GameInfoContent = {
      sections: [
        { type: 'custom', html: '<p>A</p>' },
        { type: 'custom', html: '<p>B</p>' },
        { type: 'custom', title: 'Same', html: '<p>C</p>' },
        { type: 'custom', title: 'Same', html: '<p>D</p>' },
      ] as GameInfoSection[],
    };
    const customs = (mergeGameInfo(derived, override).sections ?? []).filter((s) => s.type === 'custom') as Array<{ html?: string }>;
    expect(customs.map((s) => s.html)).toEqual(['<p>A</p>', '<p>B</p>', '<p>C</p>', '<p>D</p>']);
  });

  it('an author section still REPLACES a derived section of the same identity', () => {
    const derived: GameInfoContent = { sections: [{ type: 'custom', title: 'DISCLAIMER', html: '<p>derived</p>' } as GameInfoSection] };
    const override: GameInfoContent = { sections: [{ type: 'custom', title: 'DISCLAIMER', html: '<p>author</p>' } as GameInfoSection] };
    const customs = (mergeGameInfo(derived, override).sections ?? []) as Array<{ html?: string }>;
    expect(customs).toHaveLength(1);
    expect(customs[0].html).toBe('<p>author</p>');
  });
});

describe('defaultGameInfo', () => {
  it('builds paytable rows from the model paytable, dropping pay-less symbols', () => {
    const info = defaultGameInfo(model, { balance: 0, mode: 'base' });
    const pay = (info.sections ?? []).find((s) => s.type === 'paytable') as { rows: Array<{ symbol: { text?: string } }> };
    expect(pay.rows.map((r) => r.symbol.text)).toEqual(['CROWN', 'TEN']); // WILD has no pay → dropped
  });
});

describe('applyJurisdiction (Stake jurisdiction → shell features)', () => {
  const base = (): ShellFeatures => ({ turbo: 3, spacebar: true, autoplay: {}, buyBonus: [{ id: 'buy_bonus', type: 'bonus', title: 'BUY', description: '', priceMultiplier: 100 }] });

  it('no jurisdiction → features untouched', () => {
    const f = base(); applyJurisdiction(f, undefined);
    expect(f).toEqual(base());
  });

  it('disabledTurbo forces turbo 0; disabledSuperTurbo caps at 1', () => {
    const a = base(); applyJurisdiction(a, { disabledTurbo: true }); expect(a.turbo).toBe(0);
    const b = base(); applyJurisdiction(b, { disabledSuperTurbo: true }); expect(b.turbo).toBe(1);
    // disabledTurbo wins over disabledSuperTurbo
    const c = base(); applyJurisdiction(c, { disabledTurbo: true, disabledSuperTurbo: true }); expect(c.turbo).toBe(0);
    // basic turbo (level 1) is left alone by disabledSuperTurbo
    const d: ShellFeatures = { ...base(), turbo: 1 }; applyJurisdiction(d, { disabledSuperTurbo: true }); expect(d.turbo).toBe(1);
  });

  it('disabledSpacebar/Autoplay/BuyFeature turn the controls off', () => {
    const f = base();
    applyJurisdiction(f, { disabledSpacebar: true, disabledAutoplay: true, disabledBuyFeature: true });
    expect(f.spacebar).toBe(false);
    expect(f.autoplay).toBeNull();
    expect(f.buyBonus).toBe(false);
  });

  it('a jurisdiction restriction wins over the author features (via buildShellConfig)', () => {
    const c = buildShellConfig(
      { features: { turbo: 3, spacebar: true, autoplay: {}, buyBonus: [] } },
      model,
      { balance: 0, mode: 'base', jurisdiction: { disabledTurbo: true, disabledSpacebar: true, disabledAutoplay: true, disabledBuyFeature: true } },
    );
    expect(c.features.turbo).toBe(0);
    expect(c.features.spacebar).toBe(false);
    expect(c.features.autoplay).toBeNull();
    expect(c.features.buyBonus).toBe(false);
  });
});
