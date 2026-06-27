import { ShellController, type CreateShellOptions } from './ShellController';

/** Create a shell with an explicit renderer instance (custom or a built-in HtmlRenderer/PixiRenderer).
 *  Built-in renderers also have the createGameShell/createPixiShell sugar in /html and /pixi. */
export function createShell(opts: CreateShellOptions): ShellController {
  return new ShellController(opts);
}

export { ShellController, resolveConfig } from './ShellController';
export type { CreateShellOptions } from './ShellController';
export * from './renderer';
export * from './types';
export { resolveTheme, SCHEMES, DEFAULT_ACCENT } from './theme';
export type { ShellTokens } from './theme';
export { createI18n, socialize, normalizeLang } from './i18n';
export type { Lang, I18n, I18nOptions } from './i18n';
export { PACKAGE_VERSION } from './version';
