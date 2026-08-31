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
 */
import {
  diagnostic,
  type Diagnostic,
  type PresentationPlan,
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

type BoardMethod = (step: PresentationStep) => Promise<void>;

/**
 * Plays `plan` against `board`, one step at a time, awaiting each before
 * starting the next. Returns the diagnostics collected along the way —
 * empty when everything ran clean. Never rejects and never throws: a step
 * the board can't perform (no matching method) or one whose handler throws
 * or rejects is recorded as a `Diagnostic` and the remaining steps still
 * run.
 */
export async function executePlan(
  plan: PresentationPlan,
  board: BoardApi,
): Promise<Diagnostic[]> {
  const problems: Diagnostic[] = [];

  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    const where = `plan[${index}]`;
    const method = (board as unknown as Record<string, BoardMethod | undefined>)[step.kind];

    if (typeof method !== 'function') {
      problems.push(
        diagnostic(
          'error',
          'play-loop',
          where,
          `board cannot perform step "${step.kind}": no matching method`,
        ),
      );
      continue;
    }

    try {
      await method.call(board, step);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(
        diagnostic('error', 'play-loop', where, `step "${step.kind}" failed: ${message}`),
      );
    }
  }

  return problems;
}
