import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LOCALES } from '@/shell/locales';
import { LANGS, createI18n } from '@/shell/i18n';

it('locales.ts is byte-identical across both shells', () => {
  const a = readFileSync(new URL('../../pixi-shell/src/locales.ts', import.meta.url), 'utf8');
  const b = readFileSync(new URL('../src/shell/locales.ts', import.meta.url), 'utf8');
  expect(a.length, 'pixi-shell locales.ts must not be empty').toBeGreaterThan(10);
  expect(b.length, 'platform-core locales.ts must not be empty').toBeGreaterThan(10);
  expect(a).toBe(b);
});

it('every non-en language has >20 translation keys', () => {
  for (const l of LANGS) {
    if (l === 'en') continue;
    expect(Object.keys(LOCALES[l] ?? {}).length, `missing translations for ${l}`).toBeGreaterThan(20);
  }
});

it('known labels are translated in ru and de', () => {
  expect(LOCALES.ru?.Spin, 'LOCALES.ru.Spin must be truthy').toBeTruthy();
  expect(LOCALES.de?.Settings, 'LOCALES.de.Settings must be truthy').toBeTruthy();
});

it('createI18n resolves from LOCALES for ru', () => {
  const i = createI18n({ language: 'ru' });
  expect(i.t('Settings')).toBe(LOCALES.ru!.Settings);
  expect(i.t('Settings')).not.toBe('Settings'); // must be translated, not fallthrough
});
