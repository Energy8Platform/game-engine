/**
 * Ошибки Artube Games API и политика ретраев.
 *
 * Ретраим только идемпотентное. `PlayRound` / `OpenRound` / `CloseRound` /
 * `AutocloseRound` — деньги: повтор может списать ставку дважды, поэтому они
 * не ретраятся ни при каком коде.
 */

import type { ErrorPayload } from './types.js';

export class GamesApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(payload: ErrorPayload) {
    super(payload.message || payload.code);
    this.name = 'GamesApiError';
    this.code = payload.code;
    this.details = payload.details;
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
