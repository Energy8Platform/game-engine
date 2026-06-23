// packages/game-engine/src/host/shellConfig.ts
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
  /** Extra info sections (override — replaces any derived ones). */
  gameInfo?: GameInfoContent;
  /** Override the derived buy/ante options. */
  buyBonus?: BonusOption[];
  tiers?: WinTier[];
  features?: Partial<ShellFeatures>;
}

/** Runtime context from the SDK handshake (initData) + the resolved mode. */
export interface ShellRuntime {
  balance: number;
  currency?: string;   // currency CODE from initData (e.g. 'EUR')
  language?: string;
  mode: ShellMode;
  /** Social-casino mode from initData (`config.socialMode`); swaps shell vocabulary. */
  social?: boolean;
  /** Stake-required disclaimer lines from initData (`config.disclaimerLines`); when
   *  absent (non-stake/dev) no disclaimer section is rendered. */
  disclaimerLines?: string[];
}

const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€', USD: '$', GBP: '£', JPY: '¥', BRL: 'R$', CAD: '$', AUD: '$', INR: '₹',
};

/** Map a currency code to a shell CurrencyConfig (symbol left, code as the fallback symbol). */
export function currencyConfigFromCode(code: string): CurrencyConfig {
  return { symbol: CURRENCY_SYMBOL[code] ?? code, position: 'left' };
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
 * Stake disclaimer when present). Author-supplied `opts.gameInfo` REPLACES this entirely
 * (documented override semantics).
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

/** Pure: assemble a ShellConfig from the model + runtime context (currency/balance/language/mode). */
export function buildShellConfig(opts: SlotShellOptions, model: GameModel, runtime: ShellRuntime): ShellConfig {
  const betLevels = model.spec.betLevels;
  const defaultBet = model.spec.defaultBet ?? betLevels[0];
  const code = runtime.currency ?? model.spec.currency;
  const currency = opts.currency ?? (code ? currencyConfigFromCode(code) : { symbol: '€', position: 'left' });
  return {
    mount: opts.mount ?? (typeof document !== 'undefined' ? document.body : (undefined as never)),
    language: runtime.language ?? 'en',
    isSocial: runtime.social ?? false,
    currency,
    gameInfo: opts.gameInfo ?? defaultGameInfo(model, runtime),
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
      buyBonus: opts.buyBonus ?? toBonusOptions(model),
      ...(opts.features ?? {}),
    } as ShellFeatures,
  };
}
