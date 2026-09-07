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
});
