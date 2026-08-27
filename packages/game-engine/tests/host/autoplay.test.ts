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

  // ── Обрыв связи (замечание Artube: «autoplay stops, and after reconnection the counter is
  //    displayed correctly») ─────────────────────────────────────────────────────────────────
  describe('halt(): прогон прерван не игроком', () => {
    it('останавливает прогон, но СОХРАНЯЕТ остаток для показа', async () => {
      let resolveRound!: () => void;
      const { deps, plays, states } = harness({
        playRound: (a) => { plays.push(a); return new Promise<void>((r) => { resolveRound = r; }); },
      });
      const a = createAutoplayLoop(deps);
      a.start(5);
      await vi.waitFor(() => expect(plays.length).toBe(1)); // 1 в полёте, 4 в остатке
      a.halt();
      resolveRound();
      await vi.waitFor(() => expect(a.active).toBe(false));

      expect(plays).toHaveLength(1); // следующий авто-спин не стартовал
      expect(a.remaining).toBe(4);
      // Именно это видит игрок после реконнекта: прогон стоит, счётчик цел.
      expect(states.at(-1)).toEqual({ active: false, remaining: 4 });
    });

    it('прерванный прогон продолжается с того же места', async () => {
      const plays: string[] = [];
      const states: Array<{ active: boolean; remaining: number }> = [];
      let release!: () => void;
      const a = createAutoplayLoop({
        resolveAction: () => 'spin',
        canAfford: () => true,
        // Первый раунд висит (в нём и рвётся связь), остальные проходят.
        playRound: (act) => {
          plays.push(act);
          return plays.length === 1 ? new Promise<void>((r) => { release = r; }) : Promise.resolve();
        },
        onState: (s) => { states.push({ ...s }); },
      });
      a.start(5);
      await vi.waitFor(() => expect(plays.length).toBe(1));
      a.halt();
      release();
      await vi.waitFor(() => expect(a.active).toBe(false));
      expect(a.remaining).toBe(4);

      a.start(a.remaining); // так шелл возобновляет прогон нажатием на диск
      await vi.waitFor(() => expect(a.active).toBe(false));
      expect(plays).toHaveLength(5); // 1 до обрыва + 4 после — ровно заказанные игроком
      expect(states.at(-1)).toEqual({ active: false, remaining: 0 });
    });

    it('stop() поверх halt() убирает счётчик — игрок отказался от остатка', async () => {
      const { deps, states } = harness();
      const a = createAutoplayLoop(deps);
      a.start(5);
      a.halt();
      await vi.waitFor(() => expect(a.active).toBe(false));
      expect(a.remaining).toBeGreaterThan(0);

      a.stop();
      expect(a.remaining).toBe(0);
      expect(states.at(-1)).toEqual({ active: false, remaining: 0 });
    });

    it('halt() без активного прогона ничего не трогает', () => {
      const { deps, states } = harness();
      const a = createAutoplayLoop(deps);
      a.halt();
      expect(states).toEqual([]);
    });

    it('ошибка спина тоже сохраняет остаток (модалку показывает хост)', async () => {
      const { deps, states } = harness({
        playRound: async () => { throw new Error('connection lost'); },
      });
      const a = createAutoplayLoop(deps);
      a.start(5);
      await vi.waitFor(() => expect(a.active).toBe(false));
      expect(states.at(-1)).toEqual({ active: false, remaining: 4 });
    });
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
