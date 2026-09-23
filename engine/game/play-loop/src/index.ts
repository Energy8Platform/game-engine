/**
 * The runner for a `PresentationPlan` — the seam between "what should
 * happen" (a mechanic's plan) and "what the screen does" (a board).
 *
 * `BoardApi` declares one method per step kind in the vocabulary, each
 * taking the whole step object plus the tempo the plan is playing at. This file defines the
 * contract; the real implementation (wrapping the legacy pixi reel system)
 * is Task 9's, and a fake recording its calls is what this file's own tests
 * run against — pixi does not initialise usefully in jsdom, and animation
 * timing cannot be asserted in a unit test at all.
 *
 * The rule that shapes `executePlan`: failures are data. A board missing a
 * method for a step's kind, or a step whose handler throws, becomes a
 * `Diagnostic` and execution continues with the next step — a half-played
 * spin that reports why is recoverable; one that dies mid-animation leaves
 * the player looking at a frozen board. `executePlan` never throws, no
 * matter what the plan contains (including a step whose `kind` matches
 * nothing in the vocabulary).
 *
 * **`wait: false`.** One rule for every step, known kind or registered
 * handler: a step carrying `wait === false` is STARTED where it sits and
 * not awaited there, so the next step begins over the top of it — a death
 * morph playing through the tumble that follows it. The plan is still
 * atomic: everything started that way is awaited at the END of
 * `executePlan`, before it returns, and a rejection becomes the ordinary
 * `step "<kind>" failed` diagnostic naming the index it STARTED at. A step
 * that outlives its own plan is not something this vocabulary offers.
 *
 * **The registry.** `BoardApi` is the closed vocabulary the shipped
 * mechanics stand on — one method per known kind, not opened here. Any
 * OTHER kind (task 9's `reelStep` among them) has nowhere to land on `BoardApi`
 * without editing this package, so `executePlan` also accepts a
 * `BoardStepRegistry`: a plugin registers a `StepHandler` for the kind
 * `BoardApi` doesn't have, and `executePlan` runs it instead of reporting
 * "no matching method." The registry is checked ONLY after the board says
 * it has no method for the kind — a kind `BoardApi` already knows always
 * goes to the board, never to the registry, even if something is
 * registered for it too. Without that rule a plugin could silently replace
 * `spinTo` for every game that loads it; see `executePlan`'s own tests for
 * the case that pins it down. The registry argument is optional: a caller
 * that never passes one gets exactly today's behaviour, unchanged.
 */
import {
  diagnostic,
  isPresentationStep,
  KNOWN_STEP_KINDS,
  type Diagnostic,
  type PlayStateStep,
  type PresentationStep,
  type RefillStep,
  type RemoveStep,
  type RevealWinsStep,
  type SpinToStep,
  type StepOpts,
  type TumbleStep,
} from '@energy8engine/contracts';
import { createRegistry } from '@energy8engine/registry';

/**
 * What a board must offer to play a `PresentationPlan`: one async method
 * per step kind, each taking the whole step object it handles plus the
 * `StepOpts` the plan is being played at. Task 9 implements this against
 * the legacy pixi reel system.
 *
 * `opts` is optional on every method for one practical reason: a caller
 * that passes none (every caller before slice 25) hands `undefined`
 * through, and a board that ignores tempo simply declares one parameter.
 *
 * `skip` is optional for the honest reason: not every board can be hurried.
 * One that can collapses whatever it is animating to its end state — the
 * result still lands, the presentation just stops taking time. See
 * `PlayService.skip` (`./runtime.ts`) for who calls it.
 */
export interface BoardApi {
  spinTo(step: SpinToStep, opts?: StepOpts): Promise<void>;
  revealWins(step: RevealWinsStep, opts?: StepOpts): Promise<void>;
  remove(step: RemoveStep, opts?: StepOpts): Promise<void>;
  refill(step: RefillStep, opts?: StepOpts): Promise<void>;
  tumble(step: TumbleStep, opts?: StepOpts): Promise<void>;
  /** The named cells play a state of their symbol (`symbols.yml`'s `states`) and return to rest. */
  playState(step: PlayStateStep, opts?: StepOpts): Promise<void>;
  /** Collapse whatever is presenting right now to its end state. */
  skip?(): void;
}

