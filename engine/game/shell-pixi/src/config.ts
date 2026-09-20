/**
 * The one mapping the row makes: `session.init` (what the platform said —
 * balance, ladder, currency, language) plus the row's own config (what the
 * author said — features, game info, theme) into the `ShellConfig` the Pixi
 * shell is built from. Pure, so `tests/config.test.ts` pins it without a
 * shell or a context.
 *
 * `i18n` and `tiers` from the Config are NOT mapped: neither is a
 * `ShellConfig` field. The shell's `createI18n` does take a `messages`
 * table, but `ShellController` never passes one through from its config,
 * and `tiers` belonged to the legacy `createSlotGame` host's own big-win
 * overlay. Both stay in the schema as "reserved" so a project's YAML
 * survives, and pass nowhere.
 */
import type { SessionInit } from '@energy8engine/contracts';
import type { PixiShellConfig } from '@energy8platform/shell/pixi';
import type { Config } from './schema';

export function toShellConfig(config: Config, init: SessionInit): Omit<PixiShellConfig, 'app' | 'parent'> {
  return {
    availableBets: init.betLevels,
    defaultBet: init.defaultBet,
    currentBet: init.defaultBet,
    balance: init.balance,
    win: 0,
    mode: 'base',
    currency: {
      symbol: init.currency.symbol,
      position: init.currency.position,
      maxDecimals: init.currency.decimals,
    },
    language: config.language || init.language || 'en',
    version: config.version,
    features: {
      turbo: config.features.turbo as 0 | 1 | 2 | 3,
      // `|| null`, not `??`: schemastery turns a YAML `null` into the
      // field's default (`{}`), so `false` is the only spelling of "off" a
      // config has — and the shell reads `autoplay != null` as "on".
      autoplay: config.features.autoplay || null,
      buyBonus: config.features.buyBonus || false,
      hotkeys: config.features.hotkeys,
      spacebar: config.features.spacebar,
    },
    gameInfo: config.gameInfo,
    menu: config.menu,
    theme: config.theme,
  };
}
