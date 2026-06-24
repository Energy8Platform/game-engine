// packages/game-engine/src/host/shellConfig.ts
import { socialize } from '@energy8platform/platform-core/shell';
import type {
  ShellConfig, ShellMode, CurrencyConfig, GameInfoContent, GameInfoSection, PaytableRow,
  BonusOption, ShellFeatures,
} from '@energy8platform/platform-core/shell';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { WinTier } from '../slot';

export interface SlotShellOptions {
  mount?: HTMLElement;
  /** Override the derived currency (normally taken from initData). */
  currency?: CurrencyConfig;
  /** Author-supplied info sections, MERGED over the host-derived set by section identity (an author
   *  section REPLACES the derived one of the same `type`/`kind`; a new `type` is appended; derived
   *  sections without an override are kept).
   *
   *  Pass a plain `GameInfoContent`, OR a function `(t) => GameInfoContent` where `t` is the
   *  social-aware translator (it rewrites restricted gambling words when in social mode, and is the
   *  identity otherwise) — wrap player-facing copy in `t(...)` so it socializes. Either way the
   *  merged result is also run through `socialize` in social mode as a safety net, so forbidden
   *  words never leak even if `t()` was forgotten. */
  gameInfo?: GameInfoContent | ((t: (text: string) => string) => GameInfoContent);
  /** Override the derived buy/ante options. In social mode the card copy is socialized too. */
  buyBonus?: BonusOption[];
  tiers?: WinTier[];
  features?: Partial<ShellFeatures>;
}

/** The currency metadata surfaced on `initData.config.currency` (game-sdk `CurrencyMetaData`).
 *  Built by the Stake bridge via `lookupCurrency(code)` from the authoritative `CURRENCY_META`
 *  table — the single source of truth for symbol/decimals/placement. */
export interface CurrencyMeta {
  code: string;
  symbol: string;
  decimals: number;
  symbolAfter?: boolean;
}

/** Runtime context from the SDK handshake (initData) + the resolved mode. */
export interface ShellRuntime {
  balance: number;
  /** Resolved shell currency, derived from `initData.config.currency` (the SAME meta the Stake
   *  bridge builds). Pass a full `CurrencyConfig` — see `resolveCurrency`. */
  currency?: CurrencyConfig;
  language?: string;
  mode: ShellMode;
  /** Social-casino mode from initData (`config.socialMode`); swaps shell vocabulary. */
  social?: boolean;
  /** Stake-required disclaimer lines from initData (`config.disclaimerLines`); when
   *  absent (non-stake/dev) no disclaimer section is rendered. */
  disclaimerLines?: string[];
}

/**
 * Resolve the shell `CurrencyConfig` from the SAME data the Stake bridge uses — the
 * `CurrencyMetaData` it puts on `initData.config.currency` (symbol + placement from
 * `symbolAfter`). No second symbol table lives here.
 *
 * Fallback chain (dev/devBridge with no Stake meta): `initData.config.currency`
 * → the spec's currency `code` (neutral `{ symbol: code, position: 'left' }`)
 * → `{ symbol: '€', position: 'left' }`.
 */
/** Extra precision for WIN / TOTAL-WIN readouts so small-bet wins (e.g. 0.0041 on a 0.01 bet) are
 *  not rounded away to 0.00. Balance / bet stay at the currency's own decimals (`minDecimals`). */
const WIN_MAX_DECIMALS = 4;

/** Attach decimals: `minDecimals` (balance/bet/prices, fixed) = the currency's decimals; `maxDecimals`
 *  (win/total-win, variable, trailing zeros trimmed) = up to WIN_MAX_DECIMALS — but only when the
 *  currency actually has fraction digits (a 0-decimal currency like JPY keeps wins integer). */
function withDecimals(base: { symbol: string; position: 'left' | 'right' }, decimals: number): CurrencyConfig {
  return {
    ...base,
    minDecimals: decimals,
    maxDecimals: decimals > 0 ? Math.max(decimals, WIN_MAX_DECIMALS) : 0,
  };
}

export function resolveCurrency(meta?: CurrencyMeta | null, specCurrency?: string): CurrencyConfig {
  const hasMeta = !!(meta && meta.symbol);
  // Single expression, no early-return branches (the bundler was treeshaking the meta branch away).
  const symbol = hasMeta ? meta!.symbol : (specCurrency || '€');
  const position: 'left' | 'right' = hasMeta && meta!.symbolAfter ? 'right' : 'left';
  const decimals = hasMeta && typeof meta!.decimals === 'number' ? meta!.decimals : 2;
  return withDecimals({ symbol, position }, decimals);
}

/** Total stake for an action = bet × the action's cost multiplier (1 for a base spin; e.g. 100 for
 *  a buy bonus). The host uses this to block a play the balance can't cover. */
export function stakeForAction(model: GameModel, action: string, bet: number): number {
  const cost = (model.spec.actions?.[action]?.cost ?? 1) as number;
  return cost * bet;
}

