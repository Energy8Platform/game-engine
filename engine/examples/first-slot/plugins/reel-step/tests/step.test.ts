/**
 * The other half of the claim. `plan.test.ts` proves this plugin can DESCRIBE
 * a step the engine's vocabulary lacks; these prove the plugin can RUN it —
 * through the real `createBoardStepRegistry` and the real `executePlan`,
 * neither of which was changed for this.
 *
 * What cannot be tested here, and why it isn't faked into looking tested: the
 * animated path. `ReelStepController.step` pays the winning cells and scrolls
 * the reels through the legacy `Tween`/`Ticker.shared`, which never settles
 * without a live pixi `Application` driving `requestAnimationFrame` —
 * measured by `@energy8engine/reels` for the same reason, see its module doc.
 * So the step exercised below is the one the controller completes
 * synchronously (no winning cells, no shift): enough to prove the registry
 * routes to this handler, that the handler reaches the board's grid, and
 * that it re-syncs the board afterwards. The moving picture is a browser's
 * to prove, not node's.
 */
import { describe, expect, it, vi } from 'vitest';
import { createBoardStepRegistry, executePlan } from '@energy8engine/play-loop';
import type { BoardApi } from '@energy8engine/play-loop';
import type { PresentationStep } from '@energy8engine/contracts';
import type { SymbolResolver } from '@energy8platform/game-engine/slot';
import { createReelStepHandler } from '../src/step';
import type { ReelStepStep } from '../src/mechanic';

const SETTLED = [
  [7, 1, 2],
  [4, 5, 6],
];

/**
 * The step the legacy controller can finish without a ticker — see the
 * module doc. `executePlan` takes the WIDE `PresentationStep`, which an
 * interface without an index signature is not assignable to; the double cast
 * is the one `StepHandler`'s own doc prescribes, in the other direction.
 */
const QUIET_STEP: ReelStepStep = {
  kind: 'reelStep',
  winning: [],
  shifts: [0, 0],
  settled: SETTLED,
  index: 0,
};
const asStep = (step: ReelStepStep): PresentationStep => step as unknown as PresentationStep;

/** Never called on the path these tests take — the quiet step draws nothing. */
const stubResolve = () => (() => ({})) as unknown as SymbolResolver;

/** Enough of a `ReelGrid` for this handler's guard and for the path it takes. */
function fakeBoard() {
  const calls: string[] = [];
  return {
    calls,
    grid: {
      destroyed: false,
      getCell: vi.fn(),
      rowsOf: vi.fn(() => 3),
      cellPosition: vi.fn(() => ({ x: 0, y: 0 })),
      setGrid: vi.fn(() => {
        calls.push('grid.setGrid');
      }),
    },
    async refill(step: { board: number[][] }) {
      calls.push(`refill:${JSON.stringify(step.board)}`);
    },
    async spinTo() {
      calls.push('spinTo');
    },
  };
}

describe('reel-step: the step the board did not have', () => {
  it('is a kind the board has no method for — without this plugin it is a diagnostic', async () => {
    // The claim, stated as a test: `reelStep` is not one of the six, and a
    // board built for the six cannot perform it. If this ever passes with no
    // diagnostic, the engine's vocabulary quietly grew a seventh kind and
    // this plugin stopped being the thing that proves it is open.
    const board = fakeBoard();
    const diagnostics = await executePlan([asStep(QUIET_STEP)], board as unknown as BoardApi);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('reelStep');
    expect(board.calls).toEqual([]);
  });

  it('runs through the registry, reaches the grid, and re-syncs the board', async () => {
    const board = fakeBoard();
    const registry = createBoardStepRegistry();
    registry.register(createReelStepHandler({ resolve: stubResolve }));

    const diagnostics = await executePlan(
      [asStep(QUIET_STEP)],
      board as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toEqual([]);
    // The controller settled the grid, and the handler then put the same
    // board back through the board's own `refill`, so the reel system's
    // `board` closure agrees with what is on screen.
    expect(board.calls).toEqual(['grid.setGrid', `refill:${JSON.stringify(SETTLED)}`]);
  });

  it('unregistering takes the step away again', () => {
    const registry = createBoardStepRegistry();
    const off = registry.register(createReelStepHandler({ resolve: stubResolve }));
    expect(registry.has('reelStep')).toBe(true);
    off();
    expect(registry.has('reelStep')).toBe(false);
  });

  it('a board that is not a reel board is a diagnostic naming the row that provides one', async () => {
    const registry = createBoardStepRegistry();
    registry.register(createReelStepHandler({ resolve: stubResolve }));

    const notAReelBoard = { async spinTo() {} };
    const diagnostics = await executePlan(
      [asStep(QUIET_STEP)],
      notAReelBoard as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('reels1');
  });

  it('a composition with no art is a diagnostic naming the art, not a frozen board', async () => {
    const registry = createBoardStepRegistry();
    registry.register(createReelStepHandler({ resolve: () => undefined }));

    const diagnostics = await executePlan(
      [asStep(QUIET_STEP)],
      fakeBoard() as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('assets');
  });

  it('a failing step is data: the plan carries on to the next step', async () => {
    const board = fakeBoard();
    const registry = createBoardStepRegistry();
    registry.register(createReelStepHandler({ resolve: () => undefined }));

    const diagnostics = await executePlan(
      [asStep(QUIET_STEP), { kind: 'spinTo', board: [[1]] }],
      board as unknown as BoardApi,
      registry,
    );

    expect(diagnostics).toHaveLength(1);
    expect(board.calls).toEqual(['spinTo']);
  });
});
