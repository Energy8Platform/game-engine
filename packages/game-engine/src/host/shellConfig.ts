// packages/game-engine/src/host/shellConfig.ts
import type {
  ShellConfig, ShellMode, CurrencyConfig, GameInfoContent, BonusOption, ShellFeatures,
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

/** Pure: assemble a ShellConfig from the model + runtime context (currency/balance/language/mode). */
export function buildShellConfig(opts: SlotShellOptions, model: GameModel, runtime: ShellRuntime): ShellConfig {
  const betLevels = model.spec.betLevels;
  const defaultBet = model.spec.defaultBet ?? betLevels[0];
  const code = runtime.currency ?? model.spec.currency;
  const currency = opts.currency ?? (code ? currencyConfigFromCode(code) : { symbol: '€', position: 'left' });
  return {
    mount: opts.mount ?? (typeof document !== 'undefined' ? document.body : (undefined as never)),
    language: runtime.language ?? 'en',
    currency,
    gameInfo: opts.gameInfo ?? { sections: [] },
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