/**
 * What a plugin offers for the one kind it adds — `BoardApi` has no slot
 * for a kind it was never told about, so a `BoardStepRegistry` handler
 * gets the whole step plus the board (untyped: this package doesn't know
 * `BoardApi`'s legacy pixi implementation, only that `executePlan` will
 * hand back whatever `board` it was given) instead of a named method.
 *
 * `run`'s `step` arrives as the WIDE `PresentationStep`, not your kind's
 * own shape — narrow it yourself with a double cast, `step as unknown as
 * YourStepShape`. A single `as YourStepShape` won't compile (verified:
 * `PresentationStep` and an unrelated `{ kind: 'yourKind'; … }` don't
 * overlap enough for `tsc` to allow it, and neither does a `s is
 * YourStepShape` type predicate, for the same reason). **Do not** reach
 * for `interface YourStepShape extends UnknownPresentationStep` just to
 * make the single cast compile — it does compile, but the inherited index
 * signature then swallows excess properties on YOUR OWN step literals
 * too: `{ kind: 'reelStep', shifts: [...], shiftsTYPO: [...] }` type-checks
 * cleanly against that shape, silently, for the exact structural reason
 * `UnknownPresentationStep` is kept out of `KnownPresentationStep` in the
 * first place (see that type's doc in `@energy8engine/contracts`). A
 * plain interface — no `extends` — plus the double cast gets the
 * narrowing without paying that cost.
 */
export interface StepHandler {
  kind: string;
  run(step: PresentationStep, board: unknown, opts?: StepOpts): Promise<void>;
  /**
   * Collapse this handler's in-flight presentation, if it can be hurried at
   * all — the same bargain `BoardApi.skip` makes, and optional for the same
   * reason. A handler implemented with `await` and no cancellable animation
   * simply has none, and `PlayService.skip` skips over it.
   */
  skip?(): void;
}

/**
 * Where a plugin's step gets a handler `BoardApi` doesn't have one for.
 * Cordis-free by design, same as `executePlan` itself (see this file's
 * module doc) — which means this registry has NO automatic teardown of
 * its own. What it does have: `register`'s return value is a plain
 * disposer, exactly the shape `ctx.effect(() => registry.register(handler))`
 * wants, so a cordis-aware caller CAN tie a registration to its own
 * plugin's lifetime by wrapping the call that way. §5.4's reversibility
 * requirement is satisfiable without this package needing to know cordis
 * exists — it is not, today, already satisfied by anything in this file.
 *
 * That is deliberately NOT the same guarantee `game-runtime`'s
 * `MechanicsService.register` offers, and the difference matters if
 * you're hunting for a working example to copy: `MechanicsService`'s
 * `register` calls `ctx.effect` INTERNALLY, using the `ctx` its own
 * hosting plugin (`mechanics.ts`) closed over — so that teardown is tied
 * to the MECHANICS SERVICE's own scope, not to whichever OTHER row calls
 * `.register()`. It is a whole-registry teardown net (everything goes
 * when the service's own scope does), not per-caller reversibility.
 * `BoardStepRegistry` doesn't even have that much — nothing in this file
 * calls `ctx.effect`, so per-plugin reversibility here is entirely up to
 * whoever calls `register()` wrapping it themselves.
 */
