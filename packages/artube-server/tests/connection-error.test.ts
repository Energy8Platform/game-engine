/**
 * `Error` без `corr_id` — отказ, адресованный коннекту, а не запросу.
 *
 * Дока знает ровно один такой случай и он же самый дорогой: при провале
 * аутентификации API присылает `Error (auth failed)`. Мы его теряли: ветка
 * `corr_id` его не подбирала, ветка событий отсеивала по каналу, и он исчезал
 * бесследно — даже под `debug`. Итог на живом поде с неверным `GamesApiKey`:
 * сокет открыт, готовность объявлена по пятисекундному дедлайну Hello,
 * `/healthz` отдаёт 200, а каждый запрос игрока умирает по 15-секундному
 * таймауту RPC. Под, который выглядит здоровее некуда.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { GamesApiClient } from '../src/games-api/client';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

let api: FakeGamesApi | null = null;
let server: ArtubeServer | null = null;
let client: GamesApiClient | null = null;

afterEach(async () => {
  client?.close();
  await server?.close();
  await api?.close();
  api = null;
  server = null;
  client = null;
});

/** Платформа, отвергающая аутентификацию: Error вместо Welcome. */
function authFailure() {
  return (env: any, socket: any, self: FakeGamesApi) => {
    if (env.type !== 'Hello') return;
    self.send(socket, {
      proto: 1, schema: 1, chan: 'rpc', type: 'Error',
      id: 'err-auth', corr_id: null, op_seq: 1,
      timestamp: new Date().toISOString(),
      payload: { code: 'Unauthorized', message: 'auth failed', details: {} },
    });
  };
}

describe('отказ уровня коннекта', () => {
  it('не даёт объявить коннект готовым и приходит подписчику', async () => {
    api = await startFakeGamesApi({ autoWelcome: false, onMessage: authFailure() });
    client = new GamesApiClient({
      url: api.url, apiKey: 'wrong', gameId: 'g',
      // Дедлайн короткий: тест обязан пережить момент, в который прежний код
      // и объявлял такой коннект готовым.
      helloTimeoutMs: 150,
      goAwayCloseGraceMs: 60_000,
    });
    const seen: any[] = [];
    client.on('connectionError', (e: any) => seen.push(e));

    await client.connect();
    await new Promise((r) => setTimeout(r, 300));

    expect(seen).toEqual([{ code: 'Unauthorized', message: 'auth failed' }]);
    expect(client.connected).toBe(false);
    expect(client.lastConnectionError).toEqual({ code: 'Unauthorized', message: 'auth failed' });
  }, 20_000);

  it('состоявшийся коннект снимает прошлый отказ', async () => {
    let reject = true;
    api = await startFakeGamesApi({
      autoWelcome: false,
      onMessage: (env, socket, self) => {
        if (env.type !== 'Hello') return;
        if (reject) {
          reject = false;
          return self.send(socket, {
            proto: 1, schema: 1, chan: 'rpc', type: 'Error',
            id: 'err-auth', corr_id: null, op_seq: 1,
            timestamp: new Date().toISOString(),
            payload: { code: 'Unauthorized', message: 'auth failed' },
          });
        }
        return self.send(socket, {
          proto: 1, schema: 1, chan: 'control', type: 'Welcome',
          id: 'w', corr_id: null, op_seq: 1,
          timestamp: new Date().toISOString(), payload: { use: { max_schema: 1 } },
        });
      },
    });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      helloTimeoutMs: 150, baseReconnectDelayMs: 20, minReconnectDelayMs: 10,
      // Платформа не закрывает соединение сама — закрываем мы, иначе
      // переподключение не начнётся вовсе и под застрянет в «не готов».
      goAwayCloseGraceMs: 50,
    });
    await client.connect();

    await vi.waitFor(() => expect(client!.connected).toBe(true), { timeout: 8000 });
    expect(client.lastConnectionError).toBeNull();
  }, 20_000);

  it('/healthz перестаёт врать 200 и называет причину', async () => {
    api = await startFakeGamesApi({ autoWelcome: false, onMessage: authFailure() });
    server = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: api.url, apiKey: 'wrong', spinPath: fixtures,
    });
    await server.listen(0, '127.0.0.1');

    const res = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ok).toBe(false);
    // Не новая шкала здоровья, а те же «connected vs retrying» плюс причина:
    // «под ещё ищет платформу» и «у пода неверный ключ» требуют разных действий.
    expect(body.error).toEqual({ code: 'Unauthorized', message: 'auth failed' });

    // `/livez` при этом по-прежнему 200: процесс жив, его не надо убивать —
    // надо починить ключ.
    expect((await fetch(`http://127.0.0.1:${server.port}/livez`)).status).toBe(200);
  }, 40_000);
});
