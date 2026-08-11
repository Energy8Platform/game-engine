/**
 * Раунд в движке: горячий и холодный путь.
 *
 * Горячий — раунд ещё открыт в `e8-server` на этом поде: один `Step` на сегмент.
 * Холодный — движок раунда не знает (рестарт, другой под): поднимаем его заново
 * из тройки сидов и лога действий, доигрываем до курсора и продолжаем.
 *
 * Открытый раунд — кэш, а не состояние: его потеря ничего не стоит, потому что
 * правда лежит в `round_state` на стороне Artube.
 */

import type { EngineClient, RoundResponse } from '../engine/index.js';
import type { RoundStateV1 } from './roundState.js';

export interface Segment {
  /** Действие, которому соответствует сегмент: 'spin' | 'free_spin' | 'gamble'. */
  action: string;
  data: Record<string, unknown>;
  /** Выигрыш этого сегмента в множителях ставки. */
  winX: number;
  /** Накопленный выигрыш по сегмент включительно, в множителях. */
  totalWinX: number;
  nextActions: string[];
  spinsRemaining: number;
  spinsPlayed: number;
  isFinal: boolean;
}

export class ScriptMismatchError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super(`round was played on script ${expected}, engine has ${actual}`);
    this.name = 'ScriptMismatchError';
  }
}

function toSegment(response: RoundResponse, action: string): Segment {
  return {
    action,
    data: response.data_json ? (JSON.parse(response.data_json) as Record<string, unknown>) : {},
    winX: response.win,
    totalWinX: response.total_win,
    nextActions: response.next_actions,
    spinsRemaining: response.spins_remaining,
    spinsPlayed: response.spins_played,
    isFinal: response.round_complete,
  };
}

/**
 * Начать раунд. Ставку в движок всегда передаём как 1.0, чтобы `win` и
 * `total_win` приходили чистыми множителями — тем, что Artube ждёт в
 * `win_multiplier`. Деньги считает Games API, не мы.
 */
async function start(
  engine: EngineClient,
  gameId: string,
  state: RoundStateV1,
  requestId: string,
): Promise<RoundResponse> {
  const response = await engine.startRound({
    gameId,
    playerId: 'artube',
    roundId: state.eid,
    serverSeed: state.seed.server,
    clientSeed: state.seed.client,
    nonce: state.seed.nonce,
    action: state.action,
    bet: 1,
    paramsJson: '',
    requestId,
  });
  if (response.error) throw new Error(`engine StartRound: ${response.error}`);
  if (state.script && response.script_sha256 && state.script !== response.script_sha256) {
    throw new ScriptMismatchError(state.script, response.script_sha256);
  }
  state.script = response.script_sha256;
  return response;
}

/** Entry-действие: один шаг. `isFinal` в ответе решает, простой раунд или сложный. */
export async function openEntry(
  engine: EngineClient,
  gameId: string,
  state: RoundStateV1,
): Promise<Segment> {
  return toSegment(await start(engine, gameId, state, `${state.eid}-open`), state.action);
}

/**
 * Доиграть лог действий с позиции `fromIndex` — общий хвост для полного
 * холодного подъёма (fromIndex 0) и для резюме недоигранного восстановления
 * (fromIndex посередине лога).
 */
async function replayFrom(
  engine: EngineClient,
  state: RoundStateV1,
  fromIndex: number,
): Promise<void> {
  for (let i = fromIndex; i < state.actions.length; i++) {
    const logged = state.actions[i];
    const response = await engine.step(
      state.eid,
      logged.a,
      logged.p ? JSON.stringify(logged.p) : '',
      `${state.eid}-recover-${i}`,
    );
    if (response.error) throw new Error(`engine Step (recover): ${response.error}`);
  }
}

export interface EnsureOpenOptions {
  /**
   * Разрешить "движок ровно на один шаг впереди лога" — молча считать это
   * состоянием, которое переиграет следующий Step вызывающего, вместо того
   * чтобы бросать ошибку рассинхрона.
   *
   * По умолчанию `false` — строгая проверка. Это НЕ безопасно в общем случае:
   * ничего в этом кодбейсе не гарантирует единственного писателя на раунд
   * (несколько WS-коннектов с одним `sessionId` делят один `EngineClient`,
   * сериализация — только по очереди ОДНОГО коннекта). Если "впереди на один
   * шаг" вызвано ДРУГИМ коннектом, чьё действие отличалось от того, что
   * собирается сыграть текущий вызывающий, идемпотентный кэш движка отдаст
   * результат ЧУЖОГО действия под чужим `request_id`, а `stepRound` подпишет
   * его текущим (неверным) именем действия — именно тот тихий рассинхрон,
   * который строгая проверка обязана ловить.
   *
   * Единственный безопасный вызывающий — `resumeRound`: там "следующее
   * действие" вычисляется детерминированно из ТОГО ЖЕ лога, что и у уже
   * сыгранного в движке шага (`state.actions.at(-1)?.a ?? state.action`), так
   * что переигрываемое действие заведомо совпадает с уже закэшированным.
   */
  tolerateAheadByOne?: boolean;
}

/**
 * Гарантировать, что раунд открыт в движке и доигран ровно до нашего лога.
 * Горячий путь ничего не делает; холодный — поднимает раунд заново и
 * догоняет лог действий.
 */
