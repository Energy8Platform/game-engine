import { describe, expect, it, vi } from 'vitest';
import { executePlan } from '../src/index';

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

describe('executePlan', () => {
  it('runs the steps in order', async () => {
    const board = fakeBoard();
    await executePlan([
      { kind: 'spinTo', board: [[1]] },
      { kind: 'revealWins', total: 1, lines: [] },
      { kind: 'remove', cells: [{ col: 0, row: 0 }] },
    ], board);
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
    await executePlan([{ kind: 'spinTo', board: [[1]] }, { kind: 'revealWins', total: 0, lines: [] }], board);
    expect(board.calls).toEqual(['spinTo', 'revealWins']);
  });

  it('passes each step its own payload', async () => {
    const board = fakeBoard();
    await executePlan([{ kind: 'setMultiplier', value: 3 }], board);
    expect(board.setMultiplier).toHaveBeenCalledWith({ kind: 'setMultiplier', value: 3 });
  });

  it('reports a step the board cannot perform and keeps going', async () => {
    const board = fakeBoard() as any;
    delete board.setMultiplier;
    const problems = await executePlan([
      { kind: 'setMultiplier', value: 2 },
      { kind: 'refill', board: [[1]] },
    ], board);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('setMultiplier');
    expect(board.calls).toEqual(['refill']);
  });

  it('reports a step that throws and still runs the rest', async () => {
    const board = fakeBoard();
    board.spinTo.mockRejectedValue(new Error('pixi died'));
    const problems = await executePlan([
      { kind: 'spinTo', board: [[1]] },
      { kind: 'refill', board: [[2]] },
    ], board);
    expect(problems[0].message).toContain('pixi died');
    expect(board.calls).toEqual(['refill']);
  });

  it('never throws, whatever the plan does', async () => {
    const board = fakeBoard();
    await expect(executePlan([{ kind: 'nonsense' } as any], board)).resolves.toBeInstanceOf(Array);
  });
});
