/**
 * Runtime half of `play-loop` — the `playloop1` row in `e8-base`.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance.
 *
 * `./index.ts`'s `executePlan` is a plain function with no cordis
 * dependency of its own — `main.ts` calls it directly today
 * (`executePlan(plan, game.ctx.board)`), not through `ctx`. This row's only
 * job is to put that same function on `ctx` (`ctx.play.execute`) so a
 * caller composed purely from the project (no static import of
 * `@energy8engine/play-loop` at all) can still reach it. `config` is
 * unused — `play-loop` has no settings, only a capability.
 */
import type { Context } from 'cordis';
import { executePlan } from './index';

export interface PlayService {
  execute: typeof executePlan;
}

declare module 'cordis' {
  interface Context {
    play: PlayService;
  }
}

export const name = 'play-loop';

export function apply(ctx: Context): void {
  ctx.provide('play', { execute: executePlan });
}
