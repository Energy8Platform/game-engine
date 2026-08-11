import { createServer, type Server } from 'node:http';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { GamesApiClient } from '../games-api/client.js';
import { startEngine, type EngineClient } from '../engine/index.js';
import { handleConnection } from './ws.js';
import { handleAutocloseRequest } from './autoclose.js';
import { createLogger } from './log.js';
import type { ServerMessage } from './wire.js';
import type { ArtubeServerConfig } from '../config.js';
import type { AutocloseRequestEvent } from '../games-api/types.js';

/**
 * Сколько ждём штатного close-хендшейка живых WS-клиентов при выключении,
 * прежде чем принудительно оборвать оставшихся. `http.close(cb)` не
 * вызовет `cb`, пока жив хоть один апгрейженный сокет — без границы во
 * времени и без принудительного добивания это выключение зависло бы,
 * ожидая клиента, который не отвечает.
 */
const SHUTDOWN_GRACE_MS = 3000;

export class ArtubeServer {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private api: GamesApiClient | null = null;
  private engine: EngineClient | null = null;
  private actualPort = 0;
  private closing = false;
  /** Живые WS-соединения этого пода — `wss.close()` сам их не закрывает. */
  private readonly clients = new Set<WebSocket>();

  constructor(private readonly config: ArtubeServerConfig) {}

  get port(): number {
    return this.actualPort;
  }

  async listen(port = this.config.port ?? 80): Promise<void> {
    const log = createLogger('artube-server', { game_id: this.config.gameId });

    const gamesDir = statSync(this.config.spinPath).isDirectory()
      ? this.config.spinPath
      : dirname(this.config.spinPath);
    this.engine = await startEngine({ gamesDir });
    const config = await this.engine.getConfig(this.config.gameId);
    // gRPC GetConfig отдаёт actions массивом { name, cost, session, stage } —
    // не словарём с cost_multiplier, который печатает CLI `e8 emit-config`.
    const actions = (config.actions ?? []) as Array<{ name: string; cost: number }>;
    const costMultipliers = Object.fromEntries(actions.map((a) => [a.name, a.cost]));

    this.api = new GamesApiClient({
      url: this.config.gamesApiUrl,
      apiKey: this.config.apiKey,
      gameId: this.config.gameId,
    });
    await this.api.connect();
    this.api.on('goAway', (reason: string) => log.warn('games api asked to go away', { reason }));
    // Брошенный раунд: события приходят на подовый коннект, не на конкретное
    // WS-соединение (того обычно уже нет) — подписка живёт здесь, один раз.
    this.api.on('autocloseRequest', (event: AutocloseRequestEvent) => {
      void handleAutocloseRequest(
        { api: this.api!, engine: this.engine!, gameId: this.config.gameId, costMultipliers, log },
        event,
      );
    });

    this.http = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Пробы Kubernetes живут вне /api — так их конфигурирует платформа.
      if (url.pathname === '/livez') return respond(res, 200, { ok: true });
      if (url.pathname === '/healthz') {
        const ready = this.api?.connected === true;
        return respond(res, ready ? 200 : 503, { ok: ready });
      }
      if (url.pathname === '/api/version') {
        return respond(res, 200, {
          gameId: this.config.gameId,
          commit: process.env.GIT_HASH ?? 'dev',
        });
      }
      respond(res, 404, { error: 'not found' });
    });

    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => {
      // Выключение уже началось — новых игроков на закрывающийся под не пускаем.
      if (this.closing) return socket.destroy();
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/ws') return socket.destroy();
      const sessionId = url.searchParams.get('sessionId');
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        if (!sessionId) return ws.close(1008, 'sessionId is required');
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
        void handleConnection(ws, sessionId, {
          api: this.api!,
          engine: this.engine!,
          gameId: this.config.gameId,
          costMultipliers,
          startingDemoBalance: this.config.startingDemoBalance ?? 1000,
          log,
        });
      });
    });

    await new Promise<void>((resolve) => this.http!.listen(port, () => resolve()));
    this.actualPort = (this.http!.address() as AddressInfo).port;
    log.info('artube-server listening', { port: this.actualPort });
  }

  async close(): Promise<void> {
    this.closing = true;
    // Живым соединениям — честный `session_closed` и close-хендшейк, но не
    // ждать вечно: `http.close(cb)` не позовёт `cb`, пока жив хоть один
    // апгрейженный сокет, а зависший клиент не должен вешать деплой.
    await this.closeClients();
    this.api?.close();
    this.engine?.close();
    this.wss?.close();
    await new Promise<void>((resolve) => {
      if (!this.http) return resolve();
      this.http.close(() => resolve());
    });
  }

  private async closeClients(): Promise<void> {
    const sockets = [...this.clients];
    if (sockets.length === 0) return;

    const allClosed = Promise.all(
      sockets.map(
        (ws) =>
          new Promise<void>((resolve) => {
            if (ws.readyState === WebSocket.CLOSED) return resolve();
            ws.once('close', () => resolve());
          }),
      ),
    );

    for (const ws of sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        const msg: ServerMessage = { t: 'session_closed', reason: 'server shutting down' };
        ws.send(JSON.stringify(msg));
      } catch {
        // Сокет мог начать закрываться между чтением readyState и отправкой —
        // ниже мы всё равно закроем/добьём его, сообщение тут необязательно.
      }
      ws.close(1001, 'server shutting down');
    }

    await Promise.race([
      allClosed,
      new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS)),
    ]);

    // Кто не закрылся штатно за отведённое время — добиваем: иначе
    // `http.close()` ниже зависнет на этом же сокете бесконечно.
    for (const ws of sockets) {
      if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    }
  }
}

function respond(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createArtubeServer(config: ArtubeServerConfig): ArtubeServer {
  return new ArtubeServer(config);
}
