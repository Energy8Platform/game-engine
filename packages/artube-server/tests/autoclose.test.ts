/**
 * `AutocloseRequestEvent` приходит на общий подовый коннект (не на конкретное
 * WS-соединение — того обычно уже нет, раунд брошен), поэтому проверяем это
 * через полный `ArtubeServer` + `startFakeGamesApi`, а не напрямую через
 * `round/resume.ts` (та математика уже покрыта `resume.test.ts`).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';
import { startFakePlatform } from './helpers/fakePlatform';
import { WebSocket } from 'ws';
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

/**
 * Всё, что надо погасить после теста, гасится хуком, а не последними строками
 * тела теста.
 *
 * Разница видна только на упавшем тесте — и ровно там она и важна: до этого
 * `await server.close()` стоял ПОСЛЕ ассертов, так что первый же провал
 * оставлял слушающий сервер и живой `e8-server` до конца процесса. Один такой
 * брошенный движок держит порт из окна поиска бессрочно и портит следующие
 * прогоны, а не только свой.
 */
const openable: Array<{ close(): unknown }> = [];

function track<T extends { close(): unknown }>(resource: T): T {
  openable.push(resource);
  return resource;
}

afterEach(async () => {
  // В обратном порядке: сервер отпускает коннект к платформе раньше, чем
  // исчезает сама платформа.
  for (const resource of openable.reverse()) await resource.close();
  openable.length = 0;
});

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

/** Минимальный WS-клиент к нашему серверу. */
class WsClient {
  private readonly socket: WebSocket;
  readonly messages: any[] = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.on('message', (d) => this.messages.push(JSON.parse(d.toString())));
  }

  async waitFor(t: string): Promise<any> {
    await waitUntil(() => this.messages.some((m) => m.t === t));
    return this.messages.find((m) => m.t === t);
  }

  send(msg: unknown): void {
    this.socket.send(JSON.stringify(msg));
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      this.socket.on('close', () => resolve());
      this.socket.close();
    });
  }
}

describe('автозакрытие брошенного раунда (AutocloseRequestEvent)', () => {
  it('доигрывает раунд от лица игрока и шлёт AutocloseRoundRequest с честным итогом', async () => {
    let podSocket: WebSocket | null = null;
    const state = abandonedRoundState();
    const api = track(await startFakeGamesApi({
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
    }));

    const server: ArtubeServer = track(createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: api.url, apiKey: 'k', spinPath: fixtures,
    }));
    await server.listen(0, '127.0.0.1');

    await waitUntil(() => podSocket !== null);
    pushAutocloseEvent(api, podSocket!, 'sess-auto', 'round-auto');

    await waitUntil(() => api.received.some((e) => e.type === 'AutocloseRoundRequest'));
    const sent = api.received.find((e) => e.type === 'AutocloseRoundRequest')!;
    expect(sent.payload.round_id).toBe('round-auto');
    // feature.spin: entry (0) + 3 фриспина (1 + 1 + 1) = честный итог 3, не откат ставки.
    expect(sent.payload.win_multiplier).toBe(3);
    expect(sent.payload.status).toBe('completed');
  }, 40_000);

  it('дубль события не превращается во вторую денежную RPC', async () => {
    // Копия события может прийти от кого угодно: ретрай платформы, реконнект
    // подового коннекта, просто две отправки. `AutocloseRoundRequest` двигает
    // деньги и повторяться не имеет права ни при каком раскладе.
    const platform = track(await startFakePlatform({ allowedBets: [2] }));
    const server: ArtubeServer = track(createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: platform.url, apiKey: 'k', spinPath: fixtures,
    }));
    await server.listen(0, '127.0.0.1');

    // Настоящий брошенный раунд: игрок открыл его и ушёл.
    const client = new WsClient(`ws://127.0.0.1:${server.port}/api/ws?sessionId=sess-dup`);
    await client.waitFor('init');
    client.send({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 });
    await client.waitFor('result');
    await client.close();

    const roundId = platform.roundOf('sess-dup')!.round_id;
    platform.emitEvent('AutocloseRequestEvent', { session_id: 'sess-dup', round_id: roundId });
    platform.emitEvent('AutocloseRequestEvent', { session_id: 'sess-dup', round_id: roundId });

    await waitUntil(() => platform.roundOf('sess-dup')!.finished_at !== null);
    await new Promise((r) => setTimeout(r, 300)); // дать второму проходу шанс успеть
    expect(platform.countOf('AutocloseRoundRequest')).toBe(1);
  }, 40_000);

  it('раунд уже завершён на платформе — AutocloseRoundRequest не отправляется', async () => {
    let podSocket: WebSocket | null = null;
    const state = abandonedRoundState();
    const api = track(await startFakeGamesApi({
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
    }));

    const server: ArtubeServer = track(createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: api.url, apiKey: 'k', spinPath: fixtures,
    }));
    await server.listen(0, '127.0.0.1');

    await waitUntil(() => podSocket !== null);
    pushAutocloseEvent(api, podSocket!, 'sess-done', 'round-done');

    // Дать обработчику время дойти до SessionInfoResponse и решить пропустить —
    // затем убедиться, что за это время ничего не улетело.
    await new Promise((r) => setTimeout(r, 500));
    expect(api.received.some((e) => e.type === 'AutocloseRoundRequest')).toBe(false);
  }, 40_000);
});
