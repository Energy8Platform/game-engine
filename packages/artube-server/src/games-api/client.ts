/**
 * Клиент Artube Games API.
 *
 * Один инстанс = один WebSocket-коннект, мультиплексирующий все сессии пода:
 * `op_seq` монотонен в рамках коннекта, ответы парятся по `corr_id`.
 *
 * Коннект не рвём по своей инициативе. `GoAway` — конец ЭТОГО коннекта, а не
 * конец жизни клиента: дока (`control-requests/goaway.md`) требует «корректно
 * завершить текущие операции и дождаться закрытия соединения со стороны
 * сервера, после чего инициировать переподключение согласно значению
 * `retry_after_ms`». Терминальных причин дока не называет ни одной, а
 * `retry_after_ms` — обязательное поле: сообщение, которое диктует, когда
 * вернуться, не может значить «не возвращайся».
 *
 * По той же причине не заканчивается и переподключение после обычного обрыва:
 * ограничена растущая пауза (`MAX_BACKOFF_DELAY_MS`), а не число попыток.
 * «Перестать искать платформу, но продолжать работать» — не исход, а немота с
 * зелёным `/livez`.
 */

import { WebSocket } from 'ws';
import {
  buildEnvelope,
  parseEnvelope,
  OpSeq,
  type Channel,
  type Envelope,
} from './envelope.js';
import { GamesApiError, IDEMPOTENT_TYPES, isRetryable, readErrorPayload } from './errors.js';
import type {
  SessionInfoRequest, SessionInfoResponse,
  PlayRoundRequest, PlayRoundResponse,
  OpenRoundRequest, OpenRoundResponse,
  UpdateRoundStateRequest, UpdateRoundStateResponse,
  CloseRoundRequest, CloseRoundResponse,
  AutocloseRoundRequest,
  ErrorPayload,
} from './types.js';

/**
 * Все типы, которые Games API может прислать на этом коннекте. Дока
 * предупреждает: неанонсированный контракт исключается из согласованного
 * набора и просто не доставляется — поэтому список включает не только
 * Request-типы, но и Response, `Error` и события.
 */
export const ANNOUNCED_CONTRACTS: string[] = [
  'SessionInfoRequest', 'SessionInfoResponse',
  'PlayRoundRequest', 'PlayRoundResponse',
  'OpenRoundRequest', 'OpenRoundResponse',
  'UpdateRoundStateRequest', 'UpdateRoundStateResponse',
  'CloseRoundRequest', 'CloseRoundResponse',
  'AutocloseRoundRequest',
  'Error',
  'SessionClosedEvent', 'BalanceChangedEvent',
  'NewConnectionEvent', 'AutocloseRequestEvent',
];

export interface GamesApiClientOptions {
  url: string;
  apiKey: string;
  gameId: string;
  /** Сколько ждём Welcome, прежде чем считать коннект готовым. Дока: 5 секунд. */
  helloTimeoutMs?: number;
  rpcTimeoutMs?: number;
  /**
   * Предел числа попыток переподключения. По умолчанию — БЕЗ предела.
   *
   * Для игрового бэкенда нет состояния, в котором «перестать искать платформу,
   * но продолжать работать» — правильный исход: под остаётся жив, отвечает
   * `/healthz` 503 и не делает ничего полезного, но выглядит здоровым. Ровно в
   * эту немоту упирался живой под по другому маршруту (`GoAway` как
   * терминальный), и конечный бюджет попыток — второй путь туда же: пять
   * попыток по `1000 * 2 ** n` — это 31 секунда, а сама платформа в `GoAway`
   * называет окна в 300 000 и 1 800 000 мс.
   *
   * Опция оставлена как ЯВНОЕ согласие звать конечное число раз — тестам и
   * встраивающим, которым нужен предсказуемый конец. Исчерпание конечного
   * бюджета не оставляет клиент в подвешенном состоянии: он останавливается
   * как от `close()` (`stopped`, `connected === false`) и сообщает об этом
   * событием `reconnectAbandoned`, чтобы «сдался» было отличимо от «ещё ищет».
   */
  maxReconnectAttempts?: number;
  baseReconnectDelayMs?: number;
  /**
   * Нижняя граница паузы перед переподключением по `GoAway`. Единственная
   * защита от платформы, которая просит вернуться немедленно (или присылает
   * мусор вместо `retry_after_ms`) и получает горячий цикл коннектов.
   */
  minReconnectDelayMs?: number;
  /**
   * Сколько ждём обещанного докой закрытия со стороны сервера после `GoAway`,
   * прежде чем закрыть сокет самим.
   *
   * Дока прямо запрещает обрывать соединение по своей инициативе, и обычный
   * путь этой границы не касается — сервер закрывает сам, обычно в те же
   * миллисекунды. Но «ждать закрытия» без всякого предела — это ровно та
   * немота, от которой лечит переподключение: коннект, на котором нам уже
   * сказали `GoAway`, новых вызовов не принимает, а `close` может не прийти
   * никогда.
   */
  goAwayCloseGraceMs?: number;
  debug?: boolean;
}

