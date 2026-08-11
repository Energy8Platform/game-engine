/**
 * Обрыв связи посреди анимации сегмента — самый обычный конец сессии, а не
 * экзотика. Игрок на четвёртом фриспине из десяти теряет связь, пока игра
 * крутит анимацию: сегмент ему уже отдан, но `ack` он прислать не успел.
 *
 * Два обязательных исхода этого состояния:
 *  - игрок вернулся → тот же самый сегмент отдаётся заново, раунд доигрывается;
 *  - игрок не вернулся → автозакрытие отдаёт платформе честный итог раунда,
 *    а не проваливается в откат ставки, съедающий выигрыш фичи.
 *
 * Тест гоняет настоящий сервер, настоящий движок и Games API, который ведёт
 * раунд как платформа (round_version, last_round, запрет повторных денежных
 * RPC). Реконнект попадает на ТОТ ЖЕ под — движок раунда ещё помнит.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { decodeRoundState } from '../src/round/roundState';
import { startFakePlatform, type FakePlatform } from './helpers/fakePlatform';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let platform: FakePlatform;
let server: ArtubeServer;
let base: string;

beforeEach(async () => {
  platform = await startFakePlatform({ allowedBets: [0.5, 2] });
  server = createArtubeServer({
    gameId: 'feature-game', gamesApiUrl: platform.url, apiKey: 'k', spinPath: fixtures,
  });
  await server.listen(0);
  base = `ws://127.0.0.1:${server.port}`;
}, 40_000);

afterEach(async () => {
  await server?.close();
  await platform?.close();
});

interface Client {
  socket: WebSocket;
  messages: any[];
  waitFor(t: string, timeoutMs?: number): Promise<any>;
  nth(t: string, n: number, timeoutMs?: number): Promise<any>;
  send(msg: unknown): void;
  close(): Promise<void>;
}

function connect(sessionId: string): Client {
  const socket = new WebSocket(`${base}/api/ws?sessionId=${sessionId}`);
  const messages: any[] = [];
  socket.on('message', (d) => messages.push(JSON.parse(d.toString())));
  const nth = (t: string, n: number, timeoutMs = 5000) =>
    new Promise<any>((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        const found = messages.filter((m) => m.t === t);
        if (found.length >= n) { clearInterval(tick); resolve(found[n - 1]); }
        else if (Date.now() - started > timeoutMs) {
          clearInterval(tick);
          reject(new Error(`no ${t}#${n}; got ${JSON.stringify(messages)}`));
        }
      }, 10);
    });
  return {
    socket, messages, nth,
    waitFor: (t, timeoutMs) => nth(t, 1, timeoutMs),
    send: (msg) => socket.send(JSON.stringify(msg)),
    close: () =>
      new Promise<void>((resolve) => {
        socket.on('close', () => resolve());
        socket.close();
      }),
  };
}

/**
 * Довести раунд ровно до состояния «сегмент отдан, `ack` не пришёл»:
 * spin подтверждён, первый фриспин отдан и повис на анимации.
 */
async function playUntilUnacked(sessionId: string): Promise<Client> {
  const c = connect(sessionId);
  await c.waitFor('init');
  c.send({ t: 'play', id: 'p0', action: 'spin', betIndex: 1 });
  const spin = await c.waitFor('result');
  expect(spin.creditPending).toBe(true);
  c.send({ t: 'ack', roundId: spin.roundId, cursor: 1 });
  await new Promise((r) => setTimeout(r, 50));

  c.send({ t: 'play', id: 'p1', action: 'free_spin', betIndex: 1 });
  const first = await c.nth('result', 2);
  expect(first.winX).toBe(1);
  expect(first.spinsPlayed).toBe(2);
  // Ack НЕ шлём — игра как раз крутит анимацию этого сегмента.
  await new Promise((r) => setTimeout(r, 50));
  return c;
}

