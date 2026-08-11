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
        if (settled) return;
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
          if (env.type === 'Welcome') {
            // Welcome can reach us before our own just-sent Hello has been
            // read on the other end (same-process fake server in tests, or
            // a fast platform edge in prod) — yield one tick so in-flight
            // writes settle before we declare the connection ready.
            setTimeout(finish, 0);
            return;
          }
          if (env.type === 'GoAway') {
            this.stopped = true;
            this.ready = false;
            this.emit('goAway', (env.payload as { reason?: string })?.reason ?? 'goaway');
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
        if (!this.stopped) void this.scheduleReconnect();
      });
    });
  }

  private async scheduleReconnect(): Promise<void> {
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
  }
}
