/**
 * ArtubeBridge — хост-обёртка, дающая игре на CasinoGameSDK работать на Artube.
 *
 * Игра как и раньше говорит только с SDK; мост переводит её сообщения в
 * протокол игрового бэкенда и обратно. Per-game адаптера нет: нарезку раунда
 * на сегменты знает бэкенд, он единственный видит математику.
 *
 * Незакрытый раунд (`init.resume`) доезжает до игры ДВУМЯ каналами, оба
 * пассивные — мост никогда не проталкивает раунд игре сам:
 *  - `InitPayload.session` на самом `INIT` — сводка (spinsRemaining и т.п.),
 *    как её строит `sdk.ready()`;
 *  - `GET_STATE` → `STATE_RESPONSE` — полный снимок последнего сегмента,
 *    именно то, что вызывает `sdk.getState()` (см. `createSlotGame`'s
 *    `offerResume()`). Это и есть настоящий канал: `CasinoGameSDK` слушает
 *    `PLAY_RESULT` только внутри промиса конкретного `play()`, поэтому
 *    непрошеный push этого типа туда, где игра его не ждёт, молча теряется.
 * `lastDelivered` — кеш снимка для `GET_STATE`; живёт, пока раунд не
 * закрыт (`creditPending`), и обнуляется в момент расчёта.
 *
 * Реконнект: `ArtubeClient` эмитит `'init'` для каждого инита, пришедшего
 * ПОСЛЕ первого (см. doc-comment client.ts). Если это случилось ДО того, как
 * игра прислала свой первый `GAME_READY`, мост просто запоминает свежий
 * `init` — `onGameReady` подхватит его как обычно. Если же игра уже идёт
 * (мидроунд network blip), мост обновляет свой курсор/`lastDelivered` и
 * шлёт свежий `BALANCE_UPDATE` (его `CasinoGameSDK` слушает постоянно), но
 * НЕ пересылает `INIT` повторно и не толкает `PLAY_RESULT` — только что
 * объяснённые причины ровно те же: игра сама узнает при следующем
 * `getState()`/подтверждении своего текущего сегмента.
 */

