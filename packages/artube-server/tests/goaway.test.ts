/**
 * `GoAway` — конец ЭТОГО коннекта, а не конец жизни клиента.
 *
 * Дока (`games-api-integration/control-requests/goaway.md`) не оставляет здесь
 * свободы: «Клиент не должен обрывать WebSocket-соединение самостоятельно. При
 * получении `GoAway` клиент должен корректно завершить текущие операции и
 * дождаться закрытия соединения со стороны сервера, после чего инициировать
 * переподключение согласно значению `retry_after_ms`». `retry_after_ms` там —
 * обязательное поле рядом с `reason`, а все перечисленные причины временные:
 * техобслуживание (1 800 000 мс), обновление сервера (300 000), перегрузка
 * (60 000). Причины «больше не подключайся» в доке нет ни одной.
 *
 * Живой стенд показал цену противоположного прочтения: под получил
 * `GoAway{reason: IdleTimeout}` — платформа просто переработала простаивающий
 * коннект — и остался стоять навсегда глухим, отвечая `InternalServerError:
 * no connection to Games API` на каждый вызов сессии.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocket } from 'ws';
import {
  GamesApiClient, resolveGoAwayDelayMs, MAX_RECONNECT_DELAY_MS,
} from '../src/games-api/client';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';
import { sessionInfoResponder, startFakePlatform, type FakePlatform } from './helpers/fakePlatform';
import { createArtubeServer, type ArtubeServer } from '../src/index';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

let api: FakeGamesApi;
let client: GamesApiClient;

afterEach(async () => {
  client?.close();
  await api?.close();
});

/**
 * Считает Hello, пришедшие от клиента, и даёт дождаться n-го.
 *
 * Синхронизироваться по событию `connected` тут нельзя: сервер шлёт Welcome
 * сразу при коннекте, ещё до того, как прочитает Hello, — и тест успел бы
 * прислать GoAway раньше, чем сервер вообще увидел первое Hello.
 */