export interface BoardStepRegistry {
  /**
   * Registers `handler` under `handler.kind`, IF nothing is serving that
   * kind already. Returns a disposer that unregisters it again — call it
   * (or let `ctx.effect` call it on unload) when the plugin that
   * registered it goes away, so a row that left the composition doesn't
   * leave its handler behind for the next thing that reuses the kind.
   *
   * **A kind already taken is a collision, and the incumbent keeps it.**
   * This used to be `handlers.set(kind, handler)` — last writer wins, no
   * complaint — so two plugins bringing the same step kind meant one of
   * them composed, applied, and did nothing, with nothing anywhere saying
   * which. That is the same defect `@energy8engine/spin-parser`'s
   * `NamedCollection` exists to prevent (two `record Vars`, silently one),
   * on state shared BETWEEN plugins rather than inside one file — where it
   * is worse, because no one reader ever sees both claims.
   *
   * First wins, for three reasons, and the same rule
   * `game-runtime`'s `MechanicsService.register` applies to mechanic ids:
   *
   *  1. it is the rule `executePlan` already lives by one level up — the
   *     board gets first refusal and a registration cannot displace it —
   *     so "what is already serving this kind keeps serving it" is one
   *     rule here, not two;
   *  2. it is `NamedCollection`'s rule, so a `.spin` author and a plugin
   *     author are not told opposite things about what a repeated name
   *     does;
   *  3. last-wins makes the winner depend on composition ORDER, which a
   *     project author does not control directly (it falls out of bundle
   *     stacking and patch rows) — so the same project would present
   *     differently for reasons nothing on screen explains.
   *
   * A registration that WANTS to replace another disposes the incumbent's
   * registration first (that is what the returned disposer is for), or
   * uses a kind of its own.
   *
   * The refused registration's disposer is a no-op: it never held the
   * kind, so there is nothing for it to give back — and if it deleted the
   * entry it would take the WINNER out on its way, which is exactly the
   * silent hole this method exists to close.
   */
  register(handler: StepHandler): () => void;
  /** True when something is currently registered for `kind`. */
  has(kind: string): boolean;
  /** The handler currently registered for `kind`, or `undefined`. What `executePlan` actually calls. */
  get(kind: string): StepHandler | undefined;
  /**
   * Every kind something is currently registered for. What lets an
   * "unknown kind" diagnostic name a plugin's OWN registered kinds
   * alongside the built-in ones — see `knownKindsList` below — rather than
   * only ever pointing a typo (`reelStap`) at kinds it can't have meant
   * (`spinTo`) while staying silent about the one it probably did
   * (`reelStep`).
   */
  kinds(): string[];
  /**
   * Every collision `register` has refused, in the order they happened.
   * Cumulative and idempotent — reading it does not clear it.
   *
   * It exists because this registry has no channel of its own: it is
   * cordis-free by design (see this file's module doc), so it cannot
   * provide a service, and `register` must keep returning a plain
   * disposer, since that is the exact shape `ctx.effect(() =>
   * registry.register(h))` wants and every plugin in the repo uses it
   * that way. So the collision is RECORDED here and `executePlan` reports
   * it with the rest of what went wrong while running a plan — which is
   * the one outlet this package already has, and the right moment: a
   * shadowed kind is a fact about every plan that names it, not only
   * about the instant two plugins raced.
   */
  collisions(): Diagnostic[];
}

/** A fresh, empty `BoardStepRegistry` — nothing registered until something calls `register`. */
export function createBoardStepRegistry(): BoardStepRegistry {
  // The collision policy and the disposer's identity-guard used to be
  // hand-rolled here: a `Map`, a has-then-set branch, and an `if
  // (handlers.get(kind) === handler)` removal guard — the exact shape
  // that shipped the silent-overwrite bug `BoardStepRegistry.register`'s
  // own doc describes. `@energy8engine/registry` is that guarantee given
  // once instead of hand-rolled per collection — see
  // `registries-context.md`. What stays here is what the generic
  // collection cannot know on its own: deriving the key from
  // `handler.kind` (it only ever sees a flat `(key, value)`), and noticing
  // + wording + storing THIS package's own collision diagnostic. The
  // collection says nothing about a collision at all — `register` below
  // reads `get(kind)` first and is the one that knows.
  const handlers = createRegistry<StepHandler>({ policy: 'first-wins' });
  const collisions: Diagnostic[] = [];

  return {
    register(handler) {
      // A collision is exactly "something is already registered under
      // this kind" — checked before `add()` so this call can decide
      // whether to render a diagnostic, without re-deciding who wins:
      // `add()` already applies first-wins on its own, synchronously, so
      // nothing can change between this read and that call.
      const collided = handlers.get(handler.kind) !== undefined;
      const off = handlers.add(handler.kind, handler);
      if (collided) {
        collisions.push(
          diagnostic(
            'error',
            'play-loop',
            `steps.${handler.kind}`,
            `two handlers claim step kind "${handler.kind}": the one already registered keeps it, this one is ignored`,
            `give one of them a kind of its own, or unregister the first before registering the second — a step kind is served by exactly one handler`,
          ),
        );
      }
      // On a collision `off` is already the registry's own no-op — see
      // `BoardStepRegistry.register`'s doc for why a refused registration
      // must never be able to evict the winner.
      return off;
    },
    has(kind) {
      return handlers.get(kind) !== undefined;
    },
    get(kind) {
      return handlers.get(kind);
    },
    kinds() {
      return [...handlers.keys()];
    },
    collisions() {
      return [...collisions];
    },
  };
}

