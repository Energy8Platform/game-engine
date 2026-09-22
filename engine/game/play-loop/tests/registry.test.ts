/**
 * Task 7: the `BoardStepRegistry` — the road for a step `BoardApi` does
 * not have, without editing this package. See `src/index.ts`'s module doc
 * for the precedence rule these tests pin down: the board always gets
 * first refusal, the registry is the fallback, never the other way round.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoardStepRegistry, executePlan, type BoardStepRegistry } from '../src/index';

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
    tumble: vi.fn(async () => {
      calls.push('tumble');
    }),
    refill: vi.fn(async () => {
      calls.push('refill');
    }),
    playState: vi.fn(async () => {
      calls.push('playState');
    }),
  };
}

describe('executePlan with a BoardStepRegistry', () => {
  let board: ReturnType<typeof fakeBoard>;
  let registry: BoardStepRegistry;

  beforeEach(() => {
    board = fakeBoard();
    registry = createBoardStepRegistry();
  });

  it('runs a registered step the built-in board does not know', async () => {
    const seen: string[] = [];
    registry.register({
      kind: 'reelStep',
      run: async () => {
        seen.push('reelStep');
      },
    });
    const diagnostics = await executePlan([{ kind: 'reelStep', shifts: [1, 0] }], board, registry);
    expect(seen).toEqual(['reelStep']);
    expect(diagnostics).toEqual([]);
  });

  it('a built-in kind still goes to the board, not the registry', async () => {
    registry.register({
      kind: 'spinTo',
      run: async () => {
        throw new Error('registry must not win');
      },
    });
    const diagnostics = await executePlan([{ kind: 'spinTo', board: [[1]] }], board, registry);
    expect(diagnostics).toEqual([]);
    expect(board.calls).toEqual(['spinTo']);
  });

  it('an unknown kind is a diagnostic naming the kind and what IS known', async () => {
    const [d] = await executePlan([{ kind: 'nope' }], board, registry);
    expect(d.message).toContain('nope');
    expect(d.message).toContain('spinTo');
  });

  // This list is the one thing a developer chasing a misspelling actually
  // reads, so what it offers has to be what a board can really do.
  // `setMultiplier` and `wait` were on it while no mechanic in the repo
  // could emit either and no board was ever asked to perform one — a third
  // of the advice, pointing nowhere. They are gone; this holds them gone.
  it('offers exactly the six kinds a board declares, and neither removed one', async () => {
    const [d] = await executePlan([{ kind: 'nope' }], board, registry);
    const offered = d.message.slice(d.message.indexOf('known kinds:'));
    for (const kind of ['spinTo', 'revealWins', 'remove', 'refill', 'tumble', 'playState']) {
      expect(offered, `should offer ${kind}`).toContain(kind);
    }
    expect(offered).not.toContain('setMultiplier');
    expect(offered).not.toContain('wait');
  });

  it('unregistering removes the handler', async () => {
    const off = registry.register({ kind: 'x', run: async () => {} });
    off();
    expect(registry.has('x')).toBe(false);
  });

  it('a handler that rejects becomes a diagnostic, and the plan continues', async () => {
    registry.register({
      kind: 'boom',
      run: async () => {
        throw new Error('handler blew up');
      },
    });
    const diagnostics = await executePlan(
      [{ kind: 'boom' }, { kind: 'spinTo', board: [[1]] }],
      board,
      registry,
    );
    expect(diagnostics).toHaveLength(1);
    expect(board.calls).toEqual(['spinTo']); // the next step still ran
  });

  // Review round: `executePlan` promises never to throw no matter what the
  // plan contains — that promise has to cover what a THIRD PARTY's
  // `BoardStepRegistry` does too, not just what its `run()` does.
  // `registry?.get(step.kind)` is a call into code this package does not
  // control, exactly like `run()` is, and a synchronously-throwing `get()`
  // reached `executePlan`'s caller as a rejection before this test existed.
  it('a registry whose get() throws becomes a diagnostic, not a throw', async () => {
    const throwingRegistry: BoardStepRegistry = {
      register: () => () => {},
      has: () => false,
      get: () => {
        throw new Error('get() blew up');
      },
      kinds: () => [],
      collisions: () => [],
    };
    const diagnostics = await executePlan(
      [{ kind: 'reelStep', shifts: [1, 0] }],
      board,
      throwingRegistry,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('reelStep');
    expect(diagnostics[0].message).toContain('get() blew up');
  });

  // The same promise, extended to the method `executePlan` now reads off
  // a registry BEFORE anything else happens. Adding that read put a
  // third-party call outside every existing guard — this pins that it is
  // inside one.
  it('a registry whose collisions() throws becomes a diagnostic, not a throw', async () => {
    const throwingRegistry: BoardStepRegistry = {
      register: () => () => {},
      has: () => false,
      get: () => undefined,
      kinds: () => [],
      collisions: () => {
        throw new Error('collisions() blew up');
      },
    };
    const diagnostics = await executePlan(
      [{ kind: 'spinTo', board: [[1]] }],
      board,
      throwingRegistry,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('collisions() blew up');
    // ...and the plan still ran.
    expect(board.calls).toEqual(['spinTo']);
  });

  // Same hazard, the other interface a third party's `board` implements
  // (task 9's, eventually): a throwing GETTER on the property named by
  // `step.kind`, not just a throwing METHOD once called. `board[step.kind]`
  // is a plain property read, and reading it is enough to run someone
  // else's code.
  it('a board whose property lookup throws becomes a diagnostic, not a throw', async () => {
    const evilBoard: any = {};
    Object.defineProperty(evilBoard, 'spinTo', {
      get() {
        throw new Error('property access blew up');
      },
    });
    const diagnostics = await executePlan([{ kind: 'spinTo', board: [[1]] }], evilBoard);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('spinTo');
    expect(diagnostics[0].message).toContain('property access blew up');
  });

  // Review round: the "known kinds" list used to be the compile-time fixed
  // built-ins ONLY — a project that registers `reelStep` and mistypes it as
  // `reelStap` was told about `spinTo, revealWins, …`, never about the one
  // kind the typo was actually reaching for.
  it('an unknown kind diagnostic also names a kind the registry actually holds', async () => {
    registry.register({ kind: 'reelStep', run: async () => {} });
    const [d] = await executePlan([{ kind: 'reelStap' }], board, registry);
    expect(d.message).toContain('reelStap');
    expect(d.message).toContain('reelStep');
  });
});

/**
 * Two plugins bringing the same step kind.
 *
 * `register` was `handlers.set(kind, handler)` — last writer wins, no
 * complaint, and the losing plugin's row composed, applied, and did
 * nothing at all with nothing on screen to say so. This is the parser's
 * own `NamedCollection` defect (two `record Vars`, silently one) rebuilt
 * on state SHARED BETWEEN PLUGINS, where it is worse: inside one file an
 * author can at least see both declarations.
 *
 * The rule, and it is the same one `NamedCollection` picked and the same
 * one `executePlan` already applies to the board: the INCUMBENT wins. A
 * registration that arrives second cannot silently take a kind another
 * plugin is already serving.
 */