/** Payload `GoAway`: `reason` и `retry_after_ms`, оба объявлены обязательными. */
export interface GoAwayPayload {
  reason?: unknown;
  retry_after_ms?: unknown;
}

/**
 * Потолок паузы перед переподключением — самая большая задержка, которую
 * называет сама дока (техобслуживание: `retry_after_ms: 1800000`). Всё, что
 * больше, — не расписание платформы, а мусор, из-за которого под замолчал бы
 * на неопределённый срок.
 */
export const MAX_RECONNECT_DELAY_MS = 1_800_000;

/**
 * Потолок СОБСТВЕННОГО бэкоффа — паузы, которую клиент назначает себе сам,
 * когда платформа недоступна и никакого расписания нам не давала.
 *
 * Не путать с `MAX_RECONNECT_DELAY_MS`: тот ограничивает то, что попросила
 * платформа в `GoAway`, и должен вмещать её самое длинное окно (30 минут).
 * Здесь наоборот — нас никто не ждёт в конкретную минуту, и цену задаёт
 * ошибка в обе стороны:
 *
 *  - слишком маленький потолок = долбим платформу, которую намеренно
 *    выключили на техобслуживание;
 *  - слишком большой = платформа вернулась, а под спит. Потолок в 1 800 000
 *    (окно техобслуживания) означал бы, что после получаса недоступности мы
 *    молчим ещё до получаса ПОСЛЕ того, как всё поднялось.
 *
 * 60 000 мс — не выдуманное число: это самая короткая пауза, которую называет
 * сама дока (`goaway.md`, «Перегрузка сервера»: `retry_after_ms: 60000`). То
 * есть темп «раз в минуту на под» платформа объявляет приемлемым ровно в тот
 * момент, когда ей тяжелее всего. Против получасового окна это ~30 попыток
 * вместо пяти, а вернувшуюся платформу мы замечаем максимум через минуту.
 */
export const MAX_BACKOFF_DELAY_MS = 60_000;

const DEFAULT_MIN_RECONNECT_DELAY_MS = 1000;
const DEFAULT_BASE_RECONNECT_DELAY_MS = 1000;
const DEFAULT_GOAWAY_CLOSE_GRACE_MS = 30_000;

/**
 * Сколько коннект должен прожить, чтобы считаться состоявшимся.
 *
 * Одно и то же окно решает две задачи, потому что вопрос один и тот же —
 * «это была рабочая связь или нас не пустили?»:
 *  - `GoAway` на коннекте моложе окна — отказ, а не плановая переработка
 *    (`IdleTimeout` и техобслуживание приходят на коннект, живший минутами,
 *    а «не пущу» — сразу за рукопожатием);
 *  - обрыв коннекта моложе окна не обнуляет бэкофф: платформа, которая
 *    принимает коннект и роняет его через секунду, иначе получала бы от нас
 *    ровно `baseReconnectDelayMs` вечно.
 */
const STABLE_CONNECTION_MS = 60_000;

