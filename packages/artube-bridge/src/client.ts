/**
 * WebSocket-клиент игрового бэкенда.
 *
 * Клиент не рвёт соединение сам: при обрыве переподключается с экспонентой
 * (не больше {@link MAX_RECONNECT_ATTEMPTS} попыток, бэкофф ×2 за попытку), а
 * висящие запросы отбивает, чтобы игра не ждала вечно.
 *
 * Реконнект-луп защищён реэнтрантным флагом (`reconnecting`): на провальной
 * попытке соединения `error` и `close` могут оба сработать для одного и того
 * же провала (обычное поведение реального `WebSocket`), и без флага каждый
 * такой провал порождал бы отдельный, параллельный цикл реконнекта поверх
 * уже идущего — экспоненциально размножая цепочки при затяжном отказе бэкенда
 * вместо того, чтобы ретраить последовательно и остановиться после потолка.
 * Флаг также перепроверяется после ожидания бэкоффа: `close()` может
 * случиться прямо во время паузы между попытками, и тогда луп обязан не
 * открывать новый сокет, а не поднимать соединение-зомби поверх уже
 * закрытого клиента.
 *
 * Контракт `init`: сервер шлёт `init` на каждое новое соединение — в том
 * числе после реконнекта, и такой `init` может нести `resume`: сегмент
 * раунда, который игрок не докрутил перед обрывом связи.
 *  - Самый первый `init` за всё время жизни клиента доставляется только через
 *    промис `connect()` — событием `'init'` не дублируется, чтобы не было
 *    двойной доставки в один тик для обычного подписчика, оформленного сразу
 *    после `await connect()`.
 *  - Любой последующий `init` (то есть пришедший после реконнекта) идёт
 *    только через событие `'init'` на `on()`.
 *  - Если на момент прихода такого `init` подписчиков ещё нет (например, игра
 *    ещё грузит ассеты), самый свежий такой `init` придерживается и
 *    отдаётся первому, кто подпишется на `'init'` позже — поздний подписчик
 *    не теряет `resume`.
 *
 * Также: `error`-фрейм без `id` — это провал уровня соединения (например,
 * сессия не найдена при инициализации на сервере), а не ответ на конкретный
 * `play()`. Если в этот момент `connect()` ещё ждёт `init`, такой фрейм
 * отбивает его с кодом платформы; в остальных случаях он просто не находит
 * адресата.
 */

import type { ServerInit, ServerMessage, ServerResult } from './types';

export class ArtubeBackendError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArtubeBackendError';
  }
}

type ClientEvent = 'balance' | 'sessionClosed' | 'connection' | 'init';

export interface PlayArgs {
  action: string;
  betIndex: number;
  params?: Record<string, unknown>;
}

const MAX_RECONNECT_ATTEMPTS = 5;

export class ArtubeClient {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<
    string,
    { resolve: (r: ServerResult) => void; reject: (e: Error) => void }
  >();
  private readonly handlers = new Map<ClientEvent, Set<(arg: any) => void>>();
  private counter = 0;
  private closed = false;
  private initSettle: {
    resolve: (init: ServerInit) => void;
    reject: (err: Error) => void;
  } | null = null;
  private hasReceivedInit = false;
  private lastUnseenInit: ServerInit | null = null;
  private reconnecting = false;

  constructor(
    private readonly url: string,
    private readonly baseReconnectDelayMs = 1000,
  ) {}

  on(event: ClientEvent, cb: (arg: any) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
    // A reconnect `init` that arrived before anyone subscribed is held for
    // exactly this moment — see the class doc comment's `init` contract.
    if (event === 'init' && this.lastUnseenInit) {
      const init = this.lastUnseenInit;
      this.lastUnseenInit = null;
      cb(init);
    }
  }

  private emit(event: ClientEvent, arg: unknown): void {
    for (const cb of this.handlers.get(event) ?? []) cb(arg);
  }