describe('createBoardStepRegistry — two plugins claiming one kind', () => {
  it('keeps the first registration and refuses the second, instead of overwriting', async () => {
    const registry = createBoardStepRegistry();
    const ran: string[] = [];
    registry.register({
      kind: 'reelStep',
      run: async () => {
        ran.push('first');
      },
    });
    registry.register({
      kind: 'reelStep',
      run: async () => {
        ran.push('second');
      },
    });

    await executePlan([{ kind: 'reelStep' }], fakeBoard(), registry);
    expect(ran).toEqual(['first']);
  });

  it('says so, naming the kind and both claimants', () => {
    const registry = createBoardStepRegistry();
    registry.register({ kind: 'reelStep', run: async () => {} });
    registry.register({ kind: 'reelStep', run: async () => {} });

    const [d] = registry.collisions();
    expect(d.severity).toBe('error');
    expect(d.message).toContain('reelStep');
    // Both claimants, in the only vocabulary a `StepHandler` has: the one
    // already serving the kind, and the one that arrived after it.
    expect(d.message).toContain('already registered');
    expect(d.message).toContain('ignored');
  });

  it('the refused registration disposes to nothing — it must not unregister the winner', async () => {
    const registry = createBoardStepRegistry();
    const winner = { kind: 'reelStep', run: async () => {} };
    registry.register(winner);
    const offLoser = registry.register({ kind: 'reelStep', run: async () => {} });

    offLoser();

    // The loser never held the kind, so disposing it takes nothing away.
    expect(registry.get('reelStep')).toBe(winner);
  });

  it('a kind re-registered AFTER the first was disposed is not a collision', () => {
    // The ordinary plugin lifecycle: a row leaves the composition, its
    // `ctx.effect` disposer runs, and the kind is free again. Reporting
    // that as a collision would make every hot reload look like a
    // misconfigured project.
    const registry = createBoardStepRegistry();
    const off = registry.register({ kind: 'reelStep', run: async () => {} });
    off();
    registry.register({ kind: 'reelStep', run: async () => {} });
    expect(registry.collisions()).toEqual([]);
  });

  it('executePlan reports the collision — it is not left sitting in the registry', async () => {
    // The registry is cordis-free and has no channel of its own. This is
    // the outlet it does have: `executePlan` already returns everything
    // that went wrong while running a plan, and "the handler for this kind
    // is not the one that plugin registered" is exactly that.
    const registry = createBoardStepRegistry();
    registry.register({ kind: 'reelStep', run: async () => {} });
    registry.register({ kind: 'reelStep', run: async () => {} });

    const diagnostics = await executePlan([{ kind: 'reelStep' }], fakeBoard(), registry);
    expect(
      diagnostics.some(
        (d) => d.message.includes('reelStep') && d.message.includes('already registered'),
      ),
    ).toBe(true);
  });
});

