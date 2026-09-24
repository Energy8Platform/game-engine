/**
 * Runtime half of `reels-motion` — the `motion1` row.
 *
 * The reels' own row (`@energy8engine/reels`, `reels1`) builds a
 * `ReelSystem` (`ctx.reels`) with no opinion on HOW the reels spin — with
 * no motion row applied, `ctx.reels.spin` snaps to the result and reports
 * a warning (see `reels`' module doc). This row supplies that: it
 * registers the three built-in motion styles (`BUILTIN_MOTION_STYLES`,
 * `@energy8engine/reel-core`'s forked `SpinEngine` under three keys —
 * `swap`, `strip`, `cascade-drop`) onto `ctx.reels.motions`, then activates
 * one of them (`config.style`) with `ctx.reels.useMotion`.
 *
 * `ctx.inject(['reels'], …)`, not a static `inject` field: `reels1` is
 * `hot: true`, and a hot re-apply un-provides its `reels` service and
 * provides a NEW one (see `reels`' module doc). The callback re-runs
 * against the fresh service, so the registrations and the active pick
 * land on it too — a static dependency would only ever see the first one.
 *
 * One `ctx.effect` wraps both the three registrations and the `useMotion`
 * pick, so a hot re-apply of THIS row (or its `reels` dependency going
 * away) tears down all four in one disposer.
 */
import type { Context } from 'cordis';
import { BUILTIN_MOTION_STYLES, type MotionConfig } from '@energy8engine/reel-core';
import type {} from '@energy8engine/reels/runtime';

export const name = 'reels-motion';

/**
 * The row's config — a full `MotionConfig`. `style` pulls double duty:
 * it is both a `MotionConfig` field (folded into the style's own runner —
 * see `BUILTIN_MOTION_STYLES`) and this row's pick of which REGISTERED
 * style key to activate via `useMotion`.
 */
export type MotionRowConfig = MotionConfig;

/** The row's config is already a `MotionConfig` — `useMotion`'s second argument, verbatim. */
function motionOf(config: MotionRowConfig): MotionConfig {
  return config;
}

export function apply(ctx: Context, config: MotionRowConfig): void {
  ctx.inject(['reels'], (c) => {
    c.effect(() => {
      const offs = BUILTIN_MOTION_STYLES.map((s) => c.reels.motions.register(s));
      const off = c.reels.useMotion(config.style, motionOf(config));
      return () => {
        off();
        offs.forEach((f) => f());
      };
    }, 'reels-motion');
  });
}