import { Bridge } from '@energy8platform/game-sdk';
import type {
  GameReadyPayload,
  GetBalancePayload,
  GetStatePayload,
  PlayRequestPayload,
  PlayResultAckPayload,
  PlayResultPayload,
  PlayErrorPayload,
  InitPayload,
  BalanceUpdatePayload,
  StateResponsePayload,
  GameConfigData,
  SessionData,
} from '@energy8platform/game-sdk/protocol';
import { ArtubeClient, ArtubeBackendError } from './client';
import { parseArtubeUrl } from './detect';
import { DemoWallet } from './demo';
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
  /**
   * Курсор незакрытого раунда — совпадает с `spinsPlayed` последнего
   * выданного сегмента (не "число выданных сегментов" как отдельный
   * счётчик: сервер (`packages/artube-server/src/http/ws.ts`) сверяет
   * `ack.cursor` именно с этим числом).
   */
  private cursor = 0;
  private currentRoundId: string | null = null;
  /** true после того, как игра получила свой первый INIT (см. class doc-comment). */
  private initSent = false;
  /** Снимок незакрытого раунда для `GET_STATE`; `null`, когда раунд расчитан. */
  private lastDelivered: PlayResultPayload | null = null;
  /** Демо-баланс: заведён, только когда `init.demo` — платформа его не считает. */
  private demoWallet: DemoWallet | null = null;

  constructor(private readonly options: ArtubeBridgeOptions = {}) {
    const url = parseArtubeUrl(options.url ?? window.location.href);
    this.gameId = options.gameId ?? 'artube-game';
    this.lang = url.lang;
    this.device = url.device;

    const base = (options.apiBase ?? url.apiBase).replace(/^http/, 'ws');
    this.client = new ArtubeClient(`${base}/api/ws?sessionId=${encodeURIComponent(url.sessionId)}`);
    this.bridge = new Bridge({ devMode: options.devMode ?? true, debug: options.debug });

    this.client.on('balance', (p: { balance: number }) => {
      // Демо-баланс ведёт кошелёк — серверный пуш здесь не источник правды
      // (per-connection заглушка), и его число может не совпадать с тем,
      // что видел игрок.
      if (this.demoWallet) return;
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
        // В демо баланс ведём здесь: платформа его не считает.
        if (init.demo) {
          this.demoWallet = new DemoWallet(this.options.demoBalance ?? init.balance);
          this.balance = this.demoWallet.balance;
        }
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
    this.bridge.on<GetBalancePayload>('GET_BALANCE', (_p, id) => this.onGetBalance(id));
    this.bridge.on<GetStatePayload>('GET_STATE', (_p, id) => this.onGetState(id));
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
      const resumeSnapshot = init.resume ? this.toPlayResult(init.resume) : null;

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
        // В демо `init.balance` — стартовое значение серверной заглушки, не
        // обязательно совпадающее с тем, что видит кошелёк (см. `options.demoBalance`).
        balance: this.demoWallet ? this.demoWallet.balance : init.balance,
        config,
        session: resumeSnapshot?.session ?? null,
        lang: this.lang,
        device: this.device,
      };
      this.bridge.send('INIT', payload, id);
      this.initSent = true;

      // Незакрытый раунд: держим курсор и снимок наготове для GET_STATE —
      // именно так игра о нём узнаёт (см. class doc-comment).
      if (init.resume && resumeSnapshot) {
        this.currentRoundId = init.resume.roundId;
        this.cursor = init.resume.spinsPlayed;
        this.lastDelivered = resumeSnapshot;
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
      if (this.demoWallet) {
        // Ставку списываем на входе в раунд, выигрыш зачисляем на выходе.
        if (this.cursor === 1) this.demoWallet.bet(payload.bet);
        if (!result.creditPending) this.demoWallet.credit(result.totalWinX * result.betAmount);
        this.balance = this.demoWallet.balance;
      }
      const delivered = this.toPlayResult(result);
      // Keep GET_STATE's snapshot in step: nothing to resume once settled.
      this.lastDelivered = delivered.creditPending ? delivered : null;
      this.bridge.send('PLAY_RESULT', delivered, id);
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

  /** Текущий баланс — то же значение, что несёт последний BALANCE_UPDATE/PLAY_RESULT. */
  private onGetBalance(id?: string): void {
    this.bridge.send<BalanceUpdatePayload>('BALANCE_UPDATE', { balance: this.balance }, id);
  }

  /**
   * Настоящий канал, которым игра узнаёт о незакрытом раунде (см. class
   * doc-comment) — `createSlotGame`'s `offerResume()` зовёт это на каждом
   * запуске сцены. `null`, когда расчитывать нечего.
   */
  private onGetState(id?: string): void {
    this.bridge.send<StateResponsePayload>('STATE_RESPONSE', { session: this.lastDelivered }, id);
  }

  /**
   * Инит, пришедший после реконнекта (не первый за жизнь клиента — см.
   * `ArtubeClient` doc-comment). Всегда обновляет наше представление о
   * платформенном состоянии; если игра ещё не получила свой первый INIT,
   * этим и ограничиваемся — `onGameReady` сам подхватит свежий `this.init`.
   * Если же игра уже идёт (мидроунд network blip), недостаточно молчать:
   * доносим свежий баланс (`BALANCE_UPDATE` — единственный push, который
   * `CasinoGameSDK` слушает постоянно) и обновляем курсор/снимок раунда, чтобы
   * следующий `getState()`/ack от игры адресовался правильному состоянию —
   * но НЕ пересылаем `INIT` повторно, которую игра не ждёт после старта.
   *
   * В демо `init.balance` — заново созданная на сервере per-connection
   * заглушка (см. `artube-server`'s `createDemoApi`), обнулённая до
   * стартового значения на каждом новом соединении. Кошелёк реконнект
   * переживает, эта заглушка — нет, поэтому в демо баланс остаётся
   * кошельковым: платформенный `init.balance` сюда не подставляем.
   */
  private onReconnectInit(init: ServerInit): void {
    this.init = init;
    this.balance = this.demoWallet ? this.demoWallet.balance : init.balance;
    if (!this.initSent) return;

    this.bridge.send<BalanceUpdatePayload>('BALANCE_UPDATE', { balance: this.balance });
    if (init.resume) {
      this.currentRoundId = init.resume.roundId;
      this.cursor = init.resume.spinsPlayed;
      this.lastDelivered = this.toPlayResult(init.resume);
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
      // В демо кошелёк — единственный источник правды: серверный
      // `balanceAfter` в демо всегда реален (per-connection заглушка его
      // считает), но не переживает реконнект и не то, что видел игрок.
      balanceAfter: this.demoWallet ? this.demoWallet.balance : (result.balanceAfter ?? this.balance),
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
