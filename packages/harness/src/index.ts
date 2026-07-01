/**
 * `@energy8platform/harness` — renderer- and platform-agnostic dev harness.
 *
 * Node-only entry: the `createHarness()` vite plugin plus the contracts a
 * backend/panel plugin implements. Backends (e.g. Stake RGS) and panels (e.g.
 * the reel-config sidebar) live in their own packages and plug in here.
 */

export { createHarness } from './plugin';
export { SCREEN_PRESETS, screenPreset } from './screens';
export type { ScreenPreset } from './screens';
export { LANGS } from './langs';
export type { LangEntry } from './langs';

export type {
  CreateHarnessOptions,
  HarnessPlugin,
  HarnessBackend,
  HarnessBackendInfo,
  HarnessDescribeContext,
  HarnessMode,
  HarnessPanel,
  PanelPlacement,
  HarnessServer,
  HarnessServerContext,
  IncomingLike,
  OutgoingLike,
  WrapperData,
  WrapperPanelInfo,
} from './types';

export type { HarnessPanelContext, HarnessPanelMount } from './panel';
