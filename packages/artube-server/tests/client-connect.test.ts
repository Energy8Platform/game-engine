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
    api = await startFakeGamesApi();
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const hello = api.received.find((e) => e.type === 'Hello');
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
    api = await startFakeGamesApi();
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g', baseReconnectDelayMs: 10,
    });
    await client.connect();
    const reconnected = new Promise<void>((resolve) => client.on('connected', () => resolve()));
    api.drop();
    await reconnected;
    expect(api.connections).toBe(2);
    const hellos = api.received.filter((e) => e.type === 'Hello');
    expect(hellos).toHaveLength(2);
    expect(hellos[1].op_seq).toBe(1); // счётчик обнулился вместе с коннектом
  });

  it('на GoAway не переподключается', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'Hello') return;
        self.send(socket, {
          proto: 1, schema: 1, chan: 'control', type: 'GoAway',
          id: 'goaway-1', corr_id: null, op_seq: 2,
          timestamp: new Date().toISOString(),
          payload: { reason: 'shutdown' },
        });
        setTimeout(() => socket.close(), 10);
      },
    });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g', baseReconnectDelayMs: 10,
    });
    const goAway = new Promise<string>((resolve) => client.on('goAway', (r: string) => resolve(r)));
    await client.connect();
    expect(await goAway).toBe('shutdown');
    await new Promise((r) => setTimeout(r, 100));
    expect(api.connections).toBe(1);
    expect(client.connected).toBe(false);
  });
});
