import { ShellController, type CreateShellOptions } from './ShellController';
import type { ShellSurface, SafeArea } from './renderer';

/** A shell: the renderer-agnostic controller plus the surface facade (safeArea/barHeight/setVisible)
 *  an embedding host reads. `createShell`, `createGameShell` and `createPixiShell` all return this. */
export type Shell = ShellController & ShellSurface;

const NO_INSET: SafeArea = { top: 0, right: 0, bottom: 0, left: 0 };

/** Create a shell with an explicit renderer instance (custom or a built-in HtmlRenderer/PixiRenderer).
 *  Built-in renderers also have the createGameShell/createPixiShell sugar in /html and /pixi.
 *
 *  The returned controller is augmented with the `ShellSurface` facade, delegating to the renderer's
 *  optional surface members (inert defaults when it has none) — so any renderer, custom included, is
 *  drivable by an embedding host (e.g. game-engine's createSlotGame) without Pixi-specific glue. */
export function createShell(opts: CreateShellOptions): Shell {
  const controller = new ShellController(opts);
  const r = opts.renderer;
  Object.defineProperties(controller, {
    safeArea: { get: () => r.safeArea ?? NO_INSET, enumerable: true, configurable: true },
    barHeight: { get: () => r.barHeight ?? 0, enumerable: true, configurable: true },
    setVisible: { value: (v: boolean) => r.setVisible?.(v), enumerable: true, configurable: true },
  });
  return controller as Shell;
}

export { ShellController, resolveConfig } from './ShellController';
export type { CreateShellOptions } from './ShellController';
export * from './renderer';
export * from './types';
export { DEFAULT_MENU, resolveMenu, seedMenuValues, rangeBounds, isPresetId } from './menu';
export type { MenuItem, MenuRow, MenuHost, MenuPresetId } from './menu';
export { placePopover, popoverWidth, POPOVER } from './popover';
export type { PopoverPlacement, Rect as PopoverRect } from './popover';
export { resolveTheme, SCHEMES, DEFAULT_ACCENT } from './theme';
export type { ShellTokens } from './theme';
export { createI18n, socialize, normalizeLang } from './i18n';
export type { Lang, I18n, I18nOptions } from './i18n';
export { PACKAGE_VERSION } from './version';
