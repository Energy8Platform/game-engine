import { describe, it, expect, vi } from 'vitest';
import { withSessionRecovery } from '../src/session/recovery';
import { GamesApiError } from '../src/games-api/errors';
import type { ActiveRound } from '../src/round/orchestrator';

const round = (version: number): ActiveRound => ({
  roundId: 'r1',
  roundVersion: version,
  state: {
    v: 1, seed: { server: 's', client: 'c', nonce: 1 }, script: 'sha',
    action: 'spin', betIndex: 0, priceMultiplier: 1, cursor: 1, totalWinX: 0, actions: [],
  },
  delivered: null,
});

function deps(recovered: ActiveRound | null = round(5)) {
  return {
    sessionInfo: vi.fn(async () => ({}) as any),
    resume: vi.fn(async () => recovered),
  };
}

describe('восстановление сессии', () => {
  it('успешный вызов проходит без вмешательства', async () => {
    const d = deps();
    const run = vi.fn(async () => 'ok');
    expect(await withSessionRecovery(d, run, null)).toBe('ok');
    expect(d.sessionInfo).not.toHaveBeenCalled();
  });

  it('SessionIsNotInitialized переинициализирует сессию и повторяет', async () => {
    const d = deps();
    let calls = 0;
    const run = vi.fn(async () => {
      if (++calls === 1) {
        throw new GamesApiError({ code: 'SessionIsNotInitialized', message: 'call SessionInfo first' });
      }
      return 'ok';
    });
    expect(await withSessionRecovery(d, run, null)).toBe('ok');
    expect(d.sessionInfo).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it('InvalidRoundOperation чинит раунд из SessionInfo и повторяет', async () => {
    const d = deps(round(5));
    const seen: Array<ActiveRound | null> = [];
    let calls = 0;
    const run = vi.fn(async (current: ActiveRound | null) => {
      seen.push(current);
      if (++calls === 1) {
        throw new GamesApiError({ code: 'InvalidRoundOperation', message: 'Invalid round version to update.' });
      }
      return 'ok';
    });
    expect(await withSessionRecovery(d, run, round(1))).toBe('ok');
    expect(seen[0]!.roundVersion).toBe(1); // первая попытка со старой версией
    expect(seen[1]!.roundVersion).toBe(5); // повтор с версией от платформы
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
