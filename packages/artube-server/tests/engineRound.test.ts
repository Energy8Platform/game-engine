import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
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
});
