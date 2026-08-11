/**
 * Одна сессия — одно живое соединение на поде.
 *
 * Вторая вкладка (или реконнект, чей прежний сокет ещё не умер) — это по сути
 * реконнект: два соединения одной сессии не имеют права независимо двигать
 * один и тот же раунд. Реестр живых соединений ключуется сессией, и новый
 * коннект вытесняет старый честным `session_closed`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakePlatform, type FakePlatform } from './helpers/fakePlatform';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let platform: FakePlatform;
let server: ArtubeServer;
let base: string;

beforeAll(async () => {
  platform = await startFakePlatform();
  server = createArtubeServer({
    gameId: 'feature-game', gamesApiUrl: platform.url, apiKey: 'k', spinPath: fixtures,
  });
  await server.listen(0);
  base = `ws://127.0.0.1:${server.port}`;
}, 40_000);

afterAll(async () => {
  await server?.close();
  await platform?.close();
});

function connect(sessionId: string) {
  const socket = new WebSocket(`${base}/api/ws?sessionId=${sessionId}`);
  const messages: any[] = [];
  socket.on('message', (d) => messages.push(JSON.parse(d.toString())));
  const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
  const waitFor = (t: string, timeoutMs = 5000) =>
    new Promise<any>((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        const found = messages.find((m) => m.t === t);
        if (found) { clearInterval(tick); resolve(found); }
        else if (Date.now() - started > timeoutMs) { clearInterval(tick); reject(new Error(`no ${t}`)); }
      }, 10);
    });
  const send = (msg: unknown) => socket.send(JSON.stringify(msg));
  return { socket, messages, waitFor, send, closed };
}

describe('реестр соединений по сессии', () => {
  it('второй коннект той же сессии вытесняет первый', async () => {
    const first = connect('sess-two-tabs');
    await first.waitFor('init');

    const second = connect('sess-two-tabs');
    await second.waitFor('init');

    const goodbye = await first.waitFor('session_closed');
    expect(goodbye.reason).toMatch(/superseded/);
    await first.closed;

    // Вытеснение старого соединения не задевает новое: оно живо и играет.
    second.send({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 });
    const result = await second.waitFor('result');
    expect(result.creditPending).toBe(true);
    second.socket.close();
  }, 20_000);

  it('коннект другой сессии не трогают', async () => {
    const other = connect('sess-other');
    await other.waitFor('init');

    const mine = connect('sess-mine');
    await mine.waitFor('init');
    const again = connect('sess-mine');
    await again.waitFor('init');
    await mine.closed;

    expect(other.messages.some((m) => m.t === 'session_closed')).toBe(false);
    expect(other.socket.readyState).toBe(WebSocket.OPEN);
    other.socket.close();
    again.socket.close();
  }, 20_000);
});
