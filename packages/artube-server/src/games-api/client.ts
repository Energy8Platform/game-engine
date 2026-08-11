/**
 * Клиент Artube Games API.
 *
 * Один инстанс = один WebSocket-коннект, мультиплексирующий все сессии пода:
 * `op_seq` монотонен в рамках коннекта, ответы парятся по `corr_id`.
 * Коннект не рвём по своей инициативе — только переподключаемся при сбое и
 * останавливаемся по `GoAway`, как требует дока.
 */

import { WebSocket } from 'ws';
import {
  buildEnvelope,
  parseEnvelope,
  OpSeq,
  type Channel,
  type Envelope,
} from './envelope.js';

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
  debug?: boolean;
}

type ClientEvent = 'connected' | 'disconnected' | 'goAway';

export class GamesApiClient {
  protected socket: WebSocket | null = null;
  protected readonly seq = new OpSeq();
  private readonly handlers = new Map<ClientEvent, Set<(arg?: any) => void>>();
  private reconnectAttempts = 0;
  private stopped = false;
  private ready = false;
  /** Guards against `scheduleReconnect` being re-entered by a failed attempt's own close event. */
  private reconnecting = false;

  constructor(protected readonly opts: GamesApiClientOptions) {}

  get connected(): boolean {
    return this.ready && this.socket?.readyState === WebSocket.OPEN;
  }

  on(event: ClientEvent, cb: (arg?: any) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(cb);
  }

  off(event: ClientEvent, cb: (arg?: any) => void): void {
    this.handlers.get(event)?.delete(cb);
  }

  protected emit(event: ClientEvent, arg?: unknown): void {
    for (const cb of this.handlers.get(event) ?? []) cb(arg);
  }

  async connect(): Promise<void> {
    this.stopped = false;
    await this.openSocket();
  }

  close(): void {
    this.stopped = true;
    this.ready = false;
    this.socket?.close();
    this.socket = null;
  }

  /** Отправить конверт. Наследник (Task 3) использует это для RPC. */
  protected sendEnvelope(chan: Channel, type: string, payload: unknown, corrId?: string): Envelope {
    const env = buildEnvelope(chan, type, payload, this.seq.next(), corrId);
    this.socket?.send(JSON.stringify(env));
    return env;
  }

  /** Точка расширения: приходящие конверты, кроме control-канала. */
  protected onEnvelope(_env: Envelope): void {}

  /** Точка расширения: коннект оборвался, надо отбить висящие RPC. */
  protected onDisconnected(_reason: string): void {}

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
            settled = true;
            clearTimeout(timer);
            this.stopped = true;
            this.ready = false;
            this.emit('goAway', (env.payload as { reason?: string })?.reason ?? 'goaway');
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
        const delay = base * 2 ** this.reconnectAttempts;
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
