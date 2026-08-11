import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
import { resumeRound, autocloseRound } from '../src/round/resume';
import { openEntry, stepRound } from '../src/round/engineRound';
import {
  decodeRoundState, encodeRoundState, newEngineRoundId, newSeed, type RoundStateV1,
} from '../src/round/roundState';
import type { RoundDeps } from '../src/round/orchestrator';
import type { SessionContext } from '../src/session/types';
import type { LastRound } from '../src/games-api/types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;
let scriptSha: string;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
  scriptSha = (await engine.listGames()).find((g) => g.game_id === 'feature-game')!.script_sha256;
}, 30_000);

afterAll(() => engine?.close());

const ctx: SessionContext = { sessionId: 's1', currency: 'USD', allowedBets: [0.1, 0.5, 1, 5] };

function fakeApi() {
  return {
    playRound: vi.fn(async () => ({ round_id: 'r', balance: 0, win: 0, is_platform_max_win_reached: false })),
    openRound: vi.fn(async () => ({ round_version: 0, round_id: 'r', balance: 0 })),
    updateRoundState: vi.fn(async () => ({ round_version: 2 })),
    closeRound: vi.fn(async () => ({ balance: 150, free_round_campaign: null })),
    autocloseRound: vi.fn(async () => ({ balance: 150 })),
  };
}

function deps(api: ReturnType<typeof fakeApi>): RoundDeps {
  return { api, engine, gameId: 'feature-game', costMultipliers: { spin: 1, free_spin: 1 } };
}

/** Незакрытый раунд, у которого подтверждено `cursor` сегментов. */
function lastRound(over: Partial<RoundStateV1> = {}, finished: string | null = null): LastRound {
  const cursor = over.cursor ?? 1;
  const full: RoundStateV1 = {
    v: 1, seed: { server: 'srv-r', client: 'cli', nonce: 3 }, eid: newEngineRoundId(),
    script: scriptSha, action: 'spin', betIndex: 2, priceMultiplier: 1,
    cursor, totalWinX: Math.max(0, cursor - 1),
    actions: Array.from({ length: Math.max(0, cursor - 1) }, () => ({ a: 'free_spin' })),
    ...over,
  };
  return {
    round_id: 'round-open', price_multiplier: 1, bet_index: 2, win_multiplier: 0, win: 0,
    started_at: '2026-08-10T10:00:00.000Z', finished_at: finished,
    round_version: 1, round_state_version: '1', round_state: encodeRoundState(full),
    is_platform_max_win_reached: false,
  };
}