/**
 * `board[step.kind]` is a property read on an object with a prototype, and
 * it used to run for EVERY kind — so which kinds actually reached the
 * registry was decided by JavaScript's object model rather than by the
 * vocabulary.
 *
 * The board-first rule is now gated on `KNOWN_STEP_KINDS`: the six kinds
 * `BoardApi` declares go to the board, everything else goes straight to
 * the registry. That is exactly what this file's module doc always
 * claimed, and what `executePlan`'s own doc says.
 */
describe('executePlan — the board only wins the kinds BoardApi actually declares', () => {
  it('a kind named after an Object.prototype member reaches its registered handler', () => {
    // Before the gate: `board.toString` is inherited from
    // `Object.prototype`, `typeof` it is `'function'`, so `executePlan`
    // called THAT and the plugin's handler was never consulted — silently,
    // because `Object.prototype.toString.call(board)` returns a string
    // rather than throwing. Same for `valueOf`, `constructor`,
    // `hasOwnProperty`.
    return Promise.all(
      ['toString', 'valueOf', 'constructor', 'hasOwnProperty'].map(async (kind) => {
        const registry = createBoardStepRegistry();
        let ran = false;
        registry.register({
          kind,
          run: async () => {
            ran = true;
          },
        });
        const diagnostics = await executePlan([{ kind }], fakeBoard(), registry);
        expect(diagnostics, `${kind} should run clean`).toEqual([]);
        expect(ran, `${kind} should have reached its handler`).toBe(true);
      }),
    );
  });

  it('a board method for a kind BoardApi never declared does not outrank the registry', async () => {
    // `ReelsBoard` really does carry methods past the six — `destroy()`
    // among them — so "whatever the board happens to have" is a wider and
    // more dangerous rule than "the six", not a hypothetical one.
    const board = {
      ...fakeBoard(),
      reelStep: async () => {
        throw new Error('board must not win this');
      },
    };
    const registry = createBoardStepRegistry();
    let ran = false;
    registry.register({
      kind: 'reelStep',
      run: async () => {
        ran = true;
      },
    });

    const diagnostics = await executePlan([{ kind: 'reelStep' }], board as never, registry);
    expect(diagnostics).toEqual([]);
    expect(ran).toBe(true);
  });

  it('a kind BoardApi never declared, with nothing registered, is still reported', async () => {
    // The gate must not turn an unknown kind into silence: the board is
    // no longer asked, so the message is now only about the registry, and
    // it still has to appear.
    const registry = createBoardStepRegistry();
    const [d] = await executePlan([{ kind: 'toString' }], fakeBoard(), registry);
    expect(d).toBeDefined();
    expect(d.message).toContain('toString');
  });

  it('the six still go to the board even when something is registered for them', async () => {
    // The rule this gate must not weaken, restated against the gate.
    const board = fakeBoard();
    const registry = createBoardStepRegistry();
    registry.register({
      kind: 'spinTo',
      run: async () => {
        throw new Error('registry must not win');
      },
    });
    const diagnostics = await executePlan([{ kind: 'spinTo', board: [[1]] }], board, registry);
    expect(diagnostics).toEqual([]);
    expect(board.calls).toEqual(['spinTo']);
  });
});
