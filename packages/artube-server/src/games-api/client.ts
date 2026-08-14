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
 */

import { WebSocket } from 'ws';
import {
  buildEnvelope,
  parseEnvelope,
  OpSeq,
  type Channel,
  type Envelope,
} from './envelope.js';
import { GamesApiError, IDEMPOTENT_TYPES, isRetryable } from './errors.js';
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

const DEFAULT_MIN_RECONNECT_DELAY_MS = 1000;
const DEFAULT_GOAWAY_CLOSE_GRACE_MS = 30_000;

/**
 * Коннект, проживший меньше этого до `GoAway`, считаем отказом, а не плановой
 * переработкой: `IdleTimeout` и техобслуживание приходят на коннект, который
 * жил минутами, а «не пущу» — сразу за рукопожатием.
 */
const GOAWAY_STREAK_WINDOW_MS = 60_000;

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

type ClientEvent =
  | 'connected'
  | 'disconnected'
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
  private goAwayCloseTimer: NodeJS.Timeout | null = null;

  constructor(protected readonly opts: GamesApiClientOptions) {}

  get connected(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
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
    this.clearGoAwayCloseGrace();
    this.goAwayDelayMs = null;
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
    if (env.chan !== 'rpc' || !env.corr_id) return this.onEvent(env);
    const waiter = this.pending.get(env.corr_id);
    if (!waiter) return;
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
    const short = Date.now() - this.socketOpenedAt < GOAWAY_STREAK_WINDOW_MS;
    const delay = resolveGoAwayDelayMs(payload, {
      min: this.opts.minReconnectDelayMs ?? DEFAULT_MIN_RECONNECT_DELAY_MS,
      fallback: this.opts.baseReconnectDelayMs ?? DEFAULT_MIN_RECONNECT_DELAY_MS,
      streak: short ? this.goAwayStreak : 0,
    });
    this.goAwayStreak = short ? this.goAwayStreak + 1 : 0;
    this.ready = false;
    this.goAwayDelayMs = delay;
    // Плановая смена коннекта — не сбой связи и не должна тратить бюджет
    // попыток, который мог быть частично сожжён предыдущими обрывами.
    this.reconnectAttempts = 0;
    this.emit('goAway', reason, delay);
    this.armGoAwayCloseGrace();
  }

  /** Сервер обещал закрыть соединение сам. Ждём — но не бесконечно. */
  private armGoAwayCloseGrace(): void {
    this.clearGoAwayCloseGrace();
    const socket = this.socket;
    if (!socket) return;
    const timer = setTimeout(() => {
      this.goAwayCloseTimer = null;
      if (this.stopped || socket !== this.socket) return;
      if (socket.readyState === WebSocket.CLOSED) return;
      if (this.opts.debug) {
        console.error('[artube] GoAway: сервер не закрыл соединение, закрываем сами');
      }
      socket.terminate();
    }, this.opts.goAwayCloseGraceMs ?? DEFAULT_GOAWAY_CLOSE_GRACE_MS);
    timer.unref?.();
    this.goAwayCloseTimer = timer;
  }

  private clearGoAwayCloseGrace(): void {
    if (!this.goAwayCloseTimer) return;
    clearTimeout(this.goAwayCloseTimer);
    this.goAwayCloseTimer = null;
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
        this.reconnectAttempts = 0;
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
        this.onEnvelope(env);
      });

      socket.on('error', (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      socket.on('close', () => {
        clearTimeout(timer);
        this.clearGoAwayCloseGrace();
        this.ready = false;
        this.onDisconnected('socket closed');
        this.emit('disconnected');
        // A connection attempt can be dropped (e.g. the remote just resets
        // the TCP connection) without 'error' ever firing, which would
        // otherwise leave this attempt's promise settled forever and stall
        // scheduleReconnect()'s loop on a `catch` that never runs.
        if (!settled) {
          settled = true;
          reject(new Error('socket closed before the connection settled'));
        }
        if (!this.stopped) void this.scheduleReconnect();
      });
    });
  }

  private async scheduleReconnect(): Promise<void> {
    // Every openSocket() attempt made *inside* this loop also has its own
    // `close` handler, which — on failure — fires this same method again.
    // Without this guard, each failed attempt spawns a sibling loop racing
    // the same `reconnectAttempts` counter, stacking concurrent reconnect
    // attempts instead of retrying serially.
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      const max = this.opts.maxReconnectAttempts ?? 5;
      const base = this.opts.baseReconnectDelayMs ?? 1000;
      while (!this.stopped && this.reconnectAttempts < max) {
        // Переподключение после `GoAway` идёт по расписанию платформы, а не
        // по нашему бэкоффу, и только на первую попытку: `retry_after_ms`
        // относится к ЭТОМУ закрытию. Не удалась — дальше это обычный сбой
        // связи со своей растущей задержкой.
        const planned = this.goAwayDelayMs;
        this.goAwayDelayMs = null;
        const delay = planned ?? base * 2 ** this.reconnectAttempts;
        this.reconnectAttempts += 1;
        await new Promise((r) => setTimeout(r, delay));
        if (this.stopped) return;
        try {
          await this.openSocket();
          return;
        } catch {
          // следующая попытка с большей задержкой
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }
}
