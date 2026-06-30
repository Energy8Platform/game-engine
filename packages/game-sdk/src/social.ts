/**
 * Social-mode (sweepstakes) text replacements — the SINGLE source of truth.
 *
 * Stake's social-casino jurisdiction (stake.us) prohibits gambling vocabulary in player-facing
 * text. When `?social=true` (or jurisdiction.socialCasino is on), every user-visible string is fed
 * through a replacement pass before rendering.
 *
 * This module is the one canonical dictionary for the whole platform. It is consumed by:
 *   - `@energy8platform/stake-bridge` — re-exports `applySocialReplacements` (games call it on
 *     their own in-canvas text);
 *   - `@energy8platform/shell` (DOM shell via /html, Pixi shell via /pixi)
 *     — both build their own `socialize()` over `SOCIAL_REPLACEMENTS` so the chrome stays in lock-step.
 * Keep all vocabulary changes HERE; do not re-introduce per-package copies (they drift).
 *
 * Source dictionary: https://stake-engine.com/docs/reference/social-mode
 *
 * Matching is case-insensitive and preserves the matched casing ('Bet'→'Play', 'BET'→'PLAY').
 * Phrase rules (e.g. 'bonus buy') are sorted by length descending so longer phrases match before
 * their substrings ('bonus buy' before 'buy', 'pay out' before 'pay').
 */

export interface SocialReplacementRule {
  /** Source text (case-insensitive whole-word match by default). */
  from: string;
  /** Replacement text. */
  to: string;
  /** Whole-word match toggle. Default: `true`. */
  wholeWord?: boolean;
}

/**
 * Canonical replacement rules. The first block mirrors the Stake social-mode doc; the second adds
 * the single-word / UI forms the doc only lists as phrases (e.g. "Paytable", "Payout", "Payline")
 * plus the verb form "paying" — these are word-bounded so the bare "pay"→"win" rule can't reach them.
 * Order here is irrelevant: consumers sort by `from.length` descending before matching.
 */
export const SOCIAL_REPLACEMENTS: SocialReplacementRule[] = [
  // ── Stake social-mode doc ──
  { from: 'bet', to: 'play' },
  { from: 'bets', to: 'plays' },
  { from: 'bet/s', to: 'play/s' },
  { from: 'betting', to: 'playing' },
  { from: 'bonus buy', to: 'bonus / feature' },
  { from: 'bought', to: 'instantly triggered' },
  { from: 'buy', to: 'play' },
  { from: 'buy bonus', to: 'get bonus' },
  { from: 'cash', to: 'coins' },
  { from: 'cost of', to: 'can be played for' },
  { from: 'at the cost of', to: 'for' },
  { from: 'credit', to: 'coins' },
  { from: 'currency', to: 'token' },
  { from: 'deposit', to: 'get coins' },
  { from: 'gamble', to: 'play' },
  { from: 'loss limit', to: 'stop limit' },
  { from: 'loss streak', to: 'miss streak' },
  { from: 'money', to: 'coins' },
  { from: 'paid', to: 'won' },
  { from: 'paid out', to: 'won' },
  { from: 'pay', to: 'win' },
  { from: 'pay out', to: 'win / won' },
  { from: 'pay table', to: 'win table' },
  { from: 'payer', to: 'winner' },
  { from: 'pays', to: 'wins' },
  { from: 'pays out', to: 'win' },
  { from: 'place your bets', to: 'come and play / join in the game' },
  { from: 'profit', to: 'net gain' },
  { from: 'purchase', to: 'play' },
  { from: 'rebet', to: 'respin' },
  { from: 'stake', to: 'play amount' },
  { from: 'total bet', to: 'total play' },
  { from: 'wager', to: 'play' },
  { from: 'win feature', to: 'play feature' },
  { from: 'withdraw', to: 'redeem' },
  { from: "be awarded to player's accounts", to: "appear in player's accounts" },
  { from: 'be awarded to player’s accounts', to: 'appear in player’s accounts' }, // curly apostrophe variant
  // ── Single-word / UI forms (doc lists these only as spaced phrases) + verb form ──
  { from: 'payout', to: 'win' }, // single word; "pay out" (spaced) handled above
  { from: 'paytable', to: 'win table' }, // single word; "pay table" (spaced) handled above
  { from: 'paylines', to: 'winlines' },
  { from: 'payline', to: 'winline' },
  { from: 'paying', to: 'winning' }, // verb form; the bare "pay"→"win" rule is word-bounded and can't reach it
  { from: 'price', to: 'play' },
  { from: 'cost', to: 'play' }, // standalone; the "cost of" / "at the cost of" phrases above win first
  { from: 'fund', to: 'balance' },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply the social-mode replacement rules to `text`.
 *
 * Rules are auto-sorted by `from.length` descending so multi-word phrases match before any of their
 * substrings. Casing is preserved: `Bet` → `Play`, `BET` → `PLAY`, `bet` → `play`.
 */
export function applySocialReplacements(
  text: string,
  rules: SocialReplacementRule[] = SOCIAL_REPLACEMENTS,
): string {
  // Defensive copy + sort by length descending so longer phrases win.
  const sorted = [...rules].sort((a, b) => b.from.length - a.from.length);
  let out = text;
  for (const rule of sorted) {
    const wholeWord = rule.wholeWord ?? true;
    const pattern = wholeWord
      ? new RegExp(`\\b${escapeRegex(rule.from)}\\b`, 'gi')
      : new RegExp(escapeRegex(rule.from), 'gi');
    out = out.replace(pattern, (match) => preserveCase(match, rule.to));
  }
  return out;
}

function preserveCase(source: string, target: string): string {
  if (source.toUpperCase() === source && /[A-Z]/.test(source)) {
    return target.toUpperCase();
  }
  if (source[0] === source[0]?.toUpperCase()) {
    return target[0]?.toUpperCase() + target.slice(1);
  }
  return target.toLowerCase();
}
