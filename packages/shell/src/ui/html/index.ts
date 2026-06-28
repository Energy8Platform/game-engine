import { createShell, ShellController } from '@/core';
import type { ShellConfig } from '@/core/types';
import { HtmlRenderer } from './HtmlRenderer';

export interface HtmlShellConfig extends ShellConfig {
  mount: HTMLElement;
}

let active: ShellController | null = null;

/** Drop-in replacement for the platform-core createGameShell.
 *  Singleton: returns the existing shell if already created. */
export function createGameShell(config: HtmlShellConfig): ShellController {
  if (active) return active;
  active = createShell({ ...config, renderer: new HtmlRenderer({ mount: config.mount }) });
  return active;
}

/** Tear down the active shell (no argument — singleton). Resolves immediately when nothing is active. */
export function removeGameShell(): Promise<void> {
  if (!active) return Promise.resolve();
  const shell = active;
  active = null;
  return shell.destroy();
}

export { HtmlRenderer };
export { ShellController as GameShell };
export * from '@/core';

// Re-export socialize/createI18n/normalizeLang/Lang to mirror platform-core/src/shell/index.ts.
// They are already re-exported by `@/core` (which includes i18n), so the above wildcard covers it.

// HTML-typed narrowed aliases (node = HTMLElement rather than unknown)
export type { BonusOption, GameInfoSection } from '@/core/types';
export type { HtmlShellConfig as ShellConfig };
