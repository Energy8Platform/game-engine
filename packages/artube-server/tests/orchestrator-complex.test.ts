import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
import {
  startRound, advanceRound, acknowledgeSegment, type ActiveRound, type RoundDeps,
} from '../src/round/orchestrator';
import { decodeRoundState } from '../src/round/roundState';
import type { SessionContext } from '../src/session/types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
}, 30_000);

afterAll(() => engine?.close());

const ctx: SessionContext = {
  sessionId: 'sess-1', currency: 'USD', allowedBets: [0.1, 0.5, 1, 5],
};

function fakeApi() {
  let version = 0;
  return {
    playRound: vi.fn(async () => ({
      round_id: 'r', balance: 0, win: 0, is_platform_max_win_reached: false,
    })),
    openRound: vi.fn(async () => ({ round_version: 0, round_id: 'round-complex', balance: 95 })),
    updateRoundState: vi.fn(async () => ({ round_version: ++version })),
    closeRound: vi.fn(async () => ({ balance: 98, free_round_campaign: null })),
    autocloseRound: vi.fn(async () => ({ balance: 98 })),
  };
}

function deps(api: ReturnType<typeof fakeApi>): RoundDeps {
  return {
    api, engine, gameId: 'feature-game',
    costMultipliers: { spin: 1, buy_bonus: 5, free_spin: 1 },
  };
}

/** Пройти раунд целиком: spin + три фриспина, подтверждая каждый сегмент. */
async function playWhole(api: ReturnType<typeof fakeApi>) {
  const d = deps(api);
  const deliveries = [];
  const out = await startRound(d, ctx, { id: 'p0', action: 'spin', betIndex: 2 });
  deliveries.push(out.delivery);
  let round: ActiveRound | null = await acknowledgeSegment(d, ctx, out.round!, 1);
  let i = 0;
  while (round) {
    const next = await advanceRound(d, ctx, round, {
      id: `p${++i}`, action: 'free_spin', betIndex: 2,
    });
    deliveries.push(next.delivery);
    round = next.round ? await acknowledgeSegment(d, ctx, next.round, next.round.state.cursor + 1) : null;
  }
  return deliveries;
}