/**
 * Пауза перед переподключением по `GoAway`.
 *
 * Расписание диктует платформа (`retry_after_ms`), а мы отвечаем только за
 * границы. Поле объявлено обязательным, но «обязательное» — это обещание
 * платформы, а не гарантия по проводу: отсутствие, ноль, отрицательное число
 * и строка вместо числа приводят к собственной задержке, а не к горячему
 * циклу и не к бесконечному простою.
 *
 * `streak` — сколько `GoAway` подряд пришло на коннекты, не прожившие и
 * минуты. Это единственная граница против платформы, которая нас намеренно не
 * пускает: не выдуманный список терминальных причин (в доке нет ни одной), а
 * растущая пауза, которая никогда не превращается в «больше не подключаться».
 */
export function resolveGoAwayDelayMs(
  payload: GoAwayPayload | undefined,
  opts: { min: number; fallback: number; streak?: number },
): number {
  const asked = payload?.retry_after_ms;
  const base =
    typeof asked === 'number' && Number.isFinite(asked) && asked > 0 ? asked : opts.fallback;
  const escalated = base * 2 ** Math.min(Math.max(opts.streak ?? 0, 0), 20);
  return Math.min(Math.max(escalated, opts.min), MAX_RECONNECT_DELAY_MS);
}

/**
 * Пауза перед очередной попыткой переподключения, когда расписания от
 * платформы нет (обычный обрыв связи, а не `GoAway`).
 *
 * Экспонента с потолком: `base * 2 ** attempt`, не выше `MAX_BACKOFF_DELAY_MS`.
 * Растёт она ради платформы, которая лежит, а упирается в потолок ради нас —
 * бесконечное удвоение превращает недоступность в четверть часа сна после
 * того, как всё починилось.
 *
 * Поверх — «равный джиттер» (`[nominal/2, nominal]`). Связь теряют не по
 * одному: под HPA у сервиса несколько реплик, и рестарт пода Games API рвёт их
 * коннекты в одну и ту же миллисекунду. Без джиттера весь деплой стучится
 * ровно в одни и те же секунды и синхронно устраивает шторм `SessionInfo`,
 * когда платформа только встала. Половина паузы остаётся жёсткой — джиттер
 * разводит попытки, но не может обнулить задержку.
 *
 * `base` нормализуется: ноль, отрицательное значение или мусор — это горячий
 * цикл коннектов, а не «подключайся быстрее».
 */
export function reconnectBackoffMs(
  attempt: number,
  opts: { base?: number; cap?: number; jitter?: () => number },
): number {
  const base =
    typeof opts.base === 'number' && Number.isFinite(opts.base) && opts.base > 0
      ? opts.base
      : DEFAULT_BASE_RECONNECT_DELAY_MS;
  const cap = opts.cap ?? MAX_BACKOFF_DELAY_MS;
  // Показатель прижат: `2 ** 1024` — уже Infinity, а `Infinity * 0` — NaN.
  const steps = Math.min(Math.max(Math.floor(attempt), 0), 30);
  const nominal = Math.min(base * 2 ** steps, cap);
  const rand = Math.min(Math.max(opts.jitter?.() ?? Math.random(), 0), 1);
  return Math.round((nominal * (1 + rand)) / 2);
}

/** Что сообщает событие `reconnecting` — по одному на каждую попытку. */
export interface ReconnectAttempt {
  /** Номер попытки с последнего состоявшегося коннекта, с 1. */
  attempt: number;
  /** Пауза перед этой попыткой, мс. */
  delayMs: number;
  /** Паузу назначила платформа в `GoAway` (а не наш бэкофф). */
  planned: boolean;
}

/**
 * `Error`, не относящийся ни к одному нашему запросу.
 *
 * Дока (`connection.md`) знает ровно один такой случай и он же самый дорогой:
 * при провале аутентификации API присылает `Error (auth failed)`, и игра
 * обязана перейти в состояние FAILED.
 */
export interface ConnectionError {
  code: string;
  message: string;
}

type ClientEvent =
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'reconnectAbandoned'
  | 'connectionError'
  | 'goAway'
  | 'balanceChanged'
  | 'sessionClosed'
  | 'newConnection'
  | 'autocloseRequest';

