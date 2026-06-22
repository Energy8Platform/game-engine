export type SocialRule = [RegExp | string, string];

/** Common social-casino vocabulary swaps shared by every game. Longer phrases first. */
export const DEFAULT_PRE_REPLACEMENTS: SocialRule[] = [
  [/\bBuy Bonus\b/g, 'Get Bonus'],
  [/\bbuy bonus\b/gi, 'get bonus'],
  [/\bBet\b/g, 'Play'],
  [/\bbet\b/g, 'play'],
  [/\bCost\b/g, 'Play'],
  [/\bcost\b/g, 'play'],
  [/\bFunds\b/g, 'Balance'],
  [/\bfunds\b/g, 'balance'],
];

/** Cleanup pass after the bridge dictionary runs. */
export const DEFAULT_POST_REPLACEMENTS: SocialRule[] = [
  [/Total Play Cost/gi, 'Total Play'],
];

let cachedFn: ((text: string) => string) | null = null;

/** Lazily load the stake-bridge dictionary so non-stake builds don't pull it. */
export async function ensureSocialDictionary(): Promise<void> {
  if (cachedFn) return;
  const mod = await import('@energy8platform/stake-bridge');
  cachedFn = (t: string) => mod.applySocialReplacements(t);
}

function applyRules(text: string, rules: SocialRule[]): string {
  let out = text;
  for (const [pat, rep] of rules) {
    out = typeof pat === 'string' ? out.split(pat).join(rep) : out.replace(pat, rep);
  }
  return out;
}

/**
 * Swap gambling vocabulary for social-casino wording:
 * PRE (defaults + overrides) → bridge dictionary (if loaded) → POST (defaults + overrides).
 * The "Stake Engine" brand is protected from the bet→play swap.
 */
export function applySocialText(
  text: string,
  overrides?: { pre?: SocialRule[]; post?: SocialRule[] },
): string {
  const BRAND = 'Stake Engine';
  const SENTINEL = '￹';
  let s = text.split(BRAND).join(SENTINEL);
  s = applyRules(s, [...DEFAULT_PRE_REPLACEMENTS, ...(overrides?.pre ?? [])]);
  if (cachedFn) s = cachedFn(s);
  s = applyRules(s, [...DEFAULT_POST_REPLACEMENTS, ...(overrides?.post ?? [])]);
  return s.split(SENTINEL).join(BRAND);
}
