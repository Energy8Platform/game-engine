/**
 * `AutocloseRequestEvent` приходит на общий подовый коннект (не на конкретное
 * WS-соединение — того обычно уже нет, раунд брошен), поэтому проверяем это
 * через полный `ArtubeServer` + `startFakeGamesApi`, а не напрямую через
 * `round/resume.ts` (та математика уже покрыта `resume.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { WebSocket } from 'ws';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';
import { encodeRoundState, newEngineRoundId, newSeed, type RoundStateV1 } from '../src/round/roundState';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Брошенный, ещё не подтверждённый до конца раунд feature-game: только entry сыгран. */
function abandonedRoundState(): RoundStateV1 {
  return {
    v: 1,
    seed: newSeed(),
    eid: newEngineRoundId(),
    script: '', // холодный подъём сам заполнит — раунд ни разу не игрался в этом движке
    action: 'spin',
    betIndex: 0,
    priceMultiplier: 1,
    cursor: 1,
    totalWinX: 0,
    actions: [],
  };
}

const gameSettings = {
  default_bet_index: 0, currency_minimal_unit: 0.01, allowed_bets: [1],
  available_auto_spin_counts: [10], rtp_options: [],
  rtp_settings: { is_visible: false }, locales: ['EN'],
};

async function waitUntil(pred: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > timeoutMs) throw new Error('условие не выполнилось за отведённое время');
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Событие приходит на подовый коннект платформы, не в ответ на запрос —
 * поэтому его шлём напрямую через сокет, который держит ArtubeServer. */
function pushAutocloseEvent(api: FakeGamesApi, socket: WebSocket, sessionId: string, roundId: string): void {
  api.send(socket, {
    proto: 1, schema: 1, chan: 'events', type: 'AutocloseRequestEvent',
    id: `evt-${roundId}`, corr_id: null, op_seq: 999,
    timestamp: new Date().toISOString(),
    payload: { session_id: sessionId, round_id: roundId },
  });
}

describe('автозакрытие брошенного раунда (AutocloseRequestEvent)', () => {
  it('доигрывает раунд от лица игрока и шлёт AutocloseRoundRequest с честным итогом', async () => {
    let podSocket: WebSocket | null = null;
    const state = abandonedRoundState();
    const api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        podSocket = socket;
        const reply = (type: string, payload: unknown) =>
          self.send(socket, {
            proto: 1, schema: 1, chan: 'rpc', type,
            id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
            timestamp: new Date().toISOString(), payload,
          });
        if (env.type === 'SessionInfoRequest') {
          reply('SessionInfoResponse', {
            security_hash: 'h', currency: 'USD', balance: 100,
            last_round: {
              round_id: 'round-auto', price_multiplier: 1, bet_index: 0, win_multiplier: 0, win: 0,
              started_at: '2026-08-10T10:00:00.000Z', finished_at: null,
              round_version: 1, round_state_version: '1', round_state: encodeRoundState(state),
              is_platform_max_win_reached: false,
            },
            game_settings: gameSettings,
          });
        }
        if (env.type === 'AutocloseRoundRequest') reply('CloseRoundResponse', { balance: 155 });
      },
    });

    const server: ArtubeServer = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: api.url, apiKey: 'k', spinPath: fixtures,
    });
    await server.listen(0);

    await waitUntil(() => podSocket !== null);
    pushAutocloseEvent(api, podSocket!, 'sess-auto', 'round-auto');

    await waitUntil(() => api.received.some((e) => e.type === 'AutocloseRoundRequest'));
    const sent = api.received.find((e) => e.type === 'AutocloseRoundRequest')!;
    expect(sent.payload.round_id).toBe('round-auto');
    // feature.spin: entry (0) + 3 фриспина (1 + 1 + 1) = честный итог 3, не откат ставки.
    expect(sent.payload.win_multiplier).toBe(3);
    expect(sent.payload.status).toBe('completed');

    await server.close();
    await api.close();
  }, 40_000);

  it('раунд уже завершён на платформе — AutocloseRoundRequest не отправляется', async () => {
    let podSocket: WebSocket | null = null;
    const state = abandonedRoundState();
    const api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        podSocket = socket;
        const reply = (type: string, payload: unknown) =>
          self.send(socket, {
            proto: 1, schema: 1, chan: 'rpc', type,
            id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
            timestamp: new Date().toISOString(), payload,
          });
        if (env.type === 'SessionInfoRequest') {
          reply('SessionInfoResponse', {
            security_hash: 'h', currency: 'USD', balance: 100,
            last_round: {
              round_id: 'round-done', price_multiplier: 1, bet_index: 0, win_multiplier: 3, win: 3,
              started_at: '2026-08-10T10:00:00.000Z', finished_at: '2026-08-10T10:00:05.000Z',
              round_version: 2, round_state_version: '1', round_state: encodeRoundState(state),
              is_platform_max_win_reached: false,
            },
            game_settings: gameSettings,
          });
        }
        if (env.type === 'AutocloseRoundRequest') reply('CloseRoundResponse', { balance: 999 });
      },
    });

    const server: ArtubeServer = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: api.url, apiKey: 'k', spinPath: fixtures,
    });
    await server.listen(0);

    await waitUntil(() => podSocket !== null);
    pushAutocloseEvent(api, podSocket!, 'sess-done', 'round-done');

    // Дать обработчику время дойти до SessionInfoResponse и решить пропустить —
    // затем убедиться, что за это время ничего не улетело.
    await new Promise((r) => setTimeout(r, 500));
    expect(api.received.some((e) => e.type === 'AutocloseRoundRequest')).toBe(false);

    await server.close();
    await api.close();
  }, 40_000);
});
