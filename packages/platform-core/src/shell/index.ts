export type * from './types';
import { GameShell } from './GameShell';
import type { ShellConfig } from './types';

let active: GameShell | null = null;

export function createGameShell(config: ShellConfig): GameShell {
  if (active) return active;
  active = new GameShell(config);
  return active;
}

export function removeGameShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const shell = active;
  active = null;
  return shell.destroy();
}

export { GameShell };
export { socialize } from './i18n';
