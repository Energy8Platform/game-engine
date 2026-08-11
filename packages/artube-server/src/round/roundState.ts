/**
 * `round_state` — единственное место, где живёт состояние раунда.
 *
 * Кладём туда не дамп движка, а рецепт его воспроизведения: тройку сидов,
 * идентификатор раунда в движке, курсор и лог действий игрока. Десятки байт
 * вместо килобайтов, и любой под продолжит раунд, ничего не помня.
 */

import { randomBytes, randomUUID } from 'node:crypto';

/** Значение поля `round_state_version` в запросах к Games API. */
export const ROUND_STATE_VERSION = '1';

export interface RoundSeed {
  server: string;
  client: string;
  nonce: number;
}

export interface RoundStateV1 {
  v: 1;
  seed: RoundSeed;
  /** Идентификатор раунда в движке. Кэш живёт под ним, пока под жив. */
  eid: string;
  /** sha скрипта, которым раунд играется, — защита от деплоя посреди раунда. */
  script: string;
  /** entry-действие раунда: 'spin' | 'buy_bonus' | … */
  action: string;
  betIndex: number;
  /**
   * Ставка раунда в валюте игрока — та, что лежала в `allowed_bets[betIndex]`
   * в момент открытия раунда. Наружу (в Games API) по-прежнему уезжает только
   * индекс: сумма здесь нужна ровно для одного — показать игроку выигрыш в
   * деньгах на всех сегментах раунда. Список `allowed_bets` платформа вправе
   * поменять посреди раунда, и тогда индекс в нём уже ничего не значит.
   */
  bet: number;
  priceMultiplier: number;
  /** Сколько сегментов игрок уже подтвердил. */
  cursor: number;
  /** Накопленный множитель выигрыша по подтверждённым сегментам. */
  totalWinX: number;
  /**
   * Лог действий ПОСЛЕ entry — по одному на сегмент, с параметрами
   * интерактивного выбора. Без него холодный подъём не воспроизвести.
   */
  actions: Array<{ a: string; p?: Record<string, unknown> }>;
  frcId?: string;
}

export function encodeRoundState(state: RoundStateV1): string {
  return JSON.stringify(state);
}

export function decodeRoundState(raw: string): RoundStateV1 {
  const parsed = JSON.parse(raw) as RoundStateV1;
  if (parsed?.v !== 1) {
    throw new Error(`unsupported round_state version: ${String(parsed?.v)}`);
  }
  return parsed;
}

export function newSeed(): RoundSeed {
  return {
    server: randomBytes(16).toString('hex'),
    client: randomBytes(8).toString('hex'),
    nonce: 1,
  };
}

export function newEngineRoundId(): string {
  return `e-${randomUUID()}`;
}
