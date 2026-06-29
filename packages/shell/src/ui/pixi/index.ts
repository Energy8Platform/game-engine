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

let active: ShellController | null = null;

/** Create the Pixi game shell. Like `createGameShell`, only one is active at a time. Returns the
 *  existing instance if one is already active. */
export function createPixiShell(config: PixiShellConfig): ShellController {
  if (active) return active;
  const { app, parent, ...shell } = config;
  active = createShell({ ...shell, renderer: new PixiRenderer({ app, parent }) });
  return active;
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
/** Alias kept for parity with the legacy `@energy8platform/pixi-shell` public surface, where the
 *  shell class WAS the host. Here the host/brain is the renderer-agnostic ShellController. */
export { ShellController as PixiGameShell };
export * from '@/core';
