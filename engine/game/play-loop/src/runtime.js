/**
 * Runtime half of `play-loop` — the `playloop1` row in `e8-base`.
 *
 * See `@energy8engine/boot`'s `src/runtime.js` module doc for why this
 * file's `@energy8engine/contracts` import does not actually resolve yet
 * over `GET /plugin-runtime/:id`.
 *
 * `./index.ts`'s `executePlan` is a plain function with no cordis
 * dependency of its own — `main.ts` calls it directly today
 * (`executePlan(plan, game.ctx.board)`), not through `ctx`. This row's
 * only job is to put that same function on `ctx` (`ctx.play.execute`) so
 * a caller composed purely from the project (no static import of
 * `@energy8engine/play-loop` at all) can still reach it. `config` is
 * unused — `play-loop` has no settings, only a capability.
 */
import { diagnostic, isPresentationStep } from '@energy8engine/contracts';

export const name = 'play-loop';

async function executePlan(plan, board) {
  if (!board) {
    if (plan.length === 0) return [];
    return [
      diagnostic('error', 'play-loop', 'board', 'cannot run a presentation plan: no board to run it on'),
    ];
  }

  const problems = [];

  for (let index = 0; index < plan.length; index += 1) {
    const step = plan[index];
    const where = `plan[${index}]`;

    if (!isPresentationStep(step)) {
      problems.push(diagnostic('error', 'play-loop', where, `malformed step in plan: ${JSON.stringify(step)}`));
      continue;
    }

    const method = board[step.kind];
    if (typeof method !== 'function') {
      problems.push(
        diagnostic('error', 'play-loop', where, `board cannot perform step "${step.kind}": no matching method`),
      );
      continue;
    }

    try {
      await method.call(board, step);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      problems.push(diagnostic('error', 'play-loop', where, `step "${step.kind}" failed: ${message}`));
    }
  }

  return problems;
}

export function apply(ctx, config) {
  ctx.provide('play', { execute: executePlan });
}
