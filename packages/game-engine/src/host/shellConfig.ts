// packages/game-engine/src/host/shellConfig.ts
import type {
  ShellConfig, ShellMode, CurrencyConfig, GameInfoContent, BonusOption, ShellFeatures,
} from '@energy8platform/platform-core/shell';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { WinTier } from '../slot';

export interface SlotShellOptions {
  mount?: HTMLElement;
  currency: CurrencyConfig;
  gameInfo: GameInfoContent;
  buyBonus?: BonusOption[];
  tiers?: WinTier[];
  features?: Partial<ShellFeatures>;
}

/** Pure: assemble a ShellConfig from the model + runtime balance + mode. */
export function buildShellConfig(
  opts: SlotShellOptions,
  model: GameModel,
  balance: number,
  mode: ShellMode,
): ShellConfig {
  const betLevels = model.spec.betLevels;
  const defaultBet = model.spec.defaultBet ?? betLevels[0];
  return {
    mount: opts.mount ?? (typeof document !== 'undefined' ? document.body : (undefined as never)),
    language: 'en',
    currency: opts.currency,
    gameInfo: opts.gameInfo,
    availableBets: [...betLevels],
    defaultBet,
    currentBet: defaultBet,
    balance,
    win: 0,
    mode,
    features: {
      turbo: 0,
      spacebar: true,
      autoplay: {},
      ...(opts.buyBonus ? { buyBonus: opts.buyBonus } : {}),
      ...(opts.features ?? {}),
    } as ShellFeatures,
  };
}
