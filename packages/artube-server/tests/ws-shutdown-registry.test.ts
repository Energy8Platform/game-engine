/**
 * Выключение обязано доставать до ВСЕХ принятых сокетов, а не только до тех,
 * что лежат в реестре сессий.
 *
 * Вытесненное вторым коннектом соединение из реестра сессий уходит (там уже
 * новое), но живым TCP-сокетом остаётся: `ws.close()` только шлёт close-фрейм
 * и ждёт ответа до своего 30-секундного таймера. Пир, который на хендшейк не
 * отвечает (браузер на спящей вкладке, оборванный NAT), удерживает
 * апгрейженный сокет — и `http.close()` не позовёт колбэк, пока тот жив.
 * Деплой встаёт до SIGKILL.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { connect as netConnect, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakePlatform, type FakePlatform } from './helpers/fakePlatform';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let platform: FakePlatform;
let server: ArtubeServer | null;

beforeEach(async () => {
  platform = await startFakePlatform();
  server = createArtubeServer({
    gameId: 'feature-game', gamesApiUrl: platform.url, apiKey: 'k', spinPath: fixtures,
  });
  await server.listen(0, '127.0.0.1');
}, 40_000);

afterEach(async () => {
  await server?.close();
  await platform?.close();
});

/**
 * Клиент, который проходит WS-хендшейк и после этого не отвечает ни на что —
 * в частности, не отвечает на close-фрейм. Настоящий `ws`-клиент отзеркалил
 * бы close сам и такой сокет бы не удержал.
 */
async function deafClient(port: number, sessionId: string): Promise<Socket> {
  const socket = netConnect(port, '127.0.0.1');
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
  socket.write(
    `GET /api/ws?sessionId=${sessionId} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n` +
      'Sec-WebSocket-Version: 13\r\n\r\n',
  );
  await new Promise<void>((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      if (chunk.toString('latin1').includes('101')) {
        socket.off('data', onData);
        resolve();
      }
    };
    socket.on('data', onData);
    socket.once('error', reject);
  });
  return socket;
}

describe('реестр выключения', () => {
  it('вытесненный сокет всё ещё достижим для shutdown и не вешает close()', async () => {
    const port = server!.port;
    const deaf = await deafClient(port, 'sess-evicted');
    // Второй коннект той же сессии вытесняет глухого: из реестра сессий он
    // уходит, но TCP-сокет остаётся живым — он не ответит на close-фрейм.
    const alive = new WebSocket(`ws://127.0.0.1:${port}/api/ws?sessionId=sess-evicted`);
    await new Promise<void>((resolve) => alive.once('message', () => resolve()));

    const deafDropped = new Promise<boolean>((resolve) => {
      deaf.once('close', () => resolve(true));
      setTimeout(() => resolve(false), 12_000);
    });

    const started = Date.now();
    await server!.close();
    const elapsed = Date.now() - started;
    server = null;

    // Штатный грейс — 3с; 30с означали бы, что сокет добивал не наш shutdown,
    // а внутренний таймер `ws`.
    expect(elapsed).toBeLessThan(10_000);
    // И сам сокет действительно оборван нашим shutdown, а не оставлен висеть.
    expect(await deafDropped).toBe(true);
    deaf.destroy();
    alive.close();
  }, 45_000);
});
