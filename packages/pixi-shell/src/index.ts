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

/** Tear down the active Pixi shell (detaches listeners, removes its display objects). */
export function removePixiShell(): void {
  if (!active) return;
  const shell = active;
  active = null;
  shell.destroy();
}

export { PixiGameShell };
