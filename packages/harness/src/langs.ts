/**
 * Supported harness languages. Defined locally so the core stays self-contained.
 */

export interface LangEntry {
  /** BCP-47 language code used in launch URLs. */
  code: string;
  /** English display label shown in the language selector. */
  label: string;
}

/** The 16 supported harness languages, in display order. */
export const LANGS: LangEntry[] = [
  { code: 'da', label: 'da — Danish' },
  { code: 'de', label: 'de — German' },
  { code: 'en', label: 'en — English' },
  { code: 'es', label: 'es — Spanish' },
  { code: 'fi', label: 'fi — Finnish' },
  { code: 'fr', label: 'fr — French' },
  { code: 'hi', label: 'hi — Hindi' },
  { code: 'id', label: 'id — Indonesian' },
  { code: 'ja', label: 'ja — Japanese' },
  { code: 'ko', label: 'ko — Korean' },
  { code: 'pl', label: 'pl — Polish' },
  { code: 'pt', label: 'pt — Portuguese' },
  { code: 'ru', label: 'ru — Russian' },
  { code: 'tr', label: 'tr — Turkish' },
  { code: 'vi', label: 'vi — Vietnamese' },
  { code: 'zh', label: 'zh — Chinese' },
];