describe('восстановление раунда', () => {
  it('закрытый раунд восстанавливать нечего', async () => {
    const res = await resumeRound(deps(fakeApi()), ctx, lastRound({}, '2026-08-10T10:00:05.000Z'));
    expect(res).toBeNull();
  });

  it('неподтверждённый сегмент отдаётся заново, а не съедается', async () => {
    // cursor 2 при двух сыгранных фриспинах: игрок подтвердил spin и первый
    // фриспин, а второй ему уже отдали — и связь оборвалась посреди его
    // анимации. Вернуть обязаны именно его.
    const res = await resumeRound(
      deps(fakeApi()), ctx, lastRound({ cursor: 2, actions: [{ a: 'free_spin' }, { a: 'free_spin' }] }),
    );
    expect(res).not.toBeNull();
    expect(res!.recovered).toBe(false);
    expect(res!.delivery.action).toBe('free_spin');
    expect(res!.delivery.winX).toBe(1);
    expect(res!.delivery.totalWinX).toBe(2); // второй фриспин, а не третий
    expect(res!.delivery.spinsPlayed).toBe(3);
    expect(res!.delivery.creditPending).toBe(true);
    expect(res!.round!.roundId).toBe('round-open');
    expect(res!.round!.roundVersion).toBe(1);
    // Лог не вырос: этот сегмент в нём уже был.
    expect(res!.round!.state.actions).toHaveLength(2);
  });

  it('всё сыгранное подтверждено — играем следующий сегмент', async () => {
    // cursor 2, один сыгранный фриспин: игрок досмотрел всё, что ему отдали.
    const res = await resumeRound(deps(fakeApi()), ctx, lastRound({ cursor: 2 }));
    expect(res!.delivery.action).toBe('free_spin');
    expect(res!.delivery.totalWinX).toBe(2); // сыгран следующий, второй фриспин
    expect(res!.delivery.creditPending).toBe(true);
    expect(res!.round!.state.actions).toHaveLength(2);
  });

  it('единственный неподтверждённый сегмент оказывается финальным — курсор и лог согласуются', async () => {
    // cursor 3, два сыгранных фриспина: всё сыгранное подтверждено, значит
    // играем следующий — и он оказывается последним. Ветка "переиграли лог,
    // шагнули вперёд, попали в финал".
    const api = fakeApi();
    const res = await resumeRound(deps(api), ctx, lastRound({ cursor: 3 }));
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    const sent = api.closeRound.mock.calls[0][0];
    expect(sent.win_multiplier).toBe(3);
    expect(res!.round).toBeNull();
    expect(res!.recovered).toBe(false);
    expect(res!.delivery.creditPending).toBe(false);
    expect(res!.delivery.balanceAfter).toBe(150);
    // Именно это должно упасть, если арифметику курсора когда-нибудь сломают:
    // персистентный round_state обязан описывать все 3 сыгранных фриспина и
    // курсор на единицу больше их числа (entry + 3 подтверждённых фриспина).
    const persisted = decodeRoundState(sent.round_state);
    expect(persisted.actions.length).toBe(3);
    expect(persisted.cursor).toBe(4);
  });

  it('лог уже покрывает раунд целиком — закрываем настоящим итогом из движка', async () => {
    // cursor 4 при трёх сыгранных фриспинах: продолжать нечем, но раунд у
    // платформы всё ещё открыт (CloseRound по нему когда-то не прошёл).
    const api = fakeApi();
    const res = await resumeRound(deps(api), ctx, lastRound({ cursor: 4 }));
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    expect(api.closeRound.mock.calls[0][0].win_multiplier).toBe(3);
    expect(decodeRoundState(api.closeRound.mock.calls[0][0].round_state).cursor).toBe(4);
    expect(res!.round).toBeNull();
    expect(res!.delivery.balanceAfter).toBe(150);
  });

  it('разъехавшийся скрипт закрывает раунд накопленным выигрышем', async () => {
    const api = fakeApi();
    const res = await resumeRound(
      deps(api), ctx, lastRound({ script: 'sha-старый', cursor: 3, totalWinX: 2 }),
    );
    expect(res!.recovered).toBe(true);
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    const closed = api.closeRound.mock.calls[0][0];
    expect(closed.win_multiplier).toBe(2); // накопленное из round_state, не ноль
    expect(closed.status).toBe('completed');
    expect(res!.round).toBeNull();
  });

  it('движок на поде уже сыграл этот сегмент — resumeRound переигрывает его заново, а не спотыкается о рассинхрон', async () => {
    // Ставим раунд туда, где его застаёт advanceRound перед CloseRound:
    // entry + 2 подтверждённых free_spin сыграны и в движке, и в логе; третий
    // (финальный) free_spin УЖЕ сыгран в движке, но платформа о нём ещё не
    // знает — так выглядит "CloseRound не прошёл" изнутри одного процесса.
    const seed = newSeed();
    const eid = newEngineRoundId();
    const hot: RoundStateV1 = {
      v: 1, seed, eid, script: '', action: 'spin', betIndex: 2, priceMultiplier: 1,
      cursor: 0, totalWinX: 0, actions: [],
    };
    await openEntry(engine, 'feature-game', hot);
    await stepRound(engine, hot, 'free_spin'); hot.actions.push({ a: 'free_spin' });
    await stepRound(engine, hot, 'free_spin'); hot.actions.push({ a: 'free_spin' });
    const ahead = await stepRound(engine, hot, 'free_spin'); // сыгран в движке, не в round_state
    expect(ahead.isFinal).toBe(true);

    const api = fakeApi();
    const last = lastRound({
      eid, seed, script: hot.script, cursor: 3, totalWinX: 2,
      actions: [{ a: 'free_spin' }, { a: 'free_spin' }],
    });
    const res = await resumeRound(deps(api), ctx, last);

    expect(res).not.toBeNull();
    expect(res!.round).toBeNull(); // раунд закрыт
    expect(res!.recovered).toBe(false); // честный доигранный итог, не ScriptMismatch-аварийка
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    const persisted = decodeRoundState(api.closeRound.mock.calls[0][0].round_state);
    expect(persisted.actions.at(-1)).toEqual({ a: 'free_spin' });
    expect(persisted.actions).toHaveLength(3);
    expect(persisted.cursor).toBe(4);
    // Значения совпадают с тем, что движок уже посчитал горячим путём —
    // переигрывание под новым eid воспроизводит раунд посегментно.
    expect(api.closeRound.mock.calls[0][0].win_multiplier).toBe(ahead.totalWinX);
    expect(res!.delivery.totalWinX).toBe(ahead.totalWinX);
    expect(res!.delivery.data).toEqual(ahead.data);
    expect(res!.delivery.creditPending).toBe(false);
  });

  it('обычный реконнект посреди анимации: движок впереди лога — сегмент возвращается, а не роняет восстановление', async () => {
    // Ровно то состояние, в котором обрыв связи застаёт под чаще всего:
    // сегмент отдан игроку (и потому сыгран в движке и записан в лог), но
    // `ack` по нему не пришёл. Раньше это была фатальная ошибка рассинхрона.
    const seed = newSeed();
    const eid = newEngineRoundId();
    const hot: RoundStateV1 = {
      v: 1, seed, eid, script: '', action: 'spin', betIndex: 2, priceMultiplier: 1,
      cursor: 0, totalWinX: 0, actions: [],
    };
    await openEntry(engine, 'feature-game', hot);
    await stepRound(engine, hot, 'free_spin'); hot.actions.push({ a: 'free_spin' });
    const unacked = await stepRound(engine, hot, 'free_spin'); // отдан игроку, не подтверждён

    const api = fakeApi();
    const res = await resumeRound(deps(api), ctx, lastRound({
      eid, seed, script: hot.script, cursor: 2, totalWinX: 1,
      actions: [{ a: 'free_spin' }, { a: 'free_spin' }],
    }));

    expect(res!.round).not.toBeNull();
    expect(res!.delivery.winX).toBe(unacked.winX);
    expect(res!.delivery.totalWinX).toBe(unacked.totalWinX);
    expect(res!.delivery.data).toEqual(unacked.data);
    expect(api.closeRound).not.toHaveBeenCalled(); // раунд не закрыт: он продолжается
  });

  it('автозакрытие доигрывает раунд и шлёт AutocloseRoundRequest', async () => {
    const api = fakeApi();
    const balance = await autocloseRound(deps(api), ctx, lastRound({ cursor: 1 }));
    expect(api.autocloseRound).toHaveBeenCalledTimes(1);
    const sent = api.autocloseRound.mock.calls[0][0];
    expect(sent.round_id).toBe('round-open');
    expect(sent.win_multiplier).toBe(3); // полный математический итог, не откат
    expect(sent.status).toBe('completed');
    expect(sent.round_version).toBe(1);
    expect(balance).toBe(150);
  });

  it('автозакрытие при разъехавшемся скрипте берёт накопленное', async () => {
    const api = fakeApi();
    await autocloseRound(deps(api), ctx, lastRound({ script: 'sha-старый', cursor: 3, totalWinX: 2 }));
    expect(api.autocloseRound.mock.calls[0][0].win_multiplier).toBe(2);
  });
});
