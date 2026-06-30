import type { Answers } from '../answers';

/**
 * Emit `src/i18n.ts` for the generated project.
 *
 * Convention: **english-as-key** — the English string IS the key.
 * Missing keys fall back to the raw English string automatically.
 *
 * Fill in the per-language maps below and keep the key set in sync with `en`.
 * Add new copy to `en` first, then propagate to other languages.
 */
export function genI18nTs(a: Answers): string {
  // Collect player-facing English strings available from the default spec.
  // These come from the default actions defined in genGameSpec and the shell gameInfo copy.
  const enEntries: [string, string][] = [
    // Action titles / descriptions (from the default spec)
    ['ANTE BET', 'ANTE BET'],
    ['Pay more for a boosted chance', 'Pay more for a boosted chance'],
    ['BUY BONUS', 'BUY BONUS'],
    ['Buy the feature', 'Buy the feature'],
    // Shell gameInfo copy (from genMainTs)
    ['How to Play', 'How to Play'],
    ['Spin the reels and match symbols to win. Buy the bonus to trigger free spins instantly.', 'Spin the reels and match symbols to win. Buy the bonus to trigger free spins instantly.'],
  ];

  const enBlock = enEntries
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
    .join('\n');

  const stubLangs = ['de', 'es', 'fi', 'fr', 'hi', 'id', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'vi', 'zh', 'da'];

  const stubBlocks = stubLangs
    .map((lang) => `  // TODO: translate — fill in ${lang} strings below\n  '${lang}': {},`)
    .join('\n');

  return `// src/i18n.ts — localisation map for ${a.id}
//
// Convention: english-as-key — use the English phrase as the key.
// Missing keys fall back to the raw English string, so you can add languages
// incrementally without breaking anything.
//
// Usage: import { i18n } from './i18n' and pass it to createSlotGame({ i18n }).
// Switch language via the harness language selector (⚙ → Language).
//
// To add a new language:
//   1. Add a new key here using the two-letter BCP-47 code.
//   2. Copy the keys from \`en\` and provide translations.
//   3. Test via the harness language selector.
import type { Lang } from '@energy8platform/game-engine/shell';

export const i18n: Partial<Record<Lang, Record<string, string>>> = {
  en: {
${enBlock}
  },
${stubBlocks}
};
`;
}