/** Derive shell buy cards + ante toggles from the spec's buy/feature actions (SSOT). */
export function toBonusOptions(model: GameModel): BonusOption[] {
  const out: BonusOption[] = [];
  for (const [key, action] of Object.entries(model.spec.actions)) {
    const role = action.role ?? 'base';
    if (role !== 'buy' && role !== 'feature') continue;
    out.push({
      id: key,
      type: role === 'buy' ? 'bonus' : 'feature',
      title: action.title ?? key.replace(/_/g, ' ').toUpperCase(),
      description: action.description ?? '',
      priceMultiplier: action.cost ?? (role === 'buy' ? 100 : 1),
    });
  }
  return out;
}

/** Build a paytable section from the model's derived paytable view (multipliers per symbol count). */
function paytableSection(model: GameModel): GameInfoSection | null {
  const symbols = model.paytable?.symbols ?? [];
  const rows: PaytableRow[] = [];
  for (const s of symbols) {
    const wins = Object.entries(s.pay ?? {})
      .map(([count, multiplier]) => ({ count: String(count), multiplier: Number(multiplier) }))
      .filter((w) => Number.isFinite(w.multiplier) && w.multiplier > 0)
      .sort((a, b) => Number(a.count) - Number(b.count));
    if (!wins.length) continue;
    rows.push({ symbol: { text: s.name ?? s.id }, wins });
  }
  if (!rows.length) return null;
  return { type: 'paytable', title: 'PAYTABLE', rows };
}

/** Build a "wins" illustration section sized to the grid; `kind` follows the spec mechanic hint. */
function winsSection(model: GameModel): GameInfoSection {
  const { cols, rows } = model.spec.grid;
  const grid = { cols, rows };
  switch (model.spec.mechanic) {
    case 'cluster':
      return { type: 'wins', kind: 'cluster', minCount: 5, grid } as GameInfoSection;
    case 'ways':
      return { type: 'wins', kind: 'ways', grid } as GameInfoSection;
    default:
      return { type: 'wins', kind: 'anywhere', minCount: 3, grid } as GameInfoSection;
  }
}

/** Title of the legal disclaimer section — used to build it and to exempt it from socialization. */
const DISCLAIMER_TITLE = 'DISCLAIMER';

/** A disclaimer section from initData's disclaimer lines; null when none supplied. */
function disclaimerSection(lines?: string[]): GameInfoSection | null {
  const clean = (lines ?? []).map((l) => l.trim()).filter(Boolean);
  if (!clean.length) return null;
  const html = clean.map((l) => `<p>${l}</p>`).join('');
  return { type: 'custom', title: DISCLAIMER_TITLE, html };
}

/** The legal disclaimer must be shown verbatim — this identifies it so socialization skips it. */
function isDisclaimerSection(s: GameInfoSection): boolean {
  return s.type === 'custom' && (s as { title?: string }).title === DISCLAIMER_TITLE;
}

/**
 * Pure: derive a maximal default GameInfoContent from the model + runtime so every game
 * gets a real info panel for free (paytable, win illustration, controls, and the Stake
 * disclaimer when present). Author-supplied `opts.gameInfo` is MERGED over this set by
 * section identity (see `mergeGameInfo`), not wholesale-replaced.
 */
export function defaultGameInfo(model: GameModel, runtime: ShellRuntime): GameInfoContent {
  const sections: GameInfoSection[] = [];
  sections.push(winsSection(model));
  const pay = paytableSection(model);
  if (pay) sections.push(pay);
  sections.push({ type: 'controls' });
  const disclaimer = disclaimerSection(runtime.disclaimerLines);
  if (disclaimer) sections.push(disclaimer);
  return { sections };
}

/** Identity key for merge. `wins` is keyed by `kind` (different mechanics coexist). `custom` has
 *  no structural discriminant and several can coexist (MAX WIN, DISCLAIMER, …) so it is keyed by
 *  its `title` (an author `custom` with a matching title replaces that derived block; a new title
 *  is added). Every other type is a singleton keyed by `type`. */
function sectionKey(s: GameInfoSection): string {
  if (s.type === 'wins') return `wins:${s.kind}`;
  if (s.type === 'custom') return `custom:${s.title ?? ''}`;
  return s.type;
}

/**
 * Merge author `gameInfo` over the host-derived set by section identity: an author section
 * REPLACES the derived section of the same identity (same `type`, or same `wins` `kind`); a new
 * identity is APPENDED (after the derived ones, in author order); derived sections without an
 * author override are KEPT. `override` undefined → the pure derived set.
 */