export async function ensureOpen(
  engine: EngineClient,
  gameId: string,
  state: RoundStateV1,
  options: EnsureOpenOptions = {},
): Promise<void> {
  const known = await engine.getRound(state.eid);
  // `found` — а не `found && !round_complete` — потому что "движок знает этот
  // eid" делает холодный `start()` ниже невозможным (StartRound отказывает,
  // если раунд уже существует) НЕЗАВИСИМО от того, довёл ли он раунд до
  // конца. Раунд, уже сыгранный этим же процессом до финала (например,
  // advanceRound успел доиграть и закрыть его в движке, а CloseRound
  // платформе не прошёл), — это `found: true, round_complete: true`, и его
  // тоже нужно сверять по `spins_played`, а не гнать в заведомо провальный
  // холодный путь.
  if (known.found) {
    if (state.script && known.script_sha256 && state.script !== known.script_sha256) {
      throw new ScriptMismatchError(state.script, known.script_sha256);
    }
    // `spins_played` — счётчик самого движка: 1 сразу после StartRound, +1
    // на каждый Step. Это единственный надёжный ответ на вопрос "движок
    // реально доигран до нашего лога?" — "found" сам по себе не отличает
    // горячий путь от раунда, чей предыдущий холодный подъём упал посреди
    // цикла восстановления (транзиентная ошибка движка на каком-то Step) и
    // оставил раунд открытым, но позади state.actions.length. Без сверки по
    // числу ретрай того же ensureOpen на том же поде увидел бы found: true и
    // молча продолжил бы с чужой позиции — hot и cold разошлись бы без следа.
    const expected = 1 + state.actions.length;
    if (known.spins_played === expected) {
      return; // горячий путь: движок уже точно совпадает с логом
    }
    if (known.spins_played < expected) {
      // Резюме прерванного восстановления: доигрываем только недостающий
      // хвост, чтобы повторный вызов после частичного сбоя был идемпотентным.
      await replayFrom(engine, state, known.spins_played - 1);
      return;
    }
    if (known.spins_played === expected + 1 && options.tolerateAheadByOne) {
      // Движок уже сыграл РОВНО тот один сегмент, который вызывающий сейчас
      // переиграет сам следующим Step — паттерн "тот же процесс, тот же
      // раунд, попытка закрыть его на платформе не прошла, а сам сегмент в
      // движке уже честно сыгран". Ничего доигрывать не нужно: запрос
      // вызывающего использует тот же детерминированный `request_id`
      // (функция только длины лога действий), и движок трактует его как
      // идемпотентный повтор — отдаст закэшированный ответ того самого
      // сегмента, а не сыграет заново. Разрешено только явным
      // `tolerateAheadByOne` — без него это неотличимо от другого коннекта,
      // сыгравшего чужое действие поверх того же раунда (см. комментарий у
      // `EnsureOpenOptions`).
      return;
    }
    // known.spins_played > expected (и либо разница больше единицы, либо
    // вызывающий не попросил толерантности): движок сыграл больше сегментов,
    // чем объясняет наш лог. Гадать, каким из лишних шагов доверять, и было
    // бы тем самым молчаливым расхождением, которое эта функция должна ловить
    // — единственный сценарий, где такое расхождение безопасно объяснимо
    // (собственный отложенный Step того же вызывающего), обрабатывается выше
    // явным разрешением, а не молчанием по умолчанию.
    throw new Error(
      `round ${state.eid} is ahead of round_state: engine has played ` +
        `${known.spins_played} segments, round_state accounts for only ${expected}`,
    );
  }
  // Холодный подъём: заново под тем же eid, затем догоняем лог действий.
  await start(engine, gameId, state, `${state.eid}-recover`);
  await replayFrom(engine, state, 0);
}

/** Один сегмент. Вызывается после `ensureOpen`. */
export async function stepRound(
  engine: EngineClient,
  state: RoundStateV1,
  action: string,
  params?: Record<string, unknown>,
): Promise<Segment> {
  const response = await engine.step(
    state.eid,
    action,
    params ? JSON.stringify(params) : '',
    `${state.eid}-${state.actions.length}`,
  );
  if (response.error) throw new Error(`engine Step: ${response.error}`);
  return toSegment(response, action);
}

/**
 * Доиграть раунд до конца от лица игрока — нужен автозакрытию. Ветки выбираем
 * первым доступным действием: интерактив за игрока додумывать нечем.
 *
 * Каждый сыгранный сегмент дописываем в `state.actions` — как это делает
 * любой другой вызывающий `stepRound`. Без этого `request_id` следующего
 * шага (`${eid}-${state.actions.length}`) не меняется между итерациями, а
 * движок трактует повтор `request_id` как идемпотентный ретрай и отдаёт
 * закэшированный ответ ПРЕДЫДУЩЕГО шага вместо игры следующего сегмента —
 * раунд молча зависает на месте.
 */
export async function playToEnd(
  engine: EngineClient,
  gameId: string,
  state: RoundStateV1,
): Promise<number> {
  await ensureOpen(engine, gameId, state);
  let known = await engine.getRound(state.eid);
  let total = known.total_win;
  const maxSteps = 1000;
  for (let steps = 0; steps < maxSteps; steps++) {
    if (!known.found || known.round_complete) return total;
    const action = known.next_actions[0];
    const segment = await stepRound(engine, state, action);
    state.actions.push({ a: action });
    state.cursor += 1;
    total = segment.totalWinX;
    state.totalWinX = total;
    if (segment.isFinal) return total;
    known = await engine.getRound(state.eid);
  }
  // Exhausting the guard means the round genuinely never reached
  // round_complete — a caller that fed this into auto-close would otherwise
  // report `total` (a partial sum) as the round's final win. Throwing keeps
  // that distinction visible instead of laundering it into a number.
  throw new Error(
    `playToEnd(${state.eid}): round did not finish after ${maxSteps} steps`,
  );
}
