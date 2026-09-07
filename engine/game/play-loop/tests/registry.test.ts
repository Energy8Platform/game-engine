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
    spinTo: vi.fn(async () => { calls.push('spinTo'); }),
    revealWins: vi.fn(async () => { calls.push('revealWins'); }),
    remove: vi.fn(async () => { calls.push('remove'); }),
    refill: vi.fn(async () => { calls.push('refill'); }),
    setMultiplier: vi.fn(async () => { calls.push('setMultiplier'); }),
    wait: vi.fn(async () => { calls.push('wait'); }),
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
    registry.register({ kind: 'reelStep', run: async () => { seen.push('reelStep'); } });
    const diagnostics = await executePlan([{ kind: 'reelStep', shifts: [1, 0] }], board, registry);
    expect(seen).toEqual(['reelStep']);
    expect(diagnostics).toEqual([]);
  });

  it('a built-in kind still goes to the board, not the registry', async () => {
    registry.register({ kind: 'spinTo', run: async () => { throw new Error('registry must not win'); } });
    const diagnostics = await executePlan([{ kind: 'spinTo', board: [[1]] }], board, registry);
    expect(diagnostics).toEqual([]);
    expect(board.calls).toEqual(['spinTo']);
  });

  it('an unknown kind is a diagnostic naming the kind and what IS known', async () => {
    const [d] = await executePlan([{ kind: 'nope' }], board, registry);
    expect(d.message).toContain('nope');
    expect(d.message).toContain('spinTo');
  });

  it('unregistering removes the handler', async () => {
    const off = registry.register({ kind: 'x', run: async () => {} });
    off();
    expect(registry.has('x')).toBe(false);
  });

  it('a handler that rejects becomes a diagnostic, and the plan continues', async () => {
    registry.register({ kind: 'boom', run: async () => { throw new Error('handler blew up'); } });
    const diagnostics = await executePlan([{ kind: 'boom' }, { kind: 'spinTo', board: [[1]] }], board, registry);
    expect(diagnostics).toHaveLength(1);
    expect(board.calls).toEqual(['spinTo']);      // the next step still ran
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
  // six ONLY — a project that registers `reelStep` and mistypes it as
  // `reelStap` was told about `spinTo, revealWins, …`, never about the one
  // kind the typo was actually reaching for.
  it('an unknown kind diagnostic also names a kind the registry actually holds', async () => {
    registry.register({ kind: 'reelStep', run: async () => {} });
    const [d] = await executePlan([{ kind: 'reelStap' }], board, registry);
    expect(d.message).toContain('reelStap');
    expect(d.message).toContain('reelStep');
  });
});
