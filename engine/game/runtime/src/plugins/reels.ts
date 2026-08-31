/**
 * `reels` as a cordis plugin — provides `ctx.board` (the `BoardApi`
 * `play-loop`'s `executePlan` drives) over `@energy8engine/reels`'
 * `createReelsBoard`.
 *
 * Deliberately **not** `inject: ['renderer']` or `['stage']`. Task 9
 * measured that `createReelSystem` builds its `Container`/`ReelGrid`
 * scene-graph headlessly — no live pixi `Application` needed for
 * construction, only for the animated paths (`spin`, `playWin`) to settle.
 * So the board itself has no real dependency on the renderer having
 * started, and this plugin does not invent one: `ctx.board` comes up
 * whenever `config.reels` is well-formed, renderer or no renderer. This is
 * exactly the half of "what doesn't need a canvas" this task's compose
 * test checks for.
 *
 * Mounting the board's view where a player can see it, on the other hand,
 * genuinely does need a stage to mount into — that half IS ordered through
 * `ctx.inject`, not through call order: it runs as soon as `stage` exists,
 * whether `stage` was registered before or after this plugin (measured —
 * see task-10-report.md's `ctx.inject` probe). If `stage` never comes up
 * (no renderer, or `stage` wasn't asked for), the board is simply never
 * mounted — visible nowhere, but still fully able to run `revealWins` /
 * `remove` / `refill` / `setMultiplier` against, which is what a
 * behind-the-scenes caller (a test, or a future headless play-through)
 * needs from it.
 */
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { createReelsBoard, type ReelsBoard } from '@energy8engine/reels';

declare module 'cordis' {
  interface Context {
    board: ReelsBoard;
  }
}

export interface ReelsConfig {
  options: Parameters<typeof createReelsBoard>[0];
  /** Shared with the owning `GameApp` — a malformed reels config is recorded here, not thrown. */
  diagnostics: Diagnostic[];
}

export const name = 'reels';

export function apply(ctx: Context, config: ReelsConfig): void {
  let board: ReelsBoard;
  try {
    board = createReelsBoard(config.options);
  } catch (error) {
    config.diagnostics.push(
      diagnostic(
        'error',
        'reels',
        'config',
        `the board did not build: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return;
  }

  ctx.effect(() => () => board.destroy(), 'reels:board');
  ctx.provide('board', board);

  ctx.inject(['stage'], (stageCtx) => {
    stageCtx.stage.container.addChild(board.view);
  });
}
