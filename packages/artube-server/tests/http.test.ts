import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let api: FakeGamesApi;
let server: ArtubeServer;
let base: string;

/** Фейковый Games API, отвечающий на весь цикл раунда. */
function responder(sessionCurrency: string | null = 'USD') {
  return (env: any, socket: any, self: FakeGamesApi) => {
    const reply = (type: string, payload: unknown) =>
      self.send(socket, {
        proto: 1, schema: 1, chan: 'rpc', type,
        id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
        timestamp: new Date().toISOString(), payload,
      });
    if (env.type === 'SessionInfoRequest') {
      reply('SessionInfoResponse', {
        security_hash: 'h', currency: sessionCurrency, balance: 100,
        game_settings: {
          default_bet_index: 0, currency_minimal_unit: 0.01, allowed_bets: [1],
          available_auto_spin_counts: [10], rtp_options: [],
          rtp_settings: { is_visible: false }, locales: ['EN'],
        },
      });
    }
    if (env.type === 'OpenRoundRequest') {
      reply('OpenRoundResponse', { round_version: 0, round_id: 'round-1', balance: 99 });
    }
    if (env.type === 'UpdateRoundStateRequest') reply('UpdateRoundStateResponse', { round_version: 1 });
    if (env.type === 'CloseRoundRequest') reply('CloseRoundResponse', { balance: 102 });
  };
}

/** Открыть WS к нашему серверу и собирать входящие сообщения. */
function connect(url: string) {
  const socket = new WebSocket(url);
  const messages: any[] = [];
  socket.on('message', (d) => messages.push(JSON.parse(d.toString())));
  const waitFor = (t: string, timeoutMs = 5000) =>
    new Promise<any>((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        const found = messages.find((m) => m.t === t);
        if (found) { clearInterval(tick); resolve(found); }
        else if (Date.now() - started > timeoutMs) { clearInterval(tick); reject(new Error(`no ${t}`)); }
      }, 10);
    });
  const open = new Promise<void>((resolve) => socket.on('open', () => resolve()));
  return { socket, messages, waitFor, open };
}

beforeAll(async () => {
  api = await startFakeGamesApi({ onMessage: responder() });
  server = createArtubeServer({
    gameId: 'feature-game',
    gamesApiUrl: api.url,
    apiKey: 'k',
    spinPath: fixtures,
  });
  await server.listen(0);
  base = `ws://127.0.0.1:${server.port}`;
}, 40_000);

afterAll(async () => {
  await server?.close();
  await api?.close();
});