function helloWatcher() {
  let count = 0;
  const waiters = new Map<number, () => void>();
  return {
    observe(env: any) {
      if (env.type !== 'Hello') return;
      count += 1;
      waiters.get(count)?.();
    },
    nth(n: number, timeoutMs = 5000): Promise<void> {
      if (count >= n) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Hello #${n} не пришёл за ${timeoutMs}ms (пришло ${count})`)),
          timeoutMs,
        );
        waiters.set(n, () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('условие не наступило вовремя');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('GoAway → переподключение', () => {
  it('переподключается после GoAway и ждёт ровно столько, сколько попросила платформа', async () => {
    const hellos = helloWatcher();
    api = await startFakeGamesApi({ onMessage: hellos.observe });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 10, minReconnectDelayMs: 5,
    });
    // Расписание, по которому клиент решил ждать, — наблюдаемое: по одному
    // событию на попытку, с назначенной паузой и признаком «это план
    // платформы, а не наш бэкофф».
    const scheduled: Array<{ delayMs: number; planned: boolean }> = [];
    client.on('reconnecting', (a) => scheduled.push({ delayMs: a.delayMs, planned: a.planned }));
    await client.connect();
    await hellos.nth(1);

    api.goAway({ reason: 'IdleTimeout', retry_after_ms: 300 });
    // Уходящий коннект перестаёт принимать новые вызовы сразу.
    await waitUntil(() => !client.connected);

    api.closeCurrent();
    const closedAt = Date.now();
    await hellos.nth(2);
    const waited = Date.now() - closedAt;

    expect(api.connections).toBe(2);
    // Пауза взята РОВНО из `retry_after_ms` и помечена как расписание
    // платформы, а не как наш бэкофф (он здесь — 10 мс, то есть перепутать
    // одно с другим невозможно). Это и есть «ждёт столько, сколько попросили»,
    // проверенное точно.
    //
    // Верхней границы по стенным часам тут больше нет намеренно: она мерила не
    // решение клиента, а то, дали ли процессу процессорное время. При 300 мс
    // номинала прежние `< 2500` не отличали даже 300 от нашей секунды по
    // умолчанию — зато исправно краснели на загруженной машине.
    expect(scheduled).toEqual([{ delayMs: 300, planned: true }]);
    // А это — про настоящее время, и нижняя граница starvation'ом не ломается:
    // сколько бы процесс ни голодал, раньше срока он не проснётся. Проверяем
    // именно то, что паузу выждали, а не только записали в лог.
    expect(waited).toBeGreaterThanOrEqual(250);

    // Переподключение — полное рукопожатие заново, с нуля по op_seq.
    const sent = api.received.filter((e) => e.type === 'Hello');
    expect(sent).toHaveLength(2);
    expect(sent[1].op_seq).toBe(1);
    await waitUntil(() => client.connected);
  });

  it('не закрывает соединение сам — ждёт закрытия со стороны сервера', async () => {
    const hellos = helloWatcher();
    api = await startFakeGamesApi({ onMessage: hellos.observe });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 10, minReconnectDelayMs: 5,
    });
    await client.connect();
    await hellos.nth(1);

    api.goAway({ reason: 'Server update in progress', retry_after_ms: 20 });
    await new Promise((r) => setTimeout(r, 400));

    // Дока: «Клиент не должен обрывать WebSocket-соединение самостоятельно».
    expect(api.open).toBe(true);
    // И не бежит подключаться вторым коннектом, пока первый ещё жив.
    expect(api.connections).toBe(1);

    // Закрывает сервер — вот теперь наша очередь.
    api.closeCurrent();
    await hellos.nth(2);
    expect(api.connections).toBe(2);
  });

  it('после переподключения вызовы снова проходят — клиент не остаётся глухим', async () => {
    const hellos = helloWatcher();
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        hellos.observe(env);
        sessionInfoResponder()(env, socket, self);
      },
    });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 10, minReconnectDelayMs: 5,
    });
    await client.connect();
    await hellos.nth(1);

    api.goAway({ reason: 'IdleTimeout', retry_after_ms: 20 });
    api.closeCurrent();
    await hellos.nth(2);
    await waitUntil(() => client.connected);

    const info = await client.sessionInfo({ session_id: 's-1', player_connection_info: {} });
    expect(info.balance).toBe(100);
  });

  it('пока коннекта нет, вызовы падают сразу, а не копятся в очереди', async () => {
    // Поведение, доставшееся от прежней реализации, и его надо сохранить:
    // отсутствие коннекта — быстрый и предсказуемый отказ, а не зависание.
    const hellos = helloWatcher();
    api = await startFakeGamesApi({ onMessage: hellos.observe });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 10_000, minReconnectDelayMs: 10_000,
    });
    await client.connect();
    await hellos.nth(1);

    api.goAway({ reason: 'Server overload', retry_after_ms: 60_000 });
    await waitUntil(() => !client.connected);
    const started = Date.now();
    await expect(
      client.sessionInfo({ session_id: 's-1', player_connection_info: {} }),
    ).rejects.toMatchObject({ code: 'InternalServerError' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('close() после GoAway останавливает клиент окончательно — переподключения не будет', async () => {
    const hellos = helloWatcher();
    api = await startFakeGamesApi({ onMessage: hellos.observe });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 5, minReconnectDelayMs: 5,
    });
    await client.connect();
    await hellos.nth(1);

    api.goAway({ reason: 'IdleTimeout', retry_after_ms: 5 });
    client.close();
    api.closeCurrent();
    await new Promise((r) => setTimeout(r, 300));

    expect(api.connections).toBe(1);
    expect(client.connected).toBe(false);
  });

  it('сервер прислал GoAway и не закрывает — по истечении отведённого срока рвём сами', async () => {
    // Дока обещает закрытие со стороны сервера. Обещание, которое платформа
    // не сдержала, не должно превращаться в вечную немоту — ровно в неё
    // упирался живой под. Ждём столько, сколько велено, и только потом рвём.
    const hellos = helloWatcher();
    api = await startFakeGamesApi({ onMessage: hellos.observe });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 5, minReconnectDelayMs: 5, goAwayCloseGraceMs: 150,
    });
    await client.connect();
    await hellos.nth(1);

    api.goAway({ reason: 'IdleTimeout', retry_after_ms: 10 });
    // Внутри отведённого срока молчим и ждём сервер.
    await new Promise((r) => setTimeout(r, 80));
    expect(api.open).toBe(true);

    await hellos.nth(2);
    expect(api.connections).toBe(2);
  });

  it('GoAway раньше Welcome не даёт истёкшему hello-timeout задним числом поднять коннект', async () => {
    // Без Welcome (autoWelcome: false) GoAway обязательно приходит раньше
    // helloTimeoutMs. Если обработчик GoAway не гасит таймер дедлайна, тот
    // всё равно сработает и вызовет finish(), пометив клиент ready — на
    // коннекте, который уже уходит.
    api = await startFakeGamesApi({
      autoWelcome: false,
      onMessage: (env, socket, self) => {
        if (env.type !== 'Hello') return;
        self.send(socket, {
          proto: 1, schema: 1, chan: 'control', type: 'GoAway',
          id: 'goaway-2', corr_id: null, op_seq: 2,
          timestamp: new Date().toISOString(),
          payload: { reason: 'shutdown', retry_after_ms: 10_000 },
        });
      },
    });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      helloTimeoutMs: 30, baseReconnectDelayMs: 10, minReconnectDelayMs: 10,
    });
    const goAway = new Promise<string>((resolve) => client.on('goAway', (r: string) => resolve(r)));
    await client.connect();
    expect(await goAway).toBe('shutdown');
    expect(client.connected).toBe(false);
    // Ждём дольше, чем helloTimeoutMs, чтобы дать дедлайну шанс сработать.
    // Переподключение при этом ещё далеко: retry_after_ms — 10 секунд.
    await new Promise((r) => setTimeout(r, 80));
    expect(client.connected).toBe(false);
    expect(api.connections).toBe(1);
  });

  it('событие goAway доносит и причину, и задержку — операторy видно, что произошло', async () => {
    const hellos = helloWatcher();
    api = await startFakeGamesApi({ onMessage: hellos.observe });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 10, minReconnectDelayMs: 10,
    });
    const seen: unknown[][] = [];
    client.on('goAway', (...args: unknown[]) => seen.push(args));
    await client.connect();
    await hellos.nth(1);

    api.goAway({ reason: 'IdleTimeout', retry_after_ms: 4321 });
    await waitUntil(() => seen.length > 0);
    expect(seen[0][0]).toBe('IdleTimeout');
    expect(seen[0][1]).toBe(4321);
  });
});

