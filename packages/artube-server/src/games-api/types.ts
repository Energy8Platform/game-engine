/** Типы контрактов Artube Games API. Имена полей — snake_case, как на проводе. */

export interface PlayerConnectionInfo {
  ip_address?: string;
  user_agent?: string;
  player_connection_id?: string;
}

export interface Feature {
  type: string;
  description?: string;
}

export interface SessionInfoRequest {
  session_id: string;
  player_connection_info: PlayerConnectionInfo;
}

export interface LastRound {
  round_id: string;
  price_multiplier: number;
  bet_index: number;
  win_multiplier: number;
  win: number;
  free_round_campaign_id?: string | null;
  started_at: string;
  finished_at?: string | null;
  round_version: number;
  round_state_version: string;
  round_state: string;
  is_platform_max_win_reached: boolean;
  chain_id?: string | null;
}

export interface PlatformMaxWin {
  is_visible: boolean;
  base_currency: string;
  base_currency_value: number;
  player_currency_value: number;
}

export interface GameSettings {
  default_bet_index: number;
  currency_minimal_unit: number;
  allowed_bets: number[];
  available_auto_spin_counts: number[];
  rtp_options: Array<{ is_visible: boolean; rtp: number; game_mode: string; volatility?: string }>;
  rtp_settings: { is_visible: boolean; shown_rtp?: number };
  locales: string[];
  platform_max_win?: PlatformMaxWin | null;
}

export interface FreeRoundCampaign {
  campaign_id: string;
  rounds_total: number;
  rounds_left: number;
  valid_from: string;
  valid_to: string;
  bet: number;
  total_win: number;
  is_complete: boolean;
}

export interface SessionInfoResponse {
  security_hash: string;
  /**
   * `null` означает демо-сессию — раундовые RPC для неё запрещены.
   *
   * Необязательное, вопреки доке. `session-info.md` объявляет поле
   * обязательной строкой, `demo-mode.md` — `null` для демо, а живая платформа
   * прислала ответ, в котором ключа `currency` нет вовсе. Типы здесь описывают
   * ПРОВОД, а не обещание: рантайм-валидации у нас нет, и `string | null`
   * означало лишь, что TypeScript уверял в невозможности случая, который уже
   * произошёл.
   *
   * Отсутствие ключа демо НЕ означает: так же выглядит реальная сессия, у
   * которой валюта совпала с дефолтом сериализатора. Читать только через
   * `classifyCurrency` (`session/init.ts`) — там же разобрано, почему.
   */
  currency?: string | null;
  balance: number;
  gamification_token?: string;
  last_round?: LastRound | null;
  game_settings: GameSettings;
  free_round_campaign?: FreeRoundCampaign | null;
  history?: Array<{ win: number; possible_win: number; is_own: boolean }>;
}

export interface PlayRoundRequest {
  session_id: string;
  price_multiplier: number;
  bet_index: number;
  win_multiplier: number;
  free_round_campaign_id?: string;
  features?: Feature[];
  previous_round_id?: string;
  round_state_version: string;
  round_state: string;
}

export interface CampaignProgress {
  rounds_left: number;
  total_win: number;
  is_complete: boolean;
}

export interface PlayRoundResponse {
  round_id: string;
  balance: number;
  win: number;
  free_round_campaign?: CampaignProgress | null;
  is_platform_max_win_reached: boolean;
}

export interface OpenRoundRequest {
  session_id: string;
  price_multiplier: number;
  bet_index: number;
  free_round_campaign_id?: string;
  features?: Feature[];
  round_state_version: string;
  round_state: string;
}

export interface OpenRoundResponse {
  round_version: number;
  round_id: string;
  balance: number;
}

export interface UpdateRoundStateRequest {
  session_id: string;
  round_id: string;
  round_version: number;
  round_state_version: string;
  round_state: string;
}

export interface UpdateRoundStateResponse {
  round_version: number;
}

export interface CloseRoundRequest {
  session_id: string;
  round_id: string;
  win_multiplier: number;
  status: 'completed' | 'cancelled';
  features?: Feature[];
  round_version: number;
  round_state_version: string;
  round_state: string;
}

/**
 * Ответ на CloseRound — и на AutocloseRound (дока: тип ответа тот же).
 *
 * `win` и `is_platform_max_win_reached` объявлены обязательными
 * (`close-round.md`) ровно так же, как у `PlayRoundResponse`, и значат ровно то
 * же самое. Не моделировать их означало, что максвин, сорванный в КОНЦЕ
 * фри-спинов — единственное место, где слот его реально срывает, — не мог
 * доехать до игрока никогда: сложный раунд заканчивается здесь, а не в
 * PlayRound.
 */
export interface CloseRoundResponse {
  balance: number;
  /** Сумма выигрыша, посчитанная платформой, — уже усечённая максвином. */
  win: number;
  free_round_campaign?: CampaignProgress | null;
  is_platform_max_win_reached: boolean;
}

/** Тело то же, что у CloseRound; ответ — только баланс. */
export type AutocloseRoundRequest = CloseRoundRequest;

export interface BalanceChangedEvent {
  session_id: string;
  balance: number;
  reason: string;
}

export interface SessionClosedEvent {
  session_id: string;
  reason?: string;
}

export interface NewConnectionEvent {
  session_id: string;
  new_connection_id: string;
}

export interface AutocloseRequestEvent {
  session_id: string;
  round_id: string;
}

/**
 * Тело `Error`. Дока противоречит сама себе: `error-responses.md`,
 * `error-handling.md` и `api-overview.md` называют поля `code`/`message`/
 * `details`, а `envelope.md` — `error_code`/`error_message`/`error_details`.
 * Наблюдённого `Error` с провода нет ни одного, а провод уже однажды доказал,
 * что своей спеке не следует (`currency`), поэтому описываем ОБЕ формы.
 */
export interface ErrorPayload {
  code?: string;
  message?: string;
  details?: { retry_after_ms?: number; [key: string]: unknown };
  error_code?: string;
  error_message?: string;
  error_details?: { retry_after_ms?: number; [key: string]: unknown };
}