/**
 * The kinds an "unknown kind" diagnostic can point at: the ones `BoardApi`
 * always has, plus whatever `registry` currently holds. Without the
 * second half, a project that registers `reelStep` and then typos it as
 * `reelStap` would be told about `spinTo, revealWins, …` — true, but not
 * the one kind the typo was actually reaching for. A `Set` dedupes the
 * unlikely case of a registry also holding a known one — reachable
 * only against a board that is missing a method its own interface
 * declares, since a board that HAS the method always wins it (see
 * `executePlan`), and "known" in the sense this message means either way.
 */
function knownKindsList(registry: BoardStepRegistry | undefined): string {
  const kinds = new Set<string>(KNOWN_STEP_KINDS);
  if (registry) {
    for (const kind of registry.kinds()) kinds.add(kind);
  }
  return [...kinds].join(', ');
}

type BoardMethod = (step: PresentationStep, opts?: StepOpts) => Promise<void>;

/**
 * What a caller can be told while a plan runs. Optional, and empty for
 * every caller that wants nothing.
 */
export interface ExecuteHooks {
  /**
   * Called SYNCHRONOUSLY the moment a step has been invoked — after the
   * board method or handler was called, before its promise is awaited.
   *
   * The "after, not before" is measured, not stylistic: the legacy
   * `TumbleController.step` clears its own `_killed` flag on entry, so a
   * `skip()` fired BEFORE the call would be wiped by the very step it was
   * meant to collapse. Announcing the step once it is under way is the only
   * point at which a skip sticks. `PlayService.skip`'s latch is the one
   * caller of this today: it re-fans a skip latched earlier in the run onto
   * each later step as that step starts.
   */
  onStepStarted?(step: PresentationStep): void;
}

/**
 * Plays `plan` against `board`, one step at a time, awaiting each before
 * starting the next — unless the step says `wait: false`, which starts it
 * and moves on (see this file's module doc, and `PlayStateStep.wait` in
 * `@energy8engine/contracts`). Returns the diagnostics collected along the way —
 * empty when everything ran clean. Never rejects and never throws: a step
 * the board can't perform and has no registered handler either, or one
 * whose handler throws or rejects, is recorded as a `Diagnostic` and the
 * remaining steps still run.
 *
 * `plan`'s element type is `PresentationStep`, not `PresentationPlan` —
 * deliberately wider than what `classic`/`cascade` actually emit, so a
 * plan carrying a plugin's step (task 9's `reelStep`, say) is still a
 * well-typed call. Any real `PresentationPlan` widens into it with no cast
 * needed; see `PresentationStep`'s own doc in `@energy8engine/contracts`
 * for why that type stays separate from the one mechanics build with.
 *
 * `board` is typed optional because it legitimately IS, at the one real
 * caller: `first-slot`'s `main.ts` passes `game.ctx.board` straight
 * through, and that's `undefined` whenever the reels plugin failed to
 * build (see `game-runtime`'s `compose.test.ts` — that exact state is
 * reachable, not hypothetical). A plan with steps and no board to run them
 * on is exactly the kind of failure this function promises to report as
 * data, not throw on.
 *
 * `opts` is the plan's tempo (slice 25), passed through untouched to
 * whichever method or handler performs each step. This function decides
 * nothing about what it means — see `StepOpts` in
 * `@energy8engine/contracts`. Omitted, every step is handed `undefined`,
 * which is exactly the call every caller made before it existed.
 *
 * `registry` is optional, and reached only after the board has had its
 * refusal: for a kind in `KNOWN_STEP_KINDS`, that means the board carries
 * no method for it; for any other kind, the board is not asked at all
 * (see the gate below for why "not asked" and "has no method" are not the
 * same thing). See this file's module doc for why that order is not
 * incidental. A caller that never passes a registry (every one of this
 * file's own tests before this parameter existed, and every caller
 * outside this package until something hands it one) gets exactly the
 * behaviour this function had before `registry` existed.
 *
 * A registry that refused a colliding registration reports it HERE, ahead
 * of anything this plan itself ran into — see `BoardStepRegistry.collisions`
 * for why this is the outlet, and why the report repeats for every plan
 * rather than firing once.
 *
 * `hooks` is last and optional, so every existing call is unchanged. Its
 * one member, `onStepStarted`, is what lets a caller act ON a step that has
 * just begun — see `ExecuteHooks` for why the timing is what it is.
 */