describe('HTTP-слой', () => {
  it('отвечает на health-пробы Kubernetes', async () => {
    const http = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${http}/livez`)).status).toBe(200);
    expect((await fetch(`${http}/healthz`)).status).toBe(200);
  });

  it('версия отдаётся под префиксом /api', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/version`);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('gameId', 'feature-game');
  });

  it('WS без sessionId отвергается', async () => {
    const { socket } = connect(`${base}/api/ws`);
    const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
    expect(await closed).toBe(1008);
  });

  /**
   * Бэкенд игры смонтирован платформой под `/api/<slug>`, и наш собственный
   * `/api/**` остаётся на конце (снято с живого стенда:
   * `wss://dev.artube-888.live/api/artube-o7df8qem5k/api/ws`). Сколько из
   * этого reverse proxy срежет перед нами — её конфигурация, снаружи не
   * наблюдаемая; вариантов три, и мы обязаны отвечать на все, иначе
   * «не срезала» = молчаливый 404 на живом сервере при зелёных тестах.
   */
  describe('маршруты /api под платформенным префиксом', () => {
    const prefixes = [
      ['', 'прокси срезала префикс целиком'],
      ['/api/artube-o7df8qem5k', 'прокси не срезала ничего — форма живого стенда'],
      ['/artube-o7df8qem5k', 'прокси срезала только внешнее /api'],
    ] as const;

    for (const [prefix, why] of prefixes) {
      it(`версия отвечает: ${why}`, async () => {
        const res = await fetch(`http://127.0.0.1:${server.port}${prefix}/api/version`);
        expect(res.status).toBe(200);
        expect(await res.json()).toHaveProperty('gameId', 'feature-game');
      });

      it(`сокет поднимается: ${why}`, async () => {
        const c = connect(`${base}${prefix}/api/ws?sessionId=sess-prefix${prefix.length}`);
        c.socket.on('error', () => {});
        await c.open;
        expect(await c.waitFor('init')).toHaveProperty('balance');
        c.socket.close();
      });
    }

    it('маршруты не путаются между собой под префиксом', async () => {
      // `/api/version` под префиксом не должен становиться сокетом и наоборот:
      // хвост различает их так же, как в корне.
      const { socket } = connect(
        `${base}/api/artube-o7df8qem5k/api/version?sessionId=sess-mixup`,
      );
      const closed = new Promise<number>((resolve) => socket.on('close', () => resolve(1)));
      socket.on('error', () => {});
      expect(await closed).toBe(1);
    });

    it('пробы отвечают и через префикс — оператору незачем гадать, что значит 404', async () => {
      // Kubernetes зовёт пробы прямо в под, без префикса, и этот путь остаётся
      // точным. Но через платформенный прокси тот же `/livez` возвращал наш
      // собственный `{"error":"not found"}` — сигнал, неотличимый от «под
      // не отвечает» ровно в тот момент, когда это важнее всего.
      const http = `http://127.0.0.1:${server.port}`;
      for (const prefix of ['', '/api/artube-o7df8qem5k', '/artube-o7df8qem5k']) {
        expect((await fetch(`${http}${prefix}/livez`)).status).toBe(200);
        expect((await fetch(`${http}${prefix}/healthz`)).status).toBe(200);
      }
      // Хвост — граница по `/`, как и у остальных маршрутов.
      expect((await fetch(`${http}/xlivez`)).status).toBe(404);
      expect((await fetch(`${http}/api/artube-o7df8qem5k/xhealthz`)).status).toBe(404);
    });

    it('похожий, но чужой путь по-прежнему не маршрут', async () => {
      expect((await fetch(`http://127.0.0.1:${server.port}/xapi/version`)).status).toBe(404);
      expect(
        (await fetch(`http://127.0.0.1:${server.port}/api/artube-o7df8qem5k/xapi/version`)).status,
      ).toBe(404);
      const { socket } = connect(`${base}/notapi/ws?sessionId=sess-prefix`);
      const closed = new Promise<number>((resolve) => socket.on('close', () => resolve(1)));
      socket.on('error', () => {});
      expect(await closed).toBe(1);
    });
  });
});

