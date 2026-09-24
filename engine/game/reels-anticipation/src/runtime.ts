/**
 * Runtime half of `reels-anticipation` — the `anticipation1` row.
 *
 * `ctx.reels` (from `@energy8engine/reels`, `reels1`) has no opinion on
 * which reels get the anticipation treatment on a spin — with no
 * anticipator set, `ReelSystem.spin` never slows down for a trailing
 * scatter hunt (see `ReelSystem.resolveAnticipation`'s `none` fallback).
 * This row supplies one: `createAnticipator(config)`
 * (`@energy8engine/reel-core`, the config-driven trigger-symbol counter)
 * set onto `ctx.reels.anticipation`.
 *
 * `ctx.inject(['reels'], …)`, not a static `inject` field, for the same
 * reason as `reels-motion`: `reels1` is `hot: true`, and a hot re-apply
 * provides a NEW `reels` service — the callback re-runs against it, so
 * the anticipator lands on the fresh one too.
 */
import type { Context } from 'cordis';
import {
  createAnticipator,
  DEFAULT_REEL_CONFIG,
  mergeReelConfig,
  type AnticipationConfig,
  type DeepPartial,
} from '@energy8engine/reel-core';
import type {} from '@energy8engine/reels/runtime';

export const name = 'reels-anticipation';

/**
 * `config` is merged over `DEFAULT_REEL_CONFIG.anticipation`: the loader hands a row its config
 * verbatim, and a bundle row no patch configures arrives as `{}` — nothing runs `./schema`'s
 * defaults on the way, so the row fills them itself.
 */
export function apply(ctx: Context, config: DeepPartial<AnticipationConfig>): void {
  const anticipation = mergeReelConfig(DEFAULT_REEL_CONFIG.anticipation, config);
  ctx.inject(['reels'], (c) => {
    c.effect(() => c.reels.anticipation.set(createAnticipator(anticipation)), 'reels-anticipation');
  });
}
