import { describe, it, expect, afterEach } from 'vitest';
import { GamesApiClient, ANNOUNCED_CONTRACTS } from '../src/games-api/client';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

let api: FakeGamesApi;
let client: GamesApiClient;

afterEach(async () => {
  client?.close();
  await api?.close();
});

describe('GamesApiClient — соединение', () => {
  it('шлёт аутентификационные заголовки', async () => {
    api = await startFakeGamesApi();
    client = new GamesApiClient({ url: api.url, apiKey: 'key-1', gameId: 'my-game' });
    await client.connect();
    expect(api.headers['x-api-key']).toBe('key-1');
    expect(api.headers['x-game-id']).toBe('my-game');
  });

  it('шлёт Hello и анонсирует все контракты, которые может прислать API', async () => {
    // connect() резолвится по Welcome, а Welcome сервер шлёт сразу при
    // коннекте — раньше, чем сервер успевает прочитать Hello клиента.
    // Синхронизируемся явно через onMessage, а не через резолв connect().
    let resolveHello!: (env: any) => void;
    const helloReceived = new Promise<any>((resolve) => {
      resolveHello = resolve;
    });
    api = await startFakeGamesApi({
      onMessage: (env) => {
        if (env.type === 'Hello') resolveHello(env);
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const hello = await helloReceived;
    expect(hello.chan).toBe('control');
    expect(hello.payload.supports.max_schema).toBe(1);
    // не только Request-типы: Response, Error и события тоже
    expect(hello.payload.supports.contracts).toEqual(ANNOUNCED_CONTRACTS);
    expect(hello.payload.supports.contracts).toContain('SessionInfoResponse');
    expect(hello.payload.supports.contracts).toContain('Error');
    expect(hello.payload.supports.contracts).toContain('BalanceChangedEvent');
  });

  it('считает коннект установленным по Welcome', async () => {
    api = await startFakeGamesApi();
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    expect(client.connected).toBe(false);
    await client.connect();
    expect(client.connected).toBe(true);
  });

  it('поднимается и без Welcome — по дедлайну в 5 секунд', async () => {
    api = await startFakeGamesApi({ autoWelcome: false });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g', helloTimeoutMs: 50 });
    await client.connect();
    expect(client.connected).toBe(true);
  });

  it('переподключается после обрыва и сбрасывает op_seq', async () => {
    // Тот же нюанс, что и в предыдущем тесте: 'connected' стреляет по
    // Welcome, а Welcome сервер шлёт раньше, чем успевает прочитать Hello.
    // Ждём явно и первый Hello (иначе drop() может оборвать соединение
    // раньше, чем сервер вообще прочитал первый Hello, и второй Hello
    // никогда не станет "вторым" по счёту), и второй — прежде чем читать
    // api.received.
    let helloCount = 0;
    let resolveFirstHello!: () => void;
    let resolveSecondHello!: () => void;
    const firstHelloReceived = new Promise<void>((resolve) => {
      resolveFirstHello = resolve;
    });
    const secondHelloReceived = new Promise<void>((resolve) => {
      resolveSecondHello = resolve;
    });
    api = await startFakeGamesApi({
      onMessage: (env) => {
        if (env.type === 'Hello') {
          helloCount += 1;
          if (helloCount === 1) resolveFirstHello();
          if (helloCount === 2) resolveSecondHello();
        }
      },
    });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g', baseReconnectDelayMs: 10,
    });
    await client.connect();
    await firstHelloReceived;
    const reconnected = new Promise<void>((resolve) => client.on('connected', () => resolve()));
    api.drop();
    await reconnected;
    await secondHelloReceived;
    expect(api.connections).toBe(2);
    const hellos = api.received.filter((e) => e.type === 'Hello');
    expect(hellos).toHaveLength(2);
    expect(hellos[1].op_seq).toBe(1); // счётчик обнулился вместе с коннектом
  });

  it('при неудачных попытках реконнекта не открывает несколько попыток параллельно', async () => {
    // Каждая неудачная попытка реконнекта держит соединение открытым 20ms
    // перед обрывом (вместо мгновенного ECONNREFUSED) — так видно, если
    // параллельно откроется ещё одна попытка, пока первая ещё "висит".
    // При корректной сериализации (один openSocket() за раз) одновременно
    // не может быть больше одной такой попытки; в багованной версии
    // (Finding B) каждый неудачный сокет порождает свой parallel
    // scheduleReconnect(), и попытки начинают перекрываться по времени.
    let inFlight = 0;
    let maxInFlight = 0;
    let reconnectAttemptsSeen = 0;
    api = await startFakeGamesApi({
      autoWelcome: false,
      onMessage: (env, socket, self) => {
        if (env.type !== 'Hello') return;
        if (self.connections === 1) {
          // исходное соединение — отвечаем сразу, тест дальше сам его оборвёт
          self.send(socket, {
            proto: 1, schema: 1, chan: 'control', type: 'Welcome',
            id: 'welcome-1', corr_id: null, op_seq: 1,
            timestamp: new Date().toISOString(),
            payload: { use: { max_schema: 1 } },
          });
          return;
        }
        // Попытка реконнекта: держим "открытой" 20ms, затем рвём — имитируем
        // недоступный сервер, но с окном, в котором видно перекрытие попыток.
        reconnectAttemptsSeen += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        setTimeout(() => {
          inFlight -= 1;
          socket.terminate();
        }, 20);
      },
    });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g',
      baseReconnectDelayMs: 5, maxReconnectAttempts: 4,
    });
    await client.connect();
    api.drop();

    // Бюджет на 4 попытки по 20ms + бэкофф (5+10+20+40=75ms) — ждём с запасом.
    await new Promise((r) => setTimeout(r, 400));

    expect(reconnectAttemptsSeen).toBeGreaterThan(0);
    expect(maxInFlight).toBe(1);
    expect(client.connected).toBe(false);
  });

  // Поведение по `GoAway` живёт в отдельном файле — `tests/goaway.test.ts`:
  // это не обрыв связи, а плановая смена коннекта со своим расписанием.
});
