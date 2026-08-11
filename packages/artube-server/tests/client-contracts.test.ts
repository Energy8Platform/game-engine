import { describe, it, expect, afterEach } from 'vitest';
import { GamesApiClient } from '../src/games-api/client';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

let api: FakeGamesApi;
let client: GamesApiClient;

afterEach(async () => {
  client?.close();
  await api?.close();
});

function autoRespond(map: Record<string, unknown>) {
  return (env: any, socket: any, self: FakeGamesApi) => {
    const type = env.type.replace(/Request$/, 'Response');
    if (map[env.type] === undefined) return;
    self.send(socket, {
      proto: 1, schema: 1, chan: 'rpc', type,
      id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
      timestamp: new Date().toISOString(), payload: map[env.type],
    });
  };
}

describe('GamesApiClient — контракты', () => {
  it('sessionInfo отдаёт типизированный ответ', async () => {
    api = await startFakeGamesApi({
      onMessage: autoRespond({
        SessionInfoRequest: {
          security_hash: 'h', currency: 'USD', balance: 100,
          game_settings: {
            default_bet_index: 1, currency_minimal_unit: 0.01,
            allowed_bets: [0.1, 1, 5], available_auto_spin_counts: [10],
            rtp_options: [], rtp_settings: { is_visible: false }, locales: ['EN'],
          },
        },
      }),
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.sessionInfo({
      session_id: 's1', player_connection_info: { ip_address: '1.2.3.4' },
    });
    expect(res.currency).toBe('USD');
    expect(res.game_settings.allowed_bets).toEqual([0.1, 1, 5]);
    expect(api.received.find((e) => e.type === 'SessionInfoRequest').chan).toBe('rpc');
  });

  it('playRound шлёт индекс ставки и множители, но не суммы', async () => {
    api = await startFakeGamesApi({
      onMessage: autoRespond({
        PlayRoundRequest: {
          round_id: 'r1', balance: 105, win: 5, is_platform_max_win_reached: false,
        },
      }),
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.playRound({
      session_id: 's1', price_multiplier: 1, bet_index: 2, win_multiplier: 5,
      round_state_version: '1', round_state: '{}',
    });
    expect(res.round_id).toBe('r1');
    const sent = api.received.find((e) => e.type === 'PlayRoundRequest').payload;
    expect(sent.bet_index).toBe(2);
    expect(sent.price_multiplier).toBe(1);
    expect(sent).not.toHaveProperty('bet_amount');
    expect(sent).not.toHaveProperty('win');
  });

  it('openRound / updateRoundState / closeRound везут round_version', async () => {
    api = await startFakeGamesApi({
      onMessage: autoRespond({
        OpenRoundRequest: { round_version: 0, round_id: 'r9', balance: 90 },
        UpdateRoundStateRequest: { round_version: 1 },
        CloseRoundRequest: { balance: 120 },
      }),
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const open = await client.openRound({
      session_id: 's', price_multiplier: 1, bet_index: 0,
      round_state_version: '1', round_state: '{}',
    });
    expect(open.round_version).toBe(0);
    const upd = await client.updateRoundState({
      session_id: 's', round_id: open.round_id, round_version: open.round_version,
      round_state_version: '1', round_state: '{}',
    });
    expect(upd.round_version).toBe(1);
    const close = await client.closeRound({
      session_id: 's', round_id: open.round_id, win_multiplier: 3, status: 'completed',
      round_version: upd.round_version, round_state_version: '1', round_state: '{}',
    });
    expect(close.balance).toBe(120);
  });

  it('autocloseRound отвечает CloseRoundResponse', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'AutocloseRoundRequest') return;
        self.send(socket, {
          proto: 1, schema: 1, chan: 'rpc', type: 'CloseRoundResponse',
          id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
          timestamp: new Date().toISOString(), payload: { balance: 77 },
        });
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.autocloseRound({
      session_id: 's', round_id: 'r', win_multiplier: 2, status: 'completed',
      round_version: 1, round_state_version: '1', round_state: '{}',
    });
    expect(res.balance).toBe(77);
  });

  it('прокидывает события канала events', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'Hello') return;
        for (const [type, payload] of [
          ['BalanceChangedEvent', { session_id: 's', balance: 55, reason: 'Win' }],
          ['SessionClosedEvent', { session_id: 's', reason: 'timeout' }],
          ['NewConnectionEvent', { session_id: 's', new_connection_id: 'c2' }],
          ['AutocloseRequestEvent', { session_id: 's', round_id: 'r7' }],
        ] as const) {
          self.send(socket, {
            proto: 1, schema: 1, chan: 'events', type,
            id: `evt-${type}`, corr_id: null, op_seq: 9,
            timestamp: new Date().toISOString(), payload,
          });
        }
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    const seen: Record<string, unknown> = {};
    for (const name of ['balanceChanged', 'sessionClosed', 'newConnection', 'autocloseRequest'] as const) {
      client.on(name, (p: unknown) => { seen[name] = p; });
    }
    await client.connect();
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.balanceChanged).toMatchObject({ balance: 55 });
    expect(seen.sessionClosed).toMatchObject({ reason: 'timeout' });
    expect(seen.newConnection).toMatchObject({ new_connection_id: 'c2' });
    expect(seen.autocloseRequest).toMatchObject({ round_id: 'r7' });
  });
});
