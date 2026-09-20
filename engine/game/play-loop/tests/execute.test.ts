import { describe, expect, it, vi } from 'vitest';
import { executePlan } from '../src/index';

function fakeBoard() {
  const calls: string[] = [];
  return {
    calls,
    spinTo: vi.fn(async () => {
      calls.push('spinTo');
    }),
    revealWins: vi.fn(async () => {
      calls.push('revealWins');
    }),
    remove: vi.fn(async () => {
      calls.push('remove');
    }),
    refill: vi.fn(async () => {
      calls.push('refill');
    }),
    tumble: vi.fn(async () => {
      calls.push('tumble');
    }),
  };
}

describe('executePlan', () => {
  it('runs the steps in order', async () => {
    const board = fakeBoard();
    await executePlan(
      [
        { kind: 'spinTo', board: [[1]] },
        { kind: 'revealWins', total: 1, lines: [] },
        { kind: 'remove', cells: [{ col: 0, row: 0 }] },
      ],
      board,
    );
    expect(board.calls).toEqual(['spinTo', 'revealWins', 'remove']);
  });

  it('waits for a slow step before starting the next', async () => {
    const board = fakeBoard();
    let settled = false;
    board.spinTo.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      settled = true;
      board.calls.push('spinTo');
    });
    board.revealWins.mockImplementation(async () => {
      expect(settled).toBe(true);
      board.calls.push('revealWins');
    });
    await executePlan(
      [
        { kind: 'spinTo', board: [[1]] },
        { kind: 'revealWins', total: 0, lines: [] },
      ],
      board,
    );
    expect(board.calls).toEqual(['spinTo', 'revealWins']);
  });

  it('passes each step its own payload', async () => {
    const board = fakeBoard();
    await executePlan([{ kind: 'refill', board: [[7]] }], board);
    // Two arguments since slice 25: the step, and the tempo the plan plays at
    // (`undefined` when the caller named none).
    expect(board.refill).toHaveBeenCalledWith({ kind: 'refill', board: [[7]] }, undefined);
  });

  it('reports a step the board cannot perform and keeps going', async () => {
    // A KNOWN kind whose method the board is missing — not an unknown
    // kind, which reaches the registry instead and is a different branch
    // with a different diagnostic. `remove` is deleted here so this test
    // measures the branch its name claims.
    const board = fakeBoard() as any;
    delete board.remove;
    const problems = await executePlan(
      [
        { kind: 'remove', cells: [{ col: 0, row: 0 }] },
        { kind: 'refill', board: [[1]] },
      ],
      board,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('remove');
    expect(board.calls).toEqual(['refill']);
  });

  it('reports a step that throws and still runs the rest', async () => {
    const board = fakeBoard();
    board.spinTo.mockRejectedValue(new Error('pixi died'));
    const problems = await executePlan(
      [
        { kind: 'spinTo', board: [[1]] },
        { kind: 'refill', board: [[2]] },
      ],
      board,
    );
    expect(problems[0].message).toContain('pixi died');
    expect(board.calls).toEqual(['refill']);
  });

  it('never throws, whatever the plan does', async () => {
    const board = fakeBoard();
    await expect(executePlan([{ kind: 'nonsense' } as any], board)).resolves.toBeInstanceOf(Array);
  });

  // Task 4: `board` is legitimately `undefined` at the one real caller
  // (first-slot's main.ts passes `game.ctx.board`, which is `undefined`
  // after a reels failure) — `executePlan` promises never to throw, and
  // indexing an undefined board would break that promise on the very
  // first step.
  it('reports a missing board as a diagnostic instead of throwing', async () => {
    const problems = await executePlan([{ kind: 'spinTo', board: [[1]] }], undefined);
    expect(problems).toHaveLength(1);
    expect(problems[0].severity).toBe('error');
    expect(problems[0].message).toContain('board');
  });

  it('does not report a missing board when the plan has nothing to run', async () => {
    const problems = await executePlan([], undefined);
    expect(problems).toEqual([]);
  });

  // Task 5: `isPresentationStep` wired in — a malformed plan entry (a
  // mechanic's bug, not a board's) becomes a diagnostic instead of a
  // TypeError from reading `.kind` off something that isn't a step at all.
  it('reports a malformed step as a diagnostic instead of throwing, and keeps going', async () => {
    const board = fakeBoard();
    const problems = await executePlan([null as any, { kind: 'spinTo', board: [[1]] }], board);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('malformed');
    expect(board.calls).toEqual(['spinTo']);
  });

  it('reports a step with a valid kind but the wrong shape as malformed, not a mistyped call', async () => {
    const board = fakeBoard();
    const problems = await executePlan([{ kind: 'spinTo', board: 'not-a-board' } as any], board);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('malformed');
    expect(board.spinTo).not.toHaveBeenCalled();
  });
});

