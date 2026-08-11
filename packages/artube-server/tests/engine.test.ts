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

  it('feature-game: раунд-механика (сегменты/round_complete/next_actions) детерминирована при повторном round_id', async () => {
    // feature.spin's execute() never calls rng() — every branch is fixed
    // `if action_is(...)`. So this only proves the session/segment
    // bookkeeping (opens/extends/round_complete) is deterministic given
    // that RNG-free math; it says nothing about whether the engine actually
    // reproduces a round FROM the (server_seed, client_seed, nonce) triple —
    // any seed, or no seed at all, would pass this exact test. See the
    // 'rng-game' block below for the test that actually proves seed
    // reproduction.
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

  describe('rng-game: реальная проверка воспроизведения раунда из (server_seed, client_seed, nonce)', () => {
    // rng-game's execute() calls rng(c, 1, 1_000_000) on every segment (base
    // spin + 2 free spins = 3 independent draws per round) and writes the
    // raw roll into win/data. Unlike feature-game, a defect where the engine
    // ignores the seed triple (or round_id leaks into the RNG stream) is
    // observable here: same triple must reproduce every roll, a different
    // server_seed must not.
    const play = async (
      roundId: string,
      serverSeed: string,
      clientSeed: string,
      nonce: number,
    ) => {
      const out: Array<{ win: number; data: string; done: boolean }> = [];
      let r = await engine.startRound({
        gameId: 'rng-game', playerId: 'p1', roundId,
        serverSeed, clientSeed, nonce,
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

    it('(a)+(c): та же тройка сидов под другим round_id даёт побайтово тот же раунд — по всем 3 сегментам', async () => {
      const a = await play('rng-replay-A', 'seed-xyz', 'cli', 42);
      const b = await play('rng-replay-B', 'seed-xyz', 'cli', 42);
      expect(a).toHaveLength(3); // spin + 2 free_spin — the multi-step path, not just segment 1
      expect(a[a.length - 1]!.done).toBe(true);
      expect(a).toEqual(b);
    });

    it('(b): другой server_seed даёт другую последовательность бросков — иначе (a) ничего не доказывает', async () => {
      // Each round draws 3 independent rng(1, 1_000_000) values. If the
      // engine genuinely derives its RNG stream from server_seed, the
      // probability that a *different* server_seed coincidentally
      // reproduces all 3 draws is (1/1_000_000)^3 = 1e-18 — indistinguishable
      // from zero, so this is not a flaky assertion despite being
      // probabilistic in principle.
      const a = await play('rng-diff-A', 'seed-xyz', 'cli', 42);
      const c = await play('rng-diff-B', 'seed-completely-different', 'cli', 42);
      expect(c).toHaveLength(3);
      expect(c).not.toEqual(a);
    });
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
