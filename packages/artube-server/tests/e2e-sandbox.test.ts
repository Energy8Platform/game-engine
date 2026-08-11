/**
 * e2e против публичной песочницы Artube: там стоит тот же GamesAPI, что на
 * dev и prod. Тест не в CI — данные песочницы живут ~24 часа и создаются
 * вручную: «▶ Generate Data» → «🔗 Create Session» на
 * https://sandbox-api-dev.artube-888.live/sandbox-swagger/
 *
 * Запуск:
 *   ARTUBE_SANDBOX_SESSION=<sessionId> ARTUBE_SANDBOX_GAME=<publicGameId> \
 *   npm test --workspace @energy8platform/artube-server -- e2e-sandbox
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GamesApiClient } from '../src/games-api/client';
import { startEngine } from '../src/engine';
import { startRound, acknowledgeSegment, advanceRound, type RoundDeps } from '../src/round/orchestrator';
import { toSessionContext } from '../src/session/init';
import { SANDBOX_URL } from '../bin/artube-server';

const sessionId = process.env.ARTUBE_SANDBOX_SESSION;
const gameId = process.env.ARTUBE_SANDBOX_GAME;
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe.skipIf(!sessionId || !gameId)('песочница Artube', () => {
  it('проходит полный цикл: SessionInfo → раунд с фичей → закрытие', async () => {
    const api = new GamesApiClient({
      url: `${SANDBOX_URL}?game=${gameId}`,
      apiKey: process.env.ARTUBE_SANDBOX_KEY ?? '',
      gameId: gameId!,
    });
    await api.connect();
    const info = await api.sessionInfo({
      session_id: sessionId!, player_connection_info: {},
    });
    expect(info.game_settings.allowed_bets.length).toBeGreaterThan(0);

    const engine = await startEngine({ gamesDir: fixtures });
    const deps: RoundDeps = {
      api, engine, gameId: 'feature-game',
      costMultipliers: { spin: 1, free_spin: 1 },
    };
    const ctx = toSessionContext(sessionId!, info);

    let out = await startRound(deps, ctx, { id: 'e2e', action: 'spin', betIndex: 0 });
    expect(out.round).not.toBeNull();
    let round = await acknowledgeSegment(deps, ctx, out.round!, 1);
    let guard = 0;
    while (round && guard++ < 10) {
      out = await advanceRound(deps, ctx, round, {
        id: `e2e-${guard}`, action: 'free_spin', betIndex: 0,
      });
      if (!out.round) break;
      round = await acknowledgeSegment(deps, ctx, out.round, out.round.state.cursor + 1);
    }
    expect(out.delivery.creditPending).toBe(false);
    expect(out.delivery.balanceAfter).not.toBeNull();

    engine.close();
    api.close();
  }, 60_000);
});
