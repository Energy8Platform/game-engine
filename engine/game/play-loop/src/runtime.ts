/**
 * Runtime half of `play-loop` — the `playloop1` row in `e8-base`.
 *
 * See `@energy8engine/renderer-pixi`'s `src/runtime.ts` module doc: this is
 * a real TypeScript module served through `dev-game`'s own vite instance.
 *
 * This row composes three things a game cannot reach otherwise:
 *
 *  1. **`ctx.play.execute`** — `./index.ts`'s `executePlan` is a plain
 *     function with no cordis dependency of its own, so this puts it on
 *     `ctx` for a caller composed purely from the project (no static import
 *     of `@energy8engine/play-loop` at all).
 *  2. **`ctx.steps`** — a `BoardStepRegistry`, created here, which
 *     `execute` consults by default.
 *  3. **`ctx.play.record`** — the one door to the composition's `spin-log`,
 *     which may not be there at all. See `PlayService.record` for why it is
 *     a separate call rather than something `execute` does on its own: a
 *     plan is run for every re-presentation, and only some of those are
 *     spins.
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
import type { SpinLog, SpinLogEntry } from '@energy8engine/spin-log';
import { reportAll, type DiagnosticsService } from '@energy8engine/diagnostics';
// Type-only and fully erased — the same device `first-slot`'s `main.ts`
// uses. This is the module that DECLARES `ctx.spinLog` on cordis's
// `Context`; importing its types is not importing it, and nothing here
// pulls `spin-log` into a composition that did not ask for it. Same for
// `@energy8engine/diagnostics/runtime`, which declares `ctx.diagnostics`.
import type {} from '@energy8engine/spin-log/runtime';
import type {} from '@energy8engine/diagnostics/runtime';
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
  /**
   * Writes one spin down: what was asked, what came back, and the plan it
   * was presented with. Goes to the composition's `spin-log` if there is
   * one, and nowhere at all if there isn't — the log is optional, and a
   * caller does not have to know which.
   *
   * Never throws, for the same reason `execute` doesn't: a spin must not
   * fail because recording it failed.
   *
   * **Called per SPIN, not per plan.** `execute` deliberately does not do
   * this itself — re-presenting a captured result under a different
   * mechanic runs a plan without a spin having happened, and three replays
   * of one spin are one line in this log, not three. That is the whole
   * distinction §7 of the spec draws: the result is the fact, the
   * presentation is an interpretation of it.
   */
  record(entry: SpinLogEntry): void;
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
    async execute(plan, board, registry = steps) {
      const problems = await executePlan(plan, board, registry);
      // This row IS `executePlan`'s caller — the nearest point that both
      // knows a plan just ran and can reach the composition's shared
      // `diagnostics` service, so every game gets this for free rather
      // than every page having to wire it by hand. `executePlan` itself
      // (`./index.ts`) stays cordis-free and returns to ITS caller — this
      // row — unchanged; the return below is that exact same array, so a
      // caller logging it locally is a second READER, not a second writer
      // of the service. See task-2-3-report.md.
      //
      // Looked up per call, not captured at apply time — same reason
      // `record`'s `spinLog` lookup below is: a `diagnostics` row may
      // compose in either order relative to this one.
      reportAll(ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined, problems);
      return problems;
    },
    steps,
    record(entry) {
      try {
        // Looked up per call, not captured at apply time. Row order
        // between this row and a `spin-log` row is not this row's to
        // assume (the same reason `ctx.inject` is used for `steps` by
        // everything that registers into it), and a lookup done once at
        // compose time would miss a log that landed a moment later and
        // stay missing for the life of the page.
        //
        // `reflect.get(name, false)` rather than `ctx.spinLog`: cordis
        // throws on a property read of a registered service this plugin
        // did not `inject`, and "nobody composed one" is the answer
        // wanted here, not an exception.
        (ctx.reflect.get('spinLog', false) as SpinLog | undefined)?.append(entry);
      } catch {
        // Swallowed on purpose, and this is the one place in this package
        // that swallows rather than reporting. `execute` can hand a
        // `Diagnostic` back to its caller; `record` returns nothing, and
        // giving it a return value would put the burden of "did writing
        // the log work" on every spin. A log is a record OF the game, not
        // a part of it: the game is still correct without one.
      }
    },
  } satisfies PlayService);
}
