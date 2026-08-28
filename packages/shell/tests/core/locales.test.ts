// @vitest-environment node
import { it, expect } from 'vitest';
import { LOCALES, DISCLAIMER_LINES } from '@/core/locales';
import { LANGS, createI18n } from '@/core/i18n';

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

/**
 * Замечание Artube:
 *   «Disclaimer Availability — the game rules include the required malfunction disclaimer or
 *    equivalent wording. If multiple languages are supported, the disclaimer is translated and
 *    displayed in each language.»
 *
 * Строки дисклеймера — ОДНА константа: и источник, и ключи перевода. Разъедься они, перевод молча
 * промахнулся бы и игрок на любом языке получил бы английский юридический текст.
 */
it('дисклеймер: пять строк без бренда — брендовая строка добавляется только на Stake', () => {
  expect(DISCLAIMER_LINES).toHaveLength(5);
  expect(DISCLAIMER_LINES.join(' ')).not.toMatch(/stake/i);
  expect(DISCLAIMER_LINES[0]).toMatch(/malfunction/i); // обязательный пункт про сбой
});

it('дисклеймер переведён на каждый поддерживаемый язык целиком', () => {
  for (const l of LANGS) {
    if (l === 'en') continue;
    const i = createI18n({ language: l });
    for (const line of DISCLAIMER_LINES) {
      expect(i.t(line), `${l}: строка дисклеймера не переведена — «${line.slice(0, 40)}…»`).not.toBe(line);
    }
  }
});
