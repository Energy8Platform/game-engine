// packages/game-engine/src/host/shellConfig.ts
// `socialize` / `createI18n` are runtime helpers sourced from platform-core/shell;
// renderer-agnostic types (GameInfoSection/Content, PaytableRow, GameMode) also stay
// on platform-core so internal helpers never see the pixi-widened `node?: Container`.
// Only the pixi-specific surface types (PixiShellConfig + control types) come from the
// new @energy8platform/shell/pixi entry.
import { socialize, createI18n } from '@energy8platform/platform-core/shell';
import type { Lang } from '@energy8platform/platform-core/shell';
import type { GameInfoContent, GameInfoSection, PaytableRow, GameMode } from '@energy8platform/shell/pixi';
import type {
  PixiShellConfig, ShellMode, CurrencyConfig,
  BonusOption, ShellFeatures,
} from '@energy8platform/shell/pixi';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { WinTier } from '../slot';

export interface SlotShellOptions {
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
  /** Per-game translation map. Keys are the English source strings (from the spec or copy);
   *  values are the translated strings for each language. Merged with the shell's built-in
   *  `LOCALES` catalog — game strings take precedence over the built-in entries for the same key.
   *  When not supplied, English source strings pass through verbatim (socialised in social mode). */
  i18n?: Partial<Record<Lang, Record<string, string>>>;
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
  /** Jurisdiction flags from initData (`config.jurisdiction`). Restrict shell features — applied
   *  OVER the author's features so a jurisdiction restriction always wins. */
  jurisdiction?: JurisdictionRestrictions;
  /** Bet ladder from `/wallet/authenticate` (`initData.config.betLevels`, major units). Stake ladders
   *  are CURRENCY-SPECIFIC (us_/non_us_/social_), so this overrides the spec's static `betLevels` on a
   *  Stake launch; falls back to the spec on dev/devBridge. */
  betLevels?: number[];
  /** Per-currency default bet from `/wallet/authenticate` (the bridge surfaces it as
   *  `config.stake.defaultBetLevel`). Stake requires the selector to start here on every entry. */
  defaultBet?: number;
}

/** The subset of Stake's jurisdiction flags the shell can enforce via `ShellFeatures`. */
export interface JurisdictionRestrictions {
  /** No turbo at all → `features.turbo = 0`. */
  disabledTurbo?: boolean;
  /** Basic turbo allowed, but no super-turbo → cap `features.turbo` at 1. */
  disabledSuperTurbo?: boolean;
  /** No spacebar quick-spin → `features.spacebar = false`. */
  disabledSpacebar?: boolean;
  /** No autoplay → `features.autoplay = null`. */
  disabledAutoplay?: boolean;
  /** No buy-feature → `features.buyBonus = false`. */
  disabledBuyFeature?: boolean;
}

/**
 * Apply jurisdiction restrictions over the resolved shell features, in place. A restriction ALWAYS
 * wins over the author's intent (a forbidden control must stay off even if the game enabled it).
 */
