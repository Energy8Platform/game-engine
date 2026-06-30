import type { Application, Container } from 'pixi.js';
import { createShell, ShellController } from '@/core';
import type { ShellConfig, BonusOption as CoreBonusOption, BonusCardContext, GameInfoSection as CoreGameInfoSection } from '@/core/types';
import { PixiRenderer } from './PixiRenderer';

/** Config for the Pixi shell: the renderer-agnostic ShellConfig plus the Pixi mount target.
 *  `app` is the PixiJS Application; `parent` (defaults to `app.stage`) is where the shell root
 *  attaches. */
export interface PixiShellConfig extends ShellConfig {
  app: Application;
  parent?: Container;
}

/** A bonus-buy option whose `custom` card renderer returns a Pixi `Container` (vs core's `unknown`
 *  / ui/html's `HTMLElement`). */
export interface BonusOption extends CoreBonusOption {
  custom?: (ctx: BonusCardContext) => Container;
}

/** A `custom` game-info section renders a game-supplied Pixi `Container` (`node`). The other section
 *  kinds are unchanged from core. */
export type GameInfoSection =
  | Exclude<CoreGameInfoSection, { type: 'custom' }>
  | { type: 'custom'; title?: string; order?: number; node?: Container; html?: string };

/** The Pixi-specific surface that game scenes use to position themselves correctly. */
export interface PixiShellSurface {
  /** Insets a scene should avoid (only the bottom bar is reserved). */
  readonly safeArea: { top: number; right: number; bottom: number; left: number };
  /** Height of the bottom control bar in px. */
  readonly barHeight: number;
  /** Show/hide the whole shell (bar + overlays). */
  setVisible(visible: boolean): void;
}

/** The Pixi shell handle: the renderer-agnostic controller + the Pixi-only surface game scenes use. */
export type PixiGameShell = ShellController & PixiShellSurface;

let active: PixiGameShell | null = null;

/** Create the Pixi game shell. Like `createGameShell`, only one is active at a time. Returns the
 *  existing instance if one is already active. */
export function createPixiShell(config: PixiShellConfig): PixiGameShell {
  if (active) return active;
  const renderer = new PixiRenderer({ app: config.app, parent: config.parent });
  const shell = createShell({ ...config, renderer }) as PixiGameShell;
  Object.defineProperties(shell, {
    safeArea:   { get: () => renderer.safeArea, enumerable: true },
    barHeight:  { get: () => renderer.barHeight, enumerable: true },
    setVisible: { value: (v: boolean) => renderer.setVisible(v), enumerable: true },
  });
  active = shell;
  return shell;
}

/** Tear down the active Pixi shell (fade out, detach listeners, remove its display objects).
 *  Resolves when removed — mirrors `removePixiShell` in the legacy package. */
export function removePixiShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const shell = active;
  active = null;
  return shell.destroy();
}

export { PixiRenderer };
export * from '@/core';
