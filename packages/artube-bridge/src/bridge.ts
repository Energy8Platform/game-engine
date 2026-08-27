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
 * Кампания фри-раундов доезжает до игры НЕ через SDK, а прямыми методами моста
 * (`campaign`, `onCampaignChange`, `activateCampaign`, `declineCampaign`).
 * Причина та же, по которой их нет в `CasinoGameSDK`: анонсера в его протоколе
 * не существует, а придумывать под это своё сообщение значило бы обязать
 * понимать его и все остальные хосты. Игра получает мост из
 * `createSlotGame(...)`'s handle (`artubeBridge`), рисует анонсер и счётчик
 * сама и сама же ставит ставку кампании — своих пикселей у моста нет.
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
 *
 * Связь: мост объявляет игре `CONNECTION_STATE` — `lost`, когда сокет упал, и
 * `restored`, когда реконнект принёс новый `init`. Пара нужна затем, что без
 * неё единственным следом обрыва был отбитый `play`, и игра принимала сетевой
 * всплеск за ошибку раунда — показывала экран «перезагрузите страницу» там,
 * где связь возвращалась сама. `restored` шлётся ПОСЛЕ обновления курсора и
 * снимка раунда: игра на нём идёт за `getState()`, и он обязан ответить
 * состоянием нового соединения, а не остатками оборванного. Исчерпанный
 * реконнект (`gone`) — уже не «сейчас вернёмся»: он едет кодом
 * `ConnectionGone`, чтобы игра сказала игроку правду, а не оставила его с
 * вечным «Переподключаемся…».
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
  ConnectionStatePayload,
} from '@energy8platform/game-sdk/protocol';
import { ArtubeClient, ArtubeBackendError } from './client';
import { parseArtubeUrl } from './detect';
import { DemoWallet } from './demo';
import type { ArtubeBridgeOptions, ServerFrc, ServerInit, ServerResult } from './types';

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

/**
 * Код валюты в контракте SDK — это ISO 4217, ВЕРХНИМ регистром: по нему игра
 * (и `lookupCurrency` из stake-bridge) ищет символ. GamesAPI отдаёт его
 * строчными (`"usd"`), и без нормализации поиск промахивался, а шелл писал
 * игроку «1 000 000.00 usd» вместо «$1 000 000.00» — на КАЖДОЙ реальной
 * сессии Artube. Нормализуем ровно здесь, на границе провода: дальше по
 * коду валюта уже канонична.
 *
 * `null` — демо-сессия (у GamesAPI это и есть её признак); показываем 'FUN'.
 */
function currencyCodeOf(currency: string | null | undefined): string {
  return currency ? currency.toUpperCase() : 'FUN';
}

/**
 * Причины `BalanceChangedEvent`, описывающие движение денег ВНУТРИ раунда
 * (`balance-changed.md`). Игре их не пересылаем: ровно эти же деньги нам
 * авторитетно называет ответ раунда — см. {@link ArtubeBridge.onBalanceChanged}.
 */
const ROUND_CAUSED_REASONS: ReadonlySet<string> = new Set(['round_bet', 'round_win']);

/**
 * Причины, ради которых событие вообще существует: деньги, пришедшие ВНЕ
 * раунда. Ни один ответ раунда о них не расскажет — только этот push.
 */
