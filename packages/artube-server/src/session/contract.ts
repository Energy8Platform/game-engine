/**
 * Сверка `SessionInfoResponse` с докой платформы — на границе, где ответ
 * входит в наш код.
 *
 * Зачем вообще: этот провод уже трижды расходился со своей же спекой —
 * `currency` объявлена обязательной и не приехала; `Error` описан в двух
 * противоречащих формах; `GoAway` читался как терминальный. Каждый раз
 * расхождение обнаруживалось не там, где оно произошло, а на несколько кадров
 * позже: как `undefined` в кошельке, как строка `"undefined"` в сообщении, как
 * молчащий под. Смысл этой проверки — назвать расхождение вслух ровно в той
 * точке, где оно въехало, и назвать поле, а не симптом.
 *
 * **Что она делает при несовпадении — намеренно асимметрично.**
 *
 *  - Бросает РОВНО на том, без чего соединение обслужить нельзя: нет
 *    `game_settings` или нет списка ставок. Без ставок нет ни цены спина, ни
 *    `bet_index` — играть не во что, и единственная альтернатива броску —
 *    выдумать ставки за платформу. Сегодня это тоже падает, но случайным
 *    `TypeError` изнутри `buildInit`; здесь падает с именем поля.
 *  - На всём остальном НЕ бросает. Строгий валидатор против платформы, которая
 *    уже нарушает свою же спеку, — это способ превратить работающую игру в
 *    мёртвую: `rtp_settings` — это галочка «показывать RTP в правилах», и
 *    ронять из-за неё живую сессию с деньгами было бы хуже любого симптома,
 *    который она лечит. Такие поля возвращаются списком отклонений, вызывающий
 *    пишет их в лог и продолжает.
 *
 * **Что она НЕ проверяет и почему.** Только поля, которые мы читаем.
 * `security_hash`, `history`, `rtp_options` тоже объявлены обязательными, но мы
 * их не используем — сообщать о них значило бы приучить читателя лога
 * пролистывать эти строки, а вместе с ними и настоящие. `currency` тоже не
 * здесь: у неё свой разбор (`classifyCurrency`) и свой лог, где сказано не
 * только «поля нет», но и что из-за этого будет с сессией.
 */

import type { SessionInfoResponse } from '../games-api/types.js';

/** Одно расхождение провода с докой — поле, что не так, и чем мы это закрыли. */
export interface SessionDeviation {
  /** Путь поля так, как он выглядит в `session-info.md`. */
  field: string;
  /** Что с ним не так на проводе. */
  problem: string;
  /** Что делаем вместо него — то есть цена этого расхождения для игрока. */
  effect: string;
}

/**
 * Ответ платформы нельзя обслужить: не хватает того, без чего нет игры.
 *
 * Отдельный класс, а не `Error`, чтобы `ws.ts` отдал фронту осмысленный код, а
 * не `InternalServerError` с текстом про чтение свойства у `undefined`.
 */
export class SessionInfoContractError extends Error {
  readonly code = 'InvalidSessionInfo';

