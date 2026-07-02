import { applySocialReplacements } from '@energy8platform/game-sdk/social';
import { LOCALES } from './locales';

// Social-casino language. English is the source (and, for now, the only) language; `socialize`
// rewrites the restricted gambling vocabulary into social-safe phrasing while preserving case.
//
// The replacement dictionary is NOT kept here — it lives in the platform-wide canonical module
// `@energy8platform/game-sdk/social`, the same table the game canvas and the Stake bridge use, so
// the chrome never drifts from the games. Modelled as the `en-social` pseudo-locale in createI18n.

/** Rewrite restricted gambling terms in `text` to social-safe phrasing, preserving case. */
export function socialize(text: string): string {
  return applySocialReplacements(text);
}

export type Lang = 'de'|'en'|'es'|'fi'|'fr'|'hi'|'id'|'ja'|'ko'|'pl'|'pt'|'ru'|'tr'|'vi'|'zh'|'da';
export const LANGS: readonly Lang[] = ['de','en','es','fi','fr','hi','id','ja','ko','pl','pt','ru','tr','vi','zh','da'];
const LANG_SET = new Set<string>(LANGS);

export function normalizeLang(code: string | null | undefined): Lang {
  const base = (code ?? '').toLowerCase().split(/[-_]/)[0];
  return (LANG_SET.has(base) ? base : 'en') as Lang;
}

export interface I18nOptions { language: string; isSocial?: boolean; messages?: Partial<Record<Lang, Record<string, string>>>; }
export interface I18n { readonly lang: Lang; t(src: string): string; }

export function createI18n(opts: I18nOptions): I18n {
  // Social is the `en-social` pseudo-locale: it rewrites the English source. Non-English locales are
  // authored social-safe already, so `socialize` only runs on the English source string.
  const lang = normalizeLang(opts.language);
  const t = (src: string): string => {
    if (lang === 'en') return opts.isSocial ? socialize(src) : src;
    return opts.messages?.[lang]?.[src] ?? LOCALES[lang]?.[src] ?? src;
  };
  return { lang, t };
}
