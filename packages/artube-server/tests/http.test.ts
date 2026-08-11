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