export class GamesApiClient {
  protected socket: WebSocket | null = null;
  protected readonly seq = new OpSeq();
  /** Ожидающие ответа RPC, ключ — id запроса (он же corr_id ответа). */
  private readonly pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly handlers = new Map<ClientEvent, Set<(arg?: any) => void>>();
  private reconnectAttempts = 0;
  private stopped = false;
  private ready = false;
  /** Guards against `scheduleReconnect` being re-entered by a failed attempt's own close event. */
  private reconnecting = false;
  /**
   * Пауза, которую платформа назначила в `GoAway`. Живёт до ближайшего
   * переподключения и тратится ровно один раз: расписание платформы
   * относится к ЭТОМУ закрытию, а не ко всем последующим сбоям связи.
   */
  private goAwayDelayMs: number | null = null;
  /** Сколько `GoAway` подряд пришло на коннекты, не прожившие и минуты. */
  private goAwayStreak = 0;
  private socketOpenedAt = 0;
  /** Страховка на случай, если обещанное докой закрытие со стороны сервера не придёт. */
  private closeGraceTimer: NodeJS.Timeout | null = null;
  /** Последний `Error`, не относившийся ни к одному запросу. */
  private lastError: ConnectionError | null = null;
  /** Разбудить паузу перед очередной попыткой досрочно — этим `close()` рвёт цикл. */
  private wakeReconnect: (() => void) | null = null;

  constructor(protected readonly opts: GamesApiClientOptions) {}

