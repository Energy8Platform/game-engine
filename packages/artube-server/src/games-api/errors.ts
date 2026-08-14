/**
 * Ошибки Artube Games API и политика ретраев.
 *
 * Ретраим только идемпотентное. `PlayRound` / `OpenRound` / `CloseRound` /
 * `AutocloseRound` — деньги: повтор может списать ставку дважды, поэтому они
 * не ретраятся ни при каком коде.
 */

import type { ErrorPayload } from './types.js';

/**
 * Достать код и текст из тела `Error`, в какой бы из двух документированных
 * форм оно ни приехало (`code`/`message` против `error_code`/`error_message` —
 * дока называет обе, см. `ErrorPayload`).
 *
 * Не косметика: `code` — единственное, на что смотрят `isRetryable`,
 * `isDemoUserRejection` и список восстановимых кодов. Прочитай мы его из
 * неверного поля, `err.code` был бы `undefined`, `super(undefined)` сделал бы
 * сообщением строку `"undefined"`, и КАЖДАЯ из этих развилок молча пошла бы не
 * в ту сторону — включая ту, что переводит сессию на локальный кошелёк.
 */
export function readErrorPayload(payload: ErrorPayload | undefined | null): {
  code: string;
  message: string;
  details?: Record<string, unknown>;
} {
  const p = payload ?? {};
  const code = p.code ?? p.error_code;
  const message = p.message ?? p.error_message;
  return {
    // Пустой код хуже выдуманного: на нём разъезжаются все ветки разом, а
    // `UnknownError` хотя бы честно называет то, что произошло.
    code: typeof code === 'string' && code !== '' ? code : 'UnknownError',
    message: typeof message === 'string' && message !== '' ? message : (code ?? 'UnknownError'),
    details: p.details ?? p.error_details,
  };
}

export class GamesApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(payload: ErrorPayload) {
    const parsed = readErrorPayload(payload);
    super(parsed.message);
    this.name = 'GamesApiError';
    this.code = parsed.code;
    this.details = parsed.details;
  }

  /** Задержка перед повтором, если платформа её продиктовала. */
  get retryAfterMs(): number | undefined {
    const value = this.details?.retry_after_ms;
    return typeof value === 'number' ? value : undefined;
  }

  static internal(message: string): GamesApiError {
    return new GamesApiError({ code: 'InternalServerError', message });
  }
}

/** Типы запросов, которые можно безопасно повторить. */
export const IDEMPOTENT_TYPES: ReadonlySet<string> = new Set([
  'SessionInfoRequest',
  'UpdateRoundStateRequest',
]);

/**
 * Сообщение, которым платформа объявляет игрока демо-пользователем.
 *
 * `error-handling.md:209` даёт шаблон:
 *
 *     "Operation {NameOfOperation} is not allowed for a demo user."
 *
 * а живая платформа прислала его же без артикля:
 *
 *     "Operation Latest is not allowed for demo user."
 *
 * Отсюда форма проверки. Подстрока шаблона не годится — она как раз и не
 * совпала бы (`a demo user` против `demo user`). Имя операции в проверку не
 * входит вовсе: `Latest` не встречается ни в нашем коде, ни в их доке, это
 * внутреннее имя платформы, и привязка к нему сломалась бы от переименования
 * где-то у них. Совпадаем по двум устойчивым частям — «не разрешено» и
 * «демо-пользователь».
 */
const DEMO_USER_REJECTION = /not\s+allowed\s+for\s+(?:an?\s+)?demo\s+user/i;

/**
 * Платформа отвергла раундовую RPC, потому что считает эту сессию демо.
 *
 * Это её собственный вердикт о сессии — единственный однозначный, который у
 * нас есть: `currency` приезжает в трёх разных формах и ни одна из них не
 * различает демо и реальные деньги надёжно (см. `session/init.ts`).
 *
 * Кода мало, нужен и текст: `OperationNotAllowed` — общий код («Данная
 * операция не разрешена. Подробности в сообщении», api-overview.md:353).
 * Любая другая запрещённая операция приезжает под ним же, и реакция на один
 * код перевела бы РЕАЛЬНОГО игрока на бутафорский кошелёк — ровно та ошибка,
 * которую всё это должно исключить.
 */
export function isDemoUserRejection(err: unknown): boolean {
  return (
    err instanceof GamesApiError &&
    err.code === 'OperationNotAllowed' &&
    DEMO_USER_REJECTION.test(err.message)
  );
}

/**
 * Коды, при которых повтор имеет смысл. Дока прямо говорит: только
 * `BackPressureRejected` — платформа явно просит повторить и присылает
 * `details.retry_after_ms`. Для всего остального, включая `InternalServerError`
 * (в т.ч. локальные: не было коннекта, RPC не ответил за таймаут, коннект
 * оборвался — все они помечаются этим же кодом через `GamesApiError.internal`),
 * дока говорит: повтор не поможет, нужна диагностика. Ретраить их означало бы
 * жечь до ~3× `rpcTimeoutMs` на каждый неотвечающий бэкенд — ровно тогда,
 * когда вызывающему нужен быстрый и предсказуемый отказ.
 */
export function isRetryable(code: string): boolean {
  return code === 'BackPressureRejected';
}