describe('WS-цикл раунда', () => {
  it('на подключении отдаёт init из SessionInfo', async () => {
    const c = connect(`${base}/api/ws?sessionId=sess-1`);
    await c.open;
    const init = await c.waitFor('init');
    expect(init.balance).toBe(100);
    expect(init.currency).toBe('USD');
    expect(init.config.betLevels).toEqual([1]);
    c.socket.close();
  });

  it('play отдаёт сегмент, ack двигает курсор, финал приносит баланс', async () => {
    const c = connect(`${base}/api/ws?sessionId=sess-2`);
    await c.open;
    await c.waitFor('init');

    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const first = await c.waitFor('result');
    expect(first.id).toBe('p0');
    expect(first.creditPending).toBe(true);
    expect(first.balanceAfter).toBeNull();
    expect(first.nextActions).toEqual(['free_spin']);

    c.socket.send(JSON.stringify({ t: 'ack', roundId: first.roundId, cursor: 1 }));
    for (let i = 1; i <= 3; i++) {
      const before = c.messages.length;
      c.socket.send(JSON.stringify({ t: 'play', id: `p${i}`, action: 'free_spin', betIndex: 0 }));
      await new Promise<void>((resolve) => {
        const tick = setInterval(() => {
          if (c.messages.length > before) { clearInterval(tick); resolve(); }
        }, 10);
      });
      const last = c.messages.at(-1);
      expect(last.t).toBe('result');
      if (i < 3) {
        c.socket.send(JSON.stringify({ t: 'ack', roundId: last.roundId, cursor: i + 1 }));
      } else {
        expect(last.creditPending).toBe(false);
        expect(last.balanceAfter).toBe(102);
        expect(last.totalWinX).toBe(3);
      }
    }
    c.socket.close();
  });

  it('ошибка платформы приезжает во фронт как error с кодом', async () => {
    const failing = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        // Ровно один ответ на OpenRoundRequest — платформа не отвечает
        // дважды на один запрос. Отвечаем ошибкой вместо обычного
        // OpenRoundResponse, а не вдобавок к нему: иначе первый (успешный)
        // ответ выигрывает гонку по corr_id и второй (Error) молча
        // отбрасывается — тест перестаёт проверять то, что заявлено.
        if (env.type === 'OpenRoundRequest') {
          self.send(socket, {
            proto: 1, schema: 1, chan: 'rpc', type: 'Error',
            id: `e-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
            timestamp: new Date().toISOString(),
            payload: { code: 'InsufficientFunds', message: 'no money', details: {} },
          });
          return;
        }
        responder()(env, socket, self);
      },
    });
    const s = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: failing.url, apiKey: 'k', spinPath: fixtures,
    });
    await s.listen(0);
    const c = connect(`ws://127.0.0.1:${s.port}/api/ws?sessionId=sess-3`);
    await c.open;
    await c.waitFor('init');
    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const err = await c.waitFor('error');
    expect(err.code).toBe('InsufficientFunds');
    c.socket.close();
    await s.close();
    await failing.close();
  }, 40_000);

  it('демо-сессия не ходит в платформу за раундами', async () => {
    const demoApi = await startFakeGamesApi({ onMessage: responder(null) });
    const s = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: demoApi.url, apiKey: 'k', spinPath: fixtures,
    });
    await s.listen(0);
    const c = connect(`ws://127.0.0.1:${s.port}/api/ws?sessionId=sess-demo`);
    await c.open;
    const init = await c.waitFor('init');
    expect(init.demo).toBe(true);
    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const res = await c.waitFor('result');
    expect(res.winX).toBe(0);
    expect(demoApi.received.some((e) => e.type === 'OpenRoundRequest')).toBe(false);
    c.socket.close();
    await s.close();
    await demoApi.close();
  }, 40_000);
});

describe('восстановление после ошибок сессии/раунда (WS)', () => {
  /** Отвечает `Error` с заданным кодом на первое совпадение `matchType`, затем — как обычно. */
  function respondOnceThenRecover(matchType: string, code: string, message: string) {
    let failed = false;
    return (env: any, socket: any, self: FakeGamesApi) => {
      if (env.type === matchType && !failed) {
        failed = true;
        self.send(socket, {
          proto: 1, schema: 1, chan: 'rpc', type: 'Error',
          id: `e-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
          timestamp: new Date().toISOString(),
          payload: { code, message, details: {} },
        });
        return;
      }
      responder()(env, socket, self);
    };
  }

  it('SessionIsNotInitialized: SessionInfo перечитывается, play повторяется и доходит до игрока', async () => {
    const flaky = await startFakeGamesApi({
      onMessage: respondOnceThenRecover(
        'OpenRoundRequest', 'SessionIsNotInitialized', 'Call SessionInfoRequest first.',
      ),
    });
    const s = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: flaky.url, apiKey: 'k', spinPath: fixtures,
    });
    await s.listen(0);
    const c = connect(`ws://127.0.0.1:${s.port}/api/ws?sessionId=sess-recover-1`);
    await c.open;
    await c.waitFor('init');

    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const result = await c.waitFor('result');
    expect(result.id).toBe('p0');
    expect(result.creditPending).toBe(true);

    // Один провал + одно восстановление: SessionInfo уходит дважды (коннект
    // + перечитывание в recovery), OpenRoundRequest — дважды (провал + повтор).
    expect(flaky.received.filter((e) => e.type === 'SessionInfoRequest')).toHaveLength(2);
    expect(flaky.received.filter((e) => e.type === 'OpenRoundRequest')).toHaveLength(2);

    c.socket.close();
    await s.close();
    await flaky.close();
  }, 40_000);

  it('SessionIsNotInitialized ПОСРЕДИ раунда: повтор играет тот же сегмент, а не спотыкается о движок', async () => {
    // Это ровно то, что видит каждая живая сессия после переподключения к
    // Games API: сессия на новом коннекте не инициализирована, и первое же
    // мидраундовое действие получает `SessionIsNotInitialized`.
    //
    // Тонкость — в движке. `advanceRound` СНАЧАЛА играет сегмент и только
    // потом идёт в платформу: к моменту ошибки движок уже на шаг впереди
    // лога действий (лог пишется вместе с успешной RPC). Слепой повтор
    // упирается в строгую проверку `ensureOpen` («движок впереди
    // round_state») и отдаёт игроку InternalServerError — раунд после этого
    // заклинен до перезагрузки страницы, потому что впереди движок остаётся
    // навсегда.
    const flaky = await startFakeGamesApi({
      onMessage: respondOnceThenRecover(
        'UpdateRoundStateRequest', 'SessionIsNotInitialized', 'Call SessionInfoRequest first.',
      ),
    });
    const s = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: flaky.url, apiKey: 'k', spinPath: fixtures,
    });
    await s.listen(0);
    const c = connect(`ws://127.0.0.1:${s.port}/api/ws?sessionId=sess-recover-mid`);
    await c.open;
    await c.waitFor('init');

    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const spin = await c.waitFor('result');
    expect(spin.nextActions).toEqual(['free_spin']);

    c.socket.send(JSON.stringify({ t: 'play', id: 'p1', action: 'free_spin', betIndex: 0 }));
    await new Promise<void>((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        if (c.messages.filter((m) => m.t === 'result').length >= 2) { clearInterval(tick); resolve(); }
        else if (Date.now() - started > 8000) {
          clearInterval(tick);
          reject(new Error(`нет второго result; пришло ${JSON.stringify(c.messages)}`));
        }
      }, 10);
    });
    const fs = c.messages.filter((m) => m.t === 'result').at(-1);
    expect(fs.id).toBe('p1');
    expect(fs.spinsPlayed).toBe(2); // именно СЛЕДУЮЩИЙ сегмент, не через один
    expect(c.messages.some((m) => m.t === 'error')).toBe(false);

    // Ни одной лишней денежной RPC: восстановление трогает только движок и
    // идемпотентный UpdateRoundState.
    expect(flaky.received.filter((e) => e.type === 'OpenRoundRequest')).toHaveLength(1);
    expect(flaky.received.filter((e) => e.type === 'PlayRoundRequest')).toHaveLength(0);
    expect(flaky.received.filter((e) => e.type === 'UpdateRoundStateRequest')).toHaveLength(2);

    c.socket.close();
    await s.close();
    await flaky.close();
  }, 40_000);

  it('SessionIsNotInitialized, упорствующая и после повтора — уходит во фронт как error, без зависания', async () => {
    const alwaysFailing = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type === 'OpenRoundRequest') {
          self.send(socket, {
            proto: 1, schema: 1, chan: 'rpc', type: 'Error',
            id: `e-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
            timestamp: new Date().toISOString(),
            payload: { code: 'SessionIsNotInitialized', message: 'nope', details: {} },
          });
          return;
        }
        responder()(env, socket, self);
      },
    });
    const s = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: alwaysFailing.url, apiKey: 'k', spinPath: fixtures,
    });
    await s.listen(0);
    const c = connect(`ws://127.0.0.1:${s.port}/api/ws?sessionId=sess-recover-2`);
    await c.open;
    await c.waitFor('init');

    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const err = await c.waitFor('error');
    expect(err.code).toBe('SessionIsNotInitialized');
    // Ровно один повтор: два OpenRoundRequest, не больше.
    expect(alwaysFailing.received.filter((e) => e.type === 'OpenRoundRequest')).toHaveLength(2);

    c.socket.close();
    await s.close();
    await alwaysFailing.close();
  }, 40_000);

  it('InvalidRoundOperation: SessionInfo подтверждает, что раунда нет, play повторяется тем же действием', async () => {
    const flaky = await startFakeGamesApi({
      onMessage: respondOnceThenRecover(
        'OpenRoundRequest', 'InvalidRoundOperation', 'Round is already opened.',
      ),
    });
    const s = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: flaky.url, apiKey: 'k', spinPath: fixtures,
    });
    await s.listen(0);
    const c = connect(`ws://127.0.0.1:${s.port}/api/ws?sessionId=sess-recover-3`);
    await c.open;
    await c.waitFor('init');

    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const result = await c.waitFor('result');
    expect(result.id).toBe('p0');
    expect(result.creditPending).toBe(true);

    // Свежий SessionInfo не принёс незакрытого раунда (responder() его и не
    // отдаёт) — resume() возвращает null, повтор идёт тем же действием.
    expect(flaky.received.filter((e) => e.type === 'SessionInfoRequest')).toHaveLength(2);
    expect(flaky.received.filter((e) => e.type === 'OpenRoundRequest')).toHaveLength(2);

    c.socket.close();
    await s.close();
    await flaky.close();
  }, 40_000);

  it('InvalidRoundOperation на финальном сегменте: игрок получает досчитанный результат, фантомный раунд не открывается', async () => {
    // Фейковый Games API держит round_state ровно из последнего успешного
    // UpdateRoundStateRequest — то, что платформа реально подтвердила до
    // финального (провалившегося) действия — и отдаёт его в SessionInfo,
    // как это сделала бы настоящая платформа. round_state не выдумывается:
    // это буквально то, что сервер сам нам прислал на предыдущем ack.
    let lastConfirmedState: string | null = null;
    let version = 0;
    let closeFailedOnce = false;
    const api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        const reply = (type: string, payload: unknown) =>
          self.send(socket, {
            proto: 1, schema: 1, chan: 'rpc', type,
            id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
            timestamp: new Date().toISOString(), payload,
          });
        if (env.type === 'SessionInfoRequest') {
          reply('SessionInfoResponse', {
            security_hash: 'h', currency: 'USD', balance: 100,
            game_settings: {
              default_bet_index: 0, currency_minimal_unit: 0.01, allowed_bets: [1],
              available_auto_spin_counts: [10], rtp_options: [],
              rtp_settings: { is_visible: false }, locales: ['EN'],
            },
            last_round: lastConfirmedState && {
              round_id: 'round-1', price_multiplier: 1, bet_index: 0,
              win_multiplier: 0, win: 0, started_at: '2026-08-10T10:00:00.000Z',
              finished_at: null, round_version: version, round_state_version: '1',
              round_state: lastConfirmedState, is_platform_max_win_reached: false,
            },
          });
          return;
        }
        if (env.type === 'OpenRoundRequest') {
          reply('OpenRoundResponse', { round_version: 0, round_id: 'round-1', balance: 99 });
          return;
        }
        if (env.type === 'UpdateRoundStateRequest') {
          version += 1;
          lastConfirmedState = env.payload.round_state;
          reply('UpdateRoundStateResponse', { round_version: version });
          return;
        }
        if (env.type === 'CloseRoundRequest') {
          if (!closeFailedOnce) {
            closeFailedOnce = true;
            reply('Error', {
              code: 'InvalidRoundOperation', message: 'Invalid round version to update.', details: {},
            });
            return;
          }
          reply('CloseRoundResponse', { balance: 102, free_round_campaign: null });
          return;
        }
      },
    });
    const s = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: api.url, apiKey: 'k', spinPath: fixtures,
    });
    await s.listen(0);
    const c = connect(`ws://127.0.0.1:${s.port}/api/ws?sessionId=sess-recover-final`);
    await c.open;
    await c.waitFor('init');

    // Заводим раунд и доигрываем два фриспина из трёх, каждый раз честно
    // подтверждая курсор — ровно то, что делает настоящий фронт.
    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const spin = await c.waitFor('result');
    c.socket.send(JSON.stringify({ t: 'ack', roundId: spin.roundId, cursor: 1 }));
    await new Promise((r) => setTimeout(r, 20));

    c.socket.send(JSON.stringify({ t: 'play', id: 'p1', action: 'free_spin', betIndex: 0 }));
    const fs1 = await c.waitFor('result');
    expect(c.messages.filter((m) => m.t === 'result')).toHaveLength(2);
    c.socket.send(JSON.stringify({ t: 'ack', roundId: fs1.roundId, cursor: 2 }));
    await new Promise((r) => setTimeout(r, 20));

    c.socket.send(JSON.stringify({ t: 'play', id: 'p2', action: 'free_spin', betIndex: 0 }));
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        if (c.messages.filter((m) => m.t === 'result').length >= 3) { clearInterval(tick); resolve(); }
      }, 10);
    });
    const fs2 = c.messages.filter((m) => m.t === 'result').at(-1);
    c.socket.send(JSON.stringify({ t: 'ack', roundId: fs2.roundId, cursor: 3 }));
    await new Promise((r) => setTimeout(r, 20));

    // Третий (последний) фриспин: CloseRoundRequest сначала падает с
    // InvalidRoundOperation, recovery перечитывает SessionInfo, сам
    // досчитывает и закрывает раунд — а игроку прилетает готовый результат,
    // без второго OpenRoundRequest и без единого PlayRoundRequest.
    c.socket.send(JSON.stringify({ t: 'play', id: 'p3', action: 'free_spin', betIndex: 0 }));
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        if (c.messages.filter((m) => m.t === 'result').length >= 4) { clearInterval(tick); resolve(); }
      }, 10);
    });
    const final = c.messages.filter((m) => m.t === 'result').at(-1);
    expect(final.id).toBe('p3');
    expect(final.creditPending).toBe(false);
    expect(final.balanceAfter).toBe(102);
    expect(final.totalWinX).toBe(3);
    expect(c.messages.some((m) => m.t === 'error')).toBe(false);

    // Единственная и решающая проверка: восстановление не должно было
    // задеть ни одну денежную RPC сверх плана — ни повторного OpenRound
    // (это был бы фантомный раунд), ни тем более PlayRound (это был бы
    // одиночный раунд, выставленный за клиентское действие, которое на
    // самом деле относилось к уже закрытому раунду).
    expect(api.received.filter((e) => e.type === 'OpenRoundRequest')).toHaveLength(1);
    expect(api.received.filter((e) => e.type === 'PlayRoundRequest')).toHaveLength(0);
    expect(api.received.filter((e) => e.type === 'CloseRoundRequest')).toHaveLength(2); // провал + успешный повтор изнутри recovery

    c.socket.close();
    await s.close();
    await api.close();
  }, 40_000);
});

