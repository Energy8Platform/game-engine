// packages/game-engine/src/host/buildConfig.ts
import type { GameApplicationConfig } from '../types';
import { ScaleMode, Orientation } from '../types';
import type { CreateSlotGameOptions } from './types';

/**
 * Pure: map host options to a GameApplicationConfig with sane defaults.
 * `isStakeNow` is computed by the orchestrator (kept out of here so this
 * stays a pure, renderer-free function).
 */
export function buildAppConfig(
  opts: CreateSlotGameOptions,
  isStakeNow: boolean,
): GameApplicationConfig {
  return {
    container: opts.container ?? '#game',
    designWidth: opts.design?.width ?? 1920,
    designHeight: opts.design?.height ?? 1080,
    scaleMode: opts.scaleMode ?? ScaleMode.FILL,
    orientation: opts.orientation ?? Orientation.ANY,
    loading: opts.loading ?? { tapToStart: false, minDisplayTime: 600 },
    manifest: opts.manifest,
    audio: opts.audio,
    pixi: opts.pixi,
    sdk: { devMode: isStakeNow || (opts.dev ?? false) },
    debug: opts.dev ?? false,
  };
}
