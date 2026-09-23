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
    playState: vi.fn(async () => {
      calls.push('playState');
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

/**
 * Slice 30 — `playState`. Added to `KNOWN_STEP_KINDS` by Task 1, so it
 * reaches `board.playState` the same way `revealWins`/`remove`/etc. do — the
 * board gets first refusal, never the registry — and a board missing the
 * method is exactly the "board cannot perform" diagnostic the other five
 * known kinds already get.
 */
describe('executePlan: playState', () => {
  it('reaches board.playState, not the registry', async () => {
    const board = fakeBoard();
    const registry = {
      register: () => () => {},
      has: () => true,
      get: vi.fn(() => ({ kind: 'playState', run: vi.fn(async () => {}) })),
      kinds: () => ['playState'],
      collisions: () => [],
    };
    const step = { kind: 'playState' as const, cells: [{ col: 0, row: 0 }], state: 'death' };

    const problems = await executePlan([step], board, registry);

    expect(problems).toEqual([]);
    expect(board.calls).toEqual(['playState']);
    expect(board.playState).toHaveBeenCalledWith(step, undefined);
    // A registered handler for the SAME kind must never be consulted — the
    // board already declares this kind, so it always wins it.
    expect(registry.get).not.toHaveBeenCalled();
  });

  it('a board without playState is the "board cannot perform" diagnostic naming it', async () => {
    const board = fakeBoard() as any;
    delete board.playState;

    const problems = await executePlan(
      [{ kind: 'playState', cells: [{ col: 0, row: 0 }], state: 'death' }],
      board,
    );

    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('board cannot perform step "playState"');
  });
});

/**
 * Slice 31 — `wait: false`. A generic `executePlan` rule, not a per-kind
 * one: any step, known kind or registered handler, that carries
 * `wait === false` is STARTED and not awaited where it sits, so the next
 * step begins over the top of it. The plan is still atomic — everything
 * started this way is awaited at the very end, before the diagnostics are
 * returned.
 */
describe('executePlan: a step that does not hold the plan', () => {
  it('wait: false starts the step and the next one begins over the top of it', async () => {
    const board = fakeBoard();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    board.playState.mockImplementation(async () => {
      board.calls.push('playState:start');
      await held;
      board.calls.push('playState:end');
    });

    const running = executePlan(
      [
        { kind: 'playState', cells: [{ col: 0, row: 0 }], state: 'death', wait: false },
        { kind: 'spinTo', board: [[1]] },
      ],
      board,
    );

    // Still held, and `spinTo` has already run: the morph is playing over the
    // step that follows it, which is the whole point of the field.
    await Promise.race([running, new Promise((r) => setTimeout(r, 20))]);
    expect(board.calls).toEqual(['playState:start', 'spinTo']);

    release();
    expect(await running).toEqual([]);
    expect(board.calls).toEqual(['playState:start', 'spinTo', 'playState:end']);
  });

  /**
   * The atomicity half, and it has to be measured with the plan HELD — a
   * released gate queues its own continuation ahead of the returned promise's
   * reaction, so an `executePlan` that abandoned the step entirely would still
   * look right by the time the test read it. The non-blocking step is LAST
   * here for the same reason: with nothing after it, nothing else can be what
   * holds the plan open, and a plan that settles has genuinely walked away
   * from it. Remove `await Promise.all(pending)` from `executePlan` and this
   * is the case that fails.
   */
  it('the plan does not return until a non-blocking step has ended — even one started last', async () => {
    const board = fakeBoard();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    board.playState.mockImplementation(async () => {
      board.calls.push('playState:start');
      await held;
      board.calls.push('playState:end');
    });

    let settled = false;
    const running = executePlan(
      [
        { kind: 'spinTo', board: [[1]] },
        { kind: 'playState', cells: [{ col: 0, row: 0 }], state: 'death', wait: false },
      ],
      board,
    ).then((problems) => {
      settled = true;
      return problems;
    });

    await Promise.race([running, new Promise((r) => setTimeout(r, 20))]);
    expect(board.calls).toEqual(['spinTo', 'playState:start']);
    expect(settled).toBe(false);

    release();
    expect(await running).toEqual([]);
    expect(settled).toBe(true);
    expect(board.calls).toEqual(['spinTo', 'playState:start', 'playState:end']);
  });

  it('a non-blocking step that rejects is a diagnostic naming the index it started at', async () => {
    const board = fakeBoard();
    let fail!: (error: Error) => void;
    // Rejected only once the loop is long past index 0 — which is what makes
    // the index in the diagnostic worth asserting, and what makes the
    // diagnostic itself reachable only through the end-of-plan await.
    const held = new Promise<void>((_, reject) => (fail = reject));
    board.playState.mockImplementation(() => held);

    let settled = false;
    const running = executePlan(
      [
        { kind: 'playState', cells: [], state: 'death', wait: false },
        { kind: 'spinTo', board: [[1]] },
      ],
      board,
    ).then((problems) => {
      settled = true;
      return problems;
    });

    await Promise.race([running, new Promise((r) => setTimeout(r, 20))]);
    expect(board.calls).toEqual(['spinTo']);
    expect(settled).toBe(false);

    fail(new Error('nope'));
    expect((await running).map((d) => [d.where, d.message])).toEqual([
      ['plan[0]', 'step "playState" failed: nope'],
    ]);
  });

  it('a registered kind takes the same rule', async () => {
    const board = fakeBoard();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const run = vi.fn(async () => {
      board.calls.push('reelStep:start');
      await held;
      board.calls.push('reelStep:end');
    });
    const handler = { kind: 'reelStep', run };
    const registry = {
      register: () => () => {},
      has: (kind: string) => kind === 'reelStep',
      get: (kind: string) => (kind === 'reelStep' ? handler : undefined),
      kinds: () => ['reelStep'],
      collisions: () => [],
    };

    const running = executePlan(
      [
        { kind: 'reelStep', wait: false },
        { kind: 'spinTo', board: [[1]] },
      ],
      board,
      registry,
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(board.calls).toEqual(['reelStep:start', 'spinTo']);

    release();
    expect(await running).toEqual([]);
    expect(board.calls).toEqual(['reelStep:start', 'spinTo', 'reelStep:end']);
  });

  it('wait: true and wait absent both hold the plan', async () => {
    for (const wait of [true, undefined]) {
      const board = fakeBoard();
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      board.playState.mockImplementation(async () => {
        board.calls.push('playState:start');
        await held;
        board.calls.push('playState:end');
      });

      const running = executePlan(
        [
          { kind: 'playState', cells: [{ col: 0, row: 0 }], state: 'death', wait },
          { kind: 'spinTo', board: [[1]] },
        ],
        board,
      );

      await Promise.resolve();
      await Promise.resolve();
      expect(board.calls).toEqual(['playState:start']);

      release();
      expect(await running).toEqual([]);
      expect(board.calls).toEqual(['playState:start', 'playState:end', 'spinTo']);
    }
  });

  it('the started hook still announces a step that does not hold the plan', async () => {
    const board = fakeBoard();
    const announced: string[] = [];

    await executePlan(
      [
        { kind: 'playState', cells: [], state: 'death', wait: false },
        { kind: 'spinTo', board: [[1]] },
      ],
      board,
      undefined,
      undefined,
      { onStepStarted: (step) => announced.push(step.kind) },
    );

    expect(announced).toEqual(['playState', 'spinTo']);
  });
});
