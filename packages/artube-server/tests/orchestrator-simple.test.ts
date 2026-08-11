import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
import { startRound, resolvePriceMultiplier, type RoundDeps } from '../src/round/orchestrator';
import { decodeRoundState } from '../src/round/roundState';
import type { SessionContext } from '../src/session/types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
}, 30_000);

afterAll(() => engine?.close());

const ctx: SessionContext = {
  sessionId: 'sess-1',
  currency: 'USD',
  allowedBets: [0.1, 0.5, 1, 5],
};

/** Заглушка Games API: записывает запросы и отдаёт фиксированные ответы. */
function fakeApi() {
  return {
    playRound: vi.fn(async () => ({
      round_id: 'round-simple', balance: 199, win: 0, is_platform_max_win_reached: false,
    })),
    openRound: vi.fn(async () => ({ round_version: 0, round_id: 'r', balance: 0 })),
    updateRoundState: vi.fn(async () => ({ round_version: 1 })),
    closeRound: vi.fn(async () => ({ balance: 0 })),
    autocloseRound: vi.fn(async () => ({ balance: 0 })),
  };
}

function deps(api: ReturnType<typeof fakeApi>, gameId = 'one-shot-game'): RoundDeps {
  return {
    api, engine, gameId,
    costMultipliers: { one_shot: 1, spin: 1, buy_bonus: 5, free_spin: 1 },
  };
}

describe('оркестратор — простой раунд', () => {
  it('множитель цены берётся из стоимости действия', () => {
    const d = deps(fakeApi());
    expect(resolvePriceMultiplier(d, 'spin', false)).toBe(1);
    expect(resolvePriceMultiplier(d, 'buy_bonus', false)).toBe(5);
  });

  it('активная кампания фри-раундов обнуляет множитель цены', () => {
    expect(resolvePriceMultiplier(deps(fakeApi()), 'spin', true)).toBe(0);
  });

  it('одиночный сегмент уходит одним PlayRound', async () => {
    const api = fakeApi();
    const out = await startRound(deps(api), ctx, { id: 'p1', action: 'one_shot', betIndex: 2 });
    expect(api.playRound).toHaveBeenCalledTimes(1);
    expect(api.openRound).not.toHaveBeenCalled();
    expect(out.round).toBeNull(); // раунд закрыт, продолжения не будет
  });

  it('в PlayRound уходят индекс и множители, но не суммы', async () => {
    const api = fakeApi();
    await startRound(deps(api), ctx, { id: 'p1', action: 'one_shot', betIndex: 2 });
    const sent = api.playRound.mock.calls[0][0];
    expect(sent.session_id).toBe('sess-1');
    expect(sent.bet_index).toBe(2);
    expect(sent.price_multiplier).toBe(1);
    expect(sent.win_multiplier).toBe(0);
    expect(sent.round_state_version).toBe('1');
    expect(sent).not.toHaveProperty('bet_amount');
  });

  it('round_state несёт рецепт воспроизведения, а не дамп движка', async () => {
    const api = fakeApi();
    await startRound(deps(api), ctx, { id: 'p1', action: 'one_shot', betIndex: 2 });
    const state = decodeRoundState(api.playRound.mock.calls[0][0].round_state);
    expect(state.v).toBe(1);
    expect(state.seed.server).toMatch(/^[0-9a-f]{32}$/);
    expect(state.eid).toMatch(/^e-/);
    expect(state.action).toBe('one_shot');
    expect(state.betIndex).toBe(2);
    expect(state.cursor).toBe(1);
    expect(state).not.toHaveProperty('vars');
  });

  it('доставка сегмента несёт баланс платформы и сумму ставки', async () => {
    const api = fakeApi();
    const { delivery } = await startRound(deps(api), ctx, {
      id: 'p1', action: 'one_shot', betIndex: 2,
    });
    expect(delivery.roundId).toBe('round-simple');
    expect(delivery.balanceAfter).toBe(199); // из ответа платформы, не наш расчёт
    expect(delivery.betAmount).toBe(1); // allowed_bets[2]
    expect(delivery.creditPending).toBe(false);
  });

  it('флаг платформенного максвина пробрасывается как есть', async () => {
    const api = fakeApi();
    api.playRound.mockResolvedValueOnce({
      round_id: 'r', balance: 500, win: 300, is_platform_max_win_reached: true,
    });
    const { delivery } = await startRound(deps(api), ctx, {
      id: 'p1', action: 'one_shot', betIndex: 2,
    });
    expect(delivery.maxWinReached).toBe(true);
  });

  it('ставка вне allowed_bets отвергается до похода в платформу', async () => {
    const api = fakeApi();
    await expect(
      startRound(deps(api), ctx, { id: 'p1', action: 'one_shot', betIndex: 99 }),
    ).rejects.toThrow(/bet_index/);
    expect(api.playRound).not.toHaveBeenCalled();
  });
});
