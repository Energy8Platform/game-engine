/**
 * Максвин на закрытии сложного раунда.
 *
 * Простой раунд (PlayRound) флаг вёз всегда, а закрытие сложного — нет: на
 * месте `is_platform_max_win_reached` в `advanceRound` стоял захардкоженный
 * `false`. Слот срывает максвин в конце фри-спинов или бонуса, то есть ровно
 * там, где раунд заканчивается CloseRound'ом, — так что до игрока настоящий
 * максвин не мог доехать никогда.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
import {
  startRound, advanceRound, acknowledgeSegment, type ActiveRound, type RoundDeps,
} from '../src/round/orchestrator';
import { resumeRound } from '../src/round/resume';
import { encodeRoundState, type RoundStateV1 } from '../src/round/roundState';
import type { SessionContext } from '../src/session/types';
import type { LastRound } from '../src/games-api/types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
}, 30_000);

afterAll(() => engine?.close());

const ctx: SessionContext = {
  sessionId: 'sess-1', currency: 'USD', allowedBets: [0.1, 0.5, 1, 5],
};

/** Платформа, срывающая максвин на закрытии раунда и урезающая выигрыш. */
function fakeApi(close: { win: number; maxWin: boolean }) {
  let version = 0;
  return {
    playRound: vi.fn(async () => ({
      round_id: 'r', balance: 0, win: 0, is_platform_max_win_reached: false,
    })),
    openRound: vi.fn(async () => ({ round_version: 0, round_id: 'round-complex', balance: 95 })),
    updateRoundState: vi.fn(async () => ({ round_version: ++version })),
    closeRound: vi.fn(async () => ({
      balance: 5000,
      win: close.win,
      free_round_campaign: null,
      is_platform_max_win_reached: close.maxWin,
    })),
    autocloseRound: vi.fn(async () => ({
      balance: 5000, win: close.win, is_platform_max_win_reached: close.maxWin,
    })),
  };
}

const deps = (api: ReturnType<typeof fakeApi>): RoundDeps => ({
  api, engine, gameId: 'feature-game',
  costMultipliers: { spin: 1, buy_bonus: 5, free_spin: 1 },
});

/** Доиграть сложный раунд до финального сегмента и вернуть его доставку. */
async function playToClose(api: ReturnType<typeof fakeApi>) {
  const d = deps(api);
  const out = await startRound(d, ctx, { id: 'p0', action: 'spin', betIndex: 2 });
  let round: ActiveRound | null = await acknowledgeSegment(d, ctx, out.round!, 1);
  let last = out.delivery;
  let i = 0;
  while (round) {
    const next = await advanceRound(d, ctx, round, {
      id: `p${++i}`, action: 'free_spin', betIndex: 2,
    });
    last = next.delivery;
    round = next.round
      ? await acknowledgeSegment(d, ctx, next.round, next.round.state.cursor + 1)
      : null;
  }
  return last;
}

describe('максвин на закрытии сложного раунда', () => {
  it('флаг платформы доезжает до игрока, а не тонет в захардкоженном false', async () => {
    const api = fakeApi({ win: 500, maxWin: true });
    const delivery = await playToClose(api);
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    expect(delivery.maxWinReached).toBe(true);
  }, 20_000);

  it('без максвина флаг остаётся ложным', async () => {
    const delivery = await playToClose(fakeApi({ win: 3, maxWin: false }));
    expect(delivery.maxWinReached).toBe(false);
  }, 20_000);

  it('реально зачисленная сумма едет отдельно от нашего множителя', async () => {
    // `max-win.md` требует назвать игроку сумму, которая ДЕЙСТВИТЕЛЬНО
    // зачислена: наш `totalWinX * betAmount` — это то, что насчитала
    // математика, и при усечении максвином это другое число.
    const api = fakeApi({ win: 500, maxWin: true });
    const delivery = await playToClose(api);
    expect(delivery.winAmount).toBe(500);
    expect(delivery.totalWinX * delivery.betAmount).not.toBe(500);
  }, 20_000);
});

describe('максвин на восстановлении раунда', () => {
  it('раунд, доигранный после обрыва, тоже везёт флаг и сумму', async () => {
    const api = fakeApi({ win: 777, maxWin: true });
    const d = deps(api);
    // Раунд, у которого сыграны entry + два фри-спина: следующий шаг финальный.
    const state: RoundStateV1 = {
      v: 1,
      seed: { server: 'a'.repeat(32) },
      eid: 'resume-maxwin',
      script: '',
      action: 'spin',
      betIndex: 2,
      bet: 1,
      priceMultiplier: 1,
      cursor: 3,
      totalWinX: 0,
      actions: [{ a: 'free_spin' }, { a: 'free_spin' }],
    } as unknown as RoundStateV1;
    const lastRound: LastRound = {
      round_id: 'round-resume',
      price_multiplier: 1,
      bet_index: 2,
      win_multiplier: 0,
      win: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
      round_version: 3,
      round_state_version: '1',
      round_state: encodeRoundState(state),
      is_platform_max_win_reached: false,
    };

    const outcome = await resumeRound(d, ctx, lastRound);
    expect(outcome).not.toBeNull();
    expect(outcome!.round).toBeNull(); // раунд доигран и закрыт
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    expect(outcome!.delivery.maxWinReached).toBe(true);
    expect(outcome!.delivery.winAmount).toBe(777);
  }, 20_000);
});
