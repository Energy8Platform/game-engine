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
 * Гарантировать, что раунд открыт в движке. Горячий путь ничего не делает;
 * холодный — поднимает раунд заново и догоняет курсор по логу действий.
 */
export async function ensureOpen(
  engine: EngineClient,
  gameId: string,
  state: RoundStateV1,
): Promise<void> {
  const known = await engine.getRound(state.eid);
  if (known.found && !known.round_complete) {
    if (state.script && known.script_sha256 && state.script !== known.script_sha256) {
      throw new ScriptMismatchError(state.script, known.script_sha256);
    }
    return;
  }
  // Холодный подъём: заново под тем же eid, затем догоняем лог действий.
  await start(engine, gameId, state, `${state.eid}-recover`);
  for (let i = 0; i < state.actions.length; i++) {
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
  let guard = 0;
  while (known.found && !known.round_complete && guard++ < 1000) {
    const action = known.next_actions[0];
    const segment = await stepRound(engine, state, action);
    state.actions.push({ a: action });
    state.cursor += 1;
    total = segment.totalWinX;
    state.totalWinX = total;
    if (segment.isFinal) break;
    known = await engine.getRound(state.eid);
  }
  return total;
}