  get connected(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Идёт ли прямо сейчас цикл переподключения.
   *
   * Ради оператора: `connected === false` само по себе не отличает «ищем
   * платформу» от «клиент выключен» — а это ровно та разница, за которой во
   * время аварии лезут в первую очередь.
   */
  get retrying(): boolean {
    return this.reconnecting;
  }

  /** Сколько попыток сделано с последнего состоявшегося коннекта. */
  get attempts(): number {
    return this.reconnectAttempts;
  }

  /**
   * Последний отказ уровня коннекта, если он был. Снимается состоявшимся
   * коннектом: на здоровом поде его нет, а пока он есть — он и есть ответ на
   * вопрос «почему под не готов».
   */
  get lastConnectionError(): ConnectionError | null {
    return this.lastError;
  }

  on(event: ClientEvent, cb: (...args: any[]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
  }

  off(event: ClientEvent, cb: (...args: any[]) => void): void {
    this.handlers.get(event)?.delete(cb);
  }

  protected emit(event: ClientEvent, ...args: unknown[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }

  async connect(): Promise<void> {
    this.stopped = false;
    await this.openSocket();
  }

  close(): void {
    this.stopped = true;
    this.ready = false;
    this.clearCloseGrace();
    this.goAwayDelayMs = null;
    // Цикл переподключения может спать до минуты. Ждать этого не надо ни
    // выключению пода, ни тесту: будим паузу, она сразу видит `stopped`.
    this.wakeReconnect?.();
    this.socket?.close();
    this.socket = null;
  }

  /** Отправить конверт. Наследник (Task 3) использует это для RPC. */
  protected sendEnvelope(chan: Channel, type: string, payload: unknown, corrId?: string): Envelope {
    const env = buildEnvelope(chan, type, payload, this.seq.next(), corrId);
    this.socket?.send(JSON.stringify(env));
    return env;
  }

  /**
   * Один запрос-ответ. Повтор — только для идемпотентных типов и только на
   * кодах, где дока обещает, что повтор поможет.
   */
  async rpc<TReq, TRes>(type: string, payload: TReq, attempt = 0): Promise<TRes> {
    if (!this.connected) {
      // Дока: пока коннекта нет, запросы должны немедленно падать, а не висеть.
      throw GamesApiError.internal('no connection to Games API');
    }
    try {
      return await this.dispatch<TReq, TRes>(type, payload);
    } catch (err) {
      const retryable =
        err instanceof GamesApiError &&
        IDEMPOTENT_TYPES.has(type) &&
        isRetryable(err.code) &&
        attempt < 2;
      if (!retryable) throw err;
      const delay = (err as GamesApiError).retryAfterMs ?? 200 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, delay));
      return this.rpc<TReq, TRes>(type, payload, attempt + 1);
    }
  }

  private dispatch<TReq, TRes>(type: string, payload: TReq): Promise<TRes> {
    return new Promise<TRes>((resolve, reject) => {
      const env = this.sendEnvelope('rpc', type, payload);
      const timer = setTimeout(() => {
        this.pending.delete(env.id);
        reject(GamesApiError.internal(`timeout waiting for response to ${type}`));
      }, this.opts.rpcTimeoutMs ?? 15_000);
      this.pending.set(env.id, { resolve, reject, timer });
    });
  }

  sessionInfo(req: SessionInfoRequest): Promise<SessionInfoResponse> {
    return this.rpc('SessionInfoRequest', req);
  }

  playRound(req: PlayRoundRequest): Promise<PlayRoundResponse> {
    return this.rpc('PlayRoundRequest', req);
  }

  openRound(req: OpenRoundRequest): Promise<OpenRoundResponse> {
    return this.rpc('OpenRoundRequest', req);
  }

  updateRoundState(req: UpdateRoundStateRequest): Promise<UpdateRoundStateResponse> {
    return this.rpc('UpdateRoundStateRequest', req);
  }

  closeRound(req: CloseRoundRequest): Promise<CloseRoundResponse> {
    return this.rpc('CloseRoundRequest', req);
  }

  /** Ответ на AutocloseRoundRequest приходит типом CloseRoundResponse. */
  autocloseRound(req: AutocloseRoundRequest): Promise<CloseRoundResponse> {
    return this.rpc('AutocloseRoundRequest', req);
  }

  protected onEnvelope(env: Envelope): void {
    // `Error` без `corr_id` не отвечает ни на один наш запрос — это отказ
    // всему коннекту. Раньше он проваливался сквозь обе ветки (`onEvent`
    // отсеивает не-`events`) и исчезал бесследно: неверный `GamesApiKey`
    // давал под, который открыл сокет, получил этот отказ, был объявлен
    // готовым по пятисекундному дедлайну Hello и отвечал на `/healthz` 200,
    // пока каждый запрос игрока умирал по 15-секундному таймауту RPC.
    if (env.type === 'Error' && !env.corr_id) return this.onConnectionError(env.payload);
    if (env.chan !== 'rpc' || !env.corr_id) return this.onEvent(env);
    const waiter = this.pending.get(env.corr_id);
    if (!waiter) {
      // Ответ на запрос, который уже отдали таймаутом. Само по себе не авария
      // (RPC давно провалилась и вызывающий об этом знает), но полное молчание
      // здесь однажды уже прятало настоящую проблему.
      if (this.opts.debug) {
        console.error(`[artube] ${env.type} с неизвестным corr_id ${env.corr_id}`);
      }
      return;
    }
    this.pending.delete(env.corr_id);
    clearTimeout(waiter.timer);
    if (env.type === 'Error') {
      waiter.reject(new GamesApiError(env.payload as ErrorPayload));
    } else {
      waiter.resolve(env.payload);
    }
  }

  protected onEvent(env: Envelope): void {
    if (env.chan !== 'events') return;
    const map: Record<string, ClientEvent> = {
      BalanceChangedEvent: 'balanceChanged',
      SessionClosedEvent: 'sessionClosed',
      NewConnectionEvent: 'newConnection',
      AutocloseRequestEvent: 'autocloseRequest',
    };
    const name = map[env.type];
    if (name) this.emit(name, env.payload);
  }

  protected onDisconnected(reason: string): void {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(GamesApiError.internal(reason));
    }
    this.pending.clear();
  }

  /**
   * Отказ, адресованный не запросу, а самому коннекту.
   *
   * Единственный описанный докой случай — провал аутентификации: «Ошибка
   * аутентификации → API присылает `Error (auth failed)` → игра переходит в
   * FAILED» (`connection.md`). Никакого способа отличить его от прочих
   * неадресованных отказов провод не даёт, и это к лучшему: коннект, на
   * котором нам отказали и не сказали, кому именно, рабочим считать нельзя.
   *
   * Что делаем:
   *  - `ready = false` — под перестаёт быть готовым, и `/healthz` отвечает 503
   *    вместо прежних 200 при каждом запросе игрока, умирающем по таймауту.
   *    Отдельного понятия здоровья не заводим: это то же самое «connected vs
   *    retrying», что и при обрыве связи;
   *  - `lastError` — чтобы 503 назвал ПРИЧИНУ. «Под не готов» и «у пода
   *    неверный ключ» требуют разных действий оператора;
   *  - `armCloseGrace()` — сервер, отказавший в аутентификации, обычно
   *    закрывает соединение сам (и тогда работает обычное переподключение).
   *    Если не закроет, закроем мы: иначе под навсегда застрял бы в «не готов»
   *    и не попытался бы подключиться ни разу.
   */
  protected onConnectionError(payload: unknown): void {
    const { code, message } = readErrorPayload(payload as ErrorPayload);
    const error: ConnectionError = { code, message };
    this.lastError = error;
    this.ready = false;
    this.emit('connectionError', error);
    this.armCloseGrace();
  }

