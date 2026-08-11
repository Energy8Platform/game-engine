import { createServer, type Server } from 'node:http';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { GamesApiClient } from '../games-api/client.js';
import { startEngine, type EngineClient } from '../engine/index.js';
import { handleConnection } from './ws.js';
import { createLogger } from './log.js';
import type { ArtubeServerConfig } from '../config.js';

export class ArtubeServer {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private api: GamesApiClient | null = null;
  private engine: EngineClient | null = null;
  private actualPort = 0;

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
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/api/ws') return socket.destroy();
      const sessionId = url.searchParams.get('sessionId');
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        if (!sessionId) return ws.close(1008, 'sessionId is required');
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
    this.api?.close();
    this.engine?.close();
    this.wss?.close();
    await new Promise<void>((resolve) => {
      if (!this.http) return resolve();
      this.http.close(() => resolve());
    });
  }
}

function respond(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createArtubeServer(config: ArtubeServerConfig): ArtubeServer {
  return new ArtubeServer(config);
}
