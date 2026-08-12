// packages/game-engine/src/host/buildConfig.ts
import type { GameApplicationConfig } from '../types';
import { ScaleMode, Orientation } from '../types';
import type { CreateSlotGameOptions } from './types';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

/**
 * Pure: map host options to a GameApplicationConfig with sane defaults.
 * `isStakeNow` / `isArtubeNow` are computed by the orchestrator (kept out of
 * here so this stays a pure, renderer-free function).
 *
 * Both host bridges run IN-PROCESS with the game, so either one means the SDK
 * must be in `devMode` — that is what makes it talk over the in-memory channel
 * the bridge listens on instead of postMessage-ing an outer host that isn't
 * there. (`dev` is the third, unrelated reason for the same flag: DevBridge.)
 */
export function buildAppConfig<T extends SlotSpinResultBase = SlotSpinResultBase>(
  opts: CreateSlotGameOptions<T>,
  isStakeNow: boolean,
  isArtubeNow = false,
): GameApplicationConfig {
  return {
    container: opts.container ?? '#game',
    designWidth: opts.design?.width ?? 1920,
    designHeight: opts.design?.height ?? 1080,
    scaleMode: opts.scaleMode ?? ScaleMode.FILL,
    orientation: opts.orientation ?? Orientation.ANY,
    // MERGED, not replaced. `opts.loading ?? {…}` looked equivalent and was not: a game that
    // passes ANY loading option loses every default it did not restate, so `{ minDisplayTime: 900 }`
    // silently re-armed tap-to-start (the engine's own default for that flag is `true`, for
    // backwards compatibility with direct GameApplication users). The Artube target made it
    // visible — a game supplying only `externalOverlay` waited for a tap there and nowhere else,
    // i.e. the same source line behaved differently per platform. Spreading `opts.loading` last
    // keeps every explicit value winning while unset keys stay on the host's defaults.
    loading: { tapToStart: false, minDisplayTime: 600, ...opts.loading },
    manifest: opts.manifest,
    audio: opts.audio,
    pixi: opts.pixi,
    sdk: { devMode: isStakeNow || isArtubeNow || (opts.dev ?? false) },
    debug: opts.dev ?? false,
  };
}
