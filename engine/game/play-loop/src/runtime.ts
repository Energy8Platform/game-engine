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
 * **Slice 25 adds a fourth thing: tempo.** `execute` carries `StepOpts`
 * through to the board, and `ctx.play.skip()` collapses whatever is
 * presenting — reachable from a page directly, and from the flow bus: the
 * events named by `config.skipEvents` (`['ui.skip']` by default; the
 * template lists `[ui.skip, ui.tap]`, so a tap on the canvas during a
 * presentation skips it), which this row subscribes to through
 * `ctx.inject(['events'])` (see `apply` for why that, and not a read at
 * apply time). A skip is not a flow node: it has to land WHILE the flow is
 * busy, which is the one moment a flow node cannot run.
 *
 * **Slice 29 adds the one step no board performs.** `EmitStep`
 * (`@energy8engine/contracts`) is a `KnownPresentationStep` but deliberately
 * left out of `KNOWN_STEP_KINDS`, so `executePlan` never offers it to the
 * board at all — it always falls to the registry, where `apply` below
 * registers a handler for `emit` ahead of any plugin (a plugin registering
 * its own `emit` collides, and the built-in keeps it — `BoardStepRegistry`'s
 * ordinary first-wins rule). The handler fires the flow bus with
 * `event`/`payload` and, when `wait: true`, holds the plan open until the
 * bus's own promise settles — nothing to hold when the bus predates Task 2
 * and `emit` is still synchronous, or when no `events` service is composed
 * at all (a per-step diagnostic then, the same as any step nothing can
 * perform). `skip()`'s existing fan-out reaches it for free: the handler's
 * `skip` releases every pending hold at once, whether or not the listener's
 * own promise has settled — the branches the event started keep running on
 * their own, only the PLAN stops waiting on them.
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
 * `config` is `./schema.ts`'s `Config`: `skipEvents`, and `pendingMs` (slice
 * 32) — the cap on how long a plan's end waits on its `wait: false` steps,
 * handed to every `executePlan` this row runs (see `ExecuteLimits`).
 *
 * **`e8.runtime.requires: ["board"]`** (this package's own `package.json`).
 * `apply` below never reads `ctx.board` itself — `execute`'s `board`
 * argument is handed in by the CALLER, per call, and even types as
 * `BoardApi | undefined`. The declaration is still honest: a play loop with
 * no board to run a plan against cannot do the one thing it exists for,
 * every `spinTo`/`refill`/... step degrading to its own "board cannot
 * perform step" diagnostic. `@energy8engine/game-runtime`'s `createGame`
 * checks it once, after the whole composition has applied — see
 * `E8RuntimeHalf.requires`'s doc comment for why that is not a revival of
 * the `inject` field this row deliberately does not have.
 */
import type { Context } from 'cordis';
import type { Diagnostic, EmitStep, PresentationStep, StepOpts } from '@energy8engine/contracts';
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
    opts?: StepOpts,
  ): Promise<Diagnostic[]>;
  /**
   * Collapse the presentation that is running right now: the board this
   * row last played a plan against (`BoardApi.skip` — the legacy
   * `ReelSystem.skip()` one level down) and every handler registered for a
   * plugin's step kind. Both are optional, and anything that cannot be
   * hurried is simply passed over.
   *
   * **A no-op with no run in flight** — unless the row is armed (see
   * `arm`), when it is kept for the plan on its way, and **latched for the
   * rest of the run** when there is one: every step that STARTS after a
   * skip is collapsed as it starts, so a multi-round tumble chain ends at
   * the result instead of skipping one round and playing the rest in full.
   *
   * **The result still lands.** A skip shortens the watching, it does not
   * abandon the round — `execute`'s promise resolves as usual, with the
   * same diagnostics, once the collapsed steps fall through.
   *
   * Never throws: it is called from a UI handler (a second tap on Spin, a
   * `skipEvents` event on the flow bus), and one board or handler refusing
   * to be hurried must not cost the others theirs.
   */
  skip(): void;
  /**
   * "A plan is on its way" — what the flow's `spin`/`step` nodes call before
   * they ask the session for a round. Until the next `execute` starts, or the
   * returned release is called, a `skip()` with no run in flight is KEPT, and
   * that next `execute` starts latched: every step collapsed as it starts,
   * exactly as a skip mid-run does. Without it a second tap during the
   * round's request landed on no live run and was dropped.
   *
   * Arms nest (a set, not a flag); a release is idempotent, and the LAST one
   * with no `execute` having started clears a kept skip — a request that
   * failed does not hurry the next round. `execute` starting releases every
   * arm, so a skip after a plan began is the ordinary mid-run skip and one
   * after it ended is dropped as before. Never throws.
   */
  arm(): () => void;
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