  /**
   * `GoAway`: этот коннект уходит. Не закрываем его — ждём закрытия со
   * стороны сервера, как требует дока, и планируем переподключение через
   * `retry_after_ms`.
   *
   * `ready = false` сразу: «корректно завершить текущие операции» — про уже
   * отправленные RPC (их ответы ещё придут по этому же сокету), а не про
   * право начинать новые. Заводить денежную RPC в сокет, о котором нам только
   * что сказали, что его закроют, — как раз та «потеря данных игрока», от
   * которой дока предостерегает.
   *
   * `stopped` НЕ трогаем: это флаг «клиент выключен насовсем», и именно его
   * ошибочная установка здесь делала под глухим до перезапуска.
   */
  private onGoAway(payload: GoAwayPayload | undefined): void {
    const reason = typeof payload?.reason === 'string' ? payload.reason : 'goaway';
    // Считаем ПРЕДЫДУЩИЕ короткие коннекты: одиночный `GoAway` — норма
    // платформы и идёт ровно по её расписанию, а разводить попытки начинаем
    // только когда коннект за коннектом обрываются сразу за рукопожатием.
    const short = Date.now() - this.socketOpenedAt < STABLE_CONNECTION_MS;
    const delay = resolveGoAwayDelayMs(payload, {
      min: this.opts.minReconnectDelayMs ?? DEFAULT_MIN_RECONNECT_DELAY_MS,
      fallback: this.opts.baseReconnectDelayMs ?? DEFAULT_MIN_RECONNECT_DELAY_MS,
      streak: short ? this.goAwayStreak : 0,
    });
    this.goAwayStreak = short ? this.goAwayStreak + 1 : 0;
    this.ready = false;
    this.goAwayDelayMs = delay;
    this.emit('goAway', reason, delay);
    this.armCloseGrace();
  }

  /**
   * Сервер закроет это соединение сам — после `GoAway` он это обещал, после
   * отказа в аутентификации так делает. Ждём — но не бесконечно: коннект, на
   * котором нам уже отказали, новых вызовов не принимает, а `close` может не
   * прийти никогда, и тогда переподключение не начнётся вовсе.
   */
  private armCloseGrace(): void {
    this.clearCloseGrace();
    const socket = this.socket;
    if (!socket) return;
    const timer = setTimeout(() => {
      this.closeGraceTimer = null;
      if (this.stopped || socket !== this.socket) return;
      if (socket.readyState === WebSocket.CLOSED) return;
      if (this.opts.debug) {
        console.error('[artube] сервер не закрыл соединение, закрываем сами');
      }
      socket.terminate();
    }, this.opts.goAwayCloseGraceMs ?? DEFAULT_GOAWAY_CLOSE_GRACE_MS);
    timer.unref?.();
    this.closeGraceTimer = timer;
  }

  private clearCloseGrace(): void {
    if (!this.closeGraceTimer) return;
    clearTimeout(this.closeGraceTimer);
    this.closeGraceTimer = null;
  }

  private openSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.seq.reset();
      const socket = new WebSocket(this.opts.url, ['json'], {
        headers: { 'X-Api-Key': this.opts.apiKey, 'X-Game-ID': this.opts.gameId },
      });
      this.socket = socket;

