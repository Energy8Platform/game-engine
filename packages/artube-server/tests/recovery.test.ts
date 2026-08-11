import { describe, it, expect, vi } from 'vitest';
import { withSessionRecovery, type PlayOutcome, type ResumeResult } from '../src/session/recovery';
import { GamesApiError } from '../src/games-api/errors';
import type { ActiveRound } from '../src/round/orchestrator';
import type { SegmentDelivery } from '../src/session/types';

const round = (version: number): ActiveRound => ({
  roundId: 'r1',
  roundVersion: version,
  state: {
    v: 1, seed: { server: 's', client: 'c', nonce: 1 }, script: 'sha',
    action: 'spin', betIndex: 0, priceMultiplier: 1, cursor: 1, totalWinX: 0, actions: [],
  },
  delivered: null,
});

const delivery = (over: Partial<SegmentDelivery> = {}): SegmentDelivery => ({
  roundId: 'r1', action: 'free_spin', data: {}, winX: 1, totalWinX: 3, betAmount: 1,
  nextActions: ['spin'], spinsRemaining: 0, spinsPlayed: 4, balanceAfter: 150,
  creditPending: false, maxWinReached: false,
  ...over,
});

const outcome = (round: ActiveRound | null, over: Partial<SegmentDelivery> = {}): PlayOutcome => ({
  delivery: delivery(over),
  round,
});

function deps(resume: ResumeResult = { settled: false, round: round(5) }) {
  return {
    sessionInfo: vi.fn(async () => ({}) as any),
    resume: vi.fn(async () => resume),
  };
}

describe('восстановление сессии', () => {
  it('успешный вызов проходит без вмешательства', async () => {
    const d = deps();
    const first = outcome(null);
    const run = vi.fn(async () => first);
    expect(await withSessionRecovery(d, run, null)).toBe(first);
    expect(d.sessionInfo).not.toHaveBeenCalled();
  });

  it('SessionIsNotInitialized переинициализирует сессию и повторяет', async () => {
    const d = deps();
    let calls = 0;
    const run = vi.fn(async () => {
      if (++calls === 1) {
        throw new GamesApiError({ code: 'SessionIsNotInitialized', message: 'call SessionInfo first' });
      }
      return outcome(null);
    });
    const result = await withSessionRecovery(d, run, null);
    expect(result.round).toBeNull();
    expect(d.sessionInfo).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
    expect(d.resume).not.toHaveBeenCalled(); // resume() чинит раунд, здесь чинить нечего
  });

  it('InvalidRoundOperation чинит раунд из SessionInfo и повторяет', async () => {
    const d = deps({ settled: false, round: round(5) });
    const seen: Array<ActiveRound | null> = [];
    let calls = 0;
    const run = vi.fn(async (current: ActiveRound | null) => {
      seen.push(current);
      if (++calls === 1) {
        throw new GamesApiError({ code: 'InvalidRoundOperation', message: 'Invalid round version to update.' });
      }
      return outcome(current);
    });
    await withSessionRecovery(d, run, round(1));
    expect(seen[0]!.roundVersion).toBe(1); // первая попытка со старой версией
    expect(seen[1]!.roundVersion).toBe(5); // повтор с версией от платформы
  });

  it('InvalidRoundOperation на финальном сегменте: recovery сам закрыл раунд — run() клиентским действием не повторяется', async () => {
    // resumeRound переиграл и тут же закрыл раунд (сегмент оказался
    // финальным) — settled-исход уже готов, а run() звать второй раз нельзя:
    // клиентское действие относилось к уже закрытому раунду, и startRound
    // принял бы его как entry нового раунда с реальным списанием денег.
    const settledOutcome = outcome(null, { creditPending: false, balanceAfter: 150, totalWinX: 3 });
    const d = deps({ settled: true, outcome: settledOutcome });
    const run = vi.fn(async () => {
      throw new GamesApiError({ code: 'InvalidRoundOperation', message: 'Invalid round version to update.' });
    });
    const result = await withSessionRecovery(d, run, round(3));
    expect(result).toBe(settledOutcome);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('повторяет ровно один раз', async () => {
    const d = deps();
    const run = vi.fn(async () => {
      throw new GamesApiError({ code: 'SessionIsNotInitialized', message: 'nope' });
    });
    await expect(withSessionRecovery(d, run, null)).rejects.toMatchObject({
      code: 'SessionIsNotInitialized',
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('денежные ошибки не восстанавливает — они едут во фронт', async () => {
    const d = deps();
    const run = vi.fn(async () => {
      throw new GamesApiError({ code: 'InsufficientFunds', message: 'no money' });
    });
    await expect(withSessionRecovery(d, run, null)).rejects.toMatchObject({
      code: 'InsufficientFunds',
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(d.sessionInfo).not.toHaveBeenCalled();
  });
});
