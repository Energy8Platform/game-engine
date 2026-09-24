/**
 * Runtime half of `reels-features` — the `features1` row in `e8-base`.
 *
 * Registers the nine feature step handlers (`./handlers/*`) into play-loop's `ctx.steps` — one
 * per kind, skipping a kind whose section has `enabled: false` — and owns the one thing they
 * share but none of them owns alone: the row's overlay layer (`./layer`), which `sticky` rings
 * and the `giant` view live on so they outlive a single run (see `./shared`'s module doc). The
 * row also wires the layer's `clearGiants()` to `ReelSystem.onSpinStart` — a giant left over from
 * the previous spin is gone before the next one's reels move, the same way the legacy
 * `GiantSymbol` demo cleared on its own spin handler.
 *
 * **Two separate `ctx.inject` calls, not one.** The layer needs `reels` (it sits on
 * `kit().grid`); the handlers need `steps`. They compose in either order relative to `reels1` and
 * `playloop1`, or without one of them (a handler throws its own "needs the reel system" /
 * "needs the row's overlay layer" diagnostic at RUN time instead, same as `reels-cascade`'s
 * `reelStep` does for a missing `reels`). `e8.runtime.requires: ["steps"]` (this package's
 * `package.json`) is what turns a missing `playloop1` into a diagnostic naming this row instead
 * of nine silent no-op `inject` callbacks.
 *
 * **`ctx.inject`, not this row's own static `inject` field.** `reels1` is `hot: true`: a hot
 * re-apply provides a NEW `ReelSystem` (a new grid), and the `['reels']` callback re-runs against
 * it — a fresh, empty overlay layer on the new grid, the old one already torn down with the
 * effect it replaced. The nine handlers themselves need no such re-registration: `deps.reels()`
 * and `deps.layer()` are read per call (never captured), so the same registered handlers keep
 * working against whichever `ReelSystem`/layer is current — see `./shared`'s `FeatureDeps` doc.
 *
 * **The handler array is built once, before either `inject`.** It does not depend on `reels` or
 * `steps` being present yet — only on `merged`, this row's own config — so there is nothing to
 * gain by deferring it, and building it once keeps the two effects to exactly what they own.
 */
import type { Context } from 'cordis';
import { mergeReelConfig, type DeepPartial } from '@energy8engine/reel-core';
import type { StepHandler } from '@energy8engine/play-loop';
import type {} from '@energy8engine/reels/runtime';
import type {} from '@energy8engine/play-loop/runtime';
import { Config } from './schema';
import { createOverlayLayer, type OverlayLayer } from './layer';
import type { FeatureDeps } from './shared';
import { createExpandWildHandler, type ExpandWildConfig } from './handlers/expandWild';
import { createWalkWildHandler, type WalkWildConfig } from './handlers/walkWild';
import { createDropWildsHandler, type DropWildsConfig } from './handlers/dropWilds';
import { createRevealHandler, type RevealConfig } from './handlers/reveal';
import { createTransformHandler, type TransformConfig } from './handlers/transform';
import { createMultipliersHandler, type MultipliersConfig } from './handlers/multipliers';
import { createStickyHandler, type StickyConfig } from './handlers/sticky';
import { createGiantHandler, type GiantConfig } from './handlers/giant';
import { createNudgeHandler, type NudgeConfig } from './handlers/nudge';

export const name = 'reels-features';

/** One section per kind — each the handler's own config plus the switch `./schema` adds it. */
export interface FeaturesRowConfig {
  expandWild: ExpandWildConfig & { enabled: boolean };
  walkWild: WalkWildConfig & { enabled: boolean };
  dropWilds: DropWildsConfig & { enabled: boolean };
  reveal: RevealConfig & { enabled: boolean };
  transform: TransformConfig & { enabled: boolean };
  multipliers: MultipliersConfig & { enabled: boolean };
  sticky: StickyConfig & { enabled: boolean };
  giant: GiantConfig & { enabled: boolean };
  nudge: NudgeConfig & { enabled: boolean };
}

/** `./schema`'s own defaults — the one place these nine kinds' defaults are stated (see its doc). */
const DEFAULTS = Config({}) as FeaturesRowConfig;

/**
 * `config` is merged over `DEFAULTS`: the loader hands a row its config verbatim, and a bundle
 * row no patch configures arrives as `{}` — nothing runs `./schema`'s defaults on the way, so the
 * row fills them itself (same rule as `reels-cascade`'s `apply`).
 */
export function apply(ctx: Context, config: DeepPartial<FeaturesRowConfig>): void {
  const merged = mergeReelConfig(DEFAULTS, config);

  let layer: OverlayLayer | undefined;

  const depsFor = <C>(get: () => C): FeatureDeps<C> => ({
    reels: () => ctx.reflect.get('reels', false),
    config: get,
    layer: () => layer,
  });

  /** A section's handler, or nothing when that kind is switched off. */
  const handler = <C>(
    create: (deps: FeatureDeps<C>) => StepHandler,
    section: { enabled: boolean },
    get: () => C,
  ): StepHandler | undefined => (section.enabled ? create(depsFor(get)) : undefined);

  const enabledHandlers: StepHandler[] = [
    handler(createExpandWildHandler, merged.expandWild, () => merged.expandWild),
    handler(createWalkWildHandler, merged.walkWild, () => merged.walkWild),
    handler(createDropWildsHandler, merged.dropWilds, () => merged.dropWilds),
    handler(createRevealHandler, merged.reveal, () => merged.reveal),
    handler(createTransformHandler, merged.transform, () => merged.transform),
    handler(createMultipliersHandler, merged.multipliers, () => merged.multipliers),
    handler(createStickyHandler, merged.sticky, () => merged.sticky),
    handler(createGiantHandler, merged.giant, () => merged.giant),
    handler(createNudgeHandler, merged.nudge, () => merged.nudge),
  ].filter((h): h is StepHandler => h !== undefined);

  ctx.inject(['reels'], (c) => {
    c.effect(() => {
      layer = createOverlayLayer(c.reels.kit());
      const off = c.reels.onSpinStart(() => layer?.clearGiants());
      return () => {
        off();
        layer?.destroy();
        layer = undefined;
      };
    }, 'reels-features:layer');
  });

  ctx.inject(['steps'], (c) => {
    c.effect(() => {
      const offs = enabledHandlers.map((h) => c.steps.register(h));
      return () => offs.forEach((f) => f());
    }, 'reels-features:steps');
  });
}
