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
 *   - `@energy8platform/stake-kit` — layers game-specific pre/post normalization over it;
 *   - `@energy8platform/shell` — its `socialize()` (used by the DOM `/html` and Pixi `/pixi`
 *     chrome, and modelled as the `en-social` pseudo-locale in `createI18n`) calls
 *     `applySocialReplacements` directly, so the chrome never drifts from the games.
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
  { from: 'betting', to: 'playing' },
  { from: 'bonus buy', to: 'feature' }, // feature name; the CTA form is handled by "buy bonus"→"get bonus"
  { from: 'bought', to: 'instantly triggered' },
  { from: 'buy', to: 'play' },
  { from: 'buy bonus', to: 'get bonus' },
  { from: 'cash', to: 'coins' },
  { from: 'cost of', to: 'can be played for' },
  { from: 'at the cost of', to: 'for' },
  { from: 'credit', to: 'balance' },
  { from: 'currency', to: 'token' },
  { from: 'deposit', to: 'get coins' },
  { from: 'gamble', to: 'play' },
  { from: 'loss limit', to: 'stop limit' },
  { from: 'loss streak', to: 'miss streak' },
  { from: 'money', to: 'coins' },
  { from: 'paid', to: 'won' },
  { from: 'paid out', to: 'won' },
  { from: 'pay', to: 'win' },
  { from: 'pay out', to: 'win' },
  { from: 'pay table', to: 'win table' },
  { from: 'payer', to: 'winner' },
  { from: 'pays', to: 'wins' },
  { from: 'pays out', to: 'win' },
  { from: 'place your bets', to: 'join in the game' },
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
  { from: 'funds', to: 'balance' }, // plural; the word-bounded "fund"→"balance" rule can't reach it
  // ── Inflected / derived forms (plural · gerund · past · agent noun) ──
  // Each mirrors the root rule above; all word-bounded, so the base singular rules can't reach them
  // and social mode never leaks a gambling word merely because it appeared in a different form.
  { from: 'bettor', to: 'player' },
  { from: 'bettors', to: 'players' },
  { from: 'buys', to: 'plays' },
  { from: 'buying', to: 'playing' },
  { from: 'gambles', to: 'plays' },
  { from: 'gambling', to: 'playing' },
  { from: 'gambled', to: 'played' },
  { from: 'gambler', to: 'player' },
  { from: 'gamblers', to: 'players' },
  { from: 'wagers', to: 'plays' },
  { from: 'wagering', to: 'playing' },
  { from: 'wagered', to: 'played' },
  { from: 'purchases', to: 'plays' },
  { from: 'purchasing', to: 'playing' },
  { from: 'purchased', to: 'played' },
  { from: 'withdraws', to: 'redeems' },
  { from: 'withdrawing', to: 'redeeming' },
  { from: 'withdrew', to: 'redeemed' },
  { from: 'withdrawn', to: 'redeemed' },
  { from: 'withdrawal', to: 'redemption' },
  { from: 'withdrawals', to: 'redemptions' },
  { from: 'payouts', to: 'wins' }, // plural of the single-word "payout"→"win"
  { from: 'currencies', to: 'tokens' },
  { from: 'profits', to: 'net gains' },
  { from: 'profitable', to: 'rewarding' },
  { from: 'credits', to: 'coins' }, // singular "credit"→"balance", but "N credits" reads as coins
  { from: 'deposits', to: 'gets coins' },
  { from: 'depositing', to: 'getting coins' },
  { from: 'deposited', to: 'got coins' },
  { from: 'funding', to: 'topping up' },
  { from: 'funded', to: 'topped up' },
  { from: 'stakes', to: 'play amounts' },
  { from: 'staking', to: 'playing' }, // the legal disclaimer is exempt from socialization (host-side),
  // so the "Stake" brand there is never rewritten by the case-insensitive stake→play amount rules.
  { from: 'costs', to: 'plays' },
  { from: 'prices', to: 'plays' },
  { from: 'pricing', to: 'playing' },
  { from: 'priced', to: 'played' },
  { from: 'payment', to: 'win' },
  { from: 'payments', to: 'wins' },
  { from: 'cash out', to: 'redeem' }, // "cash out"/"cashout" mean redeem, not the bare cash→coins
  { from: 'cashout', to: 'redeem' },
  { from: 'cashback', to: 'coins back' },
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
  // ALL CAPS → upper-case the whole replacement.
  if (source.toUpperCase() === source && /[A-Z]/.test(source)) {
    return target.toUpperCase();
  }
  // Title Case (every whitespace-separated word starts with a capital) → capitalise each word of
  // the replacement, so multi-word phrases keep their casing: "Buy Bonus" → "Get Bonus" (not "Get
  // bonus"). Word counts needn't match; we re-title each token of the target independently.
  const words = source.split(/\s+/).filter(Boolean);
  const isTitleCase =
    words.length > 1 && words.every((w) => !/[A-Za-z]/.test(w) || w[0] === w[0].toUpperCase());
  if (isTitleCase) {
    return target.replace(/\S+/g, (w) => w.replace(/[A-Za-z]/, (c) => c.toUpperCase()));
  }
  // Sentence case (first letter capitalised) → capitalise only the replacement's first letter.
  if (/[A-Za-z]/.test(source[0] ?? '') && source[0] === source[0]?.toUpperCase()) {
    return target[0]?.toUpperCase() + target.slice(1);
  }
  return target.toLowerCase();
}