describe('GoAway → задержка переподключения', () => {
  const min = 1000;
  const fallback = 1000;

  it('берёт retry_after_ms платформы как есть', () => {
    expect(resolveGoAwayDelayMs({ retry_after_ms: 60_000 }, { min, fallback })).toBe(60_000);
    expect(resolveGoAwayDelayMs({ retry_after_ms: 1_800_000 }, { min, fallback })).toBe(1_800_000);
  });

  it('без retry_after_ms (или с мусором вместо него) — падает на собственную задержку', () => {
    // Поле объявлено обязательным, но «обязательное» — обещание платформы, а
    // не гарантия. Ни горячего цикла, ни вечного простоя из этого выйти
    // не должно.
    for (const payload of [
      undefined,
      {},
      { retry_after_ms: null },
      { retry_after_ms: 'soon' },
      { retry_after_ms: Number.NaN },
      { retry_after_ms: Number.POSITIVE_INFINITY },
      { retry_after_ms: -5000 },
      { retry_after_ms: 0 },
    ]) {
      expect(resolveGoAwayDelayMs(payload as any, { min, fallback })).toBe(fallback);
    }
  });

  it('слишком маленькое значение поднимается до нижней границы — горячего цикла не будет', () => {
    expect(resolveGoAwayDelayMs({ retry_after_ms: 1 }, { min, fallback })).toBe(min);
  });

  it('бессмысленно большое значение прижимается к самому большому из доки', () => {
    // Дока сама называет максимум: техобслуживание — 1 800 000 мс.
    expect(resolveGoAwayDelayMs({ retry_after_ms: 10 ** 12 }, { min, fallback }))
      .toBe(MAX_RECONNECT_DELAY_MS);
  });

  it('серия коротких GoAway подряд разводит попытки экспоненциально', () => {
    // Единственная граница против платформы, которая нас намеренно не пускает:
    // не список «терминальных» причин (в доке их нет), а растущая пауза.
    // `streak` — сколько таких GoAway было ДО этого, поэтому одиночный
    // (streak: 0) идёт ровно по расписанию платформы.
    expect(resolveGoAwayDelayMs({ retry_after_ms: 60_000 }, { min, fallback, streak: 0 }))
      .toBe(60_000);
    expect(resolveGoAwayDelayMs({ retry_after_ms: 60_000 }, { min, fallback, streak: 1 }))
      .toBe(120_000);
    expect(resolveGoAwayDelayMs({ retry_after_ms: 60_000 }, { min, fallback, streak: 2 }))
      .toBe(240_000);
    expect(resolveGoAwayDelayMs({ retry_after_ms: 60_000 }, { min, fallback, streak: 40 }))
      .toBe(MAX_RECONNECT_DELAY_MS);
  });
});

