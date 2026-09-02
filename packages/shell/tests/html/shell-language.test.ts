// @vitest-environment jsdom
/**
 * Task 2: setLanguage routes t() through the i18n resolver.
 *
 * These tests are deliberately self-contained — they rely only on the en-only
 * socialize gate (no LOCALES data). Task 3 will add real translated-language
 * assertions once it seeds LOCALES with Russian (and other) strings.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createGameShell, removeGameShell } from '@/ui/html';
import type { ShellConfig } from '@/core/types';

function base(): ShellConfig {
  return {
    mount: document.body,
    gameInfo: { sections: [] },
    language: 'en',
    currency: { symbol: '€', position: 'left' },
    availableBets: [1, 2],
    defaultBet: 1,
    currentBet: 1,
    balance: 100,
    win: 0,
    mode: 'base' as const,
    features: { turbo: 1 as const, buyBonus: false as const },
  };
}

describe('shell language', () => {
  beforeEach(async () => {
    document.body.innerHTML = '';
    await removeGameShell();
  });

  it('plain en (no social) → t() returns source string unchanged', () => {
    const shell = createGameShell({ ...base(), language: 'en' });
    expect(shell.t('Settings')).toBe('Settings');
  });

  it('en + isSocial → socialize gate active: Buy bonus → Get bonus', () => {
    const shell = createGameShell({ ...base(), language: 'en', isSocial: true });
    expect(shell.t('Buy bonus')).toBe('Get bonus');
  });

  it('setLanguage swaps the resolver at runtime', () => {
    const shell = createGameShell({ ...base(), language: 'en', isSocial: false });
    // en, no social: source string unchanged
    expect(shell.t('Buy bonus')).toBe('Buy bonus');
    // switch to de: non-en, LOCALES.de has a translation → returns German string
    shell.setLanguage('de');
    expect(shell.t('Buy bonus')).toBe('Bonus kaufen');
  });

  // The launch-time case, which is the one Stake exercises: a social session still carries the
  // operator's `?lang=` on the URL. English is the only language a social build supports, so the
  // requested locale has to lose at construction, not just on a later setLanguage.
  it('social forces English when the shell is CREATED with a non-English language', () => {
    const shell = createGameShell({ ...base(), language: 'de', isSocial: true });
    expect(shell.t('Buy bonus')).toBe('Get bonus'); // socialized English, not 'Bonus kaufen'
  });

  it('social forces English even after setLanguage', () => {
    const shell = createGameShell({ ...base(), language: 'en', isSocial: true });
    expect(shell.t('Buy bonus')).toBe('Get bonus');
    // social mode ignores the language switch — the English social vocabulary stays active
    shell.setLanguage('de');
    expect(shell.t('Buy bonus')).toBe('Get bonus');
  });

  it('setLanguage back to en+social re-enables socialize', () => {
    const shell = createGameShell({ ...base(), language: 'de' });
    expect(shell.t('Buy bonus')).toBe('Bonus kaufen'); // de: LOCALES.de has translation
    shell.setLanguage('en');
    // now en but isSocial is still false (we never set it)
    expect(shell.t('Buy bonus')).toBe('Buy bonus');
  });

  it('setSocial also rebuilds the resolver', () => {
    const shell = createGameShell({ ...base(), language: 'en', isSocial: false });
    expect(shell.t('Buy bonus')).toBe('Buy bonus');
    shell.setSocial(true);
    expect(shell.t('Buy bonus')).toBe('Get bonus');
  });
});