describe('обрыв посреди анимации сегмента', () => {
  it('реконнект на тот же под возвращает неподтверждённый сегмент и раунд доигрывается', async () => {
    const first = await playUntilUnacked('sess-blip');
    const delivered = first.messages.filter((m) => m.t === 'result').at(-1);
    await first.close();

    // Тот же под, тот же движок — раунд в нём ещё горячий и на шаг впереди
    // подтверждённого курсора. Игрок обязан получить init, а не 1011.
    const back = connect('sess-blip');
    const init = await back.waitFor('init');
    expect(init.resume).toBeTruthy();
    // Ровно тот же сегмент, а не следующий: тот, что игрок не досмотрел.
    expect(init.resume.action).toBe('free_spin');
    expect(init.resume.spinsPlayed).toBe(delivered.spinsPlayed);
    expect(init.resume.winX).toBe(delivered.winX);
    expect(init.resume.totalWinX).toBe(delivered.totalWinX);
    expect(init.resume.data).toEqual(delivered.data);
    expect(init.resume.betAmount).toBe(2);
    expect(init.resume.creditPending).toBe(true);

    // И раунд можно доиграть: подтверждаем возвращённый сегмент и крутим два
    // оставшихся фриспина.
    back.send({ t: 'ack', roundId: init.resume.roundId, cursor: 2 });
    await new Promise((r) => setTimeout(r, 50));
    back.send({ t: 'play', id: 'r1', action: 'free_spin', betIndex: 1 });
    const second = await back.waitFor('result');
    expect(second.totalWinX).toBe(2);
    back.send({ t: 'ack', roundId: second.roundId, cursor: 3 });
    await new Promise((r) => setTimeout(r, 50));
    back.send({ t: 'play', id: 'r2', action: 'free_spin', betIndex: 1 });
    const final = await back.nth('result', 2);

    expect(final.creditPending).toBe(false);
    expect(final.totalWinX).toBe(3);           // весь выигрыш фичи, не часть
    expect(final.balanceAfter).toBe(100 - 2 + 3 * 2); // ставка списана один раз
    expect(back.messages.some((m) => m.t === 'error')).toBe(false);

    // Деньги двигались ровно по одному разу на каждую сторону раунда.
    expect(platform.countOf('OpenRoundRequest')).toBe(1);
    expect(platform.countOf('CloseRoundRequest')).toBe(1);
    expect(platform.countOf('PlayRoundRequest')).toBe(0);
    await back.close();
  }, 40_000);

  it('брошенный в этом состоянии раунд автозакрывается честным итогом, а не откатом', async () => {
    const c = await playUntilUnacked('sess-abandoned');
    await c.close();

    platform.emitEvent('AutocloseRequestEvent', {
      session_id: 'sess-abandoned',
      round_id: platform.roundOf('sess-abandoned')!.round_id,
    });

    const closed = await waitUntil(
      () => platform.roundOf('sess-abandoned')!.finished_at !== null,
      5000,
    );
    expect(closed).toBe(true);
    expect(platform.countOf('AutocloseRoundRequest')).toBe(1);
    // Полный математический итог раунда: 3 фриспина по 1.0. Провал этого пути
    // означал бы платформенный откат — игрок получил бы назад ставку и
    // потерял бы выигрыш фичи.
    const sent = platform.received('AutocloseRoundRequest')[0].payload;
    expect(sent.win_multiplier).toBe(3);
    expect(sent.status).toBe('completed');
    expect(platform.balance).toBe(100 - 2 + 3 * 2);
  }, 40_000);

  it('неподтверждённый сегмент лежит в round_state — его увидит и другой под', async () => {
    const c = await playUntilUnacked('sess-persisted');
    const state = decodeRoundState(platform.roundOf('sess-persisted')!.round_state);
    // Курсор двигает только `ack`, а лог действий — сам факт того, что сегмент
    // сыгран: без этого «сыгранный, но не подтверждённый» сегмент существовал
    // бы только в памяти пода и терялся вместе с ней.
    expect(state.cursor).toBe(1);
    expect(state.actions).toEqual([{ a: 'free_spin' }]);
    await c.close();
  }, 40_000);
});

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (predicate()) return true;
    } catch {
      // состояние ещё не появилось
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}
