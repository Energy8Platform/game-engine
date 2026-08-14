import { describe, it, expect, afterEach } from 'vitest';
import { GamesApiClient } from '../src/games-api/client';
import { GamesApiError } from '../src/games-api/errors';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

let api: FakeGamesApi;
let client: GamesApiClient;

/** Ответить на RPC-запрос конвертом с corr_id, равным id запроса. */
function respond(self: FakeGamesApi, socket: any, req: any, type: string, payload: unknown) {
  self.send(socket, {
    proto: 1, schema: 1, chan: 'rpc', type,
    id: `res-${req.id}`, corr_id: req.id, op_seq: req.op_seq,
    timestamp: new Date().toISOString(), payload,
  });
}

afterEach(async () => {
  client?.close();
  await api?.close();
});

describe('GamesApiClient — RPC', () => {
  it('парит ответ с запросом по corr_id', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type === 'SessionInfoRequest') {
          respond(self, socket, env, 'SessionInfoResponse', { balance: 42, currency: 'USD' });
        }
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.rpc<unknown, { balance: number }>('SessionInfoRequest', { session_id: 's' });
    expect(res.balance).toBe(42);
  });

  it('не путает параллельные запросы', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'SessionInfoRequest') return;
        const delay = env.payload.session_id === 'slow' ? 60 : 5;
        setTimeout(
          () => respond(self, socket, env, 'SessionInfoResponse', { who: env.payload.session_id }),
          delay,
        );
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const [slow, fast] = await Promise.all([
      client.rpc<unknown, { who: string }>('SessionInfoRequest', { session_id: 'slow' }),
      client.rpc<unknown, { who: string }>('SessionInfoRequest', { session_id: 'fast' }),
    ]);
    expect(slow.who).toBe('slow');
    expect(fast.who).toBe('fast');
  });

  it('конверт Error превращается в GamesApiError с кодом', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type === 'PlayRoundRequest') {
          respond(self, socket, env, 'Error', {
            code: 'InsufficientFunds', message: 'no money', details: {},
          });
        }
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    await expect(client.rpc('PlayRoundRequest', {})).rejects.toMatchObject({
      name: 'GamesApiError',
      code: 'InsufficientFunds',
    });
  });

  it('вторая документированная форма Error читается так же', async () => {
    // Дока противоречит сама себе: `error-responses.md` называет поля
    // `code`/`message`, `envelope.md` — `error_code`/`error_message`. Ни одного
    // живого `Error` мы не наблюдали, а `code` — единственное, на что смотрят
    // `isRetryable`, `isDemoUserRejection` и список восстановимых кодов: прочти
    // мы его из неверного поля, все они молча пошли бы не в ту сторону.
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type === 'PlayRoundRequest') {
          respond(self, socket, env, 'Error', {
            error_code: 'BackPressureRejected',
            error_message: 'slow down',
            error_details: { retry_after_ms: 7 },
          });
        }
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    await expect(client.rpc('PlayRoundRequest', {})).rejects.toMatchObject({
      code: 'BackPressureRejected',
      message: 'slow down',
    });
  });

  it('Error без узнаваемого кода не превращается в код "undefined"', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type === 'PlayRoundRequest') respond(self, socket, env, 'Error', {});
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    await expect(client.rpc('PlayRoundRequest', {})).rejects.toMatchObject({
      code: 'UnknownError',
    });
  });

  it('ретраит BackPressureRejected по retry_after_ms и отдаёт результат', async () => {
    let attempts = 0;
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'UpdateRoundStateRequest') return;
        attempts += 1;
        if (attempts === 1) {
          respond(self, socket, env, 'Error', {
            code: 'BackPressureRejected', message: 'slow down', details: { retry_after_ms: 10 },
          });
        } else {
          respond(self, socket, env, 'UpdateRoundStateResponse', { round_version: 3 });
        }
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.rpc<unknown, { round_version: number }>('UpdateRoundStateRequest', {});
    expect(attempts).toBe(2);
    expect(res.round_version).toBe(3);
  });

  it('НИКОГДА не ретраит денежные запросы', async () => {
    let attempts = 0;
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'PlayRoundRequest') return;
        attempts += 1;
        respond(self, socket, env, 'Error', {
          code: 'BackPressureRejected', message: 'slow down', details: { retry_after_ms: 5 },
        });
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    await expect(client.rpc('PlayRoundRequest', {})).rejects.toBeInstanceOf(GamesApiError);
    expect(attempts).toBe(1);
  });

  it('падает по таймауту, если ответа нет', async () => {
    api = await startFakeGamesApi({ onMessage: () => {} });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g', rpcTimeoutMs: 30 });
    await client.connect();
    await expect(client.rpc('SessionInfoRequest', {})).rejects.toMatchObject({
      code: 'InternalServerError',
    });
  });

  it('без коннекта падает сразу, а не копит запросы', async () => {
    api = await startFakeGamesApi();
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await expect(client.rpc('SessionInfoRequest', {})).rejects.toMatchObject({
      code: 'InternalServerError',
    });
  });

  it('обрыв коннекта отбивает висящие запросы', async () => {
    api = await startFakeGamesApi({ onMessage: () => {} });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g', rpcTimeoutMs: 5000, baseReconnectDelayMs: 10,
    });
    await client.connect();
    const pending = client.rpc('SessionInfoRequest', {});
    api.drop();
    await expect(pending).rejects.toMatchObject({ code: 'InternalServerError' });
  });
});