export function applyJurisdiction(features: ShellFeatures, j?: JurisdictionRestrictions): void {
  if (!j) return;
  if (j.disabledTurbo) features.turbo = 0;
  else if (j.disabledSuperTurbo && features.turbo > 1) features.turbo = 1;
  if (j.disabledSpacebar) features.spacebar = false;
  if (j.disabledAutoplay) features.autoplay = null;
  if (j.disabledBuyFeature) features.buyBonus = false;
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

/** Derive shell buy cards + ante toggles from the spec's buy/feature actions (SSOT).
 *  @param t Optional translator applied to `title` and `description` before they enter the shell. */
export function toBonusOptions(model: GameModel, t: (s: string) => string = (s) => s): BonusOption[] {
  const out: BonusOption[] = [];
  for (const [key, action] of Object.entries(model.spec.actions)) {
    const role = action.role ?? 'base';
    if (role !== 'buy' && role !== 'feature') continue;
    out.push({
      id: key,
      type: role === 'buy' ? 'bonus' : 'feature',
      title: t(action.title ?? key.replace(/_/g, ' ').toUpperCase()),
      description: t(action.description ?? ''),
      priceMultiplier: action.cost ?? (role === 'buy' ? 100 : 1),
      // Volatility (1–5 bolts) is part of the spec action SSOT; forward it so the buy card shows it.
      ...(action.volatility != null ? { volatility: action.volatility } : {}),
    });
  }
  return out;
}

/** Build a paytable section from the model's derived paytable view (multipliers per symbol count).
 *  @param t Optional translator applied to symbol names before they enter the shell. */
function paytableSection(model: GameModel, t: (s: string) => string = (s) => s): GameInfoSection | null {
  const symbols = model.paytable?.symbols ?? [];
  const rows: PaytableRow[] = [];
  for (const s of symbols) {
    const wins = Object.entries(s.pay ?? {})
      .map(([count, multiplier]) => ({ count: String(count), multiplier: Number(multiplier) }))
      .filter((w) => Number.isFinite(w.multiplier) && w.multiplier > 0)
      .sort((a, b) => Number(a.count) - Number(b.count));
    if (!wins.length) continue;
    rows.push({ symbol: { text: t(s.name ?? s.id) }, wins });
  }
  if (!rows.length) return null;
  // No literal title — the shell renders `s.title ?? host.t('Paytable')`, so the heading is
  // localized (matching how the modes/wins sections rely on the shell's translated fallback).
  return { type: 'paytable', rows };
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

/** Move the legal disclaimer to the very END of the section list — it must always render last,
 *  regardless of where an author merge or an extra section would otherwise place it. */
function orderDisclaimerLast(sections: GameInfoSection[]): GameInfoSection[] {
  const disclaimer = sections.filter(isDisclaimerSection);
  if (!disclaimer.length) return sections;
  return [...sections.filter((s) => !isDisclaimerSection(s)), ...disclaimer];
}

/**
 * Pure: derive a maximal default GameInfoContent from the model + runtime so every game
 * gets a real info panel for free (paytable, win illustration, controls, and the Stake
 * disclaimer when present). Author-supplied `opts.gameInfo` is MERGED over this set by
 * section identity (see `mergeGameInfo`), not wholesale-replaced.
 * @param t Optional translator applied to spec-derived player-facing strings (symbol names, mode titles, etc.).
 */
export function defaultGameInfo(model: GameModel, runtime: ShellRuntime, t: (s: string) => string = (s) => s): GameInfoContent {
  const sections: GameInfoSection[] = [];
  sections.push(winsSection(model));
  const pay = paytableSection(model, t);
  if (pay) sections.push(pay);
  const modes = modesSection(model, t);
  if (modes) sections.push(modes);
  sections.push({ type: 'controls' });
  const disclaimer = disclaimerSection(runtime.disclaimerLines);
  if (disclaimer) sections.push(disclaimer);
  return { sections };
}

/** Per-mode info table (BASE / ANTE / each buy tier) derived from the spec's modes — the SAME SSOT
 *  (`model.mathModes` + `spec.actions`) that drives the buy cards and the math pipeline. Stake
 *  compliance requires Cost / RTP / Max Win per mode; deriving it here means the author declares a
 *  mode once (in game.spec) and the info table can't drift. `free` actions are excluded (mathModes
 *  already drops them — free spins are part of a bonus, not a purchasable mode).
 *  @param t Optional translator applied to row `title` and `description` before they enter the shell. */
function modesSection(model: GameModel, t: (s: string) => string = (s) => s): GameInfoSection | null {
  const modes = model.mathModes ?? [];
  if (!modes.length) return null;
  const rows: GameMode[] = modes.map((m) => {
    const action = model.spec.actions[m.action];
    const isBase = (action?.role ?? 'base') === 'base' || m.mode === 'BASE';
    const row: GameMode = {
      title: t(action?.title ?? (isBase ? 'Base game' : m.mode.replace(/_/g, ' '))),
      maxWin: `${m.maxWin.toLocaleString('en-US')}×`,
    };
    // Cost is a bet-multiplier; a base spin (1×) reads as no premium, so only show it for buys/features.
    if (m.costMultiplier && m.costMultiplier !== 1) row.price = `${m.costMultiplier}×`;
    if (typeof m.rtp === 'number') row.rtp = Math.round(m.rtp * 1000) / 10; // 0.965 → 96.5 (%)
    if (action?.description) row.description = t(action.description);
    return row;
  });
  return { type: 'modes', title: 'MODES', modes: rows };
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
  // `GameInfoContent.sections` is typed with the core GameInfoSection (node?: unknown) because
  // shell/pixi re-exports GameInfoContent unchanged from core. Host-built sections never set `node`,
  // so they are structurally compatible with pixi's GameInfoSection (node?: Container). Cast once
  // here so the rest of the function works against the pixi-widened type.
  const derivedSections = (derived.sections ?? []) as GameInfoSection[];
  const overrideSections = (override.sections ?? []) as GameInfoSection[];
  const authorByKey = new Map<string, GameInfoSection>();
  for (const s of overrideSections) authorByKey.set(sectionKey(s), s);

  const out: GameInfoSection[] = [];
  const used = new Set<string>();
  // Keep derived order; swap in the author's version where identities collide.
  for (const s of derivedSections) {
    const k = sectionKey(s);
    const replacement = authorByKey.get(k);
    if (replacement) { out.push(replacement); used.add(k); }
    else out.push(s);
  }
  // Append author sections whose identity wasn't in the derived set, in author order.
  for (const s of overrideSections) {
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
  if (next.type === 'modes' && Array.isArray((next as { modes?: GameMode[] }).modes)) {
    (next as { modes: GameMode[] }).modes = (next as { modes: GameMode[] }).modes.map((m) => ({
      ...m,
      title: socialize(m.title),
      ...(m.description ? { description: socialize(m.description) } : {}),
    }));
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

/** Pure: assemble the shell config (sans mount target) from the model + runtime context
 *  (currency/balance/language/mode). The host adds `app` at the call site. */
export function buildShellConfig(
  opts: SlotShellOptions,
  model: GameModel,
  runtime: ShellRuntime,
): Omit<PixiShellConfig, 'app' | 'parent' | 'gameInfo'> & { gameInfo: GameInfoContent } {
  // Prefer the currency-specific ladder from /wallet/authenticate; fall back to the spec (dev/devBridge).
  const betLevels = runtime.betLevels?.length ? runtime.betLevels : model.spec.betLevels;
  // Stake requires the default to come from authenticate on every entry; spec default is the dev fallback.
  const defaultBet = runtime.defaultBet ?? model.spec.defaultBet ?? betLevels[0];
  // runtime.currency is the resolved CurrencyConfig (derived from initData.config.currency by the
  // host); opts.currency still wins. Fall back to the spec code, then a neutral euro.
  const currency =
    opts.currency ?? runtime.currency ?? resolveCurrency(null, model.spec.currency);
  const isSocial = runtime.social ?? false;
  // Build the merged resolver: game i18n map + shell LOCALES (via createI18n), then socialize on
  // top for English social mode. For non-English languages, createI18n already handles the
  // translation lookup; social rewriting is English-only and applied separately after.
  // Author gameInfo may be a plain object or a `(t) => content` factory. `t` is the resolver so
  // authors can wrap player-facing copy explicitly; the full merged set is still socialized below
  // (section pass) as a safety net so restricted words can't slip through even if t() was missed.
  const { t } = createI18n({ language: runtime.language ?? 'en', isSocial, messages: opts.i18n });
  const authored = typeof opts.gameInfo === 'function' ? opts.gameInfo(t) : opts.gameInfo;
  // Pass t() through to spec-derived sections so symbol names, mode titles, and descriptions are
  // pre-translated before they reach the shell renderer.
  // Cast to { sections?: GameInfoSection[] } (pixi-widened) so downstream map/filter calls work
  // against the pixi section union. Host-derived sections never set `node`, so the widening is safe.
  let gameInfo: { sections?: GameInfoSection[] } = mergeGameInfo(defaultGameInfo(model, runtime, t), authored) as { sections?: GameInfoSection[] };
  // The DISCLAIMER is required legal copy and must be shown VERBATIM — never socialized (its
  // wording is mandated, and word-swaps like "bet → play" would corrupt the legal text).
  if (isSocial) {
    gameInfo = {
      sections: (gameInfo.sections ?? []).map((s) => (isDisclaimerSection(s) ? s : socializeSection(s))),
    };
  }
  // The legal DISCLAIMER always renders LAST — author-merged or extra sections never push below it.
  gameInfo = { sections: orderDisclaimerLast(gameInfo.sections ?? []) };
  // Buy-bonus cards: apply t() to spec-derived options (pre-translate), then socialize for en+social.
  const buyBonus = socializeBonusOptions(opts.buyBonus ?? toBonusOptions(model, t), isSocial);
  // Features: defaults, then author overrides, THEN jurisdiction restrictions (a restriction wins).
  const features: ShellFeatures = {
    turbo: 0,
    spacebar: true,
    autoplay: {},
    buyBonus,
    ...(opts.features ?? {}),
  } as ShellFeatures;
  applyJurisdiction(features, runtime.jurisdiction);
  return {
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
    features,
  };
}
