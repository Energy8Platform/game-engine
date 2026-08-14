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
    resync: vi.fn(async (r: ActiveRound) => r),
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
    expect(d.resync).not.toHaveBeenCalled(); // раунда нет — синхронизировать нечего
  });

  it('SessionIsNotInitialized посреди раунда: движок возвращается к round_state перед повтором', async () => {
    // Провалившаяся попытка успела сыграть сегмент в движке, а в `round_state`
    // он не попал: без resync повтор упирается в «движок впереди round_state»
    // и раунд заклинивает навсегда. Это ровно то, что видит каждая живая
    // сессия на первом же действии после переподключения к Games API.
    const d = deps();
    const live = round(1);
    const order: string[] = [];
    d.resync.mockImplementation(async (r: ActiveRound) => {
      order.push('resync');
      return r;
    });
    let calls = 0;
    const run = vi.fn(async (current: ActiveRound | null) => {
      order.push('run');
      if (++calls === 1) {
        throw new GamesApiError({ code: 'SessionIsNotInitialized', message: 'call SessionInfo first' });
      }
      return outcome(current);
    });
    const result = await withSessionRecovery(d, run, live);
    expect(order).toEqual(['run', 'resync', 'run']);
    expect(d.resync).toHaveBeenCalledWith(live);
    expect(result.round).toBe(live); // тот же раунд, а не новый
    expect(d.resume).not.toHaveBeenCalled();
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

  it('раунда у платформы больше нет, а мы в нём были — мидраундовое действие НЕ играется как новый раунд', async () => {
    // Реальная последовательность: игрок крутит последний фриспин, CloseRound
    // падает с InvalidRoundOperation (раунд успели закрыть автозакрытием, второй
    // вкладкой или ретраем платформы), свежий SessionInfo подтверждает, что
    // открытого раунда нет. `run(null)` здесь — это `startRound` с исходным
    // клиентским сообщением, то есть настоящий счёт за раунд, которого игрок
    // не заказывал.
    const d = deps({ settled: false, round: null });
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      throw new GamesApiError({ code: 'InvalidRoundOperation', message: 'Round is already closed.' });
    });
    await expect(withSessionRecovery(d, run, round(3))).rejects.toMatchObject({
      code: 'RoundAlreadySettled',
    });
    expect(calls).toBe(1); // ни одной повторной попытки — играть нечего
  });

  it('раунда не было и не должно быть — вход в новый раунд разрешён', async () => {
    // Тот же ответ платформы ("открытого раунда нет"), но провалился ВХОД в
    // раунд: клиентское действие и есть entry, повторить его правильно.
    const d = deps({ settled: false, round: null });
    let calls = 0;
    const run = vi.fn(async (current: ActiveRound | null) => {
      if (++calls === 1) {
        throw new GamesApiError({ code: 'InvalidRoundOperation', message: 'Round is already opened.' });
      }
      return outcome(current);
    });
    const result = await withSessionRecovery(d, run, null);
    expect(result.round).toBeNull();
    expect(calls).toBe(2);
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
