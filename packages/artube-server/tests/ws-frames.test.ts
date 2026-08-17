/**
 * Кадры, которые присылает не наш клиент.
 *
 * `ws` рапортует протокольный брак WebSocket'а событием `'error'` на самом
 * сокете. У EventEmitter'а без подписчика на `'error'` Node не глотает
 * ошибку, а перебрасывает её наружу — необработанное исключение убивает
 * процесс. Под обслуживает всех игроков сразу, поэтому один кривой кадр от
 * одного клиента не имеет права ронять под.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';
import { sessionInfoResponder } from './helpers/fakePlatform';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let api: FakeGamesApi;
let server: ArtubeServer;

beforeAll(async () => {
  api = await startFakeGamesApi({ onMessage: sessionInfoResponder() });
  server = createArtubeServer({
    gameId: 'feature-game', gamesApiUrl: api.url, apiKey: 'k', spinPath: fixtures,
  });
  await server.listen(0, '127.0.0.1');
}, 40_000);

afterAll(async () => {
  await server?.close();
  await api?.close();
});

/** Ручной WS-хендшейк: только так можно отправить заведомо кривой кадр. */
function rawHandshake(port: number, path: string): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(
        `GET ${path} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n\r\n',
      );
    });
    socket.once('error', reject);
    socket.on('data', (chunk) => {
      if (chunk.toString('latin1').startsWith('HTTP/1.1 101')) resolve(socket);
    });
  });
}

/** Дождаться `init` на обычном клиенте — доказательство, что под жив. */
function initOf(url: string, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('no init'));
    }, timeoutMs);
    socket.on('message', (d) => {
      const msg = JSON.parse(d.toString());
      if (msg.t !== 'init') return;
      clearTimeout(timer);
      socket.close();
      resolve(msg);
    });
    socket.on('error', reject);
  });
}

describe('битые WebSocket-кадры', () => {
  it('немаскированный кадр закрывает только своё соединение, под остаётся живым', async () => {
    const raw = await rawHandshake(server.port, '/api/ws?sessionId=sess-bad-frame');
    const closed = new Promise<void>((resolve) => raw.on('close', () => resolve()));
    // Текстовый кадр 'abc' без маски. Клиент обязан маскировать — `ws`
    // отвечает на это RangeError('MASK must be set') в событии 'error'.
    raw.write(Buffer.from([0x81, 0x03, 0x61, 0x62, 0x63]));
    await closed;

    // Под жив: новый игрок подключается и получает init как ни в чём не бывало.
    const init = await initOf(`ws://127.0.0.1:${server.port}/api/ws?sessionId=sess-after-bad-frame`);
    expect(init.balance).toBe(100);
  }, 20_000);

  it('битый кадр до апгрейда (нет sessionId) тоже не роняет под', async () => {
    const raw = await rawHandshake(server.port, '/api/ws');
    raw.write(Buffer.from([0x81, 0x03, 0x61, 0x62, 0x63]));
    await new Promise<void>((resolve) => raw.on('close', () => resolve()));

    const init = await initOf(`ws://127.0.0.1:${server.port}/api/ws?sessionId=sess-after-bad-frame-2`);
    expect(init.currency).toBe('USD');
  }, 20_000);
});
