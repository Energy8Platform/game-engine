import { createShell } from '@/core';
import { PixiHbRenderer } from '../pixi-hb/PixiHbRenderer';
import type { PixiShellConfig, PixiGameShell } from '../pixi-hb';
import { SideBar } from './SideBar';
import { installSFont } from './text';

// The S shell: HB's renderer and overlays (menu, game info, buy bonus, pickers, modals) with the S
// side-column bar. Same config, events and surface as every shell — a game switches with
// `shellFactory: createPixiSShell`.

export type { PixiShellConfig, PixiGameShell, PixiShellSurface, BonusOption, GameInfoSection } from '../pixi-hb';

let active: PixiGameShell | null = null;

/** Create the S game shell. Like `createPixiHbShell`, only one is active at a time — returns the
 *  existing instance if one is. */
export function createPixiSShell(config: PixiShellConfig): PixiGameShell {
  if (active) return active;
  installSFont(); // before the renderer mounts: its first render waits on document.fonts.ready
  const renderer = new PixiHbRenderer({ app: config.app, parent: config.parent, bar: (ctx) => new SideBar(ctx) });
  active = createShell({ ...config, renderer });
  return active;
}

/** Tear down the active S shell (fade out, detach listeners, remove its display objects). */
export function removePixiSShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const shell = active;
  active = null;
  return shell.destroy();
}

export { S } from './theme';
export * from '@/core';
