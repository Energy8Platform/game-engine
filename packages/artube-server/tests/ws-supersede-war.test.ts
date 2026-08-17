/**
 * Две вкладки на одной сессии не должны воевать за коннект.
 *
 * Сервер вытесняет старое соединение сессии новым — это правильно: у Artube
 * на сессию живёт одно соединение, и `NewConnectionEvent` в доке описывает
 * ровно этот сценарий (сравни новое соединение со своим и закрой старое).
 * Но вытесненный клиент обязан СТОЯТЬ, а не переподключаться: иначе он
 * вытесняет соперника, тот переподключается, вытесняет его — и так навсегда.
 * Потолок `MAX_RECONNECT_ATTEMPTS` тут не спасает, его сбрасывает каждый
 * успешный коннект.
 *
 * Тест гоняет настоящие `ArtubeClient` (тот код, который и переподключается),
 * а не сырые `ws`-сокеты: реестровый тест не поймал эту войну именно потому,
 * что его клиенты никогда не реконнектятся.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakePlatform, type FakePlatform } from './helpers/fakePlatform';
import { ArtubeClient } from '../../artube-bridge/src/client';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SESSION = 'sess-two-tabs-war';
let platform: FakePlatform;
let server: ArtubeServer;
let url: string;

beforeEach(async () => {
  platform = await startFakePlatform({ allowedBets: [0.5, 2] });
  server = createArtubeServer({
    gameId: 'feature-game', gamesApiUrl: platform.url, apiKey: 'k', spinPath: fixtures,
  });
  await server.listen(0, '127.0.0.1');
  url = `ws://127.0.0.1:${server.port}/api/ws?sessionId=${SESSION}`;
}, 40_000);

afterEach(async () => {
  await server?.close();
  await platform?.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('две вкладки на одной сессии', () => {
  it('вытеснение случается один раз и не превращается в бесконечную войну реконнектов', async () => {
    const supersedes: string[] = [];
    // Бэкофф намеренно крошечный: в проде это 1000мс, то есть примерно один
    // виток войны в секунду — здесь тот же цикл, только быстрее.
    const first = new ArtubeClient(url, 20);
    first.on('sessionClosed', (p: { reason: string }) => supersedes.push(`A:${p.reason}`));
    await first.connect();

    const second = new ArtubeClient(url, 20);
    second.on('sessionClosed', (p: { reason: string }) => supersedes.push(`B:${p.reason}`));
    await second.connect();

    // Окно наблюдения: при живой войне сюда влезли бы десятки витков.
    await sleep(1000);
    const afterWindow = supersedes.length;
    await sleep(1000);

    // Война остановилась: за второе окно ни одного нового вытеснения.
    expect(supersedes.length).toBe(afterWindow);
    // И всего оно было ровно одно — то самое, которым второй коннект
    // вытеснил первый.
    expect(supersedes).toEqual(['A:superseded by a new connection']);
    // Каждое новое соединение стоит платформе SessionInfo плюс полный
    // resumeRound; в войне их было бы по паре за виток.
    expect(platform.countOf('SessionInfoRequest')).toBeLessThanOrEqual(3);

    // Выживает тот, кто пришёл последним, и он играет.
    const result = await second.play({ action: 'spin', betIndex: 1 });
    expect(result.action).toBe('spin');
    expect(platform.countOf('OpenRoundRequest')).toBe(1);

    first.close();
    second.close();
  }, 40_000);

  it('обычный обрыв (без session_closed) по-прежнему переподключается', async () => {
    // Обратная сторона: терминальным делает не любой обрыв, а именно кадр
    // `session_closed`. Одинокая вкладка, потерявшая сеть, обязана вернуться.
    const only = new ArtubeClient(url, 20);
    const inits: unknown[] = [];
    only.on('init', (init: unknown) => inits.push(init));
    await only.connect();
    expect(platform.countOf('SessionInfoRequest')).toBe(1);

    // Рвём соединение так, как это делает сеть: без прощального кадра.
    (server as unknown as { sockets: Set<{ terminate(): void }> }).sockets.forEach((s) =>
      s.terminate(),
    );

    await sleep(600);
    expect(inits.length).toBe(1); // клиент вернулся и получил свежий init
    expect(platform.countOf('SessionInfoRequest')).toBe(2);
    only.close();
  }, 40_000);
});
