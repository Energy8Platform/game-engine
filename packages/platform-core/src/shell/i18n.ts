import { LOCALES } from './locales';
import { SOCIAL_REPLACEMENTS } from '@energy8platform/game-sdk/social';

// Social-casino language. English is the source (and, for now, the only) language; `socialize`
// rewrites the restricted gambling vocabulary into social-safe phrasing while preserving case.
//
// The dictionary is the SHARED, canonical list in `@energy8platform/game-sdk/social` — the DOM
// shell, the Pixi shell and stake-bridge all consume it, so the vocabulary can't drift. We only
// sort it here: the combined regex below matches the FIRST alternative that fits at a position, so
// the longest / most specific phrases must come first (e.g. "buy bonus" before "buy").
const RULES: ReadonlyArray<readonly [string, string]> = [...SOCIAL_REPLACEMENTS]
  .sort((a, b) => b.from.length - a.from.length)
  .map((r) => [r.from, r.to] as const);

const MAP = new Map(RULES.map(([k, v]) => [k.toLowerCase(), v] as const));
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
// Letter-bounded so we only swap whole words/phrases (e.g. "pay" inside "Autoplay" is left alone).
const PATTERN = new RegExp(`(?<![A-Za-z])(?:${RULES.map(([k]) => escapeRe(k)).join('|')})(?![A-Za-z])`, 'gi');

/** Carry the matched text's capitalisation onto the replacement: ALL CAPS → upper, Capitalised
 *  (first letter) → capitalise the replacement's first letter, otherwise lower-case as written. */
function applyCase(match: string, repl: string): string {
  const letters = match.replace(/[^A-Za-z]/g, '');
  if (letters && letters === letters.toUpperCase()) return repl.toUpperCase();
  if (/^[^A-Za-z]*[A-Z]/.test(match)) return repl.charAt(0).toUpperCase() + repl.slice(1);
  return repl;
}

/** Rewrite restricted gambling terms in `text` to social-safe phrasing, preserving case. */
export function socialize(text: string): string {
  return text.replace(PATTERN, (m) => {
    const repl = MAP.get(m.toLowerCase());
    return repl == null ? m : applyCase(m, repl);
  });
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
  const lang = normalizeLang(opts.language);
  const t = (src: string): string => {
    if (lang === 'en') return opts.isSocial ? socialize(src) : src;
    return opts.messages?.[lang]?.[src] ?? LOCALES[lang]?.[src] ?? src;
  };
  return { lang, t };
}