describe('graceful shutdown', () => {
  it('close() резолвится быстро и уведомляет открытых WS-клиентов, а не висит до SIGKILL', async () => {
    const shutdownApi = await startFakeGamesApi({ onMessage: responder() });
    const shutdownServer = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: shutdownApi.url, apiKey: 'k', spinPath: fixtures,
    });
    await shutdownServer.listen(0);

    const c = connect(`ws://127.0.0.1:${shutdownServer.port}/api/ws?sessionId=sess-shutdown`);
    await c.open;
    await c.waitFor('init');

    const closedMessage = c.waitFor('session_closed');
    const clientClosedCode = new Promise<number>((resolve) => c.socket.on('close', (code) => resolve(code)));

    // Клиент подключён и жив на момент close() — именно тот сценарий, в
    // котором `wss.close()` + `http.close(cb)` сами по себе зависают,
    // потому что ни один из них не завершает уже открытые апгрейженные сокеты.
    const started = Date.now();
    await Promise.race([
      shutdownServer.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('close() не завершился вовремя')), 8000)),
    ]);
    expect(Date.now() - started).toBeLessThan(8000);

    expect((await closedMessage).reason).toBeTruthy();
    expect(await clientClosedCode).toBe(1001);

    await shutdownApi.close();
  }, 20_000);
});
