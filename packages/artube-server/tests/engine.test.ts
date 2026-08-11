import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
}, 30_000);

afterAll(() => engine?.close());

describe('EngineClient', () => {
  it('видит игру из каталога и её entry-действия', async () => {
    const games = await engine.listGames();
    const game = games.find((g) => g.game_id === 'feature-game');
    expect(game).toBeDefined();
    expect(game!.entry_actions).toEqual(expect.arrayContaining(['spin', 'buy_bonus']));
    expect(game!.script_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('конфиг отдаёт стоимость действий — источник price_multiplier', async () => {
    // RoundResponse.bet — это эхо переданной ставки, а НЕ стоимость действия,
    // поэтому множитель цены берём только отсюда.
    const config = await engine.getConfig('feature-game');
    const actions = config.actions as Array<{ name: string; cost: number }>;
    expect(actions.find((a) => a.name === 'spin')?.cost).toBe(1);
    expect(actions.find((a) => a.name === 'buy_bonus')?.cost).toBe(5);
  });

  it('играет раунд целиком: 4 сегмента, total_win 3.0', async () => {
    const first = await engine.startRound({
      gameId: 'feature-game', playerId: 'p1', roundId: 'round-1',
      serverSeed: 'seed-abc', clientSeed: 'cli', nonce: 7,
      action: 'spin', bet: 1, requestId: 'req-0',
    });
    expect(first.error).toBe('');
    expect(first.win).toBe(0);
    expect(first.round_complete).toBe(false);
    expect(first.next_actions).toEqual(['free_spin']);

    const wins: number[] = [first.win];
    let r = first;
    let i = 0;
    while (!r.round_complete) {
      r = await engine.step('round-1', r.next_actions[0], '', `req-${++i}`);
      wins.push(r.win);
    }
    expect(wins).toEqual([0, 1, 1, 1]);
    expect(r.total_win).toBe(3);
    expect(r.spins_played).toBe(4);
  });

  it('та же тройка сидов под другим round_id даёт тот же раунд', async () => {
    const play = async (roundId: string) => {
      const out: unknown[] = [];
      let r = await engine.startRound({
        gameId: 'feature-game', playerId: 'p1', roundId,
        serverSeed: 'seed-xyz', clientSeed: 'cli', nonce: 42,
        action: 'spin', bet: 1, requestId: `${roundId}-0`,
      });
      out.push({ win: r.win, data: r.data_json, done: r.round_complete });
      let i = 0;
      while (!r.round_complete) {
        r = await engine.step(roundId, r.next_actions[0], '', `${roundId}-${++i}`);
        out.push({ win: r.win, data: r.data_json, done: r.round_complete });
      }
      return out;
    };
    expect(await play('replay-A')).toEqual(await play('replay-B'));
  });

  it('на неизвестное действие отдаёт ошибку в поле error', async () => {
    const r = await engine.startRound({
      gameId: 'feature-game', playerId: 'p1', roundId: 'round-bad',
      serverSeed: 's', clientSeed: 'c', nonce: 1,
      action: 'no_such_action', bet: 1, requestId: 'req-bad',
    });
    expect(r.error).not.toBe('');
  });
});
