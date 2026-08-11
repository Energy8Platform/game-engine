import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  startEngine, type EngineClient, type RoundResponse, type RoundStateResponse,
} from '../src/engine';
import {
  openEntry, ensureOpen, stepRound, playToEnd, ScriptMismatchError,
} from '../src/round/engineRound';
import { newSeed, newEngineRoundId, type RoundStateV1 } from '../src/round/roundState';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;

beforeAll(async () => {
  // Third file in this package to start a real engine process — pinned to
  // its own distant port so it can't race engine.test.ts's default scan
  // (50251+) or engine-spawn-failure.test.ts's pin (52251).
  engine = await startEngine({ gamesDir: fixtures, port: 54251 });
}, 30_000);

afterAll(() => engine?.close());

function stateFor(over: Partial<RoundStateV1> = {}): RoundStateV1 {
  return {
    v: 1,
    seed: newSeed(),
    eid: newEngineRoundId(),
    script: '',
    action: 'spin',
    betIndex: 0,
    priceMultiplier: 1,
    cursor: 0,
    totalWinX: 0,
    actions: [],
    ...over,
  };
}

/**
 * Wrap the real, already-running `engine` so individual calls can be
 * overridden per test (an injected transient failure, a tampered
 * `getRound` view) while everything else still hits the real e8-server.
 * `EngineClient` is a class with private fields, so a plain object literal
 * needs the double cast to stand in for it structurally.
 */
function wrapEngine(
  real: EngineClient,
  overrides: Partial<Pick<EngineClient, 'step' | 'getRound'>>,
): EngineClient {
  return {
    listGames: () => real.listGames(),
    getConfig: (gameId: string) => real.getConfig(gameId),
    startRound: (a: Parameters<EngineClient['startRound']>[0]) => real.startRound(a),
    step: (roundId: string, action: string, paramsJson: string, requestId: string) =>
      real.step(roundId, action, paramsJson, requestId),
    getRound: (roundId: string) => real.getRound(roundId),
    close: () => real.close(),
    ...overrides,
  } as unknown as EngineClient;
}

