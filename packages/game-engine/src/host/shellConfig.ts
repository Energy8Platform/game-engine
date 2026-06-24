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
  /** Author-supplied info sections. Sections are MERGED over the host-derived set by section
   *  identity: an author section REPLACES the derived section of the same `type`/`kind`, a new
   *  `type` is appended, and derived sections without an author override (max win, paytable,
   *  controls, disclaimer) are kept. */
  gameInfo?: GameInfoContent;
  /** Override the derived buy/ante options. */
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
export function resolveCurrency(meta?: CurrencyMeta | null, specCurrency?: string): CurrencyConfig {
  if (meta?.symbol) return { symbol: meta.symbol, position: meta.symbolAfter ? 'right' : 'left' };
  if (specCurrency) return { symbol: specCurrency, position: 'left' };
  return { symbol: '€', position: 'left' };
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

/** A free "max win" info line built from the spec's max-win multiplier. */
function maxWinSection(model: GameModel): GameInfoSection | null {
  const max = model.spec.maxWin;
  if (!max || !Number.isFinite(max) || max <= 0) return null;
  return {
    type: 'custom',
    title: 'MAX WIN',
    html: `<p>Win up to <strong>${max.toLocaleString('en-US')}x</strong> your bet.</p>`,
  };
}

/** A disclaimer section from initData's disclaimer lines; null when none supplied. */
function disclaimerSection(lines?: string[]): GameInfoSection | null {
  const clean = (lines ?? []).map((l) => l.trim()).filter(Boolean);
  if (!clean.length) return null;
  const html = clean.map((l) => `<p>${l}</p>`).join('');
  return { type: 'custom', title: 'DISCLAIMER', html };
}

/**
 * Pure: derive a maximal default GameInfoContent from the model + runtime so every game
 * gets a real info panel for free (max win, paytable, win illustration, controls, and the
 * Stake disclaimer when present). Author-supplied `opts.gameInfo` is MERGED over this set by
 * section identity (see `mergeGameInfo`), not wholesale-replaced.
 */
export function defaultGameInfo(model: GameModel, runtime: ShellRuntime): GameInfoContent {
  const sections: GameInfoSection[] = [];
  const max = maxWinSection(model);
  if (max) sections.push(max);
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

/** Recursively run a section's host-derived text (titles + custom HTML/text) through `socialize`.
 *  Only the maximal default sections this module generates are socialized; author content is
 *  left as-is (the merge replaces, so author sections keep their own wording). */
function socializeSection(s: GameInfoSection): GameInfoSection {
  const next = { ...s } as GameInfoSection;
  if ('title' in next && typeof next.title === 'string') {
    (next as { title?: string }).title = socialize(next.title);
  }
  if (next.type === 'custom' && typeof next.html === 'string') {
    (next as { html?: string }).html = socialize(next.html);
  }
  return next;
}

/** Socialize host-derived buy-bonus card copy (title/description) when in social mode; a no-op
 *  otherwise. Used only for the spec-derived options, never for author-supplied `opts.buyBonus`. */
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
  // Socialize the HOST-derived text first (titles + custom HTML), THEN merge author sections over
  // it — so the built-in info copy gets the social vocabulary while author content stays verbatim.
  let derived = defaultGameInfo(model, runtime);
  if (isSocial) derived = { sections: (derived.sections ?? []).map(socializeSection) };
  const gameInfo = mergeGameInfo(derived, opts.gameInfo);
  // Buy-bonus cards: socialize ONLY the host-derived options (from the spec); author-supplied
  // `opts.buyBonus` stays verbatim, like other author content.
  const buyBonus = opts.buyBonus ?? socializeBonusOptions(toBonusOptions(model), isSocial);
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