export function mergeGameInfo(derived: GameInfoContent, override?: GameInfoContent): GameInfoContent {
  if (!override) return derived;
  const authorByKey = new Map<string, GameInfoSection>();
  for (const s of override.sections ?? []) authorByKey.set(sectionKey(s), s);

  const out: GameInfoSection[] = [];
  const used = new Set<string>();
  // Keep derived order; swap in the author's version where identities collide.
  for (const s of derived.sections ?? []) {
    const k = sectionKey(s);
    const replacement = authorByKey.get(k);
    if (replacement) { out.push(replacement); used.add(k); }
    else out.push(s);
  }
  // Append author sections whose identity wasn't in the derived set, in author order.
  for (const s of override.sections ?? []) {
    const k = sectionKey(s);
    if (!used.has(k)) { out.push(s); used.add(k); }
  }
  return { sections: out };
}

/** Run a section's player-facing text through `socialize`. Applied to the full MERGED set
 *  (host-derived + author) in social mode. Covers section titles, custom HTML, and PAYTABLE row
 *  symbol labels — the paytable's symbol text comes straight from the gameSpec's `symbols[].name`,
 *  so a forbidden word in a spec symbol name is rewritten here too. A `node`-based custom section is
 *  returned untouched — its DOM is author-owned and not introspected. */
function socializeSection(s: GameInfoSection): GameInfoSection {
  const next = { ...s } as GameInfoSection;
  if ('title' in next && typeof next.title === 'string') {
    (next as { title?: string }).title = socialize(next.title);
  }
  if (next.type === 'custom' && typeof next.html === 'string') {
    (next as { html?: string }).html = socialize(next.html);
  }
  if (next.type === 'paytable' && Array.isArray((next as { rows?: PaytableRow[] }).rows)) {
    (next as { rows: PaytableRow[] }).rows = (next as { rows: PaytableRow[] }).rows.map((r) =>
      typeof r.symbol?.text === 'string'
        ? { ...r, symbol: { ...r.symbol, text: socialize(r.symbol.text) } }
        : r,
    );
  }
  return next;
}

/** Socialize buy-bonus card copy (title/description) when in social mode; a no-op otherwise.
 *  Applied to the final option set (author override or spec-derived) so forbidden words in author
 *  card copy are rewritten too. */
function socializeBonusOptions(options: BonusOption[], isSocial: boolean): BonusOption[] {
  if (!isSocial) return options;
  return options.map((o) => ({ ...o, title: socialize(o.title), description: socialize(o.description) }));
}

/** Pure: assemble a ShellConfig from the model + runtime context (currency/balance/language/mode). */
export function buildShellConfig(opts: SlotShellOptions, model: GameModel, runtime: ShellRuntime): ShellConfig {
  const betLevels = model.spec.betLevels;
  const defaultBet = model.spec.defaultBet ?? betLevels[0];
  // runtime.currency is the resolved CurrencyConfig (derived from initData.config.currency by the
  // host); opts.currency still wins. Fall back to the spec code, then a neutral euro.
  const currency =
    opts.currency ?? runtime.currency ?? resolveCurrency(null, model.spec.currency);
  const isSocial = runtime.social ?? false;
  // Merge author sections over the host-derived defaults, THEN socialize the WHOLE merged set in
  // social mode — so restricted gambling vocabulary is rewritten in BOTH the built-in copy AND any
  // author-supplied text (title + custom HTML). A game can no longer surface a forbidden word in
  // social mode just because the author wrote it in their own info section. (Custom sections built
  // from a raw DOM `node` can't be rewritten automatically — author owns the node and can call the
  // exported `socialize` from '@energy8platform/game-engine/host' on their own strings.)
  // Author gameInfo may be a plain object or a `(t) => content` factory. `t` socializes when in
  // social mode (identity otherwise) so authors can wrap copy explicitly; the full merged set is
  // still socialized below as a safety net.
  const t = isSocial ? socialize : (text: string) => text;
  const authored = typeof opts.gameInfo === 'function' ? opts.gameInfo(t) : opts.gameInfo;
  let gameInfo = mergeGameInfo(defaultGameInfo(model, runtime), authored);
  // The DISCLAIMER is required legal copy and must be shown VERBATIM — never socialized (its
  // wording is mandated, and word-swaps like "bet → play" would corrupt the legal text).
  if (isSocial) {
    gameInfo = {
      sections: (gameInfo.sections ?? []).map((s) => (isDisclaimerSection(s) ? s : socializeSection(s))),
    };
  }
  // Buy-bonus cards: socialize the FINAL options (author override or spec-derived) in social mode.
  const buyBonus = socializeBonusOptions(opts.buyBonus ?? toBonusOptions(model), isSocial);
  return {
    mount: opts.mount ?? (typeof document !== 'undefined' ? document.body : (undefined as never)),
    language: runtime.language ?? 'en',
    isSocial,
    currency,
    gameInfo,
    availableBets: [...betLevels],
    defaultBet,
    currentBet: defaultBet,
    balance: runtime.balance,
    win: 0,
    mode: runtime.mode,
    features: {
      turbo: 0,
      spacebar: true,
      autoplay: {},
      buyBonus,
      ...(opts.features ?? {}),
    } as ShellFeatures,
  };
}