  constructor(readonly deviation: SessionDeviation) {
    super(
      `SessionInfoResponse.${deviation.field}: ${deviation.problem} `
      + `(session-info.md объявляет поле обязательным) — ${deviation.effect}`,
    );
    this.name = 'SessionInfoContractError';
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Проверить ответ на SessionInfo.
 *
 * Бросает `SessionInfoContractError` на непригодном ответе; всё остальное
 * возвращает списком отклонений (пустой список — провод совпал с докой).
 */
export function checkSessionInfo(info: SessionInfoResponse): SessionDeviation[] {
  const out: SessionDeviation[] = [];
  const settings: unknown = (info as { game_settings?: unknown }).game_settings;

  if (!isObject(settings)) {
    throw new SessionInfoContractError({
      field: 'game_settings',
      problem: settings === undefined ? 'отсутствует' : `не объект (${typeof settings})`,
      effect: 'обслужить сессию нечем: в нём лежат и ставки, и настройки показа',
    });
  }

  const bets: unknown = settings.allowed_bets;
  if (!Array.isArray(bets) || bets.length === 0 || !bets.every(isFiniteNumber)) {
    throw new SessionInfoContractError({
      field: 'game_settings.allowed_bets',
      problem: !Array.isArray(bets)
        ? (bets === undefined ? 'отсутствует' : `не массив (${typeof bets})`)
        : (bets.length === 0 ? 'пустой массив' : 'содержит не-числа'),
      effect:
        'без лестницы ставок нет ни цены спина, ни смысла у bet_index; '
        + 'подставить её за платформу значило бы играть на выдуманные деньги',
    });
  }

  // Дальше — только то, что мы читаем, и ни одно из этого не стоит сессии.
  if (!isFiniteNumber(settings.default_bet_index)) {
    out.push({
      field: 'game_settings.default_bet_index',
      problem: settings.default_bet_index === undefined ? 'отсутствует' : 'не число',
      effect: 'уезжает во фронт как есть; игра выберет ставку сама',
    });
  } else if (settings.default_bet_index < 0 || settings.default_bet_index >= bets.length) {
    out.push({
      field: 'game_settings.default_bet_index',
      problem: `${settings.default_bet_index} вне allowed_bets (${bets.length} шт.)`,
      effect: 'уезжает во фронт как есть; игра выберет ставку сама',
    });
  }

  if (!isFiniteNumber(settings.currency_minimal_unit)) {
    out.push({
      field: 'game_settings.currency_minimal_unit',
      problem: settings.currency_minimal_unit === undefined ? 'отсутствует' : 'не число',
      effect: 'округление сумм игра сделает по своим догадкам, а не по валюте сессии',
    });
  }

  if (!Array.isArray(settings.available_auto_spin_counts)) {
    out.push({
      field: 'game_settings.available_auto_spin_counts',
      problem: settings.available_auto_spin_counts === undefined ? 'отсутствует' : 'не массив',
      effect: 'во фронт уезжает пустой список — автоспин недоступен',
    });
  }

  if (!Array.isArray(settings.locales)) {
    out.push({
      field: 'game_settings.locales',
      problem: settings.locales === undefined ? 'отсутствует' : 'не массив',
      effect: 'во фронт уезжает пустой список — игра останется на своём языке по умолчанию',
    });
  }

  if (!isObject(settings.rtp_settings)) {
    out.push({
      field: 'game_settings.rtp_settings',
      problem: settings.rtp_settings === undefined ? 'отсутствует' : 'не объект',
      effect: 'RTP в правилах игры не показывается (is_visible: false)',
    });
  }

  const maxWin: unknown = settings.platform_max_win;
  // `platform_max_win` необязателен целиком — проверяем только приехавший.
  if (isObject(maxWin)) {
    if (typeof maxWin.base_currency !== 'string' || maxWin.base_currency === '') {
      // Ровно тот случай, который дока и демонстрирует: её собственный пример
      // payload'а (session-info.md) показывает `platform_max_win` БЕЗ
      // `base_currency`, хотя таблица полей называет его обязательным.
      out.push({
        field: 'platform_max_win.base_currency',
        problem: maxWin.base_currency === undefined ? 'отсутствует' : 'не строка',
        effect: 'во фронт уезжает max-win без кода базовой валюты',
      });
    }
    if (!isFiniteNumber(maxWin.player_currency_value)) {
      out.push({
        field: 'platform_max_win.player_currency_value',
        problem: maxWin.player_currency_value === undefined ? 'отсутствует' : 'не число',
        effect: 'во фронт уезжает max-win без суммы в валюте игрока',
      });
    }
  }

  if (!isFiniteNumber(info.balance)) {
    out.push({
      field: 'balance',
      problem: info.balance === undefined ? 'отсутствует' : 'не число',
      effect: 'игрок увидит пустой баланс до первого события от платформы',
    });
  }

  // `last_round` проверяем только тот, который собираемся ВОССТАНАВЛИВАТЬ:
  // закрытый раунд мы не читаем, и жаловаться на его поля значило бы шуметь на
  // каждом коннекте после каждого сыгранного спина.
  const last: unknown = info.last_round;
  if (isObject(last) && !last.finished_at) {
    for (const field of ['round_id', 'round_state'] as const) {
      if (typeof last[field] !== 'string' || last[field] === '') {
        out.push({
          field: `last_round.${field}`,
          problem: last[field] === undefined ? 'отсутствует' : 'не строка',
          effect: 'незакрытый раунд восстановить не удастся — игрок увидит ошибку вместо продолжения',
        });
      }
    }
    if (!isFiniteNumber(last.round_version)) {
      out.push({
        field: 'last_round.round_version',
        problem: last.round_version === undefined ? 'отсутствует' : 'не число',
        effect: 'незакрытый раунд восстановить не удастся — платформа отвергнет операции по нему',
      });
    }
  }

  return out;
}
