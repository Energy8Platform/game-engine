/**
 * ArtubeBridge — хост-обёртка, дающая игре на CasinoGameSDK работать на Artube.
 *
 * Игра как и раньше говорит только с SDK; мост переводит её сообщения в
 * протокол игрового бэкенда и обратно. Per-game адаптера нет: нарезку раунда
 * на сегменты знает бэкенд, он единственный видит математику.
 *
 * Реконнект и `init.resume`: `ArtubeClient` эмитит `'init'` для каждого
 * инита, пришедшего ПОСЛЕ первого (см. doc-comment client.ts). Если это
 * случилось ДО того, как игра прислала свой первый `GAME_READY`, мост просто
 * запоминает свежий `init` — `onGameReady` подхватит его как обычно и, если
 * там есть `resume`, доиграет раунд с места обрыва. Но игрок может словить
 * обрыв связи и посреди уже показанной фичи (мост давно отправил `INIT`,
 * игра ждёт следующий сегмент) — для этого случая мост дополнительно шлёт
 * свежий баланс и незакрытый сегмент как отдельные `BALANCE_UPDATE` /
 * `PLAY_RESULT` без повторной отправки `INIT`, которую игра не ждёт после
 * старта и которая сбросила бы её экран.
 */

import { Bridge } from '@energy8platform/game-sdk';
import type {
  GameReadyPayload,
  PlayRequestPayload,
  PlayResultAckPayload,
  PlayResultPayload,
  PlayErrorPayload,
  InitPayload,
  BalanceUpdatePayload,
  GameConfigData,
  SessionData,
} from '@energy8platform/game-sdk/protocol';
import { ArtubeClient, ArtubeBackendError } from './client';
import { parseArtubeUrl } from './detect';
import type { ArtubeBridgeOptions, ServerInit, ServerResult } from './types';

/**
 * Индекс ставки в `allowed_bets`. Игра выбирает ставку суммой, наружу
 * уходит только индекс — сумму считает платформа.
 */
export function betIndexOf(betLevels: number[], bet: number): number {
  const exact = betLevels.indexOf(bet);
  if (exact >= 0) return exact;
  let best = 0;
  for (let i = 1; i < betLevels.length; i++) {
    if (Math.abs(betLevels[i] - bet) < Math.abs(betLevels[best] - bet)) best = i;
  }
  return best;
}

export class ArtubeBridge {
  private readonly bridge: Bridge;
  private readonly client: ArtubeClient;
  private readonly gameId: string;
  private readonly lang: string;
  private readonly device: 'desktop' | 'mobile';
  private readonly bootPromise: Promise<ServerInit>;

  private init: ServerInit | null = null;
  private balance = 0;
  /** Сколько сегментов текущего раунда уже показано игроку. */
  private cursor = 0;
  private currentRoundId: string | null = null;
  /** true после того, как игра получила свой первый INIT (см. class doc-comment). */
  private initSent = false;

  constructor(private readonly options: ArtubeBridgeOptions = {}) {
    const url = parseArtubeUrl(options.url ?? window.location.href);
    this.gameId = options.gameId ?? 'artube-game';
    this.lang = url.lang;
    this.device = url.device;

    const base = (options.apiBase ?? url.apiBase).replace(/^http/, 'ws');
    this.client = new ArtubeClient(`${base}/api/ws?sessionId=${encodeURIComponent(url.sessionId)}`);
    this.bridge = new Bridge({ devMode: options.devMode ?? true, debug: options.debug });

    this.client.on('balance', (p: { balance: number }) => {
      this.balance = p.balance;
      this.bridge.send<BalanceUpdatePayload>('BALANCE_UPDATE', { balance: p.balance });
    });
    this.client.on('sessionClosed', (p: { reason: string }) => {
      this.bridge.send('ERROR', { code: 'SessionClosed', message: p.reason });
    });
    // A reconnect's init — see class doc-comment for the two cases this covers.
    this.client.on('init', (init: ServerInit) => this.onReconnectInit(init));

    this.bootPromise = this.client.connect().then(
      (init) => {
        this.init = init;
        this.balance = init.balance;
        return init;
      },
      (err) => {
        // A connect() that never resolves an init (bad/expired sessionId is
        // the common case) must not be left retrying in the background
        // against a URL that will never work — stop it here.
        this.client.close();
        throw err;
      },
    );

    this.bridge.on<GameReadyPayload>('GAME_READY', (_p, id) => void this.onGameReady(id));
    this.bridge.on<PlayRequestPayload>('PLAY_REQUEST', (p, id) => void this.onPlay(p, id));
    this.bridge.on<PlayResultAckPayload>('PLAY_RESULT_ACK', (p) => this.onAck(p));
  }

  /** Резолвится, когда бэкенд отдал init. */
  async ready(): Promise<void> {
    await this.bootPromise;
  }

