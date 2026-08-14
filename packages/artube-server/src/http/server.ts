import { createServer, type Server } from 'node:http';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { GamesApiClient } from '../games-api/client.js';
import { startEngine, resolveEngineGameId, type EngineClient } from '../engine/index.js';
import { handleConnection } from './ws.js';
import { createAutocloseHandler } from './autoclose.js';
import { createLogger, type Logger } from './log.js';
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

/**
 * Совпадает ли путь запроса с маршрутом `/api/**` — точно или под ПРЕФИКСОМ.
 *
 * Бэкенд игры смонтирован платформой под `/api/<slug>` (снято с живого
 * стенда: `wss://dev.artube-888.live/api/artube-o7df8qem5k/api/ws` — внешнее
 * `api` принадлежит прокси, внутреннее наше). Сколько из этого reverse proxy
 * срежет, прежде чем отдать запрос нам, — её конфигурация, а не наш выбор, и
 * снаружи это не наблюдаемо. Варианта три, и все три приходят сюда разными
 * путями:
 *
 * ```
 * снимает всё      → /api/ws
 * не снимает       → /api/artube-o7df8qem5k/api/ws
 * снимает внешнее  → /artube-o7df8qem5k/api/ws
 * ```
 *
 * Совпадение по хвосту принимает все три. Жёсткое равенство пути превращало
 * бы два из трёх в молчаливый 404 на живом сервере, который локально проходит
 * все тесты, — а различить их заранее нечем.
 *
 * Границей служит ведущий `/` самого маршрута: `/xapi/version` маршрутом не
 * становится. Аутентификация от этого не слабеет — доступ к сессии даёт
 * `sessionId`, а не путь. Пробы Kubernetes (`/livez`, `/healthz`) специально
 * остаются точными: их платформа зовёт прямо в под, без прокси.
 */
function isApiRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.endsWith(route);
}

export class ArtubeServer {
  private http: Server | null = null;
  private wss: WebSocketServer | null = null;
  private api: GamesApiClient | null = null;
  private engine: EngineClient | null = null;
  private actualPort = 0;
  private closing = false;
  /** Защёлка от параллельных проходов по живым сессиям при реконнект-шторме. */
  private reinitialising = false;
  /** Коннект сменился, пока проход шёл: список надо обойти ещё раз, уже на новом. */
  private reinitPending = false;
  /**
   * Живые WS-соединения этого пода, по одному на сессию — `wss.close()` сам
   * их не закрывает, а второй коннект той же сессии вытесняет первый.
   *
   * Это не состояние раунда, а реестр живых соединений — ровно то же, чем был
   * `Set<WebSocket>` до этого. Ключ по `sessionId` схлопывает "две вкладки" в
   * "реконнект": один писатель на сессию в рамках пода, а поверх подов
   * настоящей защитой денег остаётся `round_version` платформы (мьютекс в
   * процессе обещал бы гарантию, которую не может дать между подами).
   */
  private readonly clients = new Map<string, WebSocket>();
  /**
   * Все принятые сокеты этого пода — реестр выключения, а не сессий.
   *
   * Отдельно от `clients`, потому что вытеснённый сокет из `clients` уходит
   * (там уже сидит новое соединение той же сессии), а закрывать при
   * выключении его всё равно надо: если его пир не отвечает на close-хендшейк,
   * `http.close()` будет ждать этот апгрейженный сокет до собственного
   * 30-секундного таймера `ws`.
   */
  private readonly sockets = new Set<WebSocket>();

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
    // Движку — его собственный id игры (из `.spin`), платформе — её `GameId`. См. resolveEngineGameId:
    // подстановка `GameId` в вызовы движка роняла старт на `unknown game "game1"`.
    const engineGameId = await resolveEngineGameId(this.engine, this.config.gameId, {
      onFallback: (engineId, platformId) =>
        log.info('engine game id differs from the platform GameId', {
          engine_game_id: engineId,
          platform_game_id: platformId,
        }),
    });
    const config = await this.engine.getConfig(engineGameId);
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
    this.api.on('goAway', (reason: string, retryAfterMs: number) =>
      log.warn('games api asked to go away', { reason, retry_after_ms: retryAfterMs }));
    // Переподключение — это НОВЫЙ коннект, и сессии на нём платформа считает
    // неинициализированными. Дока: «переподключиться и заново выполнить полную
    // последовательность подключения (Hello → Welcome → SessionInfoRequest →
    // SessionInfoResponse) ПЕРЕД продолжением работы с раундами». Игрок для
    // этого ничего делать не должен — проходим по живым сессиям сами.
    this.api.on('connected', () => void this.reinitSessions(log));
    // Брошенный раунд: события приходят на подовый коннект, не на конкретное
    // WS-соединение (того обычно уже нет) — подписка живёт здесь, один раз.
    // Обработчик создаём тоже один раз: он держит защёлку от параллельных
    // проходов по одному раунду (дубль события = вторая денежная RPC).
    const autoclose = createAutocloseHandler({
      api: this.api, engine: this.engine, gameId: engineGameId, costMultipliers, log,
    });
    this.api.on('autocloseRequest', (event: AutocloseRequestEvent) => void autoclose(event));

