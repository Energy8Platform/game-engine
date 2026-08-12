/**
 * `GameId` платформы (`publicGameId`, в песочнице — `game1`) и id игры в
 * движке (поле из `.spin`, например `moon-spice-market`) — разные вещи.
 * Первый живой запуск против песочницы падал на старте с
 * `engine GetConfig: unknown game "game1"` именно из-за их смешения.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { WebSocket } from 'ws';
import { resolveEngineGameId } from '../src/engine';
import type { EngineClient, GameInfo } from '../src/engine';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Движок целиком не нужен: resolveEngineGameId читает только listGames(). */
function fakeEngine(ids: string[]): EngineClient {
  return {
    listGames: async (): Promise<GameInfo[]> =>
      ids.map((game_id) => ({
        game_id,
        script_sha256: 'x',
        vars_layout_hash: 'y',
        entry_actions: ['spin'],
        loaded_versions: [],
      })),
  } as unknown as EngineClient;
}

describe('resolveEngineGameId', () => {
  it('точное совпадение с GameId платформы выигрывает', async () => {
    expect(await resolveEngineGameId(fakeEngine(['game1', 'other']), 'game1')).toBe('game1');
  });

  it('единственная загруженная игра берётся, даже если названа иначе', async () => {
    const seen: Array<[string, string]> = [];
    const id = await resolveEngineGameId(fakeEngine(['moon-spice-market']), 'game1', {
      onFallback: (engineId, platformId) => seen.push([engineId, platformId]),
    });
    expect(id).toBe('moon-spice-market');
    expect(seen).toEqual([['moon-spice-market', 'game1']]);
  });

  it('несколько игр и ни одна не совпала — падаем, а не угадываем математику', async () => {
    await expect(resolveEngineGameId(fakeEngine(['a', 'b']), 'game1')).rejects.toThrow(/a, b/);
  });

  it('движок не поднял ни одной игры — понятная ошибка про SPIN_PATH', async () => {
    await expect(resolveEngineGameId(fakeEngine([]), 'game1')).rejects.toThrow(/SPIN_PATH/);
  });
});

describe('сервер стартует, когда GameId платформы не равен id игры в .spin', () => {
  let api: FakeGamesApi;
  let server: ArtubeServer;
  // Движок грузит ВЕСЬ каталог, где лежит .spin (`gamesDir = dirname(spinPath)`), а в
  // tests/fixtures их три — кладём копию в отдельный каталог, как у настоящей игры.
  let soloDir: string;

  beforeAll(async () => {
    soloDir = mkdtempSync(join(tmpdir(), 'artube-solo-'));
    copyFileSync(join(fixtures, 'one-shot.spin'), join(soloDir, 'game.spin'));
    api = await startFakeGamesApi({
      onMessage: (env: any, socket: any, self: FakeGamesApi) => {
        if (env.type !== 'SessionInfoRequest') return;
        self.send(socket, {
          proto: 1, schema: 1, chan: 'rpc', type: 'SessionInfoResponse',
          id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
          timestamp: new Date().toISOString(),
          payload: {
            security_hash: 'h', currency: 'USD', balance: 100,
            game_settings: {
              default_bet_index: 0, currency_minimal_unit: 0.01, allowed_bets: [1],
              available_auto_spin_counts: [10], rtp_options: [],
              rtp_settings: { is_visible: false }, locales: ['EN'],
            },
          },
        });
      },
    });
    // Каталог с одним .spin, чья игра называется 'one-shot' — а платформа зовёт её 'game1'.
    server = createArtubeServer({
      gameId: 'game1',
      gamesApiUrl: api.url,
      apiKey: '',
      spinPath: join(soloDir, 'game.spin'),
    });
    await server.listen(0);
  }, 40_000);

  afterAll(async () => {
    await server?.close();
    await api?.close();
    if (soloDir) rmSync(soloDir, { recursive: true, force: true });
  });

  it('поднялся и обслуживает сессию, а /api/version по-прежнему отдаёт GameId платформы', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/version`);
    expect(await res.json()).toHaveProperty('gameId', 'game1');

    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws?sessionId=sess-gameid`);
    const init = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no init')), 10_000);
      socket.on('message', (d) => {
        const m = JSON.parse(d.toString());
        if (m.t === 'init') { clearTimeout(timer); resolve(m); }
      });
      socket.on('error', reject);
    });
    expect(init.config.betLevels).toEqual([1]);
    socket.close();
  });
});