/**
 * Slice 25 — tempo. A presentation can be hurried (`opts.turbo`) and the
 * `tumble` kind joined the vocabulary. Both are pure pass-through here:
 * `executePlan` decides nothing about what turbo MEANS, it only makes sure
 * the one thing that does — the board, or a plugin's handler — is told.
 */
describe('executePlan: StepOpts and tumble', () => {
  it('hands every board method the opts it was called with', async () => {
    const board = fakeBoard();

    await executePlan(
      [
        { kind: 'spinTo', board: [[1]] },
        {
          kind: 'tumble',
          winning: [],
          removed: [{ col: 0, row: 0 }],
          fresh: [{ col: 0, row: 0, symbol: 1 }],
          settled: [[1]],
        },
      ],
      board,
      undefined,
      { turbo: true },
    );

    expect(board.calls).toEqual(['spinTo', 'tumble']);
    expect(board.spinTo).toHaveBeenCalledWith({ kind: 'spinTo', board: [[1]] }, { turbo: true });
    expect(board.tumble).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tumble' }), {
      turbo: true,
    });
  });

  it('opts are undefined when the caller passes none — the pre-tempo call, unchanged', async () => {
    const board = fakeBoard();
    await executePlan([{ kind: 'spinTo', board: [[1]] }], board);
    expect(board.spinTo).toHaveBeenCalledWith({ kind: 'spinTo', board: [[1]] }, undefined);
  });

  it("hands a registered handler the same opts, after the board's own refusal", async () => {
    const board = fakeBoard();
    const run = vi.fn(async () => {});
    const registry = {
      register: () => () => {},
      has: () => true,
      get: (kind: string) => (kind === 'zap' ? { kind, run } : undefined),
      kinds: () => ['zap'],
      collisions: () => [],
    };

    await executePlan([{ kind: 'zap' }], board, registry, { turbo: true });

    expect(run).toHaveBeenCalledWith({ kind: 'zap' }, board, { turbo: true });
  });

  it('a tumble the board has no method for is the missing-method diagnostic, not an unknown kind', async () => {
    const board = fakeBoard() as Partial<ReturnType<typeof fakeBoard>>;
    delete board.tumble;
    const [problem] = await executePlan(
      [
        {
          kind: 'tumble',
          winning: [],
          removed: [],
          fresh: [],
          settled: [[1]],
        },
      ],
      board as never,
    );
    expect(problem.message).toContain('board cannot perform step "tumble"');
  });

  /**
   * Slice 25's fix wave: `hooks.onStepStarted`. The timing is the point —
   * after the step is invoked, before its promise is awaited. A skip fired
   * before the call would be wiped by `TumbleController.step`'s own
   * `_killed = false` on entry; one fired after the await would be too late.
   */
  describe('hooks.onStepStarted', () => {
    it('fires synchronously after each step is invoked, before it resolves', async () => {
      const order: string[] = [];
      const board = {
        spinTo: () => {
          order.push('invoked');
          return Promise.resolve().then(() => {
            order.push('resolved');
          });
        },
      };
      const run = vi.fn(async () => {});
      const registry = {
        register: () => () => {},
        has: () => true,
        get: (kind: string) => (kind === 'zap' ? { kind, run } : undefined),
        kinds: () => ['zap'],
        collisions: () => [],
      };

      await executePlan(
        [{ kind: 'spinTo', board: [[1]] }, { kind: 'zap' }],
        board as never,
        registry,
        undefined,
        {
          onStepStarted: (step) => order.push(`started:${step.kind}`),
        },
      );

      // The registry path announces its step the same way the board path does.
      expect(order).toEqual(['invoked', 'started:spinTo', 'resolved', 'started:zap']);
    });

    it('a hook that throws costs its step nothing — and no plan is asked for one', async () => {
      const board = fakeBoard();
      const problems = await executePlan(
        [{ kind: 'spinTo', board: [[1]] }],
        board,
        undefined,
        undefined,
        {
          onStepStarted: () => {
            throw new Error('nope');
          },
        },
      );
      expect(problems).toEqual([]);
      expect(board.calls).toEqual(['spinTo']);

      // No hooks at all: the call every caller before this parameter made.
      const plain = fakeBoard();
      expect(await executePlan([{ kind: 'spinTo', board: [[1]] }], plain)).toEqual([]);
      expect(plain.calls).toEqual(['spinTo']);
    });
  });
});