    this.http = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Пробы Kubernetes живут вне /api — так их конфигурирует платформа.
      if (url.pathname === '/livez') return respond(res, 200, { ok: true });
      if (url.pathname === '/healthz') {
        const ready = this.api?.connected === true;
        return respond(res, ready ? 200 : 503, { ok: ready });
      }
      if (isApiRoute(url.pathname, '/api/version')) {
        return respond(res, 200, {
          gameId: this.config.gameId,
          commit: process.env.GIT_HASH ?? 'dev',
        });
      }
      respond(res, 404, { error: 'not found' });
    });

    this.wss = new WebSocketServer({ noServer: true });
    this.http.on('upgrade', (req, socket, head) => {
      // Сырой сокет тоже EventEmitter: сетевая ошибка на нём до апгрейда
      // (RST в середине хендшейка) без подписчика на 'error' — то же
      // необработанное исключение, что и битый кадр после апгрейда.
      socket.on('error', () => {});
      // Выключение уже началось — новых игроков на закрывающийся под не пускаем.
      if (this.closing) return socket.destroy();
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!isApiRoute(url.pathname, '/api/ws')) return socket.destroy();
      const sessionId = url.searchParams.get('sessionId');
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        // Подписчик на 'error' обязан существовать с самого момента приёма
        // сокета: `ws` рапортует протокольный брак кадра ('MASK must be set'
        // на немаскированном кадре, например) именно событием 'error', а
        // EventEmitter без подписчика перебрасывает его наружу — под, где
        // сидят все остальные игроки, падает от одного кривого клиента.
        // Здесь молча: сессионный обработчик в handleConnection пишет лог,
        // а этот покрывает окно до него и путь без sessionId.
        ws.on('error', () => {});
        // В реестр выключения — сразу и независимо от сессии: любой принятый
        // сокет способен задержать `http.close()`.
        this.sockets.add(ws);
        ws.on('close', () => this.sockets.delete(ws));
        if (!sessionId) return ws.close(1008, 'sessionId is required');
        // Вторая вкладка (или реконнект, чей прежний сокет ещё жив) — это по
        // сути реконнект той же сессии: старое соединение получает честное
        // `session_closed` и закрывается, новое становится единственным.
        // Иначе два соединения одной сессии независимо двигали бы один раунд.
        const previous = this.clients.get(sessionId);
        if (previous && previous !== ws) {
          log.info('session superseded by a new connection', { session_id: sessionId });
          closeSocket(previous, 'superseded by a new connection');
        }
        this.clients.set(sessionId, ws);
        // Удаляем только своё: `close` вытесненного сокета приходит уже после
        // того, как в реестре лежит новый, и безусловный delete снёс бы его.
        ws.on('close', () => {
          if (this.clients.get(sessionId) === ws) this.clients.delete(sessionId);
        });
        void handleConnection(ws, sessionId, {
          api: this.api!,
          engine: this.engine!,
          gameId: engineGameId,
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

  /**
   * Заново инициализировать на свежем коннекте сессии, которые в этот момент
   * играют на поде.
   *
   * Без этого сессия становится рабочей только с ОШИБКИ: первое действие
   * игрока получает `SessionIsNotInitialized`, и лишь восстановление
   * (`withSessionRecovery`) чинит её повтором. Здесь мы делаем ровно то, что
   * дока предписывает делать после переподключения, — и до того, как игрок
   * что-нибудь нажмёт.
   *
   * Последовательно и молча к ошибкам: пачка SessionInfo в тот момент, когда
   * платформа только вернулась, — ровно та нагрузка, от которой она
   * защищается `BackPressureRejected`, а не успевший переинициализироваться
   * игрок всё равно доедет через `withSessionRecovery`.
   */
  private async reinitSessions(log: Logger): Promise<void> {
    // Реконнект-шторм не должен запускать несколько проходов сразу — но и
    // терять смену коннекта нельзя: проход, начатый на прежнем коннекте,
    // ничего не говорит о сессиях на новом.
    if (this.reinitialising) {
      this.reinitPending = true;
      return;
    }
    this.reinitialising = true;
    try {
      do {
        this.reinitPending = false;
        const sessions = [...this.clients.keys()];
        if (sessions.length === 0) continue;
        log.info('re-initialising live sessions on a fresh Games API connection', {
          sessions: sessions.length,
        });
        for (const sessionId of sessions) {
          // Игрок мог уйти, пока мы шли по списку.
          if (!this.clients.has(sessionId) || this.closing) continue;
          try {
            await this.api?.sessionInfo({ session_id: sessionId, player_connection_info: {} });
          } catch (err) {
            // Не фатально: следующий запрос игрока починит сессию через
            // withSessionRecovery. Логируем, чтобы это не осталось незаметным.
            log.warn('failed to re-initialise a session after reconnect', {
              session_id: sessionId, error: String(err),
            });
          }
        }
      } while (this.reinitPending && !this.closing);
    } finally {
      this.reinitialising = false;
    }
  }

  private async closeClients(): Promise<void> {
    const sockets = [...this.sockets];
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

    for (const ws of sockets) closeSocket(ws, 'server shutting down', 1001);

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

/** Честно попрощаться с игроком и закрыть сокет. */
function closeSocket(ws: WebSocket, reason: string, code = 1000): void {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      const msg: ServerMessage = { t: 'session_closed', reason };
      ws.send(JSON.stringify(msg));
    } catch {
      // Сокет мог начать закрываться между чтением readyState и отправкой —
      // вызывающий всё равно закроет/добьёт его, сообщение тут необязательно.
    }
  }
  ws.close(code, reason);
}

function respond(res: import('node:http').ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function createArtubeServer(config: ArtubeServerConfig): ArtubeServer {
  return new ArtubeServer(config);
}