describe('GoAway → сессия игрока переживает переподключение', () => {
  let platform: FakePlatform;
  let server: ArtubeServer;

  afterEach(async () => {
    await server?.close();
    await platform?.close();
  });

  /** Открыть WS к нашему серверу и собирать входящие сообщения. */
  function connect(base: string, sessionId: string) {
    const socket = new WebSocket(`${base}/api/ws?sessionId=${sessionId}`);
    const messages: any[] = [];
    socket.on('error', () => {});
    socket.on('message', (d) => messages.push(JSON.parse(d.toString())));
    const nth = (t: string, n: number, timeoutMs = 8000) =>
      new Promise<any>((resolve, reject) => {
        const started = Date.now();
        const tick = setInterval(() => {
          const found = messages.filter((m) => m.t === t);
          if (found.length >= n) { clearInterval(tick); resolve(found[n - 1]); }
          else if (Date.now() - started > timeoutMs) {
            clearInterval(tick);
            reject(new Error(`нет ${t}#${n}; пришло ${JSON.stringify(messages)}`));
          }
        }, 10);
      });
    return {
      socket, messages, nth,
      waitFor: (t: string, timeoutMs?: number) => nth(t, 1, timeoutMs),
      send: (msg: unknown) => socket.send(JSON.stringify(msg)),
    };
  }

  it('раунд игрока доигрывается после GoAway — от игрока не требуется ничего', async () => {
    // Платформа ведёт себя как настоящая: на новом коннекте сессия считается
    // неинициализированной, пока на НЁМ не пройдёт SessionInfo (дока:
    // «переподключиться и заново выполнить полную последовательность
    // подключения (Hello → Welcome → SessionInfoRequest → SessionInfoResponse)
    // перед продолжением работы с раундами»).
    platform = await startFakePlatform({ allowedBets: [0.5, 2], requireSessionInit: true });
    server = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: platform.url, apiKey: 'k', spinPath: fixtures,
    });
    await server.listen(0, '127.0.0.1');
    const c = connect(`ws://127.0.0.1:${server.port}`, 'sess-goaway');
    await c.waitFor('init');

    c.send({ t: 'play', id: 'p0', action: 'spin', betIndex: 1 });
    const spin = await c.waitFor('result');
    expect(spin.creditPending).toBe(true);
    c.send({ t: 'ack', roundId: spin.roundId, cursor: 1 });
    await new Promise((r) => setTimeout(r, 50));

    // Платформа переработала коннект прямо посреди раунда.
    const mark = platform.api.received.length;
    platform.goAway({ reason: 'IdleTimeout', retry_after_ms: 30 });
    platform.closeCurrent();

    // Игрок ничего не делает — а сессия обязана снова стать рабочей: новый
    // коннект, новое Hello и SessionInfo по живой сессии.
    await waitUntil(() => {
      const after = platform.api.received.slice(mark);
      return after.some((e) => e.type === 'Hello')
        && after.some((e) => e.type === 'SessionInfoRequest');
    }, 8000);

    // И раунд доигрывается тем же соединением игрока, без ошибок.
    c.send({ t: 'play', id: 'p1', action: 'free_spin', betIndex: 1 });
    const next = await c.nth('result', 2);
    expect(next.id).toBe('p1');
    expect(next.spinsPlayed).toBe(2);
    expect(c.messages.some((m) => m.t === 'error')).toBe(false);

    // Деньги за раунд по-прежнему двигались ровно один раз.
    expect(platform.countOf('OpenRoundRequest')).toBe(1);
    expect(platform.countOf('PlayRoundRequest')).toBe(0);
    c.socket.close();
  }, 40_000);
});