/**
 * The flow bus, as much of it as this row uses. Not cordis's own
 * `ctx.events`. Structural, on purpose: `@energy8engine/flow`'s own
 * `EventsService.emit` returns `Promise<void>` (Task 2, `Promise.allSettled`
 * of whatever its listeners returned), but nothing here imports that type —
 * `void | Promise<void>` accepts either shape, so the built-in `emit` step
 * below works against today's bus and tomorrow's without an upgrade of its
 * own, and against any other bus a project composes in its place.
 */
interface FlowBus {
  on(name: string, fn: (payload: unknown) => void): () => void;
  emit(name: string, payload?: unknown): void | Promise<void>;
}

export function apply(ctx: Context, config: { skipEvents?: string[]; pendingMs?: number } = {}): void {
  const steps = createBoardStepRegistry();
  const skipEvents = config.skipEvents ?? ['ui.skip'];

  // The one step no board performs: a beat on the flow bus. `wait: true`
  // holds the plan until the runs that the event started have drained (the
  // bus's `emit` promise — `@energy8engine/flow`); `skip()` lets go of
  // every pending hold at once, the branches keep running on their own.
  const holds = new Set<() => void>();
  steps.register({
    kind: 'emit',
    async run(step) {
      const bus = ctx.reflect.get('events', false) as FlowBus | undefined;
      if (!bus) throw new Error("no 'events' service in this composition");
      const { event, payload, wait } = step as unknown as EmitStep;
      const done = bus.emit(event, payload);
      if (!wait || !done || typeof done.then !== 'function') return;
      await new Promise<void>((resolve) => {
        const release = () => {
          holds.delete(release);
          resolve();
        };
        holds.add(release);
        void done.then(release, release);
      });
    },
    skip() {
      for (const release of [...holds]) release();
    },
  });

  // Provided as its own service, not only as a field on `play`, so a
  // plugin can `inject(['steps'])` — depend on exactly the capability it
  // uses, and compose in either order relative to this row.
  ctx.provide('steps', steps);

  // What `skip()` aims at: whatever the LAST `execute` ran against. The
  // board is handed in per call (see this file's module doc on
  // `requires: ["board"]`), so there is nothing else to remember it by;
  // the registry is remembered too because a caller may legitimately pass
  // its own instead of the composed `steps`.
  let lastBoard: BoardApi | undefined;
  let lastRegistry: BoardStepRegistry = steps;

  const hurry = (target: { skip?(): void } | undefined) => {
    try {
      target?.skip?.();
    } catch {
      // Swallowed deliberately: one thing refusing to be hurried must not
      // cost the rest of them their skip, and `skip()` has no return value
      // to report it through. A board that throws here has already failed
      // its plan's own step, which IS reported, through `execute`.
    }
  };

  const fanOut = () => {
    hurry(lastBoard);
    try {
      for (const kind of lastRegistry.kinds()) hurry(lastRegistry.get(kind));
    } catch {
      // `kinds()`/`get()` are a third party's, same as `collisions()` in
      // `executePlan` — see the guard there.
    }
  };

  // Latched for the REST of the run, not fired once. `BoardApi.skip` is
  // one-shot by nature — the legacy `TumbleController.step` clears its own
  // `_killed` flag on entry — so on an N-round tumble chain a single
  // `skip()` hurried the round in flight and every later round played in
  // full. With the latch, `executePlan`'s `onStepStarted` re-fans the skip
  // onto each later step the moment it starts, which is exactly when the
  // step is skippable (see `ExecuteHooks`).
  let skipped = false;

  // `arm()`'s live tokens, and a skip that landed while one was live but no
  // run was — kept for the plan on its way (see `PlayService.arm`).
  const arms = new Set<object>();
  let pending = false;

  const skip = () => {
    // No live run, nothing to collapse. Without this guard an idle `ui.skip`
    // (a stray `__e8.skip()`, a flow `emit`) still reached the LAST board
    // this row played against, and `ReelSystem.skip()` unconditionally
    // destroys every child of the `fx` overlay layer — so an idle skip wiped
    // a game's own overlay art. `execute` clears `lastBoard` when it
    // resolves, which is what makes "live" mean live. An ARMED row keeps it
    // instead: the round's plan is on its way, and the skip is for it.
    if (!lastBoard) {
      if (arms.size > 0) pending = true;
      return;
    }
    skipped = true;
    fanOut();
  };

  // The flow bus is the only channel a skip can arrive on DURING a run: a
  // flow `on` node cannot fire while the flow is busy (`busy: ignore`),
  // which is exactly when a skip means anything. Which events skip is the
  // row's `skipEvents` config — every one rides this same effect, so a
  // re-provided bus re-arms them all and a disposed one lets them all go.
  //
  // `ctx.inject`, not a lenient read at apply time, and not this row's own
  // `inject` field — the same device `ide-bridge` uses for `mechanics`. Two
  // measured facts make it the only correct one:
  //
  //  - `events` is `flow1`'s, and in `e8-base` `playloop1` is listed BEFORE
  //    `flow1`, so at apply time there is nothing to subscribe to. (There is
  //    no ambiguity with cordis's own `ctx.events` emitter here:
  //    `reflect.get('events', false)` on a bare context is `undefined`, and
  //    this callback fires exactly when something calls
  //    `ctx.provide('events', …)`.)
  //  - `flow` is `hot: true`. A re-applied flow row un-provides its bus and
  //    provides a NEW one; this callback runs again against it, and the
  //    effect below is disposed with the old bus on the way out. A
  //    subscription captured once would have gone on holding a dead bus,
  //    silently, for the rest of the page's life.
  ctx.inject(['events'], (c) => {
    c.effect(() => {
      const bus = c.get('events') as unknown as FlowBus;
      const offs = skipEvents.map((name) => bus.on(name, () => skip()));
      return () => offs.forEach((off) => off());
    }, 'play-loop:ui-skip');
  });

  ctx.provide('play', {
    async execute(plan, board, registry = steps, opts) {
      // A skip kept while the request was in flight latches this run from
      // its first step; every arm is spent — a later skip is mid-run or idle.
      skipped = pending;
      pending = false;
      arms.clear();
      lastBoard = board;
      lastRegistry = registry;
      const problems = await executePlan(
        plan,
        board,
        registry,
        opts,
        {
          onStepStarted: () => {
            if (skipped) fanOut();
          },
        },
        { pendingMs: config.pendingMs },
      ).finally(() => {
        // This run is over: a later `skip()` has nothing live to aim at, and
        // the next run starts unlatched. `finally`, not two lines after the
        // await, so a rejection nobody expects (`executePlan` promises not to
        // produce one) cannot leave the row latched for the life of the page.
        lastBoard = undefined;
        skipped = false;
      });
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
    skip,
    arm() {
      const token = {};
      arms.add(token);
      return () => {
        if (arms.delete(token) && arms.size === 0) pending = false;
      };
    },
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
