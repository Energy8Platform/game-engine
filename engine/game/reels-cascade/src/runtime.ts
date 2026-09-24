/**
 * Runtime half of `reels-cascade` — the `cascade1` row.
 *
 * Registers the two cascade-family plays the reel system does not perform itself:
 *  - the `tumble` board controller (`tumbleController`, `@energy8engine/reel-core`) into
 *    `ctx.reels.controllers` — `ReelSystem.cascade` delegates a `tumble` step to it, and throws
 *    `no reels-cascade row` without one;
 *  - the `reelStep` step handler (`./reel-step`) into play-loop's `ctx.steps`.
 *
 * The row's presence is the cascade switch (spec §3.3): its config carries no `enabled`
 * (see `./schema`), and both controllers are handed `{ ...config, enabled: true }` — the forked
 * controllers read `cfg.enabled` only as an instant-settle shortcut.
 *
 * `ctx.inject([...], …)`, not a static `inject` field: `reels1` is `hot: true`, and a hot
 * re-apply provides a NEW `reels` — the callback re-runs against it. And the row composes in
 * either order relative to `reels1`/`playloop1`, or without them.
 */
import type { Context } from 'cordis';
import {
  DEFAULT_REEL_CONFIG,
  mergeReelConfig,
  tumbleController,
  type CascadeConfig,
  type DeepPartial,
} from '@energy8engine/reel-core';
import type {} from '@energy8engine/reels/runtime';
import type {} from '@energy8engine/play-loop/runtime';
import { createReelStepHandler } from './reel-step';

export const name = 'reels-cascade';

/** `CascadeConfig` without `enabled` — see the module doc. */
export type CascadeRowConfig = Omit<CascadeConfig, 'enabled'>;

/**
 * `config` is merged over `DEFAULT_REEL_CONFIG.cascade`: the loader hands a row its config
 * verbatim, and a bundle row no patch configures arrives as `{}` — nothing runs `./schema`'s
 * defaults on the way, so the row fills them itself.
 */
export function apply(ctx: Context, config: DeepPartial<CascadeRowConfig>): void {
  const merged = mergeReelConfig(DEFAULT_REEL_CONFIG.cascade, config);
  const cascade = (): CascadeConfig => ({ ...merged, enabled: true });

  ctx.inject(['reels'], (c) => {
    c.effect(
      () => c.reels.controllers.register(tumbleController(cascade())),
      'reels-cascade:tumble',
    );
  });

  ctx.inject(['steps'], (c) => {
    c.effect(
      () =>
        c.steps.register(
          createReelStepHandler({
            reels: () => ctx.reflect.get('reels', false),
            cascade,
          }),
        ),
      'reels-cascade:reelStep',
    );
  });
}
