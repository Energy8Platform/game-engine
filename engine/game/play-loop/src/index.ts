/**
 * The runner for a `PresentationPlan` — the seam between "what should
 * happen" (a mechanic's plan) and "what the screen does" (a board).
 *
 * `BoardApi` declares one method per step kind in the vocabulary, each
 * taking the whole step object as its only argument. This file defines the
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
 * **The registry.** `BoardApi` is the closed vocabulary two shipped
 * mechanics stand on — six kinds, six methods, not touched here. A third
 * kind (task 9's `reelStep` among them) has nowhere to land on `BoardApi`
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
  type PresentationStep,
  type RefillStep,
  type RemoveStep,
  type RevealWinsStep,
  type SetMultiplierStep,
  type SpinToStep,
  type WaitStep,
} from '@energy8engine/contracts';

/**
 * What a board must offer to play a `PresentationPlan`: one async method
 * per step kind, each taking the whole step object it handles. Task 9
 * implements this against the legacy pixi reel system.
 */
export interface BoardApi {
  spinTo(step: SpinToStep): Promise<void>;
  revealWins(step: RevealWinsStep): Promise<void>;
  remove(step: RemoveStep): Promise<void>;
  refill(step: RefillStep): Promise<void>;
  setMultiplier(step: SetMultiplierStep): Promise<void>;
  wait(step: WaitStep): Promise<void>;
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
  run(step: PresentationStep, board: unknown): Promise<void>;
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
   * Registers `handler` under `handler.kind`, replacing whatever was there
   * before. Returns a disposer that unregisters it again — call it (or let
   * `ctx.effect` call it on unload) when the plugin that registered it
   * goes away, so a row that left the composition doesn't leave its
   * handler behind for the next thing that reuses the kind.
   */
  register(handler: StepHandler): () => void;
  /** True when something is currently registered for `kind`. */
  has(kind: string): boolean;
  /** The handler currently registered for `kind`, or `undefined`. What `executePlan` actually calls. */
  get(kind: string): StepHandler | undefined;
  /**
   * Every kind something is currently registered for. What lets an
   * "unknown kind" diagnostic name a plugin's OWN registered kinds
   * alongside the built-in six — see `knownKindsList` below — rather than
   * only ever pointing a typo (`reelStap`) at kinds it can't have meant
   * (`spinTo`) while staying silent about the one it probably did
   * (`reelStep`).
   */
  kinds(): string[];
}

/** A fresh, empty `BoardStepRegistry` — nothing registered until something calls `register`. */
export function createBoardStepRegistry(): BoardStepRegistry {
  const handlers = new Map<string, StepHandler>();

  return {
    register(handler) {
      handlers.set(handler.kind, handler);
      return () => {
        // Only remove the entry if it's still *this* registration — an
        // earlier registration's disposer must not delete a later one
        // that re-registered the same kind in the meantime. Same guard,
        // same reason, as `game-runtime`'s `MechanicsService.register`
        // (see this interface's own doc for where the parallel ends).
        if (handlers.get(handler.kind) === handler) {
          handlers.delete(handler.kind);
        }
      };
    },
    has(kind) {
      return handlers.has(kind);
    },
    get(kind) {
      return handlers.get(kind);
    },
    kinds() {
      return [...handlers.keys()];
    },
  };
}

/**
 * The kinds an "unknown kind" diagnostic can point at: the six `BoardApi`
 * always has, plus whatever `registry` currently holds. Without the
 * second half, a project that registers `reelStep` and then typos it as
 * `reelStap` would be told about `spinTo, revealWins, …` — true, but not
 * the one kind the typo was actually reaching for. A `Set` dedupes the
 * unlikely case of a registry also holding one of the six (never reached
 * through it — the board always wins those, see `executePlan` — but still
 * "known" in the sense this message means).
 */
function knownKindsList(registry: BoardStepRegistry | undefined): string {
  const kinds = new Set<string>(KNOWN_STEP_KINDS);
  if (registry) {
    for (const kind of registry.kinds()) kinds.add(kind);
  }
  return [...kinds].join(', ');
}

type BoardMethod = (step: PresentationStep) => Promise<void>;

/**
 * Plays `plan` against `board`, one step at a time, awaiting each before
 * starting the next. Returns the diagnostics collected along the way —
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
 * `registry` is optional and checked ONLY when `board` has no method for
 * the step's kind — see this file's module doc for why that order is not
 * incidental. A caller that never passes a registry (every one of this
 * file's own tests before this parameter existed, and every caller
 * outside this package until something hands it one) gets exactly the
 * behaviour this function had before `registry` existed.
 */
export async function executePlan(
  plan: PresentationStep[],
  board: BoardApi | undefined,
  registry?: BoardStepRegistry,
): Promise<Diagnostic[]> {
  if (!board) {
    // A plan with nothing to run needs no board either — only report the
    // failure when there was actually something for the (missing) board
    // to have done.
    if (plan.length === 0) return [];
    return [
      diagnostic(
        'error',
        'play-loop',
        'board',
        'cannot run a presentation plan: no board to run it on',
      ),
    ];
  }

  const problems: Diagnostic[] = [];

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
      const method = (board as unknown as Record<string, BoardMethod | undefined>)[step.kind];

      // The board gets first refusal on every kind, known or not —
      // including one of the six `BoardApi` already has a method for. A
      // registered handler is consulted only once the board has said it
      // has nothing, never before: reversing this would let a plugin's
      // registration win over `spinTo` (or any other built-in) for every
      // game that loads it, silently. See this file's module doc and
      // `tests/registry.test.ts`'s "a built-in kind still goes to the
      // board, not the registry".
      if (typeof method === 'function') {
        await method.call(board, step);
        continue;
      }

      const handler = registry?.get(step.kind);

      if (handler) {
        await handler.run(step, board);
        continue;
      }

      problems.push(
        diagnostic(
          'error',
          'play-loop',
          where,
          `board cannot perform step "${step.kind}": no matching method` +
            (registry ? ', and nothing is registered for it either' : '') +
            ` — known kinds: ${knownKindsList(registry)}`,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(
        diagnostic('error', 'play-loop', where, `step "${step.kind}" failed: ${message}`),
      );
    }
  }

  return problems;
}
