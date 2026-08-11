/**
 * WebSocket-клиент игрового бэкенда.
 *
 * Клиент не рвёт соединение сам: при обрыве переподключается с экспонентой,
 * а висящие запросы отбивает, чтобы игра не ждала вечно.
 *
 * Сервер шлёт `init` на каждое новое соединение — в том числе после
 * реконнекта, и тогда `init` может нести `resume`: сегмент раунда, который
 * игрок не докрутил перед обрывом связи. `connect()` резолвится только
 * первым `init` (обычный старт игры) — для этого промиса второй и все
 * последующие `init`-ы просто не существуют, `reconnect()` их отбрасывает
 * вместе с промисом внутреннего `connect()`. Чтобы такой `init` не терялся,
 * он (и первый тоже, для единообразия) дублируется в событие `'init'` на
 * существующем `on()`, на которое можно подписаться один раз и получать
 * все `init`, включая пост-реконнектные с `resume`.
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

export class ArtubeClient {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<
    string,
    { resolve: (r: ServerResult) => void; reject: (e: Error) => void }
  >();
  private readonly handlers = new Map<ClientEvent, Set<(arg: any) => void>>();
  private counter = 0;
  private closed = false;
  private initResolve: ((init: ServerInit) => void) | null = null;

  constructor(
    private readonly url: string,
    private readonly baseReconnectDelayMs = 1000,
  ) {}

  on(event: ClientEvent, cb: (arg: any) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
  }

  private emit(event: ClientEvent, arg: unknown): void {
    for (const cb of this.handlers.get(event) ?? []) cb(arg);
  }

  connect(): Promise<ServerInit> {
    return new Promise<ServerInit>((resolve, reject) => {
      this.initResolve = resolve;
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.onmessage = (event) => this.onMessage(String(event.data));
      socket.onerror = () => reject(new ArtubeBackendError('ConnectionFailed', 'ws error'));
      socket.onclose = () => {
        this.failPending('connection lost');
        this.emit('connection', { connected: false });
        if (!this.closed) void this.reconnect();
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
    const msg = JSON.parse(raw) as ServerMessage;
    if (msg.t === 'init') {
      this.initResolve?.(msg);
      this.initResolve = null;
      this.emit('init', msg);
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
      const waiter = msg.id ? this.pending.get(msg.id) : undefined;
      if (waiter) {
        this.pending.delete(msg.id!);
        waiter.reject(error);
      }
    }
  }

  private failPending(reason: string): void {
    for (const [, waiter] of this.pending) {
      waiter.reject(new ArtubeBackendError('InternalServerError', reason));
    }
    this.pending.clear();
  }

  private async reconnect(attempt = 0): Promise<void> {
    if (this.closed || attempt >= 5) return;
    await new Promise((r) => setTimeout(r, this.baseReconnectDelayMs * 2 ** attempt));
    try {
      await this.connect();
    } catch {
      await this.reconnect(attempt + 1);
    }
  }
}
