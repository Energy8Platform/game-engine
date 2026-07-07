/**
 * `@energy8platform/stake-kit/harness` — node-only entry.
 *
 * The Stake **backend** plugin for `@energy8platform/harness` plus its building
 * blocks (dev-RGS, RGS HTTP glue, book loading). Node builtins, `vite`, and
 * `@energy8platform/*` are externalised in the rollup build; this entry is NOT
 * pulled into the browser stake-kit bundle.
 *
 * Usage in a game's vite.config:
 *   import { createHarness } from '@energy8platform/harness';
 *   import { stakeRgsPlugin } from '@energy8platform/stake-kit/harness';
 *   createHarness({ plugins: [ stakeRgsPlugin({ config: './math.config.ts', booksDir: 'stake-math' }) ] });
 */

export { stakeRgsPlugin, runSpinRound } from './plugin';
export type { StakeRgsPluginOptions } from './plugin';

export { createDevRgs, NoBooksError } from './dev-rgs';
export type { DevRgs, DevRgsConfig } from './dev-rgs';

export { handleRgsRequest } from './rgs-http';
export type { RgsRequest, RgsResult, LuaPlay } from './rgs-http';

export { loadIndex, hasBooks, pickWeighted, readBook } from './books';
export type { BookMode, LutRow } from './books';