  destroy(): void {
    this.client.close();
    this.bridge.destroy();
  }

  private async onGameReady(id?: string): Promise<void> {
    try {
      await this.bootPromise;
      // Read the live `this.init`, not the promise's closed-over value: a
      // reconnect can have refreshed it (with a newer `resume`) while
      // GAME_READY was still in flight (e.g. during asset loading).
      const init = this.init!;
      const config: GameConfigData = {
        id: this.gameId,
        type: 'slot',
        betLevels: init.config.betLevels,
        demo: init.demo,
        // Платформенные данные, которые игра показывает на экране правил.
        artube: {
          defaultBetIndex: init.config.defaultBetIndex,
          autoSpinCounts: init.config.autoSpinCounts,
          locales: init.config.locales,
          rtp: init.config.rtp,
          platformMaxWin: init.config.platformMaxWin,
          frc: init.frc,
          gamificationToken: init.gamificationToken,
        },
      };
      const payload: InitPayload = {
        currency: init.currency ?? 'FUN',
        balance: init.balance,
        config,
        session: null,
        lang: this.lang,
        device: this.device,
      };
      this.bridge.send('INIT', payload, id);
      this.initSent = true;

      // Незакрытый раунд: показываем сегмент, на котором игрок остановился.
      if (init.resume) {
        this.currentRoundId = init.resume.roundId;
        this.cursor = init.resume.spinsPlayed - 1;
        this.bridge.send('PLAY_RESULT', this.toPlayResult(init.resume));
      }
    } catch (err) {
      this.bridge.send('ERROR', { code: this.codeOf(err), message: String(err) }, id);
    }
  }

  private async onPlay(payload: PlayRequestPayload, id?: string): Promise<void> {
    try {
      const levels = this.init?.config.betLevels ?? [];
      const result = await this.client.play({
        action: payload.action,
        betIndex: betIndexOf(levels, payload.bet),
        params: payload.params,
      });
      if (result.roundId !== this.currentRoundId) {
        this.currentRoundId = result.roundId;
        this.cursor = 0;
      }
      this.cursor += 1;
      if (result.balanceAfter !== null) this.balance = result.balanceAfter;
      this.bridge.send('PLAY_RESULT', this.toPlayResult(result), id);
    } catch (err) {
      this.bridge.send<PlayErrorPayload>(
        'PLAY_ERROR',
        { code: this.codeOf(err), message: err instanceof Error ? err.message : String(err) },
        id,
      );
    }
  }

  /** Игрок досмотрел сегмент — бэкенд двигает курсор в состоянии платформы. */
  private onAck(payload: PlayResultAckPayload): void {
    if (payload.roundId === this.currentRoundId) this.client.ack(payload.roundId, this.cursor);
  }

  /**
   * Инит, пришедший после реконнекта (не первый за жизнь клиента — см.
   * `ArtubeClient` doc-comment). Всегда обновляет наше представление о
   * платформенном состоянии; если игра ещё не получила свой первый INIT,
   * этим и ограничиваемся — `onGameReady` сам подхватит свежий `this.init`.
   * Если же игра уже идёт (мидроунд network blip), недостаточно молчать:
   * доносим свежий баланс и незакрытый сегмент явно, отдельными
   * сообщениями, не пересылая INIT повторно.
   */
  private onReconnectInit(init: ServerInit): void {
    this.init = init;
    this.balance = init.balance;
    if (!this.initSent) return;

    this.bridge.send<BalanceUpdatePayload>('BALANCE_UPDATE', { balance: this.balance });
    if (init.resume) {
      this.currentRoundId = init.resume.roundId;
      this.cursor = init.resume.spinsPlayed - 1;
      this.bridge.send('PLAY_RESULT', this.toPlayResult(init.resume));
    }
  }

  private toPlayResult(result: ServerResult): PlayResultPayload {
    const session: SessionData = {
      spinsRemaining: result.spinsRemaining,
      spinsPlayed: result.spinsPlayed,
      // Суммы для показа = множитель × ставка. Деньги при этом всегда
      // приходят от платформы в balanceAfter.
      totalWin: result.totalWinX * result.betAmount,
      completed: !result.creditPending,
      maxWinReached: result.maxWinReached,
      betAmount: result.betAmount,
    };
    return {
      roundId: result.roundId,
      action: result.action,
      balanceAfter: result.balanceAfter ?? this.balance,
      totalWin: result.totalWinX * result.betAmount,
      currency: this.init?.currency ?? 'FUN',
      gameId: this.gameId,
      data: result.data,
      nextActions: result.nextActions,
      session,
      creditPending: result.creditPending,
    };
  }

  private codeOf(err: unknown): string {
    return err instanceof ArtubeBackendError ? err.code : 'InternalServerError';
  }
}
