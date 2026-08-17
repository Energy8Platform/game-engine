/**
 * `NewConnectionEvent`: та же сессия открылась ещё раз — но на ДРУГОМ поде.
 *
 * Реестр `clients` в `http/server.ts` держит одно соединение на сессию только
 * в пределах пода; две вкладки за HPA попадают на разные поды, и узнать про
 * чужой под можно единственным способом — этим событием
 * (`new-connection-event.md`: сравнить `new_connection_id` с текущим
 * соединением «между фронтендом и сервером игры» и закрыть своё, если не
 * совпало). До этого события никто не слушал.
 *
 * Проверяется то, что видит игрок (`session_closed` + закрытый сокет), и
 * отдельно — осторожность: пока платформа не показала, что говорит НАШИМИ
 * идентификаторами, чужой id живое соединение не рвёт.
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
  // Слушаем ровно тот адрес, который набираем ниже: `listen(0)` занял бы
  // IPv6-wildcard, и loopback-трафик мог бы уйти чужому слушателю.
  await server.listen(0, '127.0.0.1');
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
  // Каждый тип ждётся в этих тестах не больше одного раза — курсор не нужен.
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

/** Идентификатор, который сервер выдал этому соединению, — снятый с провода. */
function announcedConnectionId(sessionId: string): string {
  const requests = platform
    .received('SessionInfoRequest')
    .filter((e) => e.payload.session_id === sessionId);
  const id = requests.at(-1)?.payload?.player_connection_info?.player_connection_id;
  expect(typeof id).toBe('string');
  return id as string;
}

/**
 * Барьер вместо паузы: событие ушло по тому же сокету платформы РАНЬШЕ, чем
 * уйдёт ответ на этот спин, поэтому получить `result` можно только после того,
 * как сервер это событие прочитал и обработал.
 */
async function roundTrip(c: ReturnType<typeof connect>, id: string) {
  c.send({ t: 'play', id, action: 'spin', betIndex: 0 });
  return c.waitFor('result');
}

describe('NewConnectionEvent', () => {
  it('другое соединение той же сессии закрывает это — игрок получает session_closed', async () => {
    const session = 'sess-new-conn';
    const c = connect(session);
    await c.waitFor('init');

    // Первое событие несёт НАШ идентификатор: его рождает наш же
    // SessionInfoRequest. Оно ничего не закрывает и служит доказательством,
    // что платформа говорит теми же идентификаторами, что и мы.
    platform.emitEvent('NewConnectionEvent', {
      session_id: session,
      new_connection_id: announcedConnectionId(session),
    });
    const alive = await roundTrip(c, 'p1');
    expect(alive.t).toBe('result');
    expect(c.messages.some((m) => m.t === 'session_closed')).toBe(false);

    // Вторая вкладка на другом поде: платформа объявляет её идентификатор.
    platform.emitEvent('NewConnectionEvent', {
      session_id: session,
      new_connection_id: '11111111-2222-3333-4444-555555555555',
    });

    const goodbye = await c.waitFor('session_closed');
    expect(goodbye.reason).toMatch(/superseded/);
    expect(await c.closed).toBe(1000);
  }, 20_000);

  it('чужой идентификатор без такого доказательства живое соединение НЕ рвёт', async () => {
    // Платформа, которая генерирует идентификаторы сама, объявляла бы чужой id
    // каждому соединению сразу после init. Закрывать по такому событию —
    // значит убить игру для всех; поэтому без совпавшего однажды id событие
    // только пишется в лог.
    const session = 'sess-uncalibrated';
    const c = connect(session);
    await c.waitFor('init');

    platform.emitEvent('NewConnectionEvent', {
      session_id: session,
      new_connection_id: '99999999-8888-7777-6666-555555555555',
    });

    const answer = await roundTrip(c, 'p1');
    expect(answer.t).toBe('result');
    expect(c.messages.some((m) => m.t === 'session_closed')).toBe(false);
    expect(c.socket.readyState).toBe(WebSocket.OPEN);
    c.socket.close();
  }, 20_000);

  it('событие про чужую сессию не трогает наше соединение', async () => {
    const session = 'sess-not-mine';
    const c = connect(session);
    await c.waitFor('init');

    platform.emitEvent('NewConnectionEvent', {
      session_id: session,
      new_connection_id: announcedConnectionId(session),
    });
    platform.emitEvent('NewConnectionEvent', {
      session_id: 'somebody-else',
      new_connection_id: '00000000-0000-0000-0000-000000000000',
    });

    const answer = await roundTrip(c, 'p1');
    expect(answer.t).toBe('result');
    expect(c.messages.some((m) => m.t === 'session_closed')).toBe(false);
    expect(c.socket.readyState).toBe(WebSocket.OPEN);
    c.socket.close();
  }, 20_000);
});