      // Welcome приходит всегда, но дока разрешает считать версию актуальной
      // молча — поэтому готовность объявляем и по дедлайну.
      let settled = false;
      const finish = () => {
        // `stopped` can flip true between Welcome/timeout firing and this
        // running — e.g. GoAway arrived, or close() was called mid-handshake.
        // Don't resurrect a connection that's already been told to stop.
        if (settled || this.stopped) return;
        settled = true;
        clearTimeout(timer);
        this.ready = true;
        // Коннект состоялся — прошлый отказ больше ничего не описывает.
        this.lastError = null;
        // Счётчик попыток обнуляет не сам факт коннекта, а его ЖИЗНЬ: см.
        // `STABLE_CONNECTION_MS` в `scheduleReconnect`. Обнулять здесь значило
        // бы, что платформа, принимающая коннект и роняющая его через
        // секунду, вечно получает от нас попытку раз в `baseReconnectDelayMs`.
        this.emit('connected');
        resolve();
      };
      const timer = setTimeout(finish, this.opts.helloTimeoutMs ?? 5000);

      socket.on('open', () => {
        this.socketOpenedAt = Date.now();
        this.sendEnvelope('control', 'Hello', {
          supports: { max_schema: 1, contracts: ANNOUNCED_CONTRACTS },
        });
      });