describe('раунд в движке', () => {
  it('entry-действие — ровно один шаг, раунд остаётся открытым', async () => {
    const state = stateFor();
    const first = await openEntry(engine, 'feature-game', state);
    expect(first.action).toBe('spin');
    expect(first.winX).toBe(0);
    expect(first.isFinal).toBe(false);
    expect(first.nextActions).toEqual(['free_spin']);
    // sha скрипта проставляется в состояние — на нём держится защита от деплоя
    expect(state.script).toMatch(/^[0-9a-f]{64}$/);
  });

  it('раунд без фичи закрывается тем же одним шагом', async () => {
    const first = await openEntry(engine, 'one-shot-game', stateFor({ action: 'one_shot' }));
    expect(first.isFinal).toBe(true);
    expect(first.totalWinX).toBe(0);
  });

  it('каждый следующий сегмент — один шаг', async () => {
    const state = stateFor();
    await openEntry(engine, 'feature-game', state);
    const wins: number[] = [];
    for (let i = 0; i < 3; i++) {
      const segment = await stepRound(engine, state, 'free_spin');
      wins.push(segment.winX);
      state.actions.push({ a: 'free_spin' });
    }
    expect(wins).toEqual([1, 1, 1]);
  });

  it('последний сегмент помечен финальным и несёт итог', async () => {
    const state = stateFor();
    await openEntry(engine, 'feature-game', state);
    let last;
    for (let i = 0; i < 3; i++) {
      last = await stepRound(engine, state, 'free_spin');
      state.actions.push({ a: 'free_spin' });
    }
    expect(last!.isFinal).toBe(true);
    expect(last!.totalWinX).toBe(3);
    // On completion next_actions lists every entry action the *next* round
    // could open with (feature-game has 'spin' and 'buy_bonus'), not just
    // the one this round happened to start on — same caution engine.test.ts
    // takes with entry_actions, so don't assert a specific order.
    expect(last!.nextActions).toEqual(expect.arrayContaining(['spin', 'buy_bonus']));
    expect(last!.nextActions).toHaveLength(2);
  });

  it('ensureOpen ничего не делает, пока раунд жив в движке', async () => {
    const state = stateFor();
    await openEntry(engine, 'feature-game', state);
    await ensureOpen(engine, 'feature-game', state);
    const segment = await stepRound(engine, state, 'free_spin');
    expect(segment.winX).toBe(1);
  });

  it('ensureOpen поднимает раунд заново, если движок его не знает', async () => {
    // Состояние есть, а раунда в движке нет — так выглядит запрос на другом поде.
    const state = stateFor({
      cursor: 2,
      actions: [{ a: 'free_spin' }, { a: 'free_spin' }],
    });
    await ensureOpen(engine, 'feature-game', state);
    // Раунд доигран до курсора: следующий шаг — третий фриспин, он же последний.
    const segment = await stepRound(engine, state, 'free_spin');
    expect(segment.isFinal).toBe(true);
    expect(segment.totalWinX).toBe(3);
  });

  it('холодный подъём воспроизводит те же значения, что горячий путь', async () => {
    // hot plays segment 2 (first free_spin) directly, then segment 3
    // (second free_spin) — that's the position cold needs to land on too.
    const seed = newSeed();
    const hot = stateFor({ seed, eid: newEngineRoundId() });
    await openEntry(engine, 'feature-game', hot);
    await stepRound(engine, hot, 'free_spin'); // segment 2, confirmed
    hot.actions.push({ a: 'free_spin' });
    const hotThird = await stepRound(engine, hot, 'free_spin'); // segment 3

    // cold's log already has segment 2 confirmed (cursor: 1) but under a
    // fresh eid the engine has never seen — ensureOpen must replay the
    // entry + that one logged free_spin from (seed, eid) alone before cold
    // can take the same "next" step hot just took.
    const cold = stateFor({
      seed, eid: newEngineRoundId(), cursor: 1, actions: [{ a: 'free_spin' }],
    });
    await ensureOpen(engine, 'feature-game', cold);
    const coldSecond = await stepRound(engine, cold, 'free_spin'); // segment 3
    // totalWinX accumulates per segment (1, 2, 3, …) so this only passes if
    // cold's replay actually reached the same segment 3 as hot — a coding
    // bug that stranded cold at segment 2 (totalWinX 2 vs hot's 3) is
    // exactly what this line catches.
    expect(coldSecond.totalWinX).toBe(hotThird.totalWinX);
    expect(coldSecond.data).toEqual(hotThird.data);
  });

  it('расхождение скрипта ловится при холодном подъёме', async () => {
    const state = stateFor({ script: 'sha256:другой-скрипт', cursor: 1, actions: [{ a: 'free_spin' }] });
    await expect(ensureOpen(engine, 'feature-game', state)).rejects.toBeInstanceOf(
      ScriptMismatchError,
    );
  });

  it('playToEnd доигрывает остаток раунда и отдаёт итоговый множитель', async () => {
    const state = stateFor({ cursor: 1, actions: [{ a: 'free_spin' }] });
    expect(await playToEnd(engine, 'feature-game', state)).toBe(3);
  });

  it('ensureOpen резюмируется после частичного сбоя восстановления, не теряя позицию', async () => {
    // Hot reference: play the whole round directly, segment by segment, to
    // get a canonical value for the position cold needs to land on too.
    const seed = newSeed();
    const hot = stateFor({ seed, eid: newEngineRoundId() });
    await openEntry(engine, 'feature-game', hot); // segment 1 (entry)
    await stepRound(engine, hot, 'free_spin'); hot.actions.push({ a: 'free_spin' }); // segment 2
    await stepRound(engine, hot, 'free_spin'); hot.actions.push({ a: 'free_spin' }); // segment 3
    const hotFinal = await stepRound(engine, hot, 'free_spin'); // segment 4, final

    // Cold has both post-entry free_spins already confirmed (cursor: 2) but
    // its eid was never opened — a full recovery is needed. Make the SECOND
    // replayed Step (recover-1, i.e. cold.actions[1]) fail once, simulating
    // a transient engine error that strands the recovery loop partway
    // through — the exact scenario the reviewer flagged.
    const cold = stateFor({
      seed, eid: newEngineRoundId(), cursor: 2,
      actions: [{ a: 'free_spin' }, { a: 'free_spin' }],
    });
    let armed = true;
    const flaky = wrapEngine(engine, {
      step: (roundId, action, paramsJson, requestId) => {
        if (armed && requestId.endsWith('-recover-1')) {
          armed = false;
          const failed: RoundResponse = {
            win: 0, total_win: 0, data_json: '', vars_json: '', globals_json: '',
            next_actions: [], round_complete: false, spins_remaining: 0,
            spins_played: 0, script_sha256: '', error: 'injected transient failure', bet: 1,
          };
          return Promise.resolve(failed);
        }
        return engine.step(roundId, action, paramsJson, requestId);
      },
    });

    await expect(ensureOpen(flaky, 'feature-game', cold)).rejects.toThrow(
      /injected transient failure/,
    );

    // The failed Step never reached the real engine, so only the entry and
    // the FIRST logged free_spin actually landed: spins_played is 2, one
    // short of the 3 the log (cursor: 2) accounts for.
    const afterFailure = await engine.getRound(cold.eid);
    expect(afterFailure.spins_played).toBe(2);

    // Retry on the same pod, same state, same (now-disarmed) client — this
    // is the "ordinary resilience pattern" from the review. A version that
    // only checked `found` would return here without finishing the replay.
    await ensureOpen(flaky, 'feature-game', cold);

    const afterResume = await engine.getRound(cold.eid);
    expect(afterResume.spins_played).toBe(3); // caught up, without redoing action[0]

    const coldFinal = await stepRound(engine, cold, 'free_spin'); // segment 4
    expect(coldFinal.isFinal).toBe(hotFinal.isFinal);
    expect(coldFinal.totalWinX).toBe(hotFinal.totalWinX);
    expect(coldFinal.data).toEqual(hotFinal.data);
  });

  it('ensureOpen ловит рассинхрон, если движок сыграл больше, чем объясняет лог', async () => {
    // A real round genuinely at spins_played 2 (entry + 1 free_spin), but
    // round_state's log only accounts for 1 (expected = 1 + 0 = 1) — as if
    // some other caller advanced this round_id past what we recorded.
    const state = stateFor();
    await openEntry(engine, 'feature-game', state);
    await stepRound(engine, state, 'free_spin'); // real spins_played is now 2, log stays []

    await expect(ensureOpen(engine, 'feature-game', state)).rejects.toThrow(
      /ahead of round_state/,
    );
  });

  it('ensureOpen ловит расхождение скрипта на горячем пути, до всякого шага', async () => {
    const state = stateFor();
    await openEntry(engine, 'feature-game', state); // round open, state.script now the real sha
    const tampered: RoundStateV1 = { ...state, script: 'sha256:другой-скрипт-в-движке-уже-нет' };
    let stepped = false;
    const spy = wrapEngine(engine, {
      step: (...args: Parameters<EngineClient['step']>) => {
        stepped = true;
        return engine.step(...args);
      },
    });
    await expect(ensureOpen(spy, 'feature-game', tampered)).rejects.toBeInstanceOf(
      ScriptMismatchError,
    );
    expect(stepped).toBe(false); // no segment served before the mismatch is caught
  });

  it('playToEnd бросает ошибку вместо частичного итога, если раунд не завершился за guard', async () => {
    // Fully-stubbed engine that always reports "one more free_spin to go" —
    // proves the guard's failure mode is a thrown error, not a laundered
    // partial total, without spending 1000 real round-trips to the binary.
    const state = stateFor();
    const stuckResponse: RoundResponse = {
      win: 1, total_win: 1, data_json: '{}', vars_json: '', globals_json: '',
      next_actions: ['free_spin'], round_complete: false, spins_remaining: 1,
      spins_played: 2, script_sha256: 'a'.repeat(64), error: '', bet: 1,
    };
    // spins_played: 1 matches `state`'s empty actions log (expected = 1 + 0)
    // so ensureOpen's own catch-up check passes immediately and playToEnd's
    // loop is what actually runs out of guard budget, not ensureOpen.
    const stuckState: RoundStateResponse = {
      found: true, game_id: 'feature-game', script_sha256: 'a'.repeat(64),
      total_win: 1, spins_played: 1, spins_remaining: 1, next_actions: ['free_spin'],
      round_complete: false, vars_json: '', error: '', bet: 1,
    };
    const stuck: EngineClient = {
      listGames: () => Promise.resolve([]),
      getConfig: () => Promise.resolve({}),
      startRound: () => Promise.resolve(stuckResponse),
      step: () => Promise.resolve(stuckResponse),
      getRound: () => Promise.resolve(stuckState),
      close: () => {},
    } as unknown as EngineClient;

    await expect(playToEnd(stuck, 'feature-game', state)).rejects.toThrow(
      /did not finish after 1000 steps/,
    );
  });
});
