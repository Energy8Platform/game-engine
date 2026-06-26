// Social-casino language. English is the source (and, for now, the only) language; `socialize`
// rewrites the restricted gambling vocabulary into social-safe phrasing while preserving case.
//
// Ordering matters: the longest / most specific phrases are listed first so they win over their
// constituent words (e.g. "buy bonus" before "buy", "pay out" before "pay"). The JS alternation
// tries entries left-to-right at each position, so a phrase earlier in this list takes priority.
//
// Conflicting duplicates in the source table are resolved to a single replacement here
// (betting→playing, total bet→total play, paid out→won, pays out→win).
const RULES: ReadonlyArray<readonly [string, string]> = [
  ['be awarded to player’s accounts', 'appear in player’s accounts'],
  ["be awarded to player's accounts", "appear in player's accounts"],
  ['place your bets', 'come and play / join in the game'],
  ['at the cost of', 'for'],
  ['cost of', 'can be played for'],
  ['win feature', 'play feature'],
  ['total bet', 'total play'],
  ['buy bonus', 'get bonus'],
  ['bonus buy', 'bonus / feature'],
  ['pay out', 'win / won'],
  ['paid out', 'won'],
  ['pays out', 'win'],
  ['payout', 'win'], // single word; "pay out" (spaced) is handled above
  ['paytable', 'win table'],
  ['paylines', 'winlines'],
  ['payline', 'winline'],
  ['bet/s', 'play/s'],
  ['betting', 'playing'],
  ['rebet', 'respin'],
  ['stake', 'play amount'],
  ['payer', 'winner'],
  ['bets', 'plays'],
  ['pays', 'wins'],
  ['paid', 'won'],
  ['bought', 'instantly triggered'],
  ['purchase', 'play'],
  ['price', 'play'],
  ['cost', 'play'], // standalone; the "cost of" / "at the cost of" phrases above win first
  ['deposit', 'get coins'],
  ['withdraw', 'redeem'],
  ['currency', 'token'],
  ['gamble', 'play'],
  ['wager', 'play'],
  ['credit', 'balance'],
  ['money', 'coins'],
  ['cash', 'coins'],
  ['fund', 'balance'],
  ['bet', 'play'],
  ['pay', 'win'],
  ['buy', 'play'],
];

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
