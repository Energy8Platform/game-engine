/**
 * `@energy8platform/game-engine/harness` — node-only entry.
 *
 * Contributes the reel-config **panel** to `@energy8platform/harness`: a docked
 * right sidebar that tunes a running game's ReelSystem live. Pair it with
 * `mountReelDevBridge` (from `@energy8platform/game-engine/devtools`) in the game.
 *
 * Usage in a game's vite.config:
 *   import { createHarness } from '@energy8platform/harness';
 *   import { reelDevtoolsPlugin } from '@energy8platform/game-engine/harness';
 *   createHarness({ plugins: [ reelDevtoolsPlugin() ] });
 *
 * Node-only: resolves the built, self-contained panel-client ESM the harness serves.
 */

import { fileURLToPath } from 'node:url';

import type { HarnessPanel, HarnessPlugin } from '@energy8platform/harness';

export interface ReelDevtoolsPluginOptions {
  /** Sidebar header / tab label. Default 'Reels'. */
  title?: string;
}

export function reelDevtoolsPlugin(opts: ReelDevtoolsPluginOptions = {}): HarnessPlugin {
  // The self-contained panel client sits next to this module in dist/.
  const clientEntry = fileURLToPath(new URL('./reel-panel-client.esm.js', import.meta.url));
  const panel: HarnessPanel = {
    id: 'reels',
    title: opts.title ?? 'Reels',
    placement: 'sidebar',
    clientEntry,
  };
  return { panel };
}
