import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
import { resumeRound, autocloseRound } from '../src/round/resume';
import { decodeRoundState, encodeRoundState, newEngineRoundId, type RoundStateV1 } from '../src/round/roundState';
import type { RoundDeps } from '../src/round/orchestrator';
import type { SessionContext } from '../src/session/types';
import type { LastRound } from '../src/games-api/types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;
let scriptSha: string;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
  scriptSha = (await engine.listGames()).find((g) => g.game_id === 'feature-game')!.script_sha256;
}, 30_000);

afterAll(() => engine?.close());

const ctx: SessionContext = { sessionId: 's1', currency: 'USD', allowedBets: [0.1, 0.5, 1, 5] };

function fakeApi() {
  return {
    playRound: vi.fn(async () => ({ round_id: 'r', balance: 0, win: 0, is_platform_max_win_reached: false })),
    openRound: vi.fn(async () => ({ round_version: 0, round_id: 'r', balance: 0 })),
    updateRoundState: vi.fn(async () => ({ round_version: 2 })),
    closeRound: vi.fn(async () => ({ balance: 150, free_round_campaign: null })),
    autocloseRound: vi.fn(async () => ({ balance: 150 })),
  };
}

function deps(api: ReturnType<typeof fakeApi>): RoundDeps {
  return { api, engine, gameId: 'feature-game', costMultipliers: { spin: 1, free_spin: 1 } };
}

/** Незакрытый раунд, у которого подтверждено `cursor` сегментов. */
function lastRound(over: Partial<RoundStateV1> = {}, finished: string | null = null): LastRound {
  const cursor = over.cursor ?? 1;
  const full: RoundStateV1 = {
    v: 1, seed: { server: 'srv-r', client: 'cli', nonce: 3 }, eid: newEngineRoundId(),
    script: scriptSha, action: 'spin', betIndex: 2, priceMultiplier: 1,
    cursor, totalWinX: Math.max(0, cursor - 1),
    actions: Array.from({ length: Math.max(0, cursor - 1) }, () => ({ a: 'free_spin' })),
    ...over,
  };
  return {
    round_id: 'round-open', price_multiplier: 1, bet_index: 2, win_multiplier: 0, win: 0,
    started_at: '2026-08-10T10:00:00.000Z', finished_at: finished,
    round_version: 1, round_state_version: '1', round_state: encodeRoundState(full),
    is_platform_max_win_reached: false,
  };
}

describe('восстановление раунда', () => {
  it('закрытый раунд восстанавливать нечего', async () => {
    const res = await resumeRound(deps(fakeApi()), ctx, lastRound({}, '2026-08-10T10:00:05.000Z'));
    expect(res).toBeNull();
  });

  it('возвращает неподтверждённый сегмент, на котором игрок остановился', async () => {
    // cursor 2 — подтверждены spin и первый фриспин; показываем второй фриспин
    const res = await resumeRound(deps(fakeApi()), ctx, lastRound({ cursor: 2 }));
    expect(res).not.toBeNull();
    expect(res!.recovered).toBe(false);
    expect(res!.delivery.action).toBe('free_spin');
    expect(res!.delivery.winX).toBe(1);
    expect(res!.delivery.creditPending).toBe(true);
    expect(res!.round!.roundId).toBe('round-open');
    expect(res!.round!.roundVersion).toBe(1);
  });

  it('единственный неподтверждённый сегмент оказывается финальным — курсор и лог согласуются', async () => {
    // cursor 3 — подтверждены spin и два фриспина; переигрываем третий (последний)
    // фриспин заново. В отличие от cursor:4 движок ЕЩЁ не считает раунд
    // завершённым до этого шага — сюда попадает не round_complete-ветка, а
    // "переиграли — и это оказался финал", ветка с `cursor: nextState.cursor + 1`.
    const api = fakeApi();
    const res = await resumeRound(deps(api), ctx, lastRound({ cursor: 3 }));
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    const sent = api.closeRound.mock.calls[0][0];
    expect(sent.win_multiplier).toBe(3);
    expect(res!.round).toBeNull();
    expect(res!.recovered).toBe(false);
    expect(res!.delivery.creditPending).toBe(false);
    expect(res!.delivery.balanceAfter).toBe(150);
    // Именно это должно упасть, если арифметику курсора когда-нибудь сломают:
    // персистентный round_state обязан описывать все 3 сыгранных фриспина и
    // курсор на единицу больше их числа (entry + 3 подтверждённых фриспина).
    const persisted = decodeRoundState(sent.round_state);
    expect(persisted.actions.length).toBe(3);
    expect(persisted.cursor).toBe(4);
  });

  it('если оставался последний сегмент — раунд закрывается', async () => {
    const api = fakeApi();
    const res = await resumeRound(deps(api), ctx, lastRound({ cursor: 4 }));
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    expect(api.closeRound.mock.calls[0][0].win_multiplier).toBe(3);
    expect(res!.round).toBeNull();
    expect(res!.delivery.balanceAfter).toBe(150);
  });

  it('разъехавшийся скрипт закрывает раунд накопленным выигрышем', async () => {
    const api = fakeApi();
    const res = await resumeRound(
      deps(api), ctx, lastRound({ script: 'sha-старый', cursor: 3, totalWinX: 2 }),
    );
    expect(res!.recovered).toBe(true);
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    const closed = api.closeRound.mock.calls[0][0];
    expect(closed.win_multiplier).toBe(2); // накопленное из round_state, не ноль
    expect(closed.status).toBe('completed');
    expect(res!.round).toBeNull();
  });

  it('автозакрытие доигрывает раунд и шлёт AutocloseRoundRequest', async () => {
    const api = fakeApi();
    const balance = await autocloseRound(deps(api), ctx, lastRound({ cursor: 1 }));
    expect(api.autocloseRound).toHaveBeenCalledTimes(1);
    const sent = api.autocloseRound.mock.calls[0][0];
    expect(sent.round_id).toBe('round-open');
    expect(sent.win_multiplier).toBe(3); // полный математический итог, не откат
    expect(sent.status).toBe('completed');
    expect(sent.round_version).toBe(1);
    expect(balance).toBe(150);
  });

  it('автозакрытие при разъехавшемся скрипте берёт накопленное', async () => {
    const api = fakeApi();
    await autocloseRound(deps(api), ctx, lastRound({ script: 'sha-старый', cursor: 3, totalWinX: 2 }));
    expect(api.autocloseRound.mock.calls[0][0].win_multiplier).toBe(2);
  });
});
