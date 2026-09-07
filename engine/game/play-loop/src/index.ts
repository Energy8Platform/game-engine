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
 */
export interface StepHandler {
  kind: string;
  run(step: PresentationStep, board: unknown): Promise<void>;
}

/**
 * Where a plugin's step gets a handler `BoardApi` doesn't have one for.
 * Cordis-free by design, same as `executePlan` itself (see this file's
 * module doc) — `register`'s return value is a plain disposer, which is
 * exactly the shape `ctx.effect(() => registry.register(handler))` wants:
 * whoever composes a plugin ties the registration to that plugin's
 * lifetime by wrapping the call, this package does not need to know
 * cordis exists to make that possible. §5.4 requires the reversibility;
 * this is how it's satisfied without a cordis dependency here.
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
        // same reason, as `game-runtime`'s `MechanicsService.register`.
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
  };
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

    // A step's handler throwing/rejecting becomes a diagnostic the same
    // way regardless of where the handler came from — the board's own
    // method, or a plugin's, below.
    const runHandler = async (run: () => Promise<void>): Promise<void> => {
      try {
        await run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        problems.push(
          diagnostic('error', 'play-loop', where, `step "${step.kind}" failed: ${message}`),
        );
      }
    };

    const method = (board as unknown as Record<string, BoardMethod | undefined>)[step.kind];

    // The board gets first refusal on every kind, known or not — including
    // one of the six `BoardApi` already has a method for. A registered
    // handler is consulted only once the board has said it has nothing,
    // never before: reversing this would let a plugin's registration win
    // over `spinTo` (or any other built-in) for every game that loads it,
    // silently. See this file's module doc and `tests/registry.test.ts`'s
    // "a built-in kind still goes to the board, not the registry".
    if (typeof method === 'function') {
      await runHandler(() => method.call(board, step));
      continue;
    }

    const handler = registry?.get(step.kind);

    if (handler) {
      await runHandler(() => handler.run(step, board));
      continue;
    }

    problems.push(
      diagnostic(
        'error',
        'play-loop',
        where,
        `board cannot perform step "${step.kind}": no matching method` +
          (registry ? ', and nothing is registered for it either' : '') +
          ` — known kinds: ${KNOWN_STEP_KINDS.join(', ')}`,
      ),
    );
  }

  return problems;
}
