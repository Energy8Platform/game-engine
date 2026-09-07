/**
 * Runtime half of `play-loop` — the `playloop1` row in `e8-base`.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance.
 *
 * This row composes two things a game cannot reach otherwise:
 *
 *  1. **`ctx.play.execute`** — `./index.ts`'s `executePlan` is a plain
 *     function with no cordis dependency of its own, so this puts it on
 *     `ctx` for a caller composed purely from the project (no static import
 *     of `@energy8engine/play-loop` at all).
 *  2. **`ctx.steps`** — a `BoardStepRegistry`, created here, which
 *     `execute` consults by default.
 *
 * The second exists because the first was, on its own, a door to a room
 * nobody could enter. `executePlan` grew an optional `registry` parameter
 * and `createBoardStepRegistry` was exported, but NOTHING composed a
 * registry and nothing passed one — so a plugin that brought a step and a
 * handler for it registered into a registry of its own making, which
 * `executePlan` never saw. The only symptom was a per-step diagnostic
 * ("board cannot perform step …") at spin time, and the only fix was a
 * hand-rolled convention between the project's page and its plugins. That
 * is not a seam a third party can find. Now the registry is part of the
 * ordinary composition: a plugin does
 *
 * ```ts
 * ctx.inject(['steps'], (c) => c.effect(() => c.steps.register(handler), 'my:step'));
 * ```
 *
 * and a caller keeps writing `ctx.play.execute(plan, board)` exactly as
 * before. Nothing about the two-argument call changed; what changed is what
 * it now consults.
 *
 * **The precedence rule is untouched.** `executePlan` gives the board first
 * refusal on every kind and reaches a registry only for kinds the board has
 * no method for, so registering `spinTo` here still cannot replace the
 * board's own — see `./index.ts`'s module doc and `tests/registry.test.ts`.
 *
 * **A caller may still pass its own registry**, and it wins: the composed
 * one is a default argument, not an override. A test, or a game running two
 * boards with different step sets, keeps that option.
 *
 * `config` is unused — `play-loop` has no settings, only capabilities.
 */
import type { Context } from 'cordis';
import type { Diagnostic, PresentationStep } from '@energy8engine/contracts';
import {
  createBoardStepRegistry,
  executePlan,
  type BoardApi,
  type BoardStepRegistry,
} from './index';

export interface PlayService {
  /**
   * `executePlan`, with this row's own registry supplied when the caller
   * names none. Same signature and same guarantees otherwise — it never
   * throws, and a failing step is a `Diagnostic` with the rest of the plan
   * still played.
   */
  execute(
    plan: PresentationStep[],
    board: BoardApi | undefined,
    registry?: BoardStepRegistry,
  ): Promise<Diagnostic[]>;
  /**
   * The registry `execute` consults by default — the same object
   * `ctx.steps` names. Exposed here as well so a caller holding the play
   * service does not need a second `inject` to reach it.
   */
  steps: BoardStepRegistry;
}

declare module 'cordis' {
  interface Context {
    play: PlayService;
    /** Where a plugin registers a handler for a step kind `BoardApi` has no method for. */
    steps: BoardStepRegistry;
  }
}

export const name = 'play-loop';

export function apply(ctx: Context): void {
  const steps = createBoardStepRegistry();

  // Provided as its own service, not only as a field on `play`, so a
  // plugin can `inject(['steps'])` — depend on exactly the capability it
  // uses, and compose in either order relative to this row.
  ctx.provide('steps', steps);

  ctx.provide('play', {
    execute: (plan, board, registry = steps) => executePlan(plan, board, registry),
    steps,
  } satisfies PlayService);
}
