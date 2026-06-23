/**
 * `@energy8platform/stake-kit/harness` — node-only entry.
 *
 * The dev-harness vite plugin plus its building blocks. Node builtins, `vite`,
 * and `@energy8platform/*` are externalised in the rollup build; this entry is
 * NOT pulled into the browser stake-kit bundle.
 */

export { stakeHarnessPlugin } from './plugin';
export type { StakeHarnessPluginOptions } from './plugin';

export { renderWrapperHtml } from './wrapper';
export type { WrapperConfig, WrapperMode } from './wrapper';

export { SCREEN_PRESETS, screenPreset, buildLaunchUrl } from './bar';
export type { ScreenPreset, LaunchOpts } from './bar';

export { createDevRgs, NoBooksError } from './dev-rgs';
export type { DevRgs, DevRgsConfig } from './dev-rgs';

export { handleRgsRequest } from './rgs-http';
export type { RgsRequest, RgsResult, LuaPlay } from './rgs-http';

export { loadIndex, hasBooks, pickWeighted, readBook } from './books';
export type { BookMode, LutRow } from './books';