export async function executePlan(
  plan: PresentationStep[],
  board: BoardApi | undefined,
  registry?: BoardStepRegistry,
  opts?: StepOpts,
  hooks?: ExecuteHooks,
): Promise<Diagnostic[]> {
  // A hook is the caller's code, but it runs inside this function's
  // never-throws promise, so it gets the same treatment the board and the
  // registry do: whatever it does, the step it announced still runs and
  // still awaits. (Not folded into the per-step try below — a throwing hook
  // there would abandon a promise nobody awaits.)
  const started = (step: PresentationStep): void => {
    try {
      hooks?.onStepStarted?.(step);
    } catch {
      // Swallowed: announcing a step must not be able to fail it.
    }
  };
  const problems: Diagnostic[] = [];
  // The one wording for a step that failed, shared by the two paths that can
  // see one: the `catch` around the loop body, and a `wait: false` step whose
  // rejection lands long after the loop moved on — which is why `where` and
  // `kind` are arguments rather than read from the loop's own variables.
  const failed = (where: string, kind: string, error: unknown): void => {
    problems.push(
      diagnostic(
        'error',
        'play-loop',
        where,
        `step "${kind}" failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
  };
  /**
   * The steps that declined to hold the plan (`wait: false`). Started in
   * order with everything else and awaited HERE, at the end, so a plan stays
   * atomic — `present` is one node in the flow, and a beat that outlives its
   * own plan is not a thing this vocabulary offers. Each one carries its own
   * `catch`, closed over the index it STARTED at, because by the time it
   * fails the loop is somewhere else entirely.
   */
  const pending: Promise<void>[] = [];
  // Read before the `!board` early return, on purpose: a collision is a
  // fact about the composition, not about this plan, so it must not be
  // swallowed by a plan that had nothing to run or no board to run it on.
  //
  // Guarded, for the same reason `registry.get(...)` below is: this is a
  // call into an interface a THIRD PARTY implements, and `executePlan`
  // promises never to throw no matter what the registry does. See
  // `tests/registry.test.ts`'s "a registry whose collisions() throws".
  if (registry) {
    try {
      problems.push(...registry.collisions());
    } catch (error) {
      problems.push(
        diagnostic(
          'error',
          'play-loop',
          'registry',
          `the registry's collisions() threw: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  if (!board) {
    // A plan with nothing to run needs no board either — only report the
    // failure when there was actually something for the (missing) board
    // to have done.
    if (plan.length === 0) return problems;
    problems.push(
      diagnostic(
        'error',
        'play-loop',
        'board',
        'cannot run a presentation plan: no board to run it on',
      ),
    );
    return problems;
  }

  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    const where = `plan[${index}]`;
    // A mechanic's plan is data a THIRD party produced (Task 5's own
    // vocabulary, but any mechanic — ours or a plugin's — can emit a
    // malformed entry: `null`, a step missing `kind`, or `spinTo` whose
    // `board` isn't actually a board). Reading `.kind` off a non-object
    // step below would throw a TypeError before `executePlan` ever gets a
    // chance to report it as a `Diagnostic` — checked BEFORE that read,
    // not after, for exactly that reason. This is a different check than
    // "does the board have a method for this kind" below: a step can name
    // a real kind and still be shaped wrong.
    if (!isPresentationStep(step)) {
      problems.push(
        diagnostic('error', 'play-loop', where, `malformed step in plan: ${JSON.stringify(step)}`),
      );
      continue;
    }

    // `wait: false` is read off the step itself, for ANY kind, known or
    // registered: `SpinToStep` and friends never declare the field, and a
    // plugin's step carries it through `UnknownPresentationStep`'s index
    // signature, so the cast is what asking a union this question costs. Only
    // an explicit `false` counts — absent and `true` both hold the plan, as
    // they always have. Read AFTER the guard above, not before: reading any
    // field off a `null` step is the exact TypeError that guard exists to
    // keep out of this function.
    const nonBlocking = (step as { wait?: unknown }).wait === false;

    // Everything from here down — RESOLVING who handles `step.kind`, and
    // RUNNING them — sits inside one try/catch, not just the running half.
    // `BoardStepRegistry` is the interface a third party implements (this
    // task's whole point), and `board` is no more trusted than that: a
    // `get()` that throws instead of returning `undefined`, or a `board`
    // whose property lookup throws (a getter, not just a throwing
    // method), fails BEFORE anything is called — a guard only around
    // `.call()`/`.run()` misses that. `executePlan` promises never to
    // throw no matter what the plan contains; that promise covers what
    // the board and the registry do too, not only what a mechanic put in
    // the plan. See `tests/registry.test.ts`'s "a registry whose get()
    // throws" and "a board whose property lookup throws".
    try {
      // The board gets first refusal on the kinds `BoardApi` declares, and
      // only those. A registered handler is consulted after
      // the board has said it has nothing, never before: reversing that
      // would let a plugin's registration win over `spinTo` (or any other
      // built-in) for every game that loads it, silently. See this file's
      // module doc and `tests/registry.test.ts`'s "a built-in kind still
      // goes to the board, not the registry".
      //
      // `KNOWN_STEP_KINDS` is what gates it, and the gate is load-bearing
      // twice over. `board[step.kind]` is an ordinary property read on an
      // object with a prototype, so ungated it answered for names nobody
      // put on a board:
      //
      //  - a plugin registering `toString`, `valueOf`, `constructor` or
      //    `hasOwnProperty` was silently never consulted — the INHERITED
      //    member is a function, so `typeof method === 'function'` held
      //    and `Object.prototype.toString.call(board)` ran instead, which
      //    returns a string rather than throwing, so nothing complained;
      //  - and any own method a board happens to carry past the known ones
      //    outranked a plugin's handler for that name. Not hypothetical:
      //    `@energy8engine/reels`' `ReelsBoard` carries `destroy()`, so a
      //    step kind `destroy` would have torn the board down.
      //
      // Gating on the vocabulary makes the rule exactly what both docs
      // already claimed — the known kinds go to the board, everything else goes
      // to the registry — instead of "whatever the board object answers
      // to", which is a wider set than anyone writes down.
      const isKnownKind = (KNOWN_STEP_KINDS as readonly string[]).includes(step.kind);
      const method = isKnownKind
        ? (board as unknown as Record<string, BoardMethod | undefined>)[step.kind]
        : undefined;

      if (typeof method === 'function') {
        const running = method.call(board, step, opts);
        started(step);
        if (nonBlocking) {
          // `Promise.resolve` because a board method is someone else's code: one
          // that returns nothing at all is fine to `await`, and must stay fine
          // to leave running.
          pending.push(
            Promise.resolve(running).catch((error: unknown) => failed(where, step.kind, error)),
          );
          continue;
        }
        await running;
        continue;
      }

      const handler = registry?.get(step.kind);

      if (handler) {
        const running = handler.run(step, board, opts);
        started(step);
        if (nonBlocking) {
          pending.push(
            Promise.resolve(running).catch((error: unknown) => failed(where, step.kind, error)),
          );
          continue;
        }
        await running;
        continue;
      }

      problems.push(
        diagnostic(
          'error',
          'play-loop',
          where,
          // Worded off `isKnownKind` because the two situations are
          // genuinely different and a person debugging needs them apart:
          // a known kind the board could not perform is a board that is
          // missing a method it declares; an unknown kind was never the
          // board's to perform at all, and the board was not asked.
          (isKnownKind
            ? `board cannot perform step "${step.kind}": no matching method`
            : `nothing can perform step "${step.kind}": it is not one of the kinds a board declares`) +
            (registry ? ', and nothing is registered for it either' : '') +
            ` — known kinds: ${knownKindsList(registry)}`,
        ),
      );
    } catch (error) {
      failed(where, step.kind, error);
    }
  }

  // Every `wait: false` step, awaited before the plan calls itself done. None
  // of these can reject: each carries its own `catch` above, which turns a
  // failure into a diagnostic instead.
  await Promise.all(pending);

  return problems;
}
