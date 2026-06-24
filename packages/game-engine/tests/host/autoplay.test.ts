import { describe, it, expect, vi } from 'vitest';
import { createAutoplayLoop, type AutoplayDeps } from '@/host/autoplay';

function harness(over: Partial<AutoplayDeps> = {}) {
  const plays: string[] = [];
  const states: Array<{ active: boolean; remaining: number }> = [];
  const deps: AutoplayDeps = {
    resolveAction: () => 'spin',
    canAfford: () => true,
    playRound: async (a) => { plays.push(a); },
    onState: (s) => { states.push({ ...s }); },
    ...over,
  };
  return { deps, plays, states };
}

describe('createAutoplayLoop', () => {
  it('runs exactly N rounds then stops, decrementing remaining each spin', async () => {
    const { deps, plays, states } = harness();
    const a = createAutoplayLoop(deps);
    a.start(3);
    await vi.waitFor(() => expect(a.active).toBe(false));
    expect(plays).toEqual(['spin', 'spin', 'spin']);
    // start shows the full count, each spin decrements, the run ends inactive at 0.
    expect(states[0]).toEqual({ active: true, remaining: 3 });
    expect(states[states.length - 1]).toEqual({ active: false, remaining: 0 });
    expect(states.map((s) => s.remaining)).toEqual([3, 2, 1, 0, 0]);
  });

  it('halts when a spin is unaffordable (no further plays)', async () => {
    let budget = 2;
    const { deps, plays } = harness({ canAfford: () => budget-- > 0 });
    const a = createAutoplayLoop(deps);
    a.start(10);
    await vi.waitFor(() => expect(a.active).toBe(false));
    expect(plays).toHaveLength(2); // affordable twice, then halted
  });

  it('stop() ends the run after the in-flight round', async () => {
    let resolveRound!: () => void;
    const { deps, plays } = harness({ playRound: (a) => { plays.push(a); return new Promise<void>((r) => { resolveRound = r; }); } });
    const a = createAutoplayLoop(deps);
    a.start(5);
    await vi.waitFor(() => expect(plays.length).toBe(1)); // first round in flight
    a.stop();
    resolveRound(); // finish the in-flight round
    await vi.waitFor(() => expect(a.active).toBe(false));
    expect(plays).toHaveLength(1); // no further rounds after stop
  });

  it('halts on a play error (the round rejected)', async () => {
    const { deps, plays } = harness({ playRound: async (a) => { plays.push(a); throw new Error('boom'); } });
    const a = createAutoplayLoop(deps);
    a.start(5);
    await vi.waitFor(() => expect(a.active).toBe(false));
    expect(plays).toHaveLength(1);
  });

  it('start() is a no-op while already running or for count ≤ 0', async () => {
    const { deps, plays } = harness();
    const a = createAutoplayLoop(deps);
    a.start(2);
    a.start(99); // ignored — already active
    await vi.waitFor(() => expect(a.active).toBe(false));
    expect(plays).toHaveLength(2);
    a.start(0); // ignored — non-positive
    expect(a.active).toBe(false);
  });
});
