/**
 * The form the IDE draws for the `shell1` row — `e8.runtime.schema` in this
 * package's manifest. Imported by the IDE HOST (a node process), so this
 * module imports `schemastery` and nothing else — `./index` pulls in
 * `pixi.js` and the shell. The row is `hot: false`: a shell is built once
 * from its config, so an edit here restarts the game.
 *
 * Lenient on purpose (spec §2, §4): the shell's nested structures —
 * `gameInfo`, `menu`, `buyBonus`, `theme` — are `any` with a description,
 * and the form shows them as YAML. A key this schema does not name (a
 * legacy `tiers`, say) survives validation untouched — schemastery keeps
 * unknown keys, measured — so a project's YAML never fails over one; it
 * just reaches nothing. Everything the SESSION decides (the bet ladder,
 * the balance, the currency) is not here at all: `session.init` feeds it
 * at apply time (see `./config`).
 *
 * A blank YAML value (`theme:` with nothing after it) arrives as `null`:
 * a field WITH a default resolves to that default, a field without one
 * keeps the `null` — `./config` turns those into `undefined` so the shell
 * sees "unset", not a value it would dereference.
 */
import Schema from 'schemastery';

export const Config = Schema.object({
  language: Schema.string()
    .default('')
    .description("UI language (de, en, es, …). Empty: the session's language, else en"),
  version: Schema.string()
    .default('1.0.0')
    .description('game version shown in the game-info footer'),
  features: Schema.object({
    turbo: Schema.natural()
      .max(3)
      .default(1)
      .description('turbo levels the bar cycles through: 0 (none) to 3'),
    autoplay: Schema.any()
      .default({})
      .description('autoplay limits ({} for the default presets, { maxCount } to cap them, false to disable)'),
    buyBonus: Schema.any()
      .default(false)
      .description('buy-bonus options ([{ id, title, cost, … }]) or false for no BUY BONUS button'),
    hotkeys: Schema.boolean().description(
      'keyboard shortcuts on/off; unset lets the shell decide by device (a mobile session turns them off regardless)',
    ),
    spacebar: Schema.boolean().description('spacebar spins in base mode (default on)'),
  }).description('what the bar offers'),
  gameInfo: Schema.any()
    .default({ sections: [] })
    .description('game-info overlay content: { sections: [...] } (rules, paytable, hotkeys, custom)'),
  menu: Schema.any().description('bar-menu rows in order; unset for the default list (sound, music, sfx, game info)'),
  i18n: Schema.any()
    .default({})
    .description('reserved — per-game translations; the Pixi shell has no hook for them yet'),
  theme: Schema.any().description('shell theme overrides ({ accent, scheme, … })'),
});

export type Config = ReturnType<typeof Config>;
