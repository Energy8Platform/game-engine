// packages/game-engine/tests/host-i18n.test.ts
// Task 13 — per-game i18n at the host: merged catalog + spec-string resolution.
import { describe, it, expect } from 'vitest';
import { buildShellConfig } from '../src/host/shellConfig';
import type { GameModel } from '@energy8platform/platform-core/game-spec';

/** Minimal model with one buy action, one mode, and a paytable symbol whose name
 *  appears in the i18n map so we can verify all three spec-string paths. */
const model = {
  spec: {
    betLevels: [1],
    defaultBet: 1,
    currency: 'EUR',
    maxWin: 5000,
    grid: { cols: 5, rows: 3 },
    mechanic: 'lines',
    actions: {
      spin: { role: 'base', title: 'Base game' },
      buy_bonus: { role: 'buy', cost: 100, title: 'BUY BONUS', description: 'Skip to the bonus' },
    },
  },
  paytable: {
    symbols: [
      { id: 'H1', name: 'CROWN', kind: 'high', pay: { 3: 5, 5: 50 } },
    ],
  },
  mathModes: [
    { action: 'spin', mode: 'BASE', costMultiplier: 1, rtp: 0.965, maxWin: 5000 },
    { action: 'buy_bonus', mode: 'BUY_BONUS', costMultiplier: 100, rtp: 0.97, maxWin: 12000 },
  ],
} as unknown as GameModel;

describe('host-i18n: per-game i18n map', () => {
  const RU_MESSAGES = {
    ru: {
      'How to Play': 'Как играть',
      'BUY BONUS': 'КУПИТЬ',
      'Skip to the bonus': 'Пропустить до бонуса',
      'CROWN': 'КОРОНА',
      'BUY BONUS — modes title?': 'not used',
    },
  };

  it('resolves bonus title + description via game i18n map when language is ru', () => {
    const c = buildShellConfig(
      { i18n: RU_MESSAGES },
      model,
      { balance: 0, mode: 'base', language: 'ru' },
    );
    const buyBonus = c.features.buyBonus as Array<{ id: string; title: string; description: string }>;
    const card = buyBonus.find((o) => o.id === 'buy_bonus');
    expect(card?.title).toBe('КУПИТЬ');
    expect(card?.description).toBe('Пропустить до бонуса');
  });

  it('resolves gameInfo section title via game i18n (factory form)', () => {
    const c = buildShellConfig(
      {
        i18n: RU_MESSAGES,
        gameInfo: (t) => ({
          sections: [{ type: 'custom' as const, title: t('How to Play'), html: '<p>spin</p>' }],
        }),
      },
      model,
      { balance: 0, mode: 'base', language: 'ru' },
    );
    const sections = c.gameInfo.sections ?? [];
    const sec = sections.find((s) => s.type === 'custom') as { title?: string } | undefined;
    expect(sec?.title).toBe('Как играть');
  });

  it('resolves paytable symbol names via game i18n map', () => {
    const c = buildShellConfig(
      { i18n: RU_MESSAGES },
      model,
      { balance: 0, mode: 'base', language: 'ru' },
    );
    const sections = c.gameInfo.sections ?? [];
    const pay = sections.find((s) => s.type === 'paytable') as { rows?: Array<{ symbol: { text?: string } }> } | undefined;
    const names = (pay?.rows ?? []).map((r) => r.symbol.text);
    expect(names).toContain('КОРОНА');
  });

  it('resolves modes section row titles via game i18n map', () => {
    const c = buildShellConfig(
      {
        i18n: {
          ru: {
            'BUY BONUS': 'КУПИТЬ',
          },
        },
      },
      model,
      { balance: 0, mode: 'base', language: 'ru' },
    );
    const sections = c.gameInfo.sections ?? [];
    const modes = sections.find((s) => s.type === 'modes') as { modes?: Array<{ title: string }> } | undefined;
    expect(modes?.modes?.some((m) => m.title === 'КУПИТЬ')).toBe(true);
  });

  it('English passes through unchanged when no i18n map provided', () => {
    const c = buildShellConfig(
      {},
      model,
      { balance: 0, mode: 'base', language: 'en' },
    );
    const buyBonus = c.features.buyBonus as Array<{ id: string; title: string }>;
    const card = buyBonus.find((o) => o.id === 'buy_bonus');
    expect(card?.title).toBe('BUY BONUS');
  });

  it('en + social still socializes (BUY BONUS → GET BONUS) when no i18n map', () => {
    const c = buildShellConfig(
      {},
      model,
      { balance: 0, mode: 'base', language: 'en', social: true },
    );
    const buyBonus = c.features.buyBonus as Array<{ id: string; title: string }>;
    const card = buyBonus.find((o) => o.id === 'buy_bonus');
    expect(card?.title).toBe('GET BONUS');
  });
});