const OUT_OF_BAND_REASONS: ReadonlySet<string> = new Set(['bonus', 'correction']);

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
  /** Кампания фри-раундов, как её сейчас видит бэкенд; `null` — её нет. */
  private frc: ServerFrc | null = null;
  private readonly frcListeners = new Set<(frc: ServerFrc | null) => void>();
  /** Незнакомые причины `BalanceChangedEvent`, о которых уже написали в консоль. */
  private readonly warnedBalanceReasons = new Set<string>();
  /** Объявлен ли игре обрыв. Держит пару lost/restored ровной: без него каждая
   *  провалившаяся попытка реконнекта слала бы игре ещё один `lost`, а
   *  `restored` мог бы приехать без предшествующего `lost` вовсе. */
  private linkLost = false;

  constructor(private readonly options: ArtubeBridgeOptions = {}) {
    const url = parseArtubeUrl(options.url ?? window.location.href);
    this.gameId = options.gameId ?? 'artube-game';
    this.lang = url.lang;
    this.device = url.device;

    const base = (options.apiBase ?? url.apiBase).replace(/^http/, 'ws');
    this.client = new ArtubeClient(`${base}/api/ws?sessionId=${encodeURIComponent(url.sessionId)}`);
    this.bridge = new Bridge({ devMode: options.devMode ?? true, debug: options.debug });

    this.client.on('balance', (p: { balance: number; reason?: string }) =>
      this.onBalanceChanged(p),
    );
    this.client.on('sessionClosed', (p: { reason: string }) => {
      this.bridge.send('ERROR', { code: 'SessionClosed', message: p.reason });
    });
    this.client.on('connection', (p: { connected: boolean; gone?: boolean }) =>
      this.onConnectionChange(p),
    );
    // A reconnect's init — see class doc-comment for the two cases this covers.
    this.client.on('init', (init: ServerInit) => this.onReconnectInit(init));
    // Кампания изменилась сама — сейчас это ровно один случай: её отыграли до
    // конца, и бэкенд прислал итог вслед за последним результатом.
    this.client.on('frc', (frc: ServerFrc) => this.setCampaign(frc));

    this.bootPromise = this.client.connect().then(
      (init) => {
        this.init = init;
        this.balance = init.balance;
        this.frc = init.frc;
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
    this.frcListeners.clear();
  }

  /**
   * Кампания фри-раундов, как её сейчас видит бэкенд; `null` — её нет.
   *
   * Всё, что нужно анонсеру и счётчику: `status`, `roundsLeft`/`roundsTotal`,
   * `totalWin`, ставка (`bet` и её `betIndex` в `betLevels`) и окно
   * `validFrom`/`validTo`. Рисует это ИГРА — у моста своих пикселей нет.
   *
   * Читать после `ready()`. Значение обновляется на активации, отказе, каждом
   * фри-раунде, завершении кампании и реконнекте.
   */
  get campaign(): ServerFrc | null {
    return this.frc;
  }

  /**
   * Подписка на изменения кампании. Возвращает функцию отписки.
   *
   * Зовётся на активации/отказе, на каждом обновлении счётчиков, на
   * завершении (`status: 'completed'` — момент показать итог и вернуть ставку
   * игрока) и на реконнекте, где кампания снова приезжает `offered`.
   */
  onCampaignChange(cb: (frc: ServerFrc | null) => void): () => void {
    this.frcListeners.add(cb);
    return () => this.frcListeners.delete(cb);
  }

  /**
   * Игрок нажал Start в анонсере: с этого момента спины бесплатны и идут на
   * ставке кампании. Игра обязана ПОСТАВИТЬ эту ставку (`campaign.bet`) и
   * заблокировать её выбор — спин с другой ставкой бэкенд отвергнет
   * (`FrcBetMismatch`), а не подгонит молча.
   *
   * `campaignId` по умолчанию — текущая кампания; передавать его отдельно есть
   * смысл только если игра хранит идентификатор у себя.
   */
  async activateCampaign(campaignId?: string): Promise<ServerFrc> {
    const id = campaignId ?? this.frc?.campaignId;
    if (!id) throw new ArtubeBackendError('FrcNotFound', 'no free round campaign on this session');
    return this.setCampaign(await this.client.activateCampaign(id));
  }

  /**
   * Игрок выбрал обычную игру. До реконнекта кампанию активировать уже нельзя,
   * поэтому это ответ игрока, а не закрытие окна: анонсер, который можно
   * открыть снова, звать это на закрытие не должен.
   */
  async declineCampaign(campaignId?: string): Promise<ServerFrc> {
    const id = campaignId ?? this.frc?.campaignId;
    if (!id) throw new ArtubeBackendError('FrcNotFound', 'no free round campaign on this session');
    return this.setCampaign(await this.client.declineCampaign(id));
  }

  private setCampaign(frc: ServerFrc | null): ServerFrc {
    this.frc = frc;
    for (const cb of this.frcListeners) cb(frc);
    return frc as ServerFrc;
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
          // Точность валюты: сколько знаков игра округляет и показывает. Без неё
          // игра хардкодит два знака и врёт на всём, что не сотые.
          currencyMinimalUnit: init.config.currencyMinimalUnit,
          autoSpinCounts: init.config.autoSpinCounts,
          locales: init.config.locales,
          rtp: init.config.rtp,
          platformMaxWin: init.config.platformMaxWin,
          frc: init.frc,
          gamificationToken: init.gamificationToken,
        },
      };
      const payload: InitPayload = {
        currency: currencyCodeOf(init.currency),
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
      this.emitPreCreditBalance(result);
      this.bridge.send('PLAY_RESULT', delivered, id);
      // Счётчик кампании платформа обновляет в ответе на КАЖДЫЙ фри-раунд —
      // складываем его в снимок ПОСЛЕ отправки результата, чтобы игра
      // перерисовала «осталось N» вслед за сегментом, а не поперёк него.
      // Статус остаётся нашим: завершение объявляет отдельный кадр `frc`.
      if (result.frc && this.frc) {
        this.setCampaign({
          ...this.frc,
          roundsLeft: result.frc.rounds_left,
          totalWin: result.frc.total_win,
        });
      }
    } catch (err) {
      this.bridge.send<PlayErrorPayload>(
        'PLAY_ERROR',
        { code: this.codeOf(err), message: err instanceof Error ? err.message : String(err) },
        id,
      );
    }
  }

  /**
   * Баланс ПОСЛЕ ставки, но ДО зачисления выигрыша — отдельным кадром, перед
   * результатом.
   *
   * Нужен потому, что при простом раунде платформа возвращает одно число, в
   * котором ставка и выигрыш уже свёрнуты: при балансе 10 и ставке 1 выигрышный
   * на 0.22 спин даёт сразу 9.22. Хост различает списание и зачисление по
   * направлению движения (`host/balanceGate.ts`), и такое суммарное движение
   * вниз читает как ставку — то есть красит немедленно, вместе с выигрышем,
   * ещё до анимации. Игрок видит итог раньше, чем узнаёт, за что.
   *
   * Разворачиваем свёртку сами: `balanceAfter - выигрыш` — это баланс после
   * списания. Он уходит первым и красится сразу (движение вниз), а
   * `balanceAfter` из `PLAY_RESULT` оказывается движением ВВЕРХ и потому ждёт
   * конца анимации. Ровно то поведение, которое ворота и описывают.
   *
   * Сегмент с `creditPending` не трогаем: там выигрыш ещё не зачислен, вычитать
   * из баланса нечего. Внутренние сегменты раунда баланса не несут вовсе.
   */
  private emitPreCreditBalance(result: ServerResult): void {
    if (result.creditPending || this.balance === null) return;
    const win = result.totalWinX * result.betAmount;
    if (win <= 0) return;
    const unit = this.init?.config.currencyMinimalUnit;
    // Округляем к минимальной единице валюты: 9.22 - 0.22 в double даёт хвост,
    // а это число едет прямо в читалку баланса.
    const step = typeof unit === 'number' && unit > 0 ? unit : 0.01;
    const before = Math.round((this.balance - win) / step) * step;
    this.bridge.send<BalanceUpdatePayload>('BALANCE_UPDATE', { balance: before });
  }

  /** Игрок досмотрел сегмент — бэкенд двигает курсор в состоянии платформы. */
  private onAck(payload: PlayResultAckPayload): void {
    if (payload.roundId === this.currentRoundId) this.client.ack(payload.roundId, this.cursor);
  }

  /**
   * `BalanceChangedEvent` платформы. Событие несёт только `{session_id,
   * balance, reason}` — ни последовательности, ни времени, ни раунда, — так
   * что сказать, свежее ли его число того, что мы уже применили, нельзя в
   * принципе. Зато по `reason` можно сказать другое: нужно ли оно нам вообще.
   *
   * `round_bet`/`round_win` объявляют движение денег ВНУТРИ раунда, а его нам
   * авторитетно называет ответ раунда, и дырок в этом пути нет:
   *  - простой раунд — `PlayRound` возвращает баланс после ставки И выигрыша;
   *  - сложный — `OpenRound` возвращает баланс после списания ставки
   *    `CloseRound` — после зачисления выигрыша;
   *  - промежуточные сегменты (`UpdateRoundState`) баланса не возвращают
   *    ровно потому, что денег не двигают: у их ответа поля баланса нет;
   *  - раунд, доигранный на восстановлении, закрывается тем же `CloseRound`.
   * То есть каждое изменение баланса внутри раунда доезжает до игры в
   * `PLAY_RESULT.balanceAfter` — и доезжает тогда, когда игра готова его
   * показать. Событие же приходит по расписанию платформы, обычно посреди
   * анимации выигрыша: это и есть та «кривизна» обновления баланса, ради
   * которой всё написано. Пересылать его — значит показывать игроку одно и
   * то же движение денег дважды, второй раз не вовремя.
   *
   * (Единственное движение внутри раунда, которое не возвращается ответом
   * раунда, — платформенное автозакрытие: там раунд закрывает СЕРВЕР по
   * `AutocloseRequestEvent`. Но оно по построению случается тогда, когда
   * соединения игрока уже нет (см. `artube-server`'s `http/autoclose.ts`), а
   * вернувшегося игрока встречает свежий `init` — {@link onReconnectInit}
   * ставит его `init.balance` и шлёт `BALANCE_UPDATE`. Сверка на этот случай
   * уже есть, и она остаётся.)
   *
   * `bonus`/`correction` — наоборот, единственный канал: их не несёт никакой
   * ответ раунда. Их пересылаем сразу, ради них событие и существует.
   *
   * Незнакомую причину тоже пересылаем: не показать реальное изменение
   * баланса хуже, чем показать его в неудачный момент, а молча съесть
   * незнакомую причину — это ровно «не показать». В консоль о ней пишем: это
   * значит, что провод разошёлся с докой.
   *
   * Подавленное событие НЕ трогает и `this.balance`. Применить его «только
   * внутрь», чтобы `GET_BALANCE` не отвечал устаревшим, — соблазн, но это
   * вернуло бы ту же гонку с другой стороны: ставку и выигрыш платформа
   * объявляет ДВУМЯ событиями, и опоздавший `round_bet` записал бы баланс ДО
   * выигрыша поверх уже посчитанного. Внутри раунда источник правды — ответ
   * раунда, он же держит `this.balance` свежим (см. {@link onPlay}), и
   * устаревшим этот кеш от подавления не становится.
   *
   * Демо разбираем первым: там баланс ведёт кошелёк, а серверный пуш
   * (per-connection заглушка) не источник правды вовсе — его число может не
   * совпадать с тем, что видел игрок, при любой причине.
   */
  private onBalanceChanged(p: { balance: number; reason?: string }): void {
    if (this.demoWallet) return;
    // Причину нормализуем здесь же, на границе провода, как и код валюты:
    // `Round_Win` — та же самая причина, а принять её за незнакомую значит
    // вернуть дёргающийся баланс.
    const reason = (p.reason ?? '').trim().toLowerCase();
    if (ROUND_CAUSED_REASONS.has(reason)) return;
    if (!OUT_OF_BAND_REASONS.has(reason)) this.warnUnknownBalanceReason(p.reason);
    this.balance = p.balance;
    this.bridge.send<BalanceUpdatePayload>('BALANCE_UPDATE', { balance: p.balance });
  }

  /**
   * По разу на причину: если платформа переименует `round_win`, предупреждение
   * иначе печаталось бы на каждый спин и утонуло бы в собственном шуме.
   */
  private warnUnknownBalanceReason(reason: string | undefined): void {
    const key = reason ?? '';
    if (this.warnedBalanceReasons.has(key)) return;
    this.warnedBalanceReasons.add(key);
    console.warn(
      `[artube-bridge] unknown BalanceChangedEvent reason ${JSON.stringify(reason)} — ` +
        'forwarding it to the game as an out-of-band balance change',
    );
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
  /**
   * Клиент сообщил о смене состояния сокета.
   *
   * `connected: true` здесь НЕ становится `restored`: открытый сокет ещё не
   * значит восстановленное состояние — платформенный `init` с курсором и
   * снимком раунда приходит следом, и объявлять возврат до него значит
   * позвать игру за `getState()` раньше, чем ему есть что ответить. Возврат
   * объявляет {@link onReconnectInit}.
   */
  private onConnectionChange(p: { connected: boolean; gone?: boolean }): void {
    if (p.connected) return;
    if (p.gone) {
      this.sendConnectionState({
        status: 'lost',
        code: 'ConnectionGone',
        message: 'the connection to the game backend could not be restored',
      });
      return;
    }
    if (this.linkLost) return; // уже объявлено — попытки реконнекта не спамим
    this.linkLost = true;
    this.sendConnectionState({
      status: 'lost',
      code: 'ConnectionLost',
      message: 'lost the connection to the game backend',
    });
  }

  /**
   * До первого `INIT` игра ещё не на экране — там своя история загрузки, и
   * кадр о связи ей не адресован (провал самого старта едет отдельным путём,
   * см. `bootPromise`).
   */
  private sendConnectionState(state: ConnectionStatePayload): void {
    if (!this.initSent) return;
    this.bridge.send<ConnectionStatePayload>('CONNECTION_STATE', state);
  }

  private onReconnectInit(init: ServerInit): void {
    this.init = init;
    this.balance = this.demoWallet ? this.demoWallet.balance : init.balance;
    // Кампания на новом соединении приезжает `offered` заново, даже если игрок
    // только что её отыгрывал: дока требует, чтобы после переподключения он
    // снова мог активировать её либо отказаться. Игра узнаёт об этом здесь —
    // это и есть та «критическая фаза» реконнекта посреди активной кампании, и
    // молчание оставило бы её с заблокированной ставкой без самой кампании.
    this.setCampaign(init.frc);
    const wasLost = this.linkLost;
    this.linkLost = false;
    if (!this.initSent) return;

    this.bridge.send<BalanceUpdatePayload>('BALANCE_UPDATE', { balance: this.balance });
    if (init.resume) {
      this.currentRoundId = init.resume.roundId;
      this.cursor = init.resume.spinsPlayed;
      this.lastDelivered = this.toPlayResult(init.resume);
    } else {
      // Незакрытого раунда у платформы нет — значит его нет и у нас. Свежий
      // init без `resume` приходит в том числе вслед за `RoundAlreadySettled`
      // (раунд досчитали где-то ещё), и оставленный снимок заставил бы
      // `getState()` предложить игре доигрывать уже закрытый раунд.
      this.currentRoundId = null;
      this.cursor = 0;
      this.lastDelivered = null;
    }
    // Последним действием — курсор и снимок раунда выше уже свежие, и
    // `getState()`, за которым игра пойдёт на этом кадре, ответит правдой.
    if (wasLost) this.sendConnectionState({ status: 'restored' });
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
      currency: currencyCodeOf(this.init?.currency),
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
