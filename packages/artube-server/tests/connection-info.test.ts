/**
 * `player_connection_info` — вход платформенного GeoIP.
 *
 * Пустой объект здесь не «недозаполненное поле»: по нему платформа решает,
 * разрешён ли игроку регион (`RegionNotSupported`). Не прислать адрес значит
 * отдать это решение на адрес НАШЕГО пода, который стоит в датацентре
 * платформы, — то есть отключить лицензионный контроль, не сказав об этом.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';
import { sessionInfoResponder } from './helpers/fakePlatform';
import { clientIp, normaliseIp } from '../src/http/connectionInfo';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('адрес игрока из цепочки прокси', () => {
  it('берёт первый публичный адрес слева, а не хвост цепочки', () => {
    // `клиент, прокси1, прокси2` — правый элемент это всегда прокси.
    expect(clientIp('203.0.113.7, 10.0.0.1, 172.16.3.9')).toBe('203.0.113.7');
  });

  it('пропускает внутренние адреса, дописанные проксями слева', () => {
    expect(clientIp('10.0.0.1, 198.51.100.22, 10.0.0.2')).toBe('198.51.100.22');
  });

  it('заголовок, приехавший несколькими строками, читается как одна цепочка', () => {
    expect(clientIp(['10.0.0.1', '203.0.113.7'])).toBe('203.0.113.7');
  });

  it('без заголовка берёт адрес сокета — приватный в дев-стенде настоящий', () => {
    expect(clientIp(undefined, '::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(clientIp('', '198.51.100.4')).toBe('198.51.100.4');
  });

  it('целиком внутренняя цепочка всё же даёт адрес, а не пустоту', () => {
    // Ничего лучше у нас нет, и это по-прежнему честнее, чем не прислать поле.
    expect(clientIp('10.0.0.1, 10.0.0.2')).toBe('10.0.0.1');
  });

  it('мусор вместо адреса не отправляется вовсе — дока валидирует IP', () => {
    expect(clientIp('not-an-ip', 'also-not-an-ip')).toBeUndefined();
    expect(clientIp('999.1.1.1')).toBeUndefined();
  });

  it('снимает обёртки, которыми адрес обрастает по дороге', () => {
    expect(normaliseIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normaliseIp('[2001:db8::1]:443')).toBe('2001:db8::1');
    expect(normaliseIp('203.0.113.7:51234')).toBe('203.0.113.7');
    expect(normaliseIp('  198.51.100.4  ')).toBe('198.51.100.4');
  });
});

describe('player_connection_info на проводе', () => {
  let api: FakeGamesApi;
  let server: ArtubeServer;

  beforeAll(async () => {
    api = await startFakeGamesApi({ onMessage: sessionInfoResponder() });
    server = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: api.url, apiKey: 'k', spinPath: fixtures,
    });
    await server.listen(0);
  }, 40_000);

  afterAll(async () => {
    await server?.close();
    await api?.close();
  });

  it('SessionInfoRequest несёт адрес игрока, его браузер и id соединения', async () => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${server.port}/api/ws?sessionId=sess-conn-info`,
      {
        headers: {
          'x-forwarded-for': '203.0.113.7, 10.0.0.1',
          'user-agent': 'Mozilla/5.0 (TestBrowser)',
        },
      },
    );
    const init = new Promise<void>((resolve) => {
      socket.on('message', (d) => {
        if (JSON.parse(d.toString()).t === 'init') resolve();
      });
    });
    await init;
    socket.close();

    const sent = api.received.find((e) => e.type === 'SessionInfoRequest');
    expect(sent.payload.player_connection_info).toMatchObject({
      ip_address: '203.0.113.7',
      user_agent: 'Mozilla/5.0 (TestBrowser)',
    });
    // Дока: «идентификатор подключения игрока между клиентом и бэкендом игры» —
    // выдать его больше некому, кроме нас.
    expect(sent.payload.player_connection_info.player_connection_id).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  }, 20_000);
});