  connect(): Promise<ServerInit> {
    return new Promise<ServerInit>((resolve, reject) => {
      let settled = false;
      this.initSettle = {
        resolve: (init) => {
          if (settled) return;
          settled = true;
          this.initSettle = null;
          resolve(init);
        },
        reject: (err) => {
          if (settled) return;
          settled = true;
          this.initSettle = null;
          reject(err);
        },
      };
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.onmessage = (event) => this.onMessage(String(event.data));
      socket.onerror = () => {
        this.initSettle?.reject(new ArtubeBackendError('ConnectionFailed', 'ws error'));
      };
      socket.onclose = () => {
        this.failPending('connection lost');
        this.emit('connection', { connected: false });
        // Init can fail server-side (e.g. an unknown/expired sessionId) or
        // the socket can drop mid-handshake before init ever arrives —
        // either way a caller awaiting connect() must not be left hanging.
        this.initSettle?.reject(
          new ArtubeBackendError('ConnectionFailed', 'connection closed before init'),
        );
        if (!this.closed) this.scheduleReconnect();
      };
      socket.onopen = () => this.emit('connection', { connected: true });
    });
  }

  play(args: PlayArgs): Promise<ServerResult> {
    return new Promise<ServerResult>((resolve, reject) => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return reject(new ArtubeBackendError('InternalServerError', 'no backend connection'));
      }
      const id = `p${++this.counter}`;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ t: 'play', id, ...args }));
    });
  }

  /** Игрок увидел сегмент — бэкенд двигает курсор в состоянии платформы. */
  ack(roundId: string, cursor: number): void {
    this.socket?.send(JSON.stringify({ t: 'ack', roundId, cursor }));
  }

  close(): void {
    this.closed = true;
    this.socket?.close();
  }

  private onMessage(raw: string): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(raw) as ServerMessage;
    } catch {
      // A malformed frame is a contained failure, not a reason to blow up
      // the message handler (and with it, every other in-flight `play()`).
      return;
    }
    if (msg.t === 'init') {
      this.initSettle?.resolve(msg);
      if (this.hasReceivedInit) {
        this.deliverInit(msg);
      } else {
        this.hasReceivedInit = true;
      }
      return;
    }
    if (msg.t === 'balance') return this.emit('balance', msg);
    if (msg.t === 'session_closed') return this.emit('sessionClosed', msg);
    if (msg.t === 'result') {
      const waiter = msg.id ? this.pending.get(msg.id) : undefined;
      if (waiter) {
        this.pending.delete(msg.id!);
        waiter.resolve(msg);
      }
      return;
    }
    if (msg.t === 'error') {
      const error = new ArtubeBackendError(msg.code, msg.message);
      if (msg.id) {
        const waiter = this.pending.get(msg.id);
        if (waiter) {
          this.pending.delete(msg.id);
          waiter.reject(error);
        }
        return;
      }
      // No id: a connection-level failure, not an answer to a specific
      // play(). If connect() is still waiting on init, this is the reason.
      this.initSettle?.reject(error);
    }
  }

  private deliverInit(init: ServerInit): void {
    const listeners = this.handlers.get('init');
    if (listeners && listeners.size > 0) {
      for (const cb of listeners) cb(init);
    } else {
      this.lastUnseenInit = init;
    }
  }

  private failPending(reason: string): void {
    for (const [, waiter] of this.pending) {
      waiter.reject(new ArtubeBackendError('InternalServerError', reason));
    }
    this.pending.clear();
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    void this.runReconnectLoop();
  }

  private async runReconnectLoop(): Promise<void> {
    try {
      let attempt = 0;
      while (!this.closed && attempt < MAX_RECONNECT_ATTEMPTS) {
        const delay = this.baseReconnectDelayMs * 2 ** attempt;
        attempt += 1;
        await new Promise((r) => setTimeout(r, delay));
        if (this.closed) return;
        try {
          await this.connect();
          return;
        } catch {
          // next attempt, longer delay
        }
      }
    } finally {
      this.reconnecting = false;
    }
  }
}
