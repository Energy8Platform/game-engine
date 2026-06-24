export type * from './types';
import { PixiGameShell } from './PixiGameShell';
import type { PixiShellConfig } from './types';

let active: PixiGameShell | null = null;

/** Create the Pixi game shell. Like `createGameShell`, only one is active at a time. */
export function createPixiShell(config: PixiShellConfig): PixiGameShell {
  if (active) return active;
  active = new PixiGameShell(config);
  return active;
}

/** Tear down the active Pixi shell (fade out, detach listeners, remove its display objects).
 *  Resolves when removed — mirrors `removeGameShell`. */
export function removePixiShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const shell = active;
  active = null;
  return shell.destroy();
}

export { PixiGameShell };