      socket.on('message', (data) => {
        let env: Envelope;
        try {
          env = parseEnvelope(data as Buffer);
        } catch (err) {
          if (this.opts.debug) console.error('[artube] bad envelope', err);
          return;
        }
        if (env.chan === 'control') {
          if (env.type === 'Welcome') return finish();
          if (env.type === 'GoAway') {
            // Settle this attempt as "done" right now so neither a pending
            // hello-timeout nor a not-yet-processed Welcome can call finish()
            // afterward and flip us back to ready/'connected'. Resolve (not
            // reject) connect() ourselves — GoAway can arrive before Welcome
            // or the deadline, and nothing else would ever settle it.
            //
            // Резолв, а не реджект: `GoAway` на самом первом коннекте — это
            // «приходи через retry_after_ms», а не провал старта. Под должен
            // подняться и подключиться сам, а не падать в CrashLoopBackOff.
            settled = true;
            clearTimeout(timer);
            this.onGoAway(env.payload as GoAwayPayload);
            resolve();
            return;
          }
        }
        // Отказ уровня коннекта закрывает и попытку подключения — по той же
        // причине, что и `GoAway`: иначе пятисекундный дедлайн Hello объявил
        // бы готовым сокет, в котором нам только что отказали, и провал
        // аутентификации выглядел бы как здоровый под. Резолв, а не реджект:
        // под обязан подняться и сказать о себе правду в `/healthz`, а не
        // упасть в CrashLoopBackOff, где никаких логов уже не прочесть.
        if (env.type === 'Error' && !env.corr_id) {
          settled = true;
          clearTimeout(timer);
          this.onEnvelope(env);
          resolve();
          return;
        }
        this.onEnvelope(env);
      });

      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      socket.on('close', (code: number, reason: Buffer) => {
        clearTimeout(timer);
        this.clearCloseGrace();
        this.ready = false;
        this.onDisconnected('socket closed');
        this.emit('disconnected');
        // A connection attempt can be dropped (e.g. the remote just resets
        // the TCP connection) without 'error' ever firing, which would
        // otherwise leave this attempt's promise settled forever and stall
        // scheduleReconnect()'s loop on a `catch` that never runs.
        if (!settled) {
          settled = true;
          // Код и причина — не украшение. Без них это сообщение сообщает ровно
          // ноль: 1006 (закрытие без кадра, то есть оборванный TCP) и 1001 от
          // самой платформы требуют разных действий, а `url` отвечает на
          // вопрос «а туда ли мы вообще подключались» — на него однажды уже
          // пришлось отвечать вручную, когда порт из динамического диапазона
          // достался чужому серверу.
          reject(
            new Error(
              `socket closed before the connection settled (${this.opts.url}, ` +
                `code ${code}${reason?.length ? `, reason ${reason.toString()}` : ''})`,
            ),
          );
        }
        if (!this.stopped) void this.scheduleReconnect();
      });
    });
  }

  /**
   * Цикл переподключения. По умолчанию БЕЗ предела по числу попыток:
   * ограничена растущая пауза, а не право пытаться.
   *
   * Конечный бюджет — это состояние «платформу больше не ищем, но под живой и
   * с виду здоровый», а такого правильного исхода для игрового бэкенда не
   * существует. Прежние пять попыток по `1000 * 2 ** n` — 31 секунда: короче
   * любого окна, которое платформа сама себе выписывает в `GoAway`
   * (обновление 300 000 мс, техобслуживание 1 800 000).
   *
   * Что вместо предела не даёт циклу стать горячим:
   *  - каждая итерация ждёт настоящий таймер, а пауза растёт до
   *    `MAX_BACKOFF_DELAY_MS` — не чаще попытки в минуту на под даже при
   *    мгновенно падающих коннектах;
   *  - `base` нормализуется в `reconnectBackoffMs`, так что `0` не превращает
   *    паузу в ноль;
   *  - коннект, не проживший `STABLE_CONNECTION_MS`, не обнуляет счётчик —
   *    иначе платформа, роняющая коннект сразу после Welcome, держала бы нас
   *    на стартовой паузе бесконечно;
   *  - защёлка `reconnecting` по-прежнему не даёт неудачной попытке породить
   *    соседний цикл (её `close` зовёт этот же метод);
   *  - `close()` будит паузу и цикл выходит сразу, а таймер паузы `unref`нут —
   *    висящее переподключение не держит процесс живым.
   */
  private async scheduleReconnect(): Promise<void> {
    // Every openSocket() attempt made *inside* this loop also has its own
    // `close` handler, which — on failure — fires this same method again.
    // Without this guard, each failed attempt spawns a sibling loop racing
    // the same `reconnectAttempts` counter, stacking concurrent reconnect
    // attempts instead of retrying serially.
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      // Сюда попадают только по закрытию коннекта, который БЫЛ живым:
      // закрытия неудачных попыток внутри цикла отсекает защёлка выше.
      // Прожил достаточно — авария новая, и разводить её надо с начала.
      if (Date.now() - this.socketOpenedAt >= STABLE_CONNECTION_MS) this.reconnectAttempts = 0;
      const max = this.opts.maxReconnectAttempts ?? Number.POSITIVE_INFINITY;
      const base = this.opts.baseReconnectDelayMs;
      while (!this.stopped && this.reconnectAttempts < max) {
        // Переподключение после `GoAway` идёт по расписанию платформы, а не
        // по нашему бэкоффу, и только на первую попытку: `retry_after_ms`
        // относится к ЭТОМУ закрытию. Не удалась — дальше это обычный сбой
        // связи со своей растущей задержкой. Потолок бэкоффа к назначенной
        // платформой паузе не применяется: её границы — в
        // `resolveGoAwayDelayMs`, и получасовое окно техобслуживания мы обязаны
        // выждать целиком.
        const planned = this.goAwayDelayMs;
        this.goAwayDelayMs = null;
        const delay = planned ?? reconnectBackoffMs(this.reconnectAttempts, { base });
        this.reconnectAttempts += 1;
        // Единственный признак жизни для оператора, пока платформы нет. Своего
        // ограничителя частоты ему не нужно: частоту задаёт сам бэкофф — шесть
        // строк за первую минуту аварии и по одной в минуту дальше.
        this.emit('reconnecting', {
          attempt: this.reconnectAttempts,
          delayMs: delay,
          planned: planned !== null,
        } satisfies ReconnectAttempt);
        await this.sleepBeforeAttempt(delay);
        if (this.stopped) return;
        try {
          await this.openSocket();
          return;
        } catch {
          // следующая попытка с большей задержкой
        }
      }
      // Досюда доходят только с конечным `maxReconnectAttempts`, который надо
      // передать явно. Не оставляем клиент в подвешенном состоянии: он
      // выключен так же, как от `close()`, и об этом сказано вслух.
      if (!this.stopped) {
        this.stopped = true;
        this.ready = false;
        this.emit('reconnectAbandoned', this.reconnectAttempts);
      }
    } finally {
      this.reconnecting = false;
    }
  }

  /** Пауза перед попыткой: просыпается сама или досрочно — от `close()`. */
  private sleepBeforeAttempt(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.wakeReconnect = null;
        resolve();
      };
      const timer = setTimeout(done, ms);
      // Ожидание переподключения не должно само по себе держать процесс живым.
      timer.unref?.();
      this.wakeReconnect = done;
    });
  }
}
