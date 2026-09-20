/**
 * The one mapping the row makes: `session.init` (what the platform said —
 * balance, ladder, currency, language, device) plus the row's own config
 * (what the author said — features, game info, theme) into the
 * `ShellConfig` the Pixi shell is built from. Pure, so `tests/config.test.ts`
 * pins it without a shell or a context.
 *
 * `i18n` from the Config is NOT mapped: it is not a `ShellConfig` field.
 * The shell's `createI18n` does take a `messages` table, but
 * `ShellController` never passes one through from its config; it stays in
 * the schema as "reserved" so a project's YAML survives, and passes nowhere.
 *
 * Every optional field the schema leaves without a default (`theme`,
 * `menu`, `hotkeys`, `spacebar`) is `?? undefined`-ed here: a blank YAML
 * `theme:` is `null` after validation, and the shell's `resolveTheme(theme
 * = {})` only defaults an `undefined` — a `null` reached `null.scheme` and
 * took the whole row down with it.
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
      // The schema bounds it to 0..3 (`natural().max(3)`); schemastery
      // still types it `number`, so the cast is what tells the shell.
      turbo: config.features.turbo as 0 | 1 | 2 | 3,
      // `|| null`, not `??`: schemastery turns a YAML `null` into the
      // field's default (`{}`), so `false` is the only spelling of "off" a
      // config has — and the shell reads `autoplay != null` as "on".
      autoplay: config.features.autoplay || null,
      buyBonus: config.features.buyBonus || false,
      // The legacy host's rule (`packages/game-engine/src/host/shellConfig.ts`):
      // a phone has no keys to press, so a mobile session turns hotkeys off
      // OVER the author's setting — a game cannot opt out of the hardware.
      // Anywhere else an unset value lets the shell measure the client.
      hotkeys: init.device === 'mobile' ? false : (config.features.hotkeys ?? undefined),
      spacebar: config.features.spacebar ?? undefined,
    },
    gameInfo: config.gameInfo,
    menu: config.menu ?? undefined,
    theme: config.theme ?? undefined,
  };
}
