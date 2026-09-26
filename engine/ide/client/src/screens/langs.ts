/**
 * A pinned COPY of `@energy8platform/harness`'s `LANGS` — not a re-export.
 * See `screenPresets.ts`'s own doc for why this is a copy rather than a
 * dependency: the package's only public entry welds this data to a
 * Node-only dev plugin at the module boundary, which is fatal to a browser
 * bundle, and `packages/*` is read-only so that boundary cannot be fixed
 * from here. `tests/screen-presets-sync.test.ts` checks this array against
 * the real package on exactly the fields `Preview` reads
 * (`code`/`label`), so drift is caught by `npm test` rather than trusted.
 */

export interface LangEntry {
  /** BCP-47 language code used in launch URLs. */
  code: string;
  /** English display label shown in the language selector. */
  label: string;
}

/** The 16 supported harness languages, in display order — see the module doc for why this is a copy. */
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
