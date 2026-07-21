import { describe, it, expect } from 'vitest';
import { normalizeLang, createI18n } from '@/core/i18n';

describe('normalizeLang', () => {
  it('passes known languages through', () => expect(normalizeLang('ru')).toBe('ru'));
  it('strips region subtags', () => expect(normalizeLang('pt-BR')).toBe('pt'));
  it('is case-insensitive', () => expect(normalizeLang('DE')).toBe('de'));
  it('falls back to en for unknown/empty', () => {
    expect(normalizeLang('xx')).toBe('en');
    expect(normalizeLang(undefined)).toBe('en');
  });
});

describe('createI18n.t', () => {
  it('returns the English source as-is for en, no social', () => {
    expect(createI18n({ language: 'en' }).t('Settings')).toBe('Settings');
  });
  it('socializes English only when isSocial', () => {
    expect(createI18n({ language: 'en', isSocial: true }).t('Buy bonus')).toBe('Get bonus');
  });
  it('translates via LOCALES when present', () => {
    const t = createI18n({ language: 'ru', messages: { ru: { Settings: 'Настройки' } } }).t;
    expect(t('Settings')).toBe('Настройки');
  });
  it('falls back to the English source when a key is missing', () => {
    expect(createI18n({ language: 'ru' }).t('No Such String')).toBe('No Such String');
  });
  it('game messages override built-in LOCALES', () => {
    const i = createI18n({ language: 'de', messages: { de: { Spin: 'XXX' } } });
    expect(i.t('Spin')).toBe('XXX');
  });
  it('forces English social vocabulary regardless of language', () => {
    // The social dictionary is English-only, so social mode ignores `language` (and any localized
    // messages) and renders the socialized English source — never a restricted-vocabulary locale.
    const i = createI18n({ language: 'ru', isSocial: true, messages: { ru: { 'Buy bonus': 'Бонус' } } });
    expect(i.lang).toBe('en');
    expect(i.t('Buy bonus')).toBe('Get bonus');
  });
});