describe('оркестратор — сложный раунд', () => {
  it('многосегментный раунд открывается через OpenRound', async () => {
    const api = fakeApi();
    const out = await startRound(deps(api), ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    expect(api.openRound).toHaveBeenCalledTimes(1);
    expect(api.playRound).not.toHaveBeenCalled();
    expect(out.round).not.toBeNull();
    expect(out.round!.roundId).toBe('round-complex');
    expect(out.round!.roundVersion).toBe(0);
  });

  it('в OpenRound нет win_multiplier — выигрыш ещё не сыгран', async () => {
    const api = fakeApi();
    await startRound(deps(api), ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    const sent = api.openRound.mock.calls[0][0];
    expect(sent.bet_index).toBe(2);
    expect(sent.price_multiplier).toBe(1);
    expect(sent).not.toHaveProperty('win_multiplier');
  });

  it('первый сегмент отдаётся с creditPending и без баланса раунда', async () => {
    const api = fakeApi();
    const { delivery } = await startRound(deps(api), ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    expect(delivery.creditPending).toBe(true);
    expect(delivery.action).toBe('spin');
    expect(delivery.winX).toBe(0);
    expect(delivery.nextActions).toEqual(['free_spin']);
  });

  it('подтверждение сегмента двигает курсор через UpdateRoundState', async () => {
    const api = fakeApi();
    const d = deps(api);
    const { round } = await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    const advanced = await acknowledgeSegment(d, ctx, round!, 1);
    expect(api.updateRoundState).toHaveBeenCalledTimes(1);
    const sent = api.updateRoundState.mock.calls[0][0];
    expect(sent.round_id).toBe('round-complex');
    expect(sent.round_version).toBe(0); // версия из OpenRoundResponse
    expect(decodeRoundState(sent.round_state).cursor).toBe(1);
    expect(advanced.roundVersion).toBe(1); // версия из ответа
    expect(advanced.state.cursor).toBe(1);
  });

  it('каждый сегмент — один шаг движка, лог действий растёт', async () => {
    const api = fakeApi();
    const d = deps(api);
    const { round } = await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    const acked = await acknowledgeSegment(d, ctx, round!, 1);
    const next = await advanceRound(d, ctx, acked, { id: 'p2', action: 'free_spin', betIndex: 2 });
    expect(next.delivery.winX).toBe(1);
    expect(next.round!.state.actions).toEqual([{ a: 'free_spin' }]);
  });

  it('сыгранный сегмент уезжает в round_state сразу, курсор при этом стоит', async () => {
    const api = fakeApi();
    const d = deps(api);
    const { round } = await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    const acked = await acknowledgeSegment(d, ctx, round!, 1); // update #1: курсор 1
    const next = await advanceRound(d, ctx, acked, { id: 'p2', action: 'free_spin', betIndex: 2 });

    // update #2 — это запись самого факта "сегмент сыгран". Без неё сегмент,
    // который игрок сейчас смотрит, существовал бы только в памяти пода.
    expect(api.updateRoundState).toHaveBeenCalledTimes(2);
    const played = decodeRoundState(api.updateRoundState.mock.calls[1][0].round_state);
    expect(played.actions).toEqual([{ a: 'free_spin' }]);
    expect(played.cursor).toBe(1); // курсор двигает только ack
    // Версия раунда, которую вернул UpdateRoundState, обязана поехать дальше:
    // с устаревшей платформа отобьёт следующий UpdateRoundState/CloseRound.
    expect(next.round!.roundVersion).toBe(2);
  });

  it('финальный сегмент не платит лишней RPC — его действие едет в самом CloseRound', async () => {
    const api = fakeApi();
    const d = deps(api);
    let round = (await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 })).round!;
    round = await acknowledgeSegment(d, ctx, round, 1);
    for (let i = 0; i < 2; i++) {
      const out = await advanceRound(d, ctx, round, { id: `p${i}`, action: 'free_spin', betIndex: 2 });
      round = await acknowledgeSegment(d, ctx, out.round!, out.round!.state.cursor + 1);
    }
    const updatesBefore = api.updateRoundState.mock.calls.length;
    const final = await advanceRound(d, ctx, round, { id: 'p3', action: 'free_spin', betIndex: 2 });

    expect(final.round).toBeNull();
    expect(api.updateRoundState.mock.calls).toHaveLength(updatesBefore);
    const closed = decodeRoundState(api.closeRound.mock.calls[0][0].round_state);
    expect(closed.actions).toHaveLength(3);
    expect(closed.cursor).toBe(4);
  });

  it('интерактивный выбор игрока попадает в лог — иначе раунд не поднять', async () => {
    const api = fakeApi();
    const d = deps(api);
    const { round } = await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    const acked = await acknowledgeSegment(d, ctx, round!, 1);
    const next = await advanceRound(d, ctx, acked, {
      id: 'p2', action: 'free_spin', betIndex: 2, params: { pick: 3 },
    });
    expect(next.round!.state.actions).toEqual([{ a: 'free_spin', p: { pick: 3 } }]);
  });

  it('раунд доигрывается до конца и закрывается CloseRound', async () => {
    const api = fakeApi();
    const deliveries = await playWhole(api);
    expect(deliveries).toHaveLength(4);
    expect(deliveries.map((d) => d.winX)).toEqual([0, 1, 1, 1]);
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    const closed = api.closeRound.mock.calls[0][0];
    expect(closed.win_multiplier).toBe(3);
    expect(closed.status).toBe('completed');
  });

  it('баланс появляется только на финальном сегменте', async () => {
    const api = fakeApi();
    const deliveries = await playWhole(api);
    expect(deliveries.slice(0, 3).map((d) => d.balanceAfter)).toEqual([null, null, null]);
    expect(deliveries.slice(0, 3).every((d) => d.creditPending)).toBe(true);
    expect(deliveries[3].balanceAfter).toBe(98);
    expect(deliveries[3].creditPending).toBe(false);
  });

  it('CloseRound везёт round_version из последнего UpdateRoundState', async () => {
    const api = fakeApi();
    await playWhole(api);
    const updates = api.updateRoundState.mock.results;
    const lastVersion = (await (updates.at(-1)!.value as Promise<{ round_version: number }>)).round_version;
    expect(api.closeRound.mock.calls[0][0].round_version).toBe(lastVersion);
  });

  it('чужое действие в незакрытом раунде отвергается', async () => {
    const api = fakeApi();
    const d = deps(api);
    const { round } = await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    await expect(
      advanceRound(d, ctx, round!, { id: 'p2', action: 'buy_bonus', betIndex: 2 }),
    ).rejects.toThrow(/not allowed/);
  });
});
