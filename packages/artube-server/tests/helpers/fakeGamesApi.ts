/**
 * Фейковый Games API на настоящем WebSocket-сервере: тесты клиента гоняются
 * через реальный транспорт, а не через мок `ws`. Поведение сервера задаётся
 * колбэком `onMessage`, чтобы каждый тест сценарий описывал сам.
 */
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

export interface FakeGamesApi {
  url: string;
  /** Все конверты, пришедшие от клиента, в порядке получения. */
  received: any[];
  /** Заголовки upgrade-запроса последнего соединения. */
  headers: Record<string, string | string[] | undefined>;
  /** Сколько раз клиент подключался (для проверки реконнекта). */
  connections: number;
  send(socket: WebSocket, envelope: unknown): void;
  /** Оборвать текущее соединение, эмулируя сетевой сбой. */
  drop(): void;
  /**
   * Прислать `GoAway` на текущее соединение — и НЕ закрывать его.
   *
   * Разделено с закрытием намеренно: дока требует, чтобы клиент дождался
   * закрытия со стороны сервера, а проверить это можно, только оставив
   * соединение открытым и посмотрев, не закроет ли его клиент сам.
   */
  goAway(payload: Record<string, unknown>): void;
  /** Закрыть текущее соединение — так, как это делает платформа вслед за GoAway. */
  closeCurrent(code?: number): void;
  /** Открыто ли соединение с клиентом прямо сейчас. */
  readonly open: boolean;
  close(): Promise<void>;
}

export interface FakeGamesApiOptions {
  /** Отвечать ли `Welcome` автоматически (по умолчанию да). */
  autoWelcome?: boolean;
  onMessage?: (env: any, socket: WebSocket, api: FakeGamesApi) => void;
}

/**
 * Слушаем РОВНО тот адрес, который потом набираем, — `127.0.0.1`, а не `::`.
 *
 * `{ port: 0 }` без хоста заставляет `ws` занять IPv6-wildcard, и это не
 * косметика: динамический порт ядро выдаёт с оглядкой на конфликты по ТОМУ
 * адресу, который просят. На `::` оно не видит чужих слушателей, сидящих на
 * `127.0.0.1` (у разработчика их десятки: хелперы редактора, language server,
 * докер), и спокойно отдаёт нам их порт. Слушатель при этом остаётся их —
 * при входящем соединении точное совпадение адреса выигрывает у wildcard,
 * поэтому `ws://127.0.0.1:<наш порт>` уходил ЧУЖОМУ серверу.
 *
 * Так выглядели все три наблюдавшихся мигания, и ни одно не говорило о
 * проверяемом поведении: `Server sent no subprotocol` (чужой сервер поднял
 * WS, но про наш сабпротокол не знает), `socket closed before the connection
 * settled` (поднял и закрыл) и `no connection to Games API` спустя ровно 5014
 * мс (не ответил вообще — дедлайн Hello).
 *
 * С `host: '127.0.0.1'` ядро проверяет конфликты по тому же адресу и занятый
 * порт просто не выдаёт, а более специфичный bind забирает loopback-трафик
 * себе, даже если кто-то потом займёт `0.0.0.0` на том же порту.
 */
export const TEST_HOST = '127.0.0.1';

export async function startFakeGamesApi(opts: FakeGamesApiOptions = {}): Promise<FakeGamesApi> {
  const wss = new WebSocketServer({
    port: 0,
    host: TEST_HOST,
    handleProtocols: () => 'json',
  });
  let current: WebSocket | null = null;

  const api: FakeGamesApi = {
    url: '',
    received: [],
    headers: {},
    connections: 0,
    send(socket, envelope) {
      socket.send(JSON.stringify(envelope));
    },
    drop() {
      current?.terminate();
    },
    goAway(payload) {
      if (!current) throw new Error('fake games api: клиент ещё не подключился');
      api.send(current, {
        proto: 1, schema: 1, chan: 'control', type: 'GoAway',
        id: `goaway-${api.connections}`, corr_id: null, op_seq: 99,
        timestamp: new Date().toISOString(),
        payload,
      });
    },
    closeCurrent(code = 1001) {
      current?.close(code, 'going away');
    },
    get open() {
      return current?.readyState === 1; // WebSocket.OPEN
    },
    close() {
      return new Promise((resolve) => wss.close(() => resolve()));
    },
  };

  wss.on('connection', (socket, req) => {
    current = socket;
    api.connections += 1;
    api.headers = req.headers as Record<string, string | string[] | undefined>;
    if (opts.autoWelcome !== false) {
      api.send(socket, {
        proto: 1, schema: 1, chan: 'control', type: 'Welcome',
        id: 'welcome-1', corr_id: null, op_seq: 1,
        timestamp: new Date().toISOString(),
        payload: { use: { max_schema: 1 } },
      });
    }
    socket.on('message', (data) => {
      const env = JSON.parse(data.toString());
      api.received.push(env);
      opts.onMessage?.(env, socket, api);
    });
  });

  await new Promise<void>((resolve) => wss.on('listening', () => resolve()));
  const { port } = wss.address() as AddressInfo;
  api.url = `ws://${TEST_HOST}:${port}/v1/ws`;
  return api;
}
