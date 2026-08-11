# Artube Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать играм на `@energy8platform/game-sdk` работать на платформе Artube — бэкенд `@energy8platform/artube-server` говорит с Artube Games API, фронтовый мост `@energy8platform/artube-bridge` переводит это в протокол SDK, код игры не меняется.

**Architecture:** Бэкенд stateless: состояние раунда живёт в `round_state` на стороне Artube как тройка сидов + курсор + лог действий. Каждый сегмент — один шаг SpinML-движка `e8-server` (gRPC); открытый раунд в движке это кэш, и при его потере раунд поднимается из `round_state` детерминированно. Один сегмент → `PlayRound`; несколько → `OpenRound` → `UpdateRoundState`* → `CloseRound`. Фронтовый мост — зеркало `stake-bridge`: WS к `/api/ws`, `MemoryChannel` в `CasinoGameSDK`, per-game адаптера нет.

**Tech Stack:** TypeScript (ESM, strict), Node ≥ 20, `ws`, `@grpc/grpc-js` + `@grpc/proto-loader`, Vitest 2, Rollup (только для фронтового пакета), нативный бинарь `e8-server` из `platform-core/bin`.

**Спека:** [`docs/superpowers/specs/2026-08-10-artube-bridge-design.md`](../specs/2026-08-10-artube-bridge-design.md)

## Global Constraints

- **Деньги не считаем нигде.** Наружу уходят только `bet_index`, `price_multiplier` (1 обычный / >1 buy-bonus / 0 фри-раунд) и `win_multiplier`. Баланс всегда берём из ответа Games API. Ни одна функция в `artube-server` не умножает ставку на множитель ради денег.
- **Бэкенд stateless.** Никаких `Map`/кэшей, переживающих запрос, кроме WS-коннекта к Games API. Состояние раунда — только в `round_state`.
- **Конверт:** `proto: 1`, `schema: 1`, `id` — GUID v7, `timestamp` — ISO 8601 UTC, `op_seq` монотонно растёт в рамках коннекта, `corr_id` в ответе равен `id` запроса. Максимальный размер сообщения — 128 KB. WebSocket subprotocol — `json`.
- **Ретраи только идемпотентного:** `SessionInfoRequest`, `UpdateRoundStateRequest`. `PlayRoundRequest`, `OpenRoundRequest`, `CloseRoundRequest`, `AutocloseRoundRequest` — **никогда**.
- **Деплой-контракт Artube:** весь HTTP под префиксом `/api`, порт по умолчанию 80, эндпоинты `/livez` и `/healthz`, логи — структурированный JSON, одна строка на запись.
- **Тесты гонять только через workspace:** `npm test --workspace @energy8platform/artube-server`. Рутовый `npx vitest run <path>` даёт ложные падения из-за конфигурации воркспейсов.
- **TypeScript strict** — оба пакета наследуют `tsconfig.base.json` из корня.

## File Structure

**`packages/artube-server/`** — Node-сервис, сборка через `tsc` (не Rollup: серверный код не бандлим).

| Файл | Ответственность |
|---|---|
| `src/games-api/envelope.ts` | кодек конверта: сборка, парсинг, валидация, `op_seq` |
| `src/games-api/types.ts` | типы 6 запросов, 4 событий, `Error`-payload |
| `src/games-api/errors.ts` | `GamesApiError`, классификация кодов, политика ретраев |
| `src/games-api/client.ts` | `GamesApiClient`: коннект, Hello/Welcome/GoAway, реконнект, RPC, события |
| `src/engine/proto.ts` | копия `engine.proto` + загрузчик gRPC-клиента |
| `src/engine/spawn.ts` | поиск бинаря `e8-server`, спавн, ожидание готовности |
| `src/engine/client.ts` | `EngineClient`: `ListGames` / `StartRound` / `Step` / `GetRound` |
| `src/round/roundState.ts` | кодек `round_state`: сериализация, парсинг, версия, лимит размера |
| `src/round/engineRound.ts` | раунд в движке: `openEntry` / `ensureOpen` / `stepRound` / `playToEnd` |
| `src/round/orchestrator.ts` | `playSegment` / `resumeRound` / `autocloseRound` — чистые функции |
| `src/session/types.ts` | `SessionContext`, `PlayRequest`, `PlayResult` — контракт фронт↔бэк |
| `src/http/log.ts` | JSON-логгер, одна строка на запись |
| `src/http/server.ts` | HTTP + WS сервер, роутинг `/api`, `/livez`, `/healthz` |
| `src/http/ws.ts` | WS-хендлер: `play` / `ack` → оркестратор → `init` / `result` / `balance` |
| `src/config.ts` | чтение env, валидация конфига |
| `src/index.ts` | `createArtubeServer` |
| `bin/artube-server.ts` | CLI, включая режим `--sandbox` |
| `Dockerfile.template` | шаблон для серверного репозитория игры |
| `tests/fixtures/feature.spin` | детерминированная игра: `spin` + 3 фриспина по 1.0 |

**`packages/artube-bridge/`** — фронт, сборка Rollup (ESM + UMD + `.d.ts`), как у `stake-bridge`.

| Файл | Ответственность |
|---|---|
| `src/detect.ts` | `isArtubeLaunch` — лист-модуль без импортов моста |
| `src/types.ts` | `ArtubeBridgeOptions`, типы сообщений `/api/ws` |
| `src/client.ts` | `ArtubeClient`: WS к бэкенду, реконнект, парность `id` |
| `src/demo.ts` | виртуальный баланс демо-режима |
| `src/bridge.ts` | `ArtubeBridge`: перевод в `game-sdk` |
| `src/index.ts` | публичные экспорты |

---

### Task 1: Скаффолд `artube-server` и кодек конверта

**Files:**
- Create: `packages/artube-server/package.json`
- Create: `packages/artube-server/tsconfig.json`
- Create: `packages/artube-server/vitest.config.ts`
- Create: `packages/artube-server/src/games-api/envelope.ts`
- Test: `packages/artube-server/tests/envelope.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `type Channel = 'rpc' | 'events' | 'control'`; `interface Envelope<P = unknown> { proto: 1; schema: 1; chan: Channel; type: string; id: string; corr_id?: string | null; op_seq: number; timestamp: string; trace?: Record<string, string>; payload: P }`; `class OpSeq { next(): number; reset(): void }`; `function newMessageId(): string`; `function buildEnvelope<P>(chan: Channel, type: string, payload: P, opSeq: number, corrId?: string): Envelope<P>`; `function parseEnvelope(raw: string | Buffer): Envelope`; `class EnvelopeError extends Error { readonly reason: string }`; `const MAX_MESSAGE_BYTES = 128 * 1024`.

- [ ] **Step 1: Создать скаффолд пакета**

`packages/artube-server/package.json`:

```json
{
  "name": "@energy8platform/artube-server",
  "version": "0.1.0",
  "description": "Game backend that runs an @energy8platform/game-sdk slot on the Artube platform",
  "author": "Energy8 Platform",
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "bin": { "artube-server": "dist/bin/artube-server.js" },
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" },
    "./games-api": { "import": "./dist/games-api/index.js", "types": "./dist/games-api/index.d.ts" },
    "./engine": { "import": "./dist/engine/index.js", "types": "./dist/engine/index.d.ts" }
  },
  "files": ["dist", "Dockerfile.template", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run clean && npm run build"
  },
  "engines": { "node": ">=20" },
  "dependencies": {
    "@grpc/grpc-js": "^1.12.0",
    "@grpc/proto-loader": "^0.7.13",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.13",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "keywords": ["casino", "artube", "games-api", "slot", "backend"],
  "repository": {
    "type": "git",
    "url": "https://github.com/energy8platform/game-engine.git",
    "directory": "packages/artube-server"
  }
}
```

`packages/artube-server/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext"
  },
  "include": ["src", "bin"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

`packages/artube-server/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 2: Написать падающий тест**

`packages/artube-server/tests/envelope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildEnvelope,
  parseEnvelope,
  newMessageId,
  OpSeq,
  EnvelopeError,
  MAX_MESSAGE_BYTES,
} from '../src/games-api/envelope';

describe('envelope', () => {
  it('строит конверт с обязательными полями', () => {
    const env = buildEnvelope('rpc', 'SessionInfoRequest', { session_id: 's1' }, 2);
    expect(env.proto).toBe(1);
    expect(env.schema).toBe(1);
    expect(env.chan).toBe('rpc');
    expect(env.type).toBe('SessionInfoRequest');
    expect(env.op_seq).toBe(2);
    expect(env.payload).toEqual({ session_id: 's1' });
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(env.corr_id).toBeNull();
  });

  it('проставляет corr_id, когда он передан', () => {
    const env = buildEnvelope('rpc', 'X', {}, 1, 'req-1');
    expect(env.corr_id).toBe('req-1');
  });

  it('генерирует уникальные id в формате GUID', () => {
    const a = newMessageId();
    const b = newMessageId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });

  it('op_seq растёт монотонно и сбрасывается', () => {
    const seq = new OpSeq();
    expect(seq.next()).toBe(1);
    expect(seq.next()).toBe(2);
    seq.reset();
    expect(seq.next()).toBe(1);
  });

  it('парсит валидный конверт', () => {
    const raw = JSON.stringify(buildEnvelope('events', 'BalanceChangedEvent', { balance: 10 }, 5));
    const env = parseEnvelope(raw);
    expect(env.type).toBe('BalanceChangedEvent');
    expect(env.payload).toEqual({ balance: 10 });
  });

  it('отвергает битый JSON', () => {
    expect(() => parseEnvelope('{oops')).toThrow(EnvelopeError);
  });

  it('отвергает конверт без обязательных полей', () => {
    expect(() => parseEnvelope(JSON.stringify({ proto: 1, chan: 'rpc' }))).toThrow(/type/);
  });

  it('отвергает неизвестный канал', () => {
    const bad = { ...buildEnvelope('rpc', 'X', {}, 1), chan: 'weird' };
    expect(() => parseEnvelope(JSON.stringify(bad))).toThrow(/chan/);
  });

  it('отвергает сообщение больше 128 KB', () => {
    const huge = JSON.stringify(buildEnvelope('rpc', 'X', { blob: 'x'.repeat(MAX_MESSAGE_BYTES) }, 1));
    expect(() => parseEnvelope(huge)).toThrow(/too large/);
  });
});
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: FAIL — `Cannot find module '../src/games-api/envelope'`

- [ ] **Step 4: Реализовать кодек**

`packages/artube-server/src/games-api/envelope.ts`:

```ts
/**
 * Кодек конверта Artube Games API.
 *
 * Все сообщения — и наши запросы, и ответы/события платформы — упакованы в
 * один и тот же конверт с метаданными версионирования, трейсинга и
 * упорядочивания. Модуль намеренно не знает ни про WebSocket, ни про
 * конкретные контракты: он только собирает и разбирает оболочку.
 */

import { randomUUID } from 'node:crypto';

export type Channel = 'rpc' | 'events' | 'control';

export interface Envelope<P = unknown> {
  proto: 1;
  schema: 1;
  chan: Channel;
  type: string;
  id: string;
  corr_id?: string | null;
  op_seq: number;
  timestamp: string;
  trace?: Record<string, string>;
  payload: P;
}

/** Лимит из доки: WebSocket-сообщение не может быть больше 128 KB. */
export const MAX_MESSAGE_BYTES = 128 * 1024;

export class EnvelopeError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'EnvelopeError';
  }
}

/**
 * Порядковый номер операции. Дока требует монотонного роста в рамках
 * соединения, поэтому счётчик живёт ровно столько же, сколько коннект, и
 * сбрасывается при переподключении.
 */
export class OpSeq {
  private value = 0;

  next(): number {
    this.value += 1;
    return this.value;
  }

  reset(): void {
    this.value = 0;
  }
}

/**
 * GUID v7 — монотонный по времени, как требует дока. `randomUUID` даёт v4,
 * поэтому переписываем метку времени и версию вручную.
 */
export function newMessageId(): string {
  const hex = randomUUID().replace(/-/g, '');
  const ts = Date.now().toString(16).padStart(12, '0');
  const rest = hex.slice(12);
  const v7 = ts + '7' + rest.slice(1);
  return [
    v7.slice(0, 8),
    v7.slice(8, 12),
    v7.slice(12, 16),
    v7.slice(16, 20),
    v7.slice(20, 32),
  ].join('-');
}

export function buildEnvelope<P>(
  chan: Channel,
  type: string,
  payload: P,
  opSeq: number,
  corrId?: string,
): Envelope<P> {
  return {
    proto: 1,
    schema: 1,
    chan,
    type,
    id: newMessageId(),
    corr_id: corrId ?? null,
    op_seq: opSeq,
    timestamp: new Date().toISOString(),
    payload,
  };
}

const CHANNELS = new Set<string>(['rpc', 'events', 'control']);

export function parseEnvelope(raw: string | Buffer): Envelope {
  const text = typeof raw === 'string' ? raw : raw.toString('utf8');
  if (Buffer.byteLength(text, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new EnvelopeError(`message too large: ${Buffer.byteLength(text, 'utf8')} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new EnvelopeError('invalid json');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new EnvelopeError('envelope must be an object');
  }
  const env = parsed as Partial<Envelope>;
  if (typeof env.type !== 'string' || env.type === '') {
    throw new EnvelopeError('missing type');
  }
  if (typeof env.chan !== 'string' || !CHANNELS.has(env.chan)) {
    throw new EnvelopeError(`unknown chan: ${String(env.chan)}`);
  }
  if (typeof env.id !== 'string' || env.id === '') {
    throw new EnvelopeError('missing id');
  }
  if (env.payload === undefined || env.payload === null) {
    throw new EnvelopeError('missing payload');
  }
  return env as Envelope;
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: PASS, 9 тестов

- [ ] **Step 6: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): скаффолд пакета и кодек конверта Games API"
```

---

### Task 2: Коннект к Games API — Hello / Welcome / GoAway / реконнект

**Files:**
- Create: `packages/artube-server/src/games-api/types.ts`
- Create: `packages/artube-server/src/games-api/client.ts`
- Create: `packages/artube-server/tests/helpers/fakeGamesApi.ts`
- Test: `packages/artube-server/tests/client-connect.test.ts`

**Interfaces:**
- Consumes: из Task 1 — `Envelope`, `OpSeq`, `buildEnvelope`, `parseEnvelope`, `newMessageId`.
- Produces: `interface GamesApiClientOptions { url: string; apiKey: string; gameId: string; helloTimeoutMs?: number; rpcTimeoutMs?: number; maxReconnectAttempts?: number; baseReconnectDelayMs?: number; debug?: boolean }`; `class GamesApiClient { readonly connected: boolean; connect(): Promise<void>; close(): void; on(event, cb): void; off(event, cb): void }` с событиями `'connected' | 'disconnected' | 'goAway'`; `const ANNOUNCED_CONTRACTS: string[]`; тестовый хелпер `startFakeGamesApi(opts): Promise<FakeGamesApi>`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-server/tests/helpers/fakeGamesApi.ts`:

```ts
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
  close(): Promise<void>;
}

export interface FakeGamesApiOptions {
  /** Отвечать ли `Welcome` автоматически (по умолчанию да). */
  autoWelcome?: boolean;
  onMessage?: (env: any, socket: WebSocket, api: FakeGamesApi) => void;
}

export async function startFakeGamesApi(opts: FakeGamesApiOptions = {}): Promise<FakeGamesApi> {
  const wss = new WebSocketServer({ port: 0, handleProtocols: () => 'json' });
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
  api.url = `ws://127.0.0.1:${port}/v1/ws`;
  return api;
}
```

`packages/artube-server/tests/client-connect.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { GamesApiClient, ANNOUNCED_CONTRACTS } from '../src/games-api/client';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

let api: FakeGamesApi;
let client: GamesApiClient;

afterEach(async () => {
  client?.close();
  await api?.close();
});

describe('GamesApiClient — соединение', () => {
  it('шлёт аутентификационные заголовки', async () => {
    api = await startFakeGamesApi();
    client = new GamesApiClient({ url: api.url, apiKey: 'key-1', gameId: 'my-game' });
    await client.connect();
    expect(api.headers['x-api-key']).toBe('key-1');
    expect(api.headers['x-game-id']).toBe('my-game');
  });

  it('шлёт Hello и анонсирует все контракты, которые может прислать API', async () => {
    api = await startFakeGamesApi();
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const hello = api.received.find((e) => e.type === 'Hello');
    expect(hello.chan).toBe('control');
    expect(hello.payload.supports.max_schema).toBe(1);
    // не только Request-типы: Response, Error и события тоже
    expect(hello.payload.supports.contracts).toEqual(ANNOUNCED_CONTRACTS);
    expect(hello.payload.supports.contracts).toContain('SessionInfoResponse');
    expect(hello.payload.supports.contracts).toContain('Error');
    expect(hello.payload.supports.contracts).toContain('BalanceChangedEvent');
  });

  it('считает коннект установленным по Welcome', async () => {
    api = await startFakeGamesApi();
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    expect(client.connected).toBe(false);
    await client.connect();
    expect(client.connected).toBe(true);
  });

  it('поднимается и без Welcome — по дедлайну в 5 секунд', async () => {
    api = await startFakeGamesApi({ autoWelcome: false });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g', helloTimeoutMs: 50 });
    await client.connect();
    expect(client.connected).toBe(true);
  });

  it('переподключается после обрыва и сбрасывает op_seq', async () => {
    api = await startFakeGamesApi();
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g', baseReconnectDelayMs: 10,
    });
    await client.connect();
    const reconnected = new Promise<void>((resolve) => client.on('connected', () => resolve()));
    api.drop();
    await reconnected;
    expect(api.connections).toBe(2);
    const hellos = api.received.filter((e) => e.type === 'Hello');
    expect(hellos).toHaveLength(2);
    expect(hellos[1].op_seq).toBe(1); // счётчик обнулился вместе с коннектом
  });

  it('на GoAway не переподключается', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'Hello') return;
        self.send(socket, {
          proto: 1, schema: 1, chan: 'control', type: 'GoAway',
          id: 'goaway-1', corr_id: null, op_seq: 2,
          timestamp: new Date().toISOString(),
          payload: { reason: 'shutdown' },
        });
        setTimeout(() => socket.close(), 10);
      },
    });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g', baseReconnectDelayMs: 10,
    });
    const goAway = new Promise<string>((resolve) => client.on('goAway', (r: string) => resolve(r)));
    await client.connect();
    expect(await goAway).toBe('shutdown');
    await new Promise((r) => setTimeout(r, 100));
    expect(api.connections).toBe(1);
    expect(client.connected).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- client-connect`
Expected: FAIL — `Cannot find module '../src/games-api/client'`

- [ ] **Step 3: Реализовать типы контрактов**

`packages/artube-server/src/games-api/types.ts`:

```ts
/** Типы контрактов Artube Games API. Имена полей — snake_case, как на проводе. */

export interface PlayerConnectionInfo {
  ip_address?: string;
  user_agent?: string;
  player_connection_id?: string;
}

export interface Feature {
  type: string;
  description?: string;
}

export interface SessionInfoRequest {
  session_id: string;
  player_connection_info: PlayerConnectionInfo;
}

export interface LastRound {
  round_id: string;
  price_multiplier: number;
  bet_index: number;
  win_multiplier: number;
  win: number;
  free_round_campaign_id?: string | null;
  started_at: string;
  finished_at?: string | null;
  round_version: number;
  round_state_version: string;
  round_state: string;
  is_platform_max_win_reached: boolean;
  chain_id?: string | null;
}

export interface PlatformMaxWin {
  is_visible: boolean;
  base_currency: string;
  base_currency_value: number;
  player_currency_value: number;
}

export interface GameSettings {
  default_bet_index: number;
  currency_minimal_unit: number;
  allowed_bets: number[];
  available_auto_spin_counts: number[];
  rtp_options: Array<{ is_visible: boolean; rtp: number; game_mode: string; volatility?: string }>;
  rtp_settings: { is_visible: boolean; shown_rtp?: number };
  locales: string[];
  platform_max_win?: PlatformMaxWin | null;
}

export interface FreeRoundCampaign {
  campaign_id: string;
  rounds_total: number;
  rounds_left: number;
  valid_from: string;
  valid_to: string;
  bet: number;
  total_win: number;
  is_complete: boolean;
}

export interface SessionInfoResponse {
  security_hash: string;
  /** `null` означает демо-сессию — раундовые RPC для неё запрещены. */
  currency: string | null;
  balance: number;
  gamification_token?: string;
  last_round?: LastRound | null;
  game_settings: GameSettings;
  free_round_campaign?: FreeRoundCampaign | null;
  history?: Array<{ win: number; possible_win: number; is_own: boolean }>;
}

export interface PlayRoundRequest {
  session_id: string;
  price_multiplier: number;
  bet_index: number;
  win_multiplier: number;
  free_round_campaign_id?: string;
  features?: Feature[];
  previous_round_id?: string;
  round_state_version: string;
  round_state: string;
}

export interface CampaignProgress {
  rounds_left: number;
  total_win: number;
  is_complete: boolean;
}

export interface PlayRoundResponse {
  round_id: string;
  balance: number;
  win: number;
  free_round_campaign?: CampaignProgress | null;
  is_platform_max_win_reached: boolean;
}

export interface OpenRoundRequest {
  session_id: string;
  price_multiplier: number;
  bet_index: number;
  free_round_campaign_id?: string;
  features?: Feature[];
  round_state_version: string;
  round_state: string;
}

export interface OpenRoundResponse {
  round_version: number;
  round_id: string;
  balance: number;
}

export interface UpdateRoundStateRequest {
  session_id: string;
  round_id: string;
  round_version: number;
  round_state_version: string;
  round_state: string;
}

export interface UpdateRoundStateResponse {
  round_version: number;
}

export interface CloseRoundRequest {
  session_id: string;
  round_id: string;
  win_multiplier: number;
  status: 'completed' | 'cancelled';
  features?: Feature[];
  round_version: number;
  round_state_version: string;
  round_state: string;
}

export interface CloseRoundResponse {
  balance: number;
  free_round_campaign?: CampaignProgress | null;
}

/** Тело то же, что у CloseRound; ответ — только баланс. */
export type AutocloseRoundRequest = CloseRoundRequest;

export interface BalanceChangedEvent {
  session_id: string;
  balance: number;
  reason: string;
}

export interface SessionClosedEvent {
  session_id: string;
  reason?: string;
}

export interface NewConnectionEvent {
  session_id: string;
  new_connection_id: string;
}

export interface AutocloseRequestEvent {
  session_id: string;
  round_id: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: { retry_after_ms?: number; [key: string]: unknown };
}
```

- [ ] **Step 4: Реализовать коннект-часть клиента**

`packages/artube-server/src/games-api/client.ts`:

```ts
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
} from './envelope';

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
          if (env.type === 'Welcome') return finish();
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
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server -- client-connect`
Expected: PASS, 6 тестов

- [ ] **Step 6: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): коннект к Games API — Hello/Welcome/GoAway и реконнект"
```

---

### Task 3: RPC-слой — парность `corr_id`, таймауты, ошибки и ретраи

**Files:**
- Create: `packages/artube-server/src/games-api/errors.ts`
- Modify: `packages/artube-server/src/games-api/client.ts` (добавить RPC поверх коннекта из Task 2)
- Test: `packages/artube-server/tests/client-rpc.test.ts`

**Interfaces:**
- Consumes: из Task 2 — `GamesApiClient`, `ANNOUNCED_CONTRACTS`; из Task 1 — `Envelope`.
- Produces: `class GamesApiError extends Error { readonly code: string; readonly details?: Record<string, unknown>; readonly retryAfterMs?: number }`; `function isRetryable(code: string): boolean`; `const IDEMPOTENT_TYPES: ReadonlySet<string>`; метод `GamesApiClient.rpc<TReq, TRes>(type: string, payload: TReq): Promise<TRes>`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-server/tests/client-rpc.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { GamesApiClient } from '../src/games-api/client';
import { GamesApiError } from '../src/games-api/errors';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

let api: FakeGamesApi;
let client: GamesApiClient;

/** Ответить на RPC-запрос конвертом с corr_id, равным id запроса. */
function respond(self: FakeGamesApi, socket: any, req: any, type: string, payload: unknown) {
  self.send(socket, {
    proto: 1, schema: 1, chan: 'rpc', type,
    id: `res-${req.id}`, corr_id: req.id, op_seq: req.op_seq,
    timestamp: new Date().toISOString(), payload,
  });
}

afterEach(async () => {
  client?.close();
  await api?.close();
});

describe('GamesApiClient — RPC', () => {
  it('парит ответ с запросом по corr_id', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type === 'SessionInfoRequest') {
          respond(self, socket, env, 'SessionInfoResponse', { balance: 42, currency: 'USD' });
        }
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.rpc<unknown, { balance: number }>('SessionInfoRequest', { session_id: 's' });
    expect(res.balance).toBe(42);
  });

  it('не путает параллельные запросы', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'SessionInfoRequest') return;
        const delay = env.payload.session_id === 'slow' ? 60 : 5;
        setTimeout(
          () => respond(self, socket, env, 'SessionInfoResponse', { who: env.payload.session_id }),
          delay,
        );
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const [slow, fast] = await Promise.all([
      client.rpc<unknown, { who: string }>('SessionInfoRequest', { session_id: 'slow' }),
      client.rpc<unknown, { who: string }>('SessionInfoRequest', { session_id: 'fast' }),
    ]);
    expect(slow.who).toBe('slow');
    expect(fast.who).toBe('fast');
  });

  it('конверт Error превращается в GamesApiError с кодом', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type === 'PlayRoundRequest') {
          respond(self, socket, env, 'Error', {
            code: 'InsufficientFunds', message: 'no money', details: {},
          });
        }
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    await expect(client.rpc('PlayRoundRequest', {})).rejects.toMatchObject({
      name: 'GamesApiError',
      code: 'InsufficientFunds',
    });
  });

  it('ретраит BackPressureRejected по retry_after_ms и отдаёт результат', async () => {
    let attempts = 0;
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'UpdateRoundStateRequest') return;
        attempts += 1;
        if (attempts === 1) {
          respond(self, socket, env, 'Error', {
            code: 'BackPressureRejected', message: 'slow down', details: { retry_after_ms: 10 },
          });
        } else {
          respond(self, socket, env, 'UpdateRoundStateResponse', { round_version: 3 });
        }
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.rpc<unknown, { round_version: number }>('UpdateRoundStateRequest', {});
    expect(attempts).toBe(2);
    expect(res.round_version).toBe(3);
  });

  it('НИКОГДА не ретраит денежные запросы', async () => {
    let attempts = 0;
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'PlayRoundRequest') return;
        attempts += 1;
        respond(self, socket, env, 'Error', {
          code: 'BackPressureRejected', message: 'slow down', details: { retry_after_ms: 5 },
        });
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    await expect(client.rpc('PlayRoundRequest', {})).rejects.toBeInstanceOf(GamesApiError);
    expect(attempts).toBe(1);
  });

  it('падает по таймауту, если ответа нет', async () => {
    api = await startFakeGamesApi({ onMessage: () => {} });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g', rpcTimeoutMs: 30 });
    await client.connect();
    await expect(client.rpc('SessionInfoRequest', {})).rejects.toMatchObject({
      code: 'InternalServerError',
    });
  });

  it('без коннекта падает сразу, а не копит запросы', async () => {
    api = await startFakeGamesApi();
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await expect(client.rpc('SessionInfoRequest', {})).rejects.toMatchObject({
      code: 'InternalServerError',
    });
  });

  it('обрыв коннекта отбивает висящие запросы', async () => {
    api = await startFakeGamesApi({ onMessage: () => {} });
    client = new GamesApiClient({
      url: api.url, apiKey: 'k', gameId: 'g', rpcTimeoutMs: 5000, baseReconnectDelayMs: 10,
    });
    await client.connect();
    const pending = client.rpc('SessionInfoRequest', {});
    api.drop();
    await expect(pending).rejects.toMatchObject({ code: 'InternalServerError' });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- client-rpc`
Expected: FAIL — `client.rpc is not a function`

- [ ] **Step 3: Реализовать классификацию ошибок**

`packages/artube-server/src/games-api/errors.ts`:

```ts
/**
 * Ошибки Artube Games API и политика ретраев.
 *
 * Ретраим только идемпотентное. `PlayRound` / `OpenRound` / `CloseRound` /
 * `AutocloseRound` — деньги: повтор может списать ставку дважды, поэтому они
 * не ретраятся ни при каком коде.
 */

import type { ErrorPayload } from './types';

export class GamesApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(payload: ErrorPayload) {
    super(payload.message || payload.code);
    this.name = 'GamesApiError';
    this.code = payload.code;
    this.details = payload.details;
  }

  /** Задержка перед повтором, если платформа её продиктовала. */
  get retryAfterMs(): number | undefined {
    const value = this.details?.retry_after_ms;
    return typeof value === 'number' ? value : undefined;
  }

  static internal(message: string): GamesApiError {
    return new GamesApiError({ code: 'InternalServerError', message });
  }
}

/** Типы запросов, которые можно безопасно повторить. */
export const IDEMPOTENT_TYPES: ReadonlySet<string> = new Set([
  'SessionInfoRequest',
  'UpdateRoundStateRequest',
]);

/**
 * Коды, при которых повтор имеет смысл. Для всего остального дока прямо
 * говорит: повторный запрос не поможет, нужна диагностика.
 */
export function isRetryable(code: string): boolean {
  return code === 'BackPressureRejected' || code === 'InternalServerError';
}
```

- [ ] **Step 4: Добавить RPC в клиент**

В `packages/artube-server/src/games-api/client.ts` добавить импорты и реализацию.

Импорты сверху файла:

```ts
import { GamesApiError, IDEMPOTENT_TYPES, isRetryable } from './errors';
import type { ErrorPayload } from './types';
```

Поле рядом с `protected socket`:

```ts
  /** Ожидающие ответа RPC, ключ — id запроса (он же corr_id ответа). */
  private readonly pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
```

Заменить пустые точки расширения на рабочие и добавить `rpc`:

```ts
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

  protected override onEnvelope(env: Envelope): void {
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

  /** Точка расширения для событий канала `events` (Task 4). */
  protected onEvent(_env: Envelope): void {}

  protected override onDisconnected(reason: string): void {
    for (const [, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(GamesApiError.internal(reason));
    }
    this.pending.clear();
  }
```

Убрать из Task 2 пустые заглушки `onEnvelope` / `onDisconnected` — их заменили рабочие версии выше. Так как теперь `onEnvelope` не абстрактная точка расширения, а реализация, слово `override` в подклассе Task 4 применяется к `onEvent`.

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: PASS — все тесты Task 1–3 (23 теста)

- [ ] **Step 6: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): RPC-слой Games API — corr_id, таймауты, ретраи идемпотентного"
```

---

### Task 4: Типизированные методы контрактов и события

**Files:**
- Modify: `packages/artube-server/src/games-api/client.ts`
- Create: `packages/artube-server/src/games-api/index.ts`
- Test: `packages/artube-server/tests/client-contracts.test.ts`

**Interfaces:**
- Consumes: из Task 3 — `GamesApiClient.rpc`, `GamesApiError`; из Task 2 — типы контрактов.
- Produces: методы `sessionInfo(req: SessionInfoRequest): Promise<SessionInfoResponse>`, `playRound(req: PlayRoundRequest): Promise<PlayRoundResponse>`, `openRound(req: OpenRoundRequest): Promise<OpenRoundResponse>`, `updateRoundState(req: UpdateRoundStateRequest): Promise<UpdateRoundStateResponse>`, `closeRound(req: CloseRoundRequest): Promise<CloseRoundResponse>`, `autocloseRound(req: AutocloseRoundRequest): Promise<CloseRoundResponse>`; события `on('balanceChanged' | 'sessionClosed' | 'newConnection' | 'autocloseRequest', cb)`; ре-экспорт всего из `@energy8platform/artube-server/games-api`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-server/tests/client-contracts.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { GamesApiClient } from '../src/games-api/client';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

let api: FakeGamesApi;
let client: GamesApiClient;

afterEach(async () => {
  client?.close();
  await api?.close();
});

function autoRespond(map: Record<string, unknown>) {
  return (env: any, socket: any, self: FakeGamesApi) => {
    const type = env.type.replace(/Request$/, 'Response');
    if (map[env.type] === undefined) return;
    self.send(socket, {
      proto: 1, schema: 1, chan: 'rpc', type,
      id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
      timestamp: new Date().toISOString(), payload: map[env.type],
    });
  };
}

describe('GamesApiClient — контракты', () => {
  it('sessionInfo отдаёт типизированный ответ', async () => {
    api = await startFakeGamesApi({
      onMessage: autoRespond({
        SessionInfoRequest: {
          security_hash: 'h', currency: 'USD', balance: 100,
          game_settings: {
            default_bet_index: 1, currency_minimal_unit: 0.01,
            allowed_bets: [0.1, 1, 5], available_auto_spin_counts: [10],
            rtp_options: [], rtp_settings: { is_visible: false }, locales: ['EN'],
          },
        },
      }),
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.sessionInfo({
      session_id: 's1', player_connection_info: { ip_address: '1.2.3.4' },
    });
    expect(res.currency).toBe('USD');
    expect(res.game_settings.allowed_bets).toEqual([0.1, 1, 5]);
    expect(api.received.find((e) => e.type === 'SessionInfoRequest').chan).toBe('rpc');
  });

  it('playRound шлёт индекс ставки и множители, но не суммы', async () => {
    api = await startFakeGamesApi({
      onMessage: autoRespond({
        PlayRoundRequest: {
          round_id: 'r1', balance: 105, win: 5, is_platform_max_win_reached: false,
        },
      }),
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.playRound({
      session_id: 's1', price_multiplier: 1, bet_index: 2, win_multiplier: 5,
      round_state_version: '1', round_state: '{}',
    });
    expect(res.round_id).toBe('r1');
    const sent = api.received.find((e) => e.type === 'PlayRoundRequest').payload;
    expect(sent.bet_index).toBe(2);
    expect(sent.price_multiplier).toBe(1);
    expect(sent).not.toHaveProperty('bet_amount');
    expect(sent).not.toHaveProperty('win');
  });

  it('openRound / updateRoundState / closeRound везут round_version', async () => {
    api = await startFakeGamesApi({
      onMessage: autoRespond({
        OpenRoundRequest: { round_version: 0, round_id: 'r9', balance: 90 },
        UpdateRoundStateRequest: { round_version: 1 },
        CloseRoundRequest: { balance: 120 },
      }),
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const open = await client.openRound({
      session_id: 's', price_multiplier: 1, bet_index: 0,
      round_state_version: '1', round_state: '{}',
    });
    expect(open.round_version).toBe(0);
    const upd = await client.updateRoundState({
      session_id: 's', round_id: open.round_id, round_version: open.round_version,
      round_state_version: '1', round_state: '{}',
    });
    expect(upd.round_version).toBe(1);
    const close = await client.closeRound({
      session_id: 's', round_id: open.round_id, win_multiplier: 3, status: 'completed',
      round_version: upd.round_version, round_state_version: '1', round_state: '{}',
    });
    expect(close.balance).toBe(120);
  });

  it('autocloseRound отвечает CloseRoundResponse', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'AutocloseRoundRequest') return;
        self.send(socket, {
          proto: 1, schema: 1, chan: 'rpc', type: 'CloseRoundResponse',
          id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
          timestamp: new Date().toISOString(), payload: { balance: 77 },
        });
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    await client.connect();
    const res = await client.autocloseRound({
      session_id: 's', round_id: 'r', win_multiplier: 2, status: 'completed',
      round_version: 1, round_state_version: '1', round_state: '{}',
    });
    expect(res.balance).toBe(77);
  });

  it('прокидывает события канала events', async () => {
    api = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        if (env.type !== 'Hello') return;
        for (const [type, payload] of [
          ['BalanceChangedEvent', { session_id: 's', balance: 55, reason: 'Win' }],
          ['SessionClosedEvent', { session_id: 's', reason: 'timeout' }],
          ['NewConnectionEvent', { session_id: 's', new_connection_id: 'c2' }],
          ['AutocloseRequestEvent', { session_id: 's', round_id: 'r7' }],
        ] as const) {
          self.send(socket, {
            proto: 1, schema: 1, chan: 'events', type,
            id: `evt-${type}`, corr_id: null, op_seq: 9,
            timestamp: new Date().toISOString(), payload,
          });
        }
      },
    });
    client = new GamesApiClient({ url: api.url, apiKey: 'k', gameId: 'g' });
    const seen: Record<string, unknown> = {};
    for (const name of ['balanceChanged', 'sessionClosed', 'newConnection', 'autocloseRequest'] as const) {
      client.on(name, (p: unknown) => { seen[name] = p; });
    }
    await client.connect();
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.balanceChanged).toMatchObject({ balance: 55 });
    expect(seen.sessionClosed).toMatchObject({ reason: 'timeout' });
    expect(seen.newConnection).toMatchObject({ new_connection_id: 'c2' });
    expect(seen.autocloseRequest).toMatchObject({ round_id: 'r7' });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- client-contracts`
Expected: FAIL — `client.sessionInfo is not a function`

- [ ] **Step 3: Реализовать методы и события**

В `packages/artube-server/src/games-api/client.ts` расширить тип события и добавить методы.

Заменить строку `type ClientEvent = 'connected' | 'disconnected' | 'goAway';` на:

```ts
type ClientEvent =
  | 'connected'
  | 'disconnected'
  | 'goAway'
  | 'balanceChanged'
  | 'sessionClosed'
  | 'newConnection'
  | 'autocloseRequest';
```

Добавить импорт типов контрактов:

```ts
import type {
  SessionInfoRequest, SessionInfoResponse,
  PlayRoundRequest, PlayRoundResponse,
  OpenRoundRequest, OpenRoundResponse,
  UpdateRoundStateRequest, UpdateRoundStateResponse,
  CloseRoundRequest, CloseRoundResponse,
  AutocloseRoundRequest,
} from './types';
```

Добавить в класс:

```ts
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

  protected override onEvent(env: Envelope): void {
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
```

`packages/artube-server/src/games-api/index.ts`:

```ts
export { GamesApiClient, ANNOUNCED_CONTRACTS, type GamesApiClientOptions } from './client';
export { GamesApiError, IDEMPOTENT_TYPES, isRetryable } from './errors';
export {
  buildEnvelope, parseEnvelope, newMessageId, OpSeq, EnvelopeError,
  MAX_MESSAGE_BYTES, type Envelope, type Channel,
} from './envelope';
export type * from './types';
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: PASS — 28 тестов

- [ ] **Step 5: Проверить типы**

Run: `npm run typecheck --workspace @energy8platform/artube-server`
Expected: без ошибок

- [ ] **Step 6: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): типизированные контракты Games API и события платформы"
```

---

### Task 5: Клиент SpinML-движка (`e8-server` по gRPC)

**Files:**
- Create: `packages/artube-server/src/engine/proto.ts`
- Create: `packages/artube-server/src/engine/spawn.ts`
- Create: `packages/artube-server/src/engine/client.ts`
- Create: `packages/artube-server/src/engine/index.ts`
- Create: `packages/artube-server/tests/fixtures/feature.spin`
- Test: `packages/artube-server/tests/engine.test.ts`

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces: `interface RoundResponse { win: number; total_win: number; data_json: string; vars_json: string; globals_json: string; next_actions: string[]; round_complete: boolean; spins_remaining: number; spins_played: number; script_sha256: string; error: string; bet: number }`; `interface StartRoundArgs { gameId: string; playerId: string; roundId: string; serverSeed: string; clientSeed: string; nonce: number; action: string; bet: number; paramsJson?: string; requestId: string }`; `class EngineClient { listGames(): Promise<GameInfo[]>; getConfig(gameId: string): Promise<Record<string, unknown>>; startRound(a: StartRoundArgs): Promise<RoundResponse>; step(roundId: string, action: string, paramsJson: string, requestId: string): Promise<RoundResponse>; close(): void }`; `function startEngine(opts: { gamesDir: string; binPath?: string; port?: number }): Promise<EngineClient>`.

> **Проверено на живом бинаре.** `StartRound` с одной и той же тройкой `(server_seed, client_seed, nonce)` под разными `round_id` даёт побайтово одинаковую последовательность сегментов. Фикстура ниже даёт ровно 4 сегмента: `spin` (win 0) + три `free_spins` по 1.0, `total_win` = 3.0, на последнем `round_complete: true` и `next_actions: ['spin']`.

- [ ] **Step 1: Создать фикстуру игры**

`packages/artube-server/tests/fixtures/feature.spin`:

```
-- Детерминированная игра для тестов: spin всегда открывает 3 фриспина,
-- каждый фриспин платит ровно 1.0 множитель ставки. Ни одного вызова rng,
-- поэтому ожидания в тестах — точные числа, а не диапазоны.

record Vars {
  free_spins_awarded: int
  retrigger_spins: int
}
record Feat { buy: int }
record Data {
  stage: str
  win: float
}

game "feature-game" {
  bet_levels = [1.0]
  max_win = 100.0
  vars = Vars
  feature = Feat
  data = Data
}

action spin { stage = base_game  cost = 1.0  opens = free_spin count free_spins_awarded }
action buy_bonus { stage = buy_bonus  cost = 5.0  feature { buy = 1 }  opens = free_spin count free_spins_awarded }
action free_spin { stage = free_spins  cost = 1.0  session = true  extends = retrigger_spins }

fn execute(c: ctx, v: Vars) -> outcome {
  if action_is(c, "free_spin") {
    return outcome {
      win: 1.0,
      vars: Vars { free_spins_awarded: 0, retrigger_spins: 0 },
      data: Data { stage: "free_spins", win: 1.0 },
    }
  }
  return outcome {
    win: 0.0,
    vars: Vars { free_spins_awarded: 3, retrigger_spins: 0 },
    data: Data { stage: "base_game", win: 0.0 },
  }
}
```

Проверить, что она компилируется:

Run: `./packages/platform-core/bin/e8-darwin-arm64 check packages/artube-server/tests/fixtures/feature.spin`
Expected: `OK: … 1 function(s) … execute`

- [ ] **Step 2: Написать падающий тест**

`packages/artube-server/tests/engine.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
}, 30_000);

afterAll(() => engine?.close());

describe('EngineClient', () => {
  it('видит игру из каталога и её entry-действия', async () => {
    const games = await engine.listGames();
    const game = games.find((g) => g.game_id === 'feature-game');
    expect(game).toBeDefined();
    expect(game!.entry_actions).toEqual(expect.arrayContaining(['spin', 'buy_bonus']));
    expect(game!.script_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('конфиг отдаёт стоимость действий — источник price_multiplier', async () => {
    // RoundResponse.bet — это эхо переданной ставки, а НЕ стоимость действия,
    // поэтому множитель цены берём только отсюда.
    const config = await engine.getConfig('feature-game');
    const actions = config.actions as Record<string, { cost_multiplier: number }>;
    expect(actions.spin.cost_multiplier).toBe(1);
    expect(actions.buy_bonus.cost_multiplier).toBe(5);
  });

  it('играет раунд целиком: 4 сегмента, total_win 3.0', async () => {
    const first = await engine.startRound({
      gameId: 'feature-game', playerId: 'p1', roundId: 'round-1',
      serverSeed: 'seed-abc', clientSeed: 'cli', nonce: 7,
      action: 'spin', bet: 1, requestId: 'req-0',
    });
    expect(first.error).toBe('');
    expect(first.win).toBe(0);
    expect(first.round_complete).toBe(false);
    expect(first.next_actions).toEqual(['free_spin']);

    const wins: number[] = [first.win];
    let r = first;
    let i = 0;
    while (!r.round_complete) {
      r = await engine.step('round-1', r.next_actions[0], '', `req-${++i}`);
      wins.push(r.win);
    }
    expect(wins).toEqual([0, 1, 1, 1]);
    expect(r.total_win).toBe(3);
    expect(r.spins_played).toBe(4);
  });

  it('та же тройка сидов под другим round_id даёт тот же раунд', async () => {
    const play = async (roundId: string) => {
      const out: unknown[] = [];
      let r = await engine.startRound({
        gameId: 'feature-game', playerId: 'p1', roundId,
        serverSeed: 'seed-xyz', clientSeed: 'cli', nonce: 42,
        action: 'spin', bet: 1, requestId: `${roundId}-0`,
      });
      out.push({ win: r.win, data: r.data_json, done: r.round_complete });
      let i = 0;
      while (!r.round_complete) {
        r = await engine.step(roundId, r.next_actions[0], '', `${roundId}-${++i}`);
        out.push({ win: r.win, data: r.data_json, done: r.round_complete });
      }
      return out;
    };
    expect(await play('replay-A')).toEqual(await play('replay-B'));
  });

  it('на неизвестное действие отдаёт ошибку в поле error', async () => {
    const r = await engine.startRound({
      gameId: 'feature-game', playerId: 'p1', roundId: 'round-bad',
      serverSeed: 's', clientSeed: 'c', nonce: 1,
      action: 'no_such_action', bet: 1, requestId: 'req-bad',
    });
    expect(r.error).not.toBe('');
  });
});
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- engine`
Expected: FAIL — `Cannot find module '../src/engine'`

- [ ] **Step 4: Реализовать proto и спавн**

`packages/artube-server/src/engine/proto.ts`:

```ts
/**
 * Контракт gRPC движка SpinML.
 *
 * Источник истины — `crates/e8-server/proto/engine.proto` в репозитории
 * движка; здесь синхронизированная копия, как и в `platform-core/src/vite/
 * spinPlugin.ts`. Держим её в строке, чтобы не тащить .proto через сборку.
 */
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const ENGINE_PROTO = `
syntax = "proto3";
package e8;
service Engine {
  rpc ListGames(ListGamesRequest) returns (ListGamesResponse);
  rpc GetConfig(ConfigRequest) returns (ConfigResponse);
  rpc StartRound(StartRoundRequest) returns (RoundResponse);
  rpc Step(RoundStepRequest) returns (RoundResponse);
  rpc GetRound(GetRoundRequest) returns (RoundStateResponse);
  rpc Health(HealthRequest) returns (HealthResponse);
}
message ListGamesRequest {}
message GameInfo {
  string game_id = 1;
  string script_sha256 = 2;
  string vars_layout_hash = 3;
  repeated string entry_actions = 4;
  repeated string loaded_versions = 5;
}
message ListGamesResponse { repeated GameInfo games = 1; }
message ConfigRequest { string game_id = 1; }
message ConfigResponse { string config_json = 1; string error = 2; }
message StartRoundRequest {
  string game_id = 1;
  string player_id = 2;
  string round_id = 3;
  string server_seed = 4;
  string client_seed = 5;
  int64 nonce = 6;
  string action = 7;
  double bet = 8;
  string params_json = 9;
  string request_id = 10;
  bool recording = 11;
}
message RoundStepRequest {
  string round_id = 1;
  string action = 2;
  string params_json = 3;
  string request_id = 4;
}
message RoundResponse {
  double win = 1;
  double total_win = 2;
  string data_json = 3;
  string vars_json = 4;
  string globals_json = 5;
  repeated string next_actions = 6;
  bool round_complete = 7;
  int64 spins_remaining = 8;
  uint32 spins_played = 9;
  string script_sha256 = 10;
  string error = 11;
  double bet = 12;
}
message GetRoundRequest { string round_id = 1; }
message RoundStateResponse {
  bool found = 1;
  string game_id = 2;
  string script_sha256 = 3;
  double total_win = 4;
  uint32 spins_played = 5;
  int64 spins_remaining = 6;
  repeated string next_actions = 7;
  bool round_complete = 8;
  string vars_json = 9;
  string error = 10;
  double bet = 11;
}
message HealthRequest {}
message HealthResponse { bool ok = 1; uint32 games_loaded = 2; string sessions_backend = 3; }
`;

/** Собрать gRPC-клиент к уже запущенному серверу на 127.0.0.1:port. */
export function createGrpcClient(port: number): any {
  const req = createRequire(import.meta.url);
  const grpcJs = req('@grpc/grpc-js');
  const loader = req('@grpc/proto-loader');
  const dir = mkdtempSync(join(tmpdir(), 'artube-proto-'));
  writeFileSync(join(dir, 'engine.proto'), ENGINE_PROTO);
  const def = loader.loadSync(join(dir, 'engine.proto'), {
    keepCase: true,
    longs: Number,
    defaults: true,
  });
  const pkg = grpcJs.loadPackageDefinition(def);
  return new pkg.e8.Engine(`127.0.0.1:${port}`, grpcJs.credentials.createInsecure());
}
```

`packages/artube-server/src/engine/spawn.ts`:

```ts
/**
 * Поиск и запуск бинаря `e8-server`.
 *
 * Движок эфемерный: `--sessions memory` и короткий TTL. Раунды, которые он
 * держит, — временный кэш воспроизведения, а не состояние игры: настоящее
 * состояние живёт в `round_state` на стороне Artube.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createRequire } from 'node:module';

export const DEFAULT_ENGINE_PORT = 50251;

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Порядок поиска тот же, что у `spinPlugin`: явный путь → `E8_SERVER_BINARY`
 * → бинарь, скачанный postinstall'ом platform-core → голое имя из PATH.
 */
export function resolveEngineBinary(explicit?: string): string {
  if (explicit) return explicit;
  const fromEnv = process.env.E8_SERVER_BINARY;
  if (fromEnv && executable(fromEnv)) return fromEnv;
  const arch = process.arch === 'x64' ? 'amd64' : process.arch;
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const ext = process.platform === 'win32' ? '.exe' : '';
  const name = `e8-server-${platform}-${arch}${ext}`;
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve('@energy8platform/platform-core/package.json');
    const candidate = join(pkg, '..', 'bin', name);
    if (executable(candidate)) return candidate;
  } catch {
    // platform-core не установлен — падаем на PATH
  }
  try {
    const here = fileURLToPath(import.meta.url);
    for (const up of ['..', '../..', '../../..']) {
      const candidate = join(here, '..', up, 'bin', name);
      if (executable(candidate)) return candidate;
    }
  } catch {
    // import.meta недоступен
  }
  return `e8-server${ext}`;
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

export async function findFreePort(start: number, range = 20): Promise<number> {
  for (let p = start; p < start + range; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(`[artube] нет свободного порта в диапазоне ${start}..${start + range - 1}`);
}

export interface SpawnedEngine {
  port: number;
  child: ChildProcess;
}

export async function spawnEngine(opts: {
  gamesDir: string;
  binPath?: string;
  port?: number;
  sessionTtlSec?: number;
}): Promise<SpawnedEngine> {
  const port = await findFreePort(opts.port ?? DEFAULT_ENGINE_PORT);
  const bin = resolveEngineBinary(opts.binPath);
  const child = spawn(
    bin,
    [
      '--port', String(port),
      '--sessions', 'memory',
      '--session-ttl', String(opts.sessionTtlSec ?? 300),
      '--games-dir', opts.gamesDir,
    ],
    { stdio: 'inherit' },
  );
  return { port, child };
}
```

- [ ] **Step 5: Реализовать клиент движка**

`packages/artube-server/src/engine/client.ts`:

```ts
import type { ChildProcess } from 'node:child_process';
import { createGrpcClient } from './proto';
import { spawnEngine } from './spawn';

export interface GameInfo {
  game_id: string;
  script_sha256: string;
  vars_layout_hash: string;
  entry_actions: string[];
  loaded_versions: string[];
}

export interface RoundResponse {
  win: number;
  total_win: number;
  data_json: string;
  vars_json: string;
  globals_json: string;
  next_actions: string[];
  round_complete: boolean;
  spins_remaining: number;
  spins_played: number;
  script_sha256: string;
  error: string;
  bet: number;
}

export interface StartRoundArgs {
  gameId: string;
  playerId: string;
  roundId: string;
  serverSeed: string;
  clientSeed: string;
  nonce: number;
  action: string;
  bet: number;
  paramsJson?: string;
  requestId: string;
}

export class EngineClient {
  constructor(
    private readonly grpc: any,
    private readonly child: ChildProcess | null,
  ) {}

  private call<T>(method: string, req: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      this.grpc[method](req, (err: Error | null, res: T) => (err ? reject(err) : resolve(res)));
    });
  }

  async listGames(): Promise<GameInfo[]> {
    const res = await this.call<{ games: GameInfo[] }>('ListGames', {});
    return res.games;
  }

  async getConfig(gameId: string): Promise<Record<string, unknown>> {
    const res = await this.call<{ config_json: string; error: string }>('GetConfig', {
      game_id: gameId,
    });
    if (res.error) throw new Error(`engine GetConfig: ${res.error}`);
    return JSON.parse(res.config_json) as Record<string, unknown>;
  }

  /**
   * Начать раунд. Ставку всегда передаём как 1.0: `win` и `total_win` тогда
   * приходят чистыми множителями — ровно тем, что Artube ждёт в
   * `win_multiplier`. Деньги считает Games API, не мы.
   */
  startRound(a: StartRoundArgs): Promise<RoundResponse> {
    return this.call<RoundResponse>('StartRound', {
      game_id: a.gameId,
      player_id: a.playerId,
      round_id: a.roundId,
      server_seed: a.serverSeed,
      client_seed: a.clientSeed,
      nonce: a.nonce,
      action: a.action,
      bet: a.bet,
      params_json: a.paramsJson ?? '',
      request_id: a.requestId,
      recording: true,
    });
  }

  step(roundId: string, action: string, paramsJson: string, requestId: string): Promise<RoundResponse> {
    return this.call<RoundResponse>('Step', {
      round_id: roundId,
      action,
      params_json: paramsJson,
      request_id: requestId,
    });
  }

  close(): void {
    this.child?.kill();
  }
}

/** Поднять движок и дождаться, пока он загрузит игры. */
export async function startEngine(opts: {
  gamesDir: string;
  binPath?: string;
  port?: number;
}): Promise<EngineClient> {
  const { port, child } = await spawnEngine(opts);
  const grpc = createGrpcClient(port);
  const client = new EngineClient(grpc, child);
  for (let i = 0; i < 100; i++) {
    try {
      await client.listGames();
      return client;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  child.kill();
  throw new Error('[artube] e8-server не поднялся за 20 секунд');
}
```

`packages/artube-server/src/engine/index.ts`:

```ts
export {
  EngineClient, startEngine,
  type GameInfo, type RoundResponse, type StartRoundArgs,
} from './client';
export {
  resolveEngineBinary, spawnEngine, findFreePort, DEFAULT_ENGINE_PORT,
} from './spawn';
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server -- engine`
Expected: PASS, 4 теста

- [ ] **Step 7: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): gRPC-клиент SpinML-движка и детерминированная фикстура"
```

---

### Task 6: Кодек `round_state` и раунд в движке — горячий и холодный путь

**Files:**
- Create: `packages/artube-server/src/round/roundState.ts`
- Create: `packages/artube-server/src/round/engineRound.ts`
- Test: `packages/artube-server/tests/roundState.test.ts`
- Test: `packages/artube-server/tests/engineRound.test.ts`

**Interfaces:**
- Consumes: из Task 5 — `EngineClient`, `RoundResponse`, `GetRound`.
- Produces: `const ROUND_STATE_VERSION = '1'`; `interface RoundStateV1 { v: 1; seed: { server: string; client: string; nonce: number }; eid: string; script: string; action: string; betIndex: number; priceMultiplier: number; cursor: number; totalWinX: number; actions: Array<{ a: string; p?: Record<string, unknown> }>; frcId?: string }`; `function encodeRoundState(s): string`; `function decodeRoundState(raw): RoundStateV1`; `function newSeed()`; `function newEngineRoundId(): string`; `interface Segment { action: string; data: Record<string, unknown>; winX: number; totalWinX: number; nextActions: string[]; spinsRemaining: number; spinsPlayed: number; isFinal: boolean }`; `async function openEntry(engine, gameId, state): Promise<Segment>`; `async function ensureOpen(engine, gameId, state): Promise<void>`; `async function stepRound(engine, state, action, params): Promise<Segment>`; `async function playToEnd(engine, gameId, state): Promise<number>`; `class ScriptMismatchError extends Error { readonly expected: string; readonly actual: string }`.

> **Ключевое решение.** Раунд НЕ проигрывается заранее: entry-действие — один `StartRound`,
> каждый следующий сегмент — один `Step`. Открытый раунд в движке это **кэш**: `GetRound`
> нашёл — работаем дальше (O(1)); не нашёл (рестарт пода, запрос на другом поде) —
> воспроизводим из сидов и лога действий до курсора (O(N) один раз). Правда всегда лежит
> в `round_state` у Artube, поэтому потеря кэша ничего не стоит. Из той же модели следует
> гэмбл: выбор игрока приезжает в `params` ДО шага, который на нём ветвится.

- [ ] **Step 1: Написать падающий тест кодека**

`packages/artube-server/tests/roundState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  encodeRoundState, decodeRoundState, newSeed, newEngineRoundId, ROUND_STATE_VERSION,
  type RoundStateV1,
} from '../src/round/roundState';
import { MAX_MESSAGE_BYTES } from '../src/games-api/envelope';

const sample: RoundStateV1 = {
  v: 1,
  seed: { server: 'srv', client: 'cli', nonce: 7 },
  eid: 'e-1',
  script: 'sha-1',
  action: 'spin',
  betIndex: 2,
  priceMultiplier: 1,
  cursor: 0,
  totalWinX: 0,
  actions: [],
};

describe('round_state', () => {
  it('версия формата — строка "1"', () => {
    expect(ROUND_STATE_VERSION).toBe('1');
  });

  it('кодирование и декодирование — round-trip', () => {
    expect(decodeRoundState(encodeRoundState(sample))).toEqual(sample);
  });

  it('кодируется в строку, а не в объект — так требует дока', () => {
    expect(typeof encodeRoundState(sample)).toBe('string');
  });

  it('состояние остаётся крошечным даже с полным логом фичи', () => {
    const withActions: RoundStateV1 = {
      ...sample,
      cursor: 50,
      actions: Array.from({ length: 50 }, () => ({ a: 'free_spin' })),
    };
    expect(encodeRoundState(withActions).length).toBeLessThan(MAX_MESSAGE_BYTES / 10);
  });

  it('интерактивный выбор игрока сохраняется в логе', () => {
    const withGamble: RoundStateV1 = {
      ...sample,
      actions: [{ a: 'gamble', p: { choice: 'red' } }],
    };
    expect(decodeRoundState(encodeRoundState(withGamble)).actions[0].p).toEqual({ choice: 'red' });
  });

  it('отвергает чужую версию формата', () => {
    expect(() => decodeRoundState(JSON.stringify({ ...sample, v: 2 }))).toThrow(/version/);
  });

  it('отвергает битую строку', () => {
    expect(() => decodeRoundState('not json')).toThrow();
  });

  it('newSeed даёт разные сиды, newEngineRoundId — разные id', () => {
    expect(newSeed().server).not.toBe(newSeed().server);
    expect(newSeed().server).toMatch(/^[0-9a-f]{32}$/);
    expect(newEngineRoundId()).not.toBe(newEngineRoundId());
  });
});
```

- [ ] **Step 2: Написать падающий тест раунда в движке**

`packages/artube-server/tests/engineRound.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
import {
  openEntry, ensureOpen, stepRound, playToEnd, ScriptMismatchError,
} from '../src/round/engineRound';
import { newSeed, newEngineRoundId, type RoundStateV1 } from '../src/round/roundState';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
}, 30_000);

afterAll(() => engine?.close());

function stateFor(over: Partial<RoundStateV1> = {}): RoundStateV1 {
  return {
    v: 1,
    seed: newSeed(),
    eid: newEngineRoundId(),
    script: '',
    action: 'spin',
    betIndex: 0,
    priceMultiplier: 1,
    cursor: 0,
    totalWinX: 0,
    actions: [],
    ...over,
  };
}

describe('раунд в движке', () => {
  it('entry-действие — ровно один шаг, раунд остаётся открытым', async () => {
    const state = stateFor();
    const first = await openEntry(engine, 'feature-game', state);
    expect(first.action).toBe('spin');
    expect(first.winX).toBe(0);
    expect(first.isFinal).toBe(false);
    expect(first.nextActions).toEqual(['free_spin']);
    // sha скрипта проставляется в состояние — на нём держится защита от деплоя
    expect(state.script).toMatch(/^[0-9a-f]{64}$/);
  });

  it('раунд без фичи закрывается тем же одним шагом', async () => {
    const first = await openEntry(engine, 'one-shot-game', stateFor({ action: 'one_shot' }));
    expect(first.isFinal).toBe(true);
    expect(first.totalWinX).toBe(0);
  });

  it('каждый следующий сегмент — один шаг', async () => {
    const state = stateFor();
    await openEntry(engine, 'feature-game', state);
    const wins: number[] = [];
    for (let i = 0; i < 3; i++) {
      const segment = await stepRound(engine, state, 'free_spin');
      wins.push(segment.winX);
      state.actions.push({ a: 'free_spin' });
    }
    expect(wins).toEqual([1, 1, 1]);
  });

  it('последний сегмент помечен финальным и несёт итог', async () => {
    const state = stateFor();
    await openEntry(engine, 'feature-game', state);
    let last;
    for (let i = 0; i < 3; i++) {
      last = await stepRound(engine, state, 'free_spin');
      state.actions.push({ a: 'free_spin' });
    }
    expect(last!.isFinal).toBe(true);
    expect(last!.totalWinX).toBe(3);
    expect(last!.nextActions).toEqual(['spin']);
  });

  it('ensureOpen ничего не делает, пока раунд жив в движке', async () => {
    const state = stateFor();
    await openEntry(engine, 'feature-game', state);
    await ensureOpen(engine, 'feature-game', state);
    const segment = await stepRound(engine, state, 'free_spin');
    expect(segment.winX).toBe(1);
  });

  it('ensureOpen поднимает раунд заново, если движок его не знает', async () => {
    // Состояние есть, а раунда в движке нет — так выглядит запрос на другом поде.
    const state = stateFor({
      cursor: 2,
      actions: [{ a: 'free_spin' }, { a: 'free_spin' }],
    });
    await ensureOpen(engine, 'feature-game', state);
    // Раунд доигран до курсора: следующий шаг — третий фриспин, он же последний.
    const segment = await stepRound(engine, state, 'free_spin');
    expect(segment.isFinal).toBe(true);
    expect(segment.totalWinX).toBe(3);
  });

  it('холодный подъём воспроизводит те же значения, что горячий путь', async () => {
    const seed = newSeed();
    const hot = stateFor({ seed, eid: newEngineRoundId() });
    await openEntry(engine, 'feature-game', hot);
    const hotSecond = await stepRound(engine, hot, 'free_spin');

    const cold = stateFor({
      seed, eid: newEngineRoundId(), cursor: 1, actions: [{ a: 'free_spin' }],
    });
    await ensureOpen(engine, 'feature-game', cold);
    const coldSecond = await stepRound(engine, cold, 'free_spin');
    expect(coldSecond.data).toEqual(hotSecond.data);
    expect(coldSecond.totalWinX).toBe(hotSecond.totalWinX);
  });

  it('расхождение скрипта ловится при холодном подъёме', async () => {
    const state = stateFor({ script: 'sha256:другой-скрипт', cursor: 1, actions: [{ a: 'free_spin' }] });
    await expect(ensureOpen(engine, 'feature-game', state)).rejects.toBeInstanceOf(
      ScriptMismatchError,
    );
  });

  it('playToEnd доигрывает остаток раунда и отдаёт итоговый множитель', async () => {
    const state = stateFor({ cursor: 1, actions: [{ a: 'free_spin' }] });
    expect(await playToEnd(engine, 'feature-game', state)).toBe(3);
  });
});
```

- [ ] **Step 3: Убедиться, что тесты падают**

Run: `npm test --workspace @energy8platform/artube-server -- roundState engineRound`
Expected: FAIL — `Cannot find module '../src/round/roundState'`

> `one-shot-game` — фикстура из Task 7, шаг 2. Если Task 7 ещё не выполнен, создайте
> `tests/fixtures/one-shot.spin` сейчас: её содержимое приведено там.

- [ ] **Step 4: Реализовать кодек**

`packages/artube-server/src/round/roundState.ts`:

```ts
/**
 * `round_state` — единственное место, где живёт состояние раунда.
 *
 * Кладём туда не дамп движка, а рецепт его воспроизведения: тройку сидов,
 * идентификатор раунда в движке, курсор и лог действий игрока. Десятки байт
 * вместо килобайтов, и любой под продолжит раунд, ничего не помня.
 */

import { randomBytes, randomUUID } from 'node:crypto';

/** Значение поля `round_state_version` в запросах к Games API. */
export const ROUND_STATE_VERSION = '1';

export interface RoundSeed {
  server: string;
  client: string;
  nonce: number;
}

export interface RoundStateV1 {
  v: 1;
  seed: RoundSeed;
  /** Идентификатор раунда в движке. Кэш живёт под ним, пока под жив. */
  eid: string;
  /** sha скрипта, которым раунд играется, — защита от деплоя посреди раунда. */
  script: string;
  /** entry-действие раунда: 'spin' | 'buy_bonus' | … */
  action: string;
  betIndex: number;
  priceMultiplier: number;
  /** Сколько сегментов игрок уже подтвердил. */
  cursor: number;
  /** Накопленный множитель выигрыша по подтверждённым сегментам. */
  totalWinX: number;
  /**
   * Лог действий ПОСЛЕ entry — по одному на сегмент, с параметрами
   * интерактивного выбора. Без него холодный подъём не воспроизвести.
   */
  actions: Array<{ a: string; p?: Record<string, unknown> }>;
  frcId?: string;
}

export function encodeRoundState(state: RoundStateV1): string {
  return JSON.stringify(state);
}

export function decodeRoundState(raw: string): RoundStateV1 {
  const parsed = JSON.parse(raw) as RoundStateV1;
  if (parsed?.v !== 1) {
    throw new Error(`unsupported round_state version: ${String(parsed?.v)}`);
  }
  return parsed;
}

export function newSeed(): RoundSeed {
  return {
    server: randomBytes(16).toString('hex'),
    client: randomBytes(8).toString('hex'),
    nonce: 1,
  };
}

export function newEngineRoundId(): string {
  return `e-${randomUUID()}`;
}
```

- [ ] **Step 5: Реализовать работу с раундом движка**

`packages/artube-server/src/round/engineRound.ts`:

```ts
/**
 * Раунд в движке: горячий и холодный путь.
 *
 * Горячий — раунд ещё открыт в `e8-server` на этом поде: один `Step` на сегмент.
 * Холодный — движок раунда не знает (рестарт, другой под): поднимаем его заново
 * из тройки сидов и лога действий, доигрываем до курсора и продолжаем.
 *
 * Открытый раунд — кэш, а не состояние: его потеря ничего не стоит, потому что
 * правда лежит в `round_state` на стороне Artube.
 */

import type { EngineClient, RoundResponse } from '../engine';
import type { RoundStateV1 } from './roundState';

export interface Segment {
  /** Действие, которому соответствует сегмент: 'spin' | 'free_spin' | 'gamble'. */
  action: string;
  data: Record<string, unknown>;
  /** Выигрыш этого сегмента в множителях ставки. */
  winX: number;
  /** Накопленный выигрыш по сегмент включительно, в множителях. */
  totalWinX: number;
  nextActions: string[];
  spinsRemaining: number;
  spinsPlayed: number;
  isFinal: boolean;
}

export class ScriptMismatchError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super(`round was played on script ${expected}, engine has ${actual}`);
    this.name = 'ScriptMismatchError';
  }
}

function toSegment(response: RoundResponse, action: string): Segment {
  return {
    action,
    data: response.data_json ? (JSON.parse(response.data_json) as Record<string, unknown>) : {},
    winX: response.win,
    totalWinX: response.total_win,
    nextActions: response.next_actions,
    spinsRemaining: response.spins_remaining,
    spinsPlayed: response.spins_played,
    isFinal: response.round_complete,
  };
}

/**
 * Начать раунд. Ставку в движок всегда передаём как 1.0, чтобы `win` и
 * `total_win` приходили чистыми множителями — тем, что Artube ждёт в
 * `win_multiplier`. Деньги считает Games API, не мы.
 */
async function start(
  engine: EngineClient,
  gameId: string,
  state: RoundStateV1,
  requestId: string,
): Promise<RoundResponse> {
  const response = await engine.startRound({
    gameId,
    playerId: 'artube',
    roundId: state.eid,
    serverSeed: state.seed.server,
    clientSeed: state.seed.client,
    nonce: state.seed.nonce,
    action: state.action,
    bet: 1,
    paramsJson: '',
    requestId,
  });
  if (response.error) throw new Error(`engine StartRound: ${response.error}`);
  if (state.script && response.script_sha256 && state.script !== response.script_sha256) {
    throw new ScriptMismatchError(state.script, response.script_sha256);
  }
  state.script = response.script_sha256;
  return response;
}

/** Entry-действие: один шаг. `isFinal` в ответе решает, простой раунд или сложный. */
export async function openEntry(
  engine: EngineClient,
  gameId: string,
  state: RoundStateV1,
): Promise<Segment> {
  return toSegment(await start(engine, gameId, state, `${state.eid}-open`), state.action);
}

/**
 * Гарантировать, что раунд открыт в движке. Горячий путь ничего не делает;
 * холодный — поднимает раунд заново и догоняет курсор по логу действий.
 */
export async function ensureOpen(
  engine: EngineClient,
  gameId: string,
  state: RoundStateV1,
): Promise<void> {
  const known = await engine.getRound(state.eid);
  if (known.found && !known.round_complete) {
    if (state.script && known.script_sha256 && state.script !== known.script_sha256) {
      throw new ScriptMismatchError(state.script, known.script_sha256);
    }
    return;
  }
  // Холодный подъём: заново под тем же eid, затем догоняем лог действий.
  await start(engine, gameId, state, `${state.eid}-recover`);
  for (let i = 0; i < state.actions.length; i++) {
    const logged = state.actions[i];
    const response = await engine.step(
      state.eid,
      logged.a,
      logged.p ? JSON.stringify(logged.p) : '',
      `${state.eid}-recover-${i}`,
    );
    if (response.error) throw new Error(`engine Step (recover): ${response.error}`);
  }
}

/** Один сегмент. Вызывается после `ensureOpen`. */
export async function stepRound(
  engine: EngineClient,
  state: RoundStateV1,
  action: string,
  params?: Record<string, unknown>,
): Promise<Segment> {
  const response = await engine.step(
    state.eid,
    action,
    params ? JSON.stringify(params) : '',
    `${state.eid}-${state.actions.length}`,
  );
  if (response.error) throw new Error(`engine Step: ${response.error}`);
  return toSegment(response, action);
}

/**
 * Доиграть раунд до конца от лица игрока — нужен автозакрытию. Ветки выбираем
 * первым доступным действием: интерактив за игрока додумывать нечем.
 */
export async function playToEnd(
  engine: EngineClient,
  gameId: string,
  state: RoundStateV1,
): Promise<number> {
  await ensureOpen(engine, gameId, state);
  let known = await engine.getRound(state.eid);
  let total = known.total_win;
  let guard = 0;
  while (known.found && !known.round_complete && guard++ < 1000) {
    const segment = await stepRound(engine, state, known.next_actions[0]);
    total = segment.totalWinX;
    if (segment.isFinal) break;
    known = await engine.getRound(state.eid);
  }
  return total;
}
```

- [ ] **Step 6: Добавить `getRound` в клиент движка**

В `packages/artube-server/src/engine/client.ts` добавить тип и метод:

```ts
export interface RoundStateResponse {
  found: boolean;
  game_id: string;
  script_sha256: string;
  total_win: number;
  spins_played: number;
  spins_remaining: number;
  next_actions: string[];
  round_complete: boolean;
  vars_json: string;
  error: string;
  bet: number;
}
```

```ts
  /** Жив ли раунд в кэше движка. `found: false` — нужен холодный подъём. */
  getRound(roundId: string): Promise<RoundStateResponse> {
    return this.call<RoundStateResponse>('GetRound', { round_id: roundId });
  }
```

и в `packages/artube-server/src/engine/index.ts` дописать `RoundStateResponse` в список экспортируемых типов.

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: PASS — все тесты Task 1–6

- [ ] **Step 8: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): round_state и раунд в движке — шаг на сегмент, холодный подъём из лога"
```

---

### Task 7: Оркестратор — простой раунд (`PlayRound`)

**Files:**
- Create: `packages/artube-server/src/session/types.ts`
- Create: `packages/artube-server/src/round/orchestrator.ts`
- Create: `packages/artube-server/tests/fixtures/one-shot.spin`
- Test: `packages/artube-server/tests/orchestrator-simple.test.ts`

**Interfaces:**
- Consumes: из Task 4 — методы `GamesApiClient`; Task 5 — `EngineClient`; Task 6 — `openEntry`, `Segment`, `RoundStateV1`, `encodeRoundState`, `newSeed`, `newEngineRoundId`, `ROUND_STATE_VERSION`.
- Produces: `interface RoundApi`; `interface SessionContext { sessionId: string; currency: string | null; allowedBets: number[]; frcId?: string }`; `interface PlayRequest { id: string; action: string; betIndex: number; params?: Record<string, unknown> }`; `interface SegmentDelivery { … }`; `interface ActiveRound { roundId: string; roundVersion: number; state: RoundStateV1; delivered: Segment | null }`; `interface RoundDeps { api: RoundApi; engine: EngineClient; gameId: string; costMultipliers: Record<string, number> }`; `function resolvePriceMultiplier(deps, action, frcActive): number`; `export function toDelivery(...)`; `async function startRound(deps, ctx, req): Promise<{ delivery: SegmentDelivery; round: ActiveRound | null }>`.

- [ ] **Step 1: Создать фикстуру без фичи**

`packages/artube-server/tests/fixtures/one-shot.spin` — раунд из одного сегмента, отличает простой путь от сложного:

```
-- Раунд без фичи: ровно один сегмент, выигрыш всегда 0.
record Vars { dummy: int }
record Feat { dummy: int }
record Data { stage: str }

game "one-shot-game" {
  bet_levels = [1.0]
  max_win = 10.0
  vars = Vars
  feature = Feat
  data = Data
}

action one_shot { stage = base_game  cost = 1.0 }

fn execute(c: ctx, v: Vars) -> outcome {
  return outcome {
    win: 0.0,
    vars: Vars { dummy: 0 },
    data: Data { stage: "base_game" },
  }
}
```

Run: `./packages/platform-core/bin/e8-darwin-arm64 check packages/artube-server/tests/fixtures/one-shot.spin`
Expected: `OK: … execute`

- [ ] **Step 2: Написать падающий тест**

`packages/artube-server/tests/orchestrator-simple.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
import { startRound, resolvePriceMultiplier, type RoundDeps } from '../src/round/orchestrator';
import { decodeRoundState } from '../src/round/roundState';
import type { SessionContext } from '../src/session/types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
}, 30_000);

afterAll(() => engine?.close());

const ctx: SessionContext = {
  sessionId: 'sess-1',
  currency: 'USD',
  allowedBets: [0.1, 0.5, 1, 5],
};

/** Заглушка Games API: записывает запросы и отдаёт фиксированные ответы. */
function fakeApi() {
  return {
    playRound: vi.fn(async () => ({
      round_id: 'round-simple', balance: 199, win: 0, is_platform_max_win_reached: false,
    })),
    openRound: vi.fn(async () => ({ round_version: 0, round_id: 'r', balance: 0 })),
    updateRoundState: vi.fn(async () => ({ round_version: 1 })),
    closeRound: vi.fn(async () => ({ balance: 0 })),
    autocloseRound: vi.fn(async () => ({ balance: 0 })),
  };
}

function deps(api: ReturnType<typeof fakeApi>, gameId = 'one-shot-game'): RoundDeps {
  return {
    api, engine, gameId,
    costMultipliers: { one_shot: 1, spin: 1, buy_bonus: 5, free_spin: 1 },
  };
}

describe('оркестратор — простой раунд', () => {
  it('множитель цены берётся из стоимости действия', () => {
    const d = deps(fakeApi());
    expect(resolvePriceMultiplier(d, 'spin', false)).toBe(1);
    expect(resolvePriceMultiplier(d, 'buy_bonus', false)).toBe(5);
  });

  it('активная кампания фри-раундов обнуляет множитель цены', () => {
    expect(resolvePriceMultiplier(deps(fakeApi()), 'spin', true)).toBe(0);
  });

  it('одиночный сегмент уходит одним PlayRound', async () => {
    const api = fakeApi();
    const out = await startRound(deps(api), ctx, { id: 'p1', action: 'one_shot', betIndex: 2 });
    expect(api.playRound).toHaveBeenCalledTimes(1);
    expect(api.openRound).not.toHaveBeenCalled();
    expect(out.round).toBeNull(); // раунд закрыт, продолжения не будет
  });

  it('в PlayRound уходят индекс и множители, но не суммы', async () => {
    const api = fakeApi();
    await startRound(deps(api), ctx, { id: 'p1', action: 'one_shot', betIndex: 2 });
    const sent = api.playRound.mock.calls[0][0];
    expect(sent.session_id).toBe('sess-1');
    expect(sent.bet_index).toBe(2);
    expect(sent.price_multiplier).toBe(1);
    expect(sent.win_multiplier).toBe(0);
    expect(sent.round_state_version).toBe('1');
    expect(sent).not.toHaveProperty('bet_amount');
  });

  it('round_state несёт рецепт воспроизведения, а не дамп движка', async () => {
    const api = fakeApi();
    await startRound(deps(api), ctx, { id: 'p1', action: 'one_shot', betIndex: 2 });
    const state = decodeRoundState(api.playRound.mock.calls[0][0].round_state);
    expect(state.v).toBe(1);
    expect(state.seed.server).toMatch(/^[0-9a-f]{32}$/);
    expect(state.eid).toMatch(/^e-/);
    expect(state.action).toBe('one_shot');
    expect(state.betIndex).toBe(2);
    expect(state.cursor).toBe(1);
    expect(state).not.toHaveProperty('vars');
  });

  it('доставка сегмента несёт баланс платформы и сумму ставки', async () => {
    const api = fakeApi();
    const { delivery } = await startRound(deps(api), ctx, {
      id: 'p1', action: 'one_shot', betIndex: 2,
    });
    expect(delivery.roundId).toBe('round-simple');
    expect(delivery.balanceAfter).toBe(199); // из ответа платформы, не наш расчёт
    expect(delivery.betAmount).toBe(1); // allowed_bets[2]
    expect(delivery.creditPending).toBe(false);
  });

  it('флаг платформенного максвина пробрасывается как есть', async () => {
    const api = fakeApi();
    api.playRound.mockResolvedValueOnce({
      round_id: 'r', balance: 500, win: 300, is_platform_max_win_reached: true,
    });
    const { delivery } = await startRound(deps(api), ctx, {
      id: 'p1', action: 'one_shot', betIndex: 2,
    });
    expect(delivery.maxWinReached).toBe(true);
  });

  it('ставка вне allowed_bets отвергается до похода в платформу', async () => {
    const api = fakeApi();
    await expect(
      startRound(deps(api), ctx, { id: 'p1', action: 'one_shot', betIndex: 99 }),
    ).rejects.toThrow(/bet_index/);
    expect(api.playRound).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- orchestrator-simple`
Expected: FAIL — `Cannot find module '../src/round/orchestrator'`

- [ ] **Step 4: Реализовать типы сессии**

`packages/artube-server/src/session/types.ts`:

```ts
/** Контракт между HTTP-слоем и оркестратором. Ничего из этого не переживает запрос. */

import type { CampaignProgress } from '../games-api/types';

export interface SessionContext {
  sessionId: string;
  /** `null` — демо-сессия: раундовые RPC платформе запрещены. */
  currency: string | null;
  /** Массив допустимых ставок из SessionInfo; индекс в нём — то, что едет наружу. */
  allowedBets: number[];
  /** Активная кампания фри-раундов, если есть. */
  frcId?: string;
}

export interface PlayRequest {
  /** Идентификатор запроса фронта — возвращаем его в ответе. */
  id: string;
  action: string;
  betIndex: number;
  /** Интерактивный выбор игрока: гэмбл, пик бонуса и подобное. */
  params?: Record<string, unknown>;
}

/** Один сегмент, готовый к отправке во фронт. */
export interface SegmentDelivery {
  roundId: string;
  action: string;
  data: Record<string, unknown>;
  /** Выигрыш сегмента в множителях ставки — суммы считает фронт для показа. */
  winX: number;
  totalWinX: number;
  /** allowed_bets[betIndex] — платформенное значение, не наш расчёт. */
  betAmount: number;
  nextActions: string[];
  spinsRemaining: number;
  spinsPlayed: number;
  /** Баланс из ответа платформы; `null`, пока раунд не рассчитан. */
  balanceAfter: number | null;
  /** true, пока выигрыш ещё не зачислен (сложный раунд не закрыт). */
  creditPending: boolean;
  maxWinReached: boolean;
  frc?: CampaignProgress | null;
}
```

- [ ] **Step 5: Реализовать простой путь оркестратора**

`packages/artube-server/src/round/orchestrator.ts`:

```ts
/**
 * Оркестратор раунда — чистые функции поверх Games API и движка.
 *
 * Ни одного поля, переживающего запрос: всё, что нужно для продолжения раунда,
 * возвращается наружу и уезжает в `round_state` платформы.
 *
 * Entry-действие — один шаг движка; `isFinal` в ответе решает, простой это
 * раунд (PlayRound) или сложный (Open/Update/Close).
 */

import type { EngineClient } from '../engine';
import { openEntry, type Segment } from './engineRound';
import {
  encodeRoundState, newEngineRoundId, newSeed, ROUND_STATE_VERSION, type RoundStateV1,
} from './roundState';
import type {
  PlayRoundRequest, PlayRoundResponse,
  OpenRoundRequest, OpenRoundResponse,
  UpdateRoundStateRequest, UpdateRoundStateResponse,
  CloseRoundRequest, CloseRoundResponse,
  AutocloseRoundRequest,
} from '../games-api/types';
import type { PlayRequest, SegmentDelivery, SessionContext } from '../session/types';

/** Узкий структурный интерфейс: в тестах подменяется заглушкой. */
export interface RoundApi {
  playRound(req: PlayRoundRequest): Promise<PlayRoundResponse>;
  openRound(req: OpenRoundRequest): Promise<OpenRoundResponse>;
  updateRoundState(req: UpdateRoundStateRequest): Promise<UpdateRoundStateResponse>;
  closeRound(req: CloseRoundRequest): Promise<CloseRoundResponse>;
  autocloseRound(req: AutocloseRoundRequest): Promise<CloseRoundResponse>;
}

export interface RoundDeps {
  api: RoundApi;
  engine: EngineClient;
  gameId: string;
  /**
   * `actions[action].cost_multiplier` из GetConfig движка. Читается один раз
   * на старте: `RoundResponse.bet` — это эхо переданной ставки, а не цена.
   */
  costMultipliers: Record<string, number>;
}

/** Незакрытый раунд: всё, что нужно, чтобы отдать следующий сегмент. */
export interface ActiveRound {
  roundId: string;
  /** Версия раунда, которую считает Games API. */
  roundVersion: number;
  state: RoundStateV1;
  /** Последний выданный сегмент, ещё не подтверждённый игроком. */
  delivered: Segment | null;
}

export function resolvePriceMultiplier(
  deps: RoundDeps,
  action: string,
  frcActive: boolean,
): number {
  // Фри-раунд игрок не оплачивает — дока требует ровно 0.
  if (frcActive) return 0;
  return deps.costMultipliers[action] ?? 1;
}

export function toDelivery(
  segment: Segment,
  roundId: string,
  betAmount: number,
  balanceAfter: number | null,
  creditPending: boolean,
  maxWinReached: boolean,
): SegmentDelivery {
  return {
    roundId,
    action: segment.action,
    data: segment.data,
    winX: segment.winX,
    totalWinX: segment.totalWinX,
    betAmount,
    nextActions: segment.nextActions,
    spinsRemaining: segment.spinsRemaining,
    spinsPlayed: segment.spinsPlayed,
    balanceAfter,
    creditPending,
    maxWinReached,
  };
}

/**
 * Начать раунд: один шаг движка, затем одна RPC платформе. Для одиночного
 * сегмента `round` равен `null` — продолжения не будет.
 */
export async function startRound(
  deps: RoundDeps,
  ctx: SessionContext,
  req: PlayRequest,
): Promise<{ delivery: SegmentDelivery; round: ActiveRound | null }> {
  const betAmount = ctx.allowedBets[req.betIndex];
  if (betAmount === undefined) {
    throw new Error(`bet_index ${req.betIndex} вне allowed_bets`);
  }

  const state: RoundStateV1 = {
    v: 1,
    seed: newSeed(),
    eid: newEngineRoundId(),
    script: '',
    action: req.action,
    betIndex: req.betIndex,
    priceMultiplier: resolvePriceMultiplier(deps, req.action, Boolean(ctx.frcId)),
    cursor: 0,
    totalWinX: 0,
    actions: [],
    frcId: ctx.frcId,
  };

  const first = await openEntry(deps.engine, deps.gameId, state);
  return first.isFinal
    ? finishSimple(deps, ctx, state, first, betAmount)
    : openComplex(deps, ctx, state, first, betAmount);
}

/** Раунд из одного сегмента: ставка и выигрыш одной транзакцией. */
async function finishSimple(
  deps: RoundDeps,
  ctx: SessionContext,
  state: RoundStateV1,
  segment: Segment,
  betAmount: number,
): Promise<{ delivery: SegmentDelivery; round: null }> {
  const settled: RoundStateV1 = { ...state, cursor: 1, totalWinX: segment.totalWinX };
  const res = await deps.api.playRound({
    session_id: ctx.sessionId,
    price_multiplier: state.priceMultiplier,
    bet_index: state.betIndex,
    win_multiplier: segment.totalWinX,
    free_round_campaign_id: ctx.frcId,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState(settled),
  });
  const delivery = toDelivery(
    segment, res.round_id, betAmount, res.balance, false, res.is_platform_max_win_reached,
  );
  delivery.frc = res.free_round_campaign ?? null;
  return { delivery, round: null };
}

/** Заглушка на время Task 7 — многосегментный путь приходит в Task 8. */
async function openComplex(
  _deps: RoundDeps,
  _ctx: SessionContext,
  _state: RoundStateV1,
  _first: Segment,
  _betAmount: number,
): Promise<{ delivery: SegmentDelivery; round: ActiveRound | null }> {
  throw new Error('complex round not implemented yet');
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server -- orchestrator-simple`
Expected: PASS, 8 тестов

- [ ] **Step 7: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): оркестратор простого раунда через PlayRound"
```

---

### Task 8: Оркестратор — сложный раунд (`OpenRound` → `UpdateRoundState` → `CloseRound`)

**Files:**
- Modify: `packages/artube-server/src/round/orchestrator.ts` (заменить заглушку `openComplex`, добавить `advanceRound` и `acknowledgeSegment`)
- Test: `packages/artube-server/tests/orchestrator-complex.test.ts`

**Interfaces:**
- Consumes: из Task 6 — `ensureOpen`, `stepRound`; из Task 7 — `RoundDeps`, `ActiveRound`, `SegmentDelivery`, `startRound`, `toDelivery`.
- Produces: `async function advanceRound(deps, ctx, round, req): Promise<{ delivery: SegmentDelivery; round: ActiveRound | null }>`; `async function acknowledgeSegment(deps, ctx, round, cursor): Promise<ActiveRound>`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-server/tests/orchestrator-complex.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
import {
  startRound, advanceRound, acknowledgeSegment, type ActiveRound, type RoundDeps,
} from '../src/round/orchestrator';
import { decodeRoundState } from '../src/round/roundState';
import type { SessionContext } from '../src/session/types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
}, 30_000);

afterAll(() => engine?.close());

const ctx: SessionContext = {
  sessionId: 'sess-1', currency: 'USD', allowedBets: [0.1, 0.5, 1, 5],
};

function fakeApi() {
  let version = 0;
  return {
    playRound: vi.fn(async () => ({
      round_id: 'r', balance: 0, win: 0, is_platform_max_win_reached: false,
    })),
    openRound: vi.fn(async () => ({ round_version: 0, round_id: 'round-complex', balance: 95 })),
    updateRoundState: vi.fn(async () => ({ round_version: ++version })),
    closeRound: vi.fn(async () => ({ balance: 98, free_round_campaign: null })),
    autocloseRound: vi.fn(async () => ({ balance: 98 })),
  };
}

function deps(api: ReturnType<typeof fakeApi>): RoundDeps {
  return {
    api, engine, gameId: 'feature-game',
    costMultipliers: { spin: 1, buy_bonus: 5, free_spin: 1 },
  };
}

/** Пройти раунд целиком: spin + три фриспина, подтверждая каждый сегмент. */
async function playWhole(api: ReturnType<typeof fakeApi>) {
  const d = deps(api);
  const deliveries = [];
  const out = await startRound(d, ctx, { id: 'p0', action: 'spin', betIndex: 2 });
  deliveries.push(out.delivery);
  let round: ActiveRound | null = await acknowledgeSegment(d, ctx, out.round!, 1);
  let i = 0;
  while (round) {
    const next = await advanceRound(d, ctx, round, {
      id: `p${++i}`, action: 'free_spin', betIndex: 2,
    });
    deliveries.push(next.delivery);
    round = next.round ? await acknowledgeSegment(d, ctx, next.round, next.round.state.cursor + 1) : null;
  }
  return deliveries;
}

describe('оркестратор — сложный раунд', () => {
  it('многосегментный раунд открывается через OpenRound', async () => {
    const api = fakeApi();
    const out = await startRound(deps(api), ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    expect(api.openRound).toHaveBeenCalledTimes(1);
    expect(api.playRound).not.toHaveBeenCalled();
    expect(out.round).not.toBeNull();
    expect(out.round!.roundId).toBe('round-complex');
    expect(out.round!.roundVersion).toBe(0);
  });

  it('в OpenRound нет win_multiplier — выигрыш ещё не сыгран', async () => {
    const api = fakeApi();
    await startRound(deps(api), ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    const sent = api.openRound.mock.calls[0][0];
    expect(sent.bet_index).toBe(2);
    expect(sent.price_multiplier).toBe(1);
    expect(sent).not.toHaveProperty('win_multiplier');
  });

  it('первый сегмент отдаётся с creditPending и без баланса раунда', async () => {
    const api = fakeApi();
    const { delivery } = await startRound(deps(api), ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    expect(delivery.creditPending).toBe(true);
    expect(delivery.action).toBe('spin');
    expect(delivery.winX).toBe(0);
    expect(delivery.nextActions).toEqual(['free_spin']);
  });

  it('подтверждение сегмента двигает курсор через UpdateRoundState', async () => {
    const api = fakeApi();
    const d = deps(api);
    const { round } = await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    const advanced = await acknowledgeSegment(d, ctx, round!, 1);
    expect(api.updateRoundState).toHaveBeenCalledTimes(1);
    const sent = api.updateRoundState.mock.calls[0][0];
    expect(sent.round_id).toBe('round-complex');
    expect(sent.round_version).toBe(0); // версия из OpenRoundResponse
    expect(decodeRoundState(sent.round_state).cursor).toBe(1);
    expect(advanced.roundVersion).toBe(1); // версия из ответа
    expect(advanced.state.cursor).toBe(1);
  });

  it('каждый сегмент — один шаг движка, лог действий растёт', async () => {
    const api = fakeApi();
    const d = deps(api);
    const { round } = await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    const acked = await acknowledgeSegment(d, ctx, round!, 1);
    const next = await advanceRound(d, ctx, acked, { id: 'p2', action: 'free_spin', betIndex: 2 });
    expect(next.delivery.winX).toBe(1);
    expect(next.round!.state.actions).toEqual([{ a: 'free_spin' }]);
  });

  it('интерактивный выбор игрока попадает в лог — иначе раунд не поднять', async () => {
    const api = fakeApi();
    const d = deps(api);
    const { round } = await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    const acked = await acknowledgeSegment(d, ctx, round!, 1);
    const next = await advanceRound(d, ctx, acked, {
      id: 'p2', action: 'free_spin', betIndex: 2, params: { pick: 3 },
    });
    expect(next.round!.state.actions).toEqual([{ a: 'free_spin', p: { pick: 3 } }]);
  });

  it('раунд доигрывается до конца и закрывается CloseRound', async () => {
    const api = fakeApi();
    const deliveries = await playWhole(api);
    expect(deliveries).toHaveLength(4);
    expect(deliveries.map((d) => d.winX)).toEqual([0, 1, 1, 1]);
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    const closed = api.closeRound.mock.calls[0][0];
    expect(closed.win_multiplier).toBe(3);
    expect(closed.status).toBe('completed');
  });

  it('баланс появляется только на финальном сегменте', async () => {
    const api = fakeApi();
    const deliveries = await playWhole(api);
    expect(deliveries.slice(0, 3).map((d) => d.balanceAfter)).toEqual([null, null, null]);
    expect(deliveries.slice(0, 3).every((d) => d.creditPending)).toBe(true);
    expect(deliveries[3].balanceAfter).toBe(98);
    expect(deliveries[3].creditPending).toBe(false);
  });

  it('CloseRound везёт round_version из последнего UpdateRoundState', async () => {
    const api = fakeApi();
    await playWhole(api);
    const updates = api.updateRoundState.mock.results;
    const lastVersion = (await (updates.at(-1)!.value as Promise<{ round_version: number }>)).round_version;
    expect(api.closeRound.mock.calls[0][0].round_version).toBe(lastVersion);
  });

  it('чужое действие в незакрытом раунде отвергается', async () => {
    const api = fakeApi();
    const d = deps(api);
    const { round } = await startRound(d, ctx, { id: 'p1', action: 'spin', betIndex: 2 });
    await expect(
      advanceRound(d, ctx, round!, { id: 'p2', action: 'buy_bonus', betIndex: 2 }),
    ).rejects.toThrow(/not allowed/);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- orchestrator-complex`
Expected: FAIL — `complex round not implemented yet`

- [ ] **Step 3: Реализовать открытие сложного раунда**

В `packages/artube-server/src/round/orchestrator.ts` добавить импорт `import { ensureOpen, stepRound } from './engineRound';` и заменить заглушку:

```ts
/**
 * Раунд из нескольких сегментов: OpenRound списывает ставку, выигрыш
 * зачислится только на CloseRound. До тех пор сегменты уезжают во фронт
 * с `creditPending`, а баланс раунда остаётся неизвестным.
 */
async function openComplex(
  deps: RoundDeps,
  ctx: SessionContext,
  state: RoundStateV1,
  first: Segment,
  betAmount: number,
): Promise<{ delivery: SegmentDelivery; round: ActiveRound }> {
  const res = await deps.api.openRound({
    session_id: ctx.sessionId,
    price_multiplier: state.priceMultiplier,
    bet_index: state.betIndex,
    free_round_campaign_id: ctx.frcId,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState(state),
  });
  return {
    delivery: toDelivery(first, res.round_id, betAmount, null, true, false),
    round: {
      roundId: res.round_id,
      roundVersion: res.round_version,
      state,
      delivered: first,
    },
  };
}
```

- [ ] **Step 4: Реализовать подтверждение и продвижение**

Добавить в тот же файл:

```ts
/**
 * Игрок увидел сегмент — двигаем курсор в состоянии платформы.
 *
 * Именно поэтому UpdateRoundState шлётся на подтверждении, а не на выдаче:
 * реконнект посреди фичи должен вернуть неподтверждённый сегмент, а не
 * съесть его.
 */
export async function acknowledgeSegment(
  deps: RoundDeps,
  ctx: SessionContext,
  round: ActiveRound,
  cursor: number,
): Promise<ActiveRound> {
  const state: RoundStateV1 = {
    ...round.state,
    cursor,
    totalWinX: round.delivered?.totalWinX ?? round.state.totalWinX,
  };
  const res = await deps.api.updateRoundState({
    session_id: ctx.sessionId,
    round_id: round.roundId,
    round_version: round.roundVersion,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState(state),
  });
  return { ...round, roundVersion: res.round_version, state };
}

/**
 * Следующий сегмент открытого раунда — ровно один шаг движка. На финальном
 * шлём CloseRound, и только он приносит настоящий баланс.
 */
export async function advanceRound(
  deps: RoundDeps,
  ctx: SessionContext,
  round: ActiveRound,
  req: PlayRequest,
): Promise<{ delivery: SegmentDelivery; round: ActiveRound | null }> {
  const allowed = round.delivered?.nextActions ?? [];
  if (allowed.length > 0 && !allowed.includes(req.action)) {
    throw new Error(`action "${req.action}" is not allowed here, expected one of ${allowed.join(', ')}`);
  }

  // Горячий путь ничего не стоит; холодный поднимет раунд из лога действий.
  await ensureOpen(deps.engine, deps.gameId, round.state);
  const segment = await stepRound(deps.engine, round.state, req.action, req.params);

  // Действие обязано попасть в лог до того, как состояние уедет к Artube:
  // без него холодный подъём воспроизведёт другой раунд.
  const logged = req.params ? { a: req.action, p: req.params } : { a: req.action };
  const state: RoundStateV1 = { ...round.state, actions: [...round.state.actions, logged] };
  const betAmount = ctx.allowedBets[state.betIndex];

  if (!segment.isFinal) {
    return {
      delivery: toDelivery(segment, round.roundId, betAmount, null, true, false),
      round: { ...round, state, delivered: segment },
    };
  }

  const finalState: RoundStateV1 = {
    ...state,
    cursor: state.cursor + 1,
    totalWinX: segment.totalWinX,
  };
  const res = await deps.api.closeRound({
    session_id: ctx.sessionId,
    round_id: round.roundId,
    win_multiplier: segment.totalWinX,
    status: 'completed',
    round_version: round.roundVersion,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState(finalState),
  });
  const delivery = toDelivery(segment, round.roundId, betAmount, res.balance, false, false);
  delivery.frc = res.free_round_campaign ?? null;
  return { delivery, round: null };
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: PASS — все тесты Task 1–8

- [ ] **Step 6: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): сложный раунд — шаг на сегмент, creditPending и подтверждение курсора"
```

---

### Task 9: Восстановление незакрытого раунда и автозакрытие

**Files:**
- Create: `packages/artube-server/src/round/resume.ts`
- Test: `packages/artube-server/tests/resume.test.ts`

**Interfaces:**
- Consumes: из Task 6 — `decodeRoundState`, `ensureOpen`, `stepRound`, `playToEnd`, `ScriptMismatchError`; из Task 7/8 — `RoundDeps`, `ActiveRound`, `toDelivery`.
- Produces: `interface ResumeOutcome { delivery: SegmentDelivery; round: ActiveRound | null; recovered: boolean }`; `async function resumeRound(deps, ctx, lastRound: LastRound): Promise<ResumeOutcome | null>`; `async function autocloseRound(deps, ctx, lastRound: LastRound): Promise<number>`.

> Восстановление всегда идёт холодным путём: игрок вернулся после разрыва, и раунда в
> кэше движка, скорее всего, уже нет. `ensureOpen` догоняет курсор по логу действий и
> отдаёт неподтверждённый сегмент заново.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-server/tests/resume.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startEngine, type EngineClient } from '../src/engine';
import { resumeRound, autocloseRound } from '../src/round/resume';
import { encodeRoundState, newEngineRoundId, type RoundStateV1 } from '../src/round/roundState';
import type { RoundDeps } from '../src/round/orchestrator';
import type { SessionContext } from '../src/session/types';
import type { LastRound } from '../src/games-api/types';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let engine: EngineClient;
let scriptSha: string;

beforeAll(async () => {
  engine = await startEngine({ gamesDir: fixtures });
  scriptSha = (await engine.listGames()).find((g) => g.game_id === 'feature-game')!.script_sha256;
}, 30_000);

afterAll(() => engine?.close());

const ctx: SessionContext = { sessionId: 's1', currency: 'USD', allowedBets: [0.1, 0.5, 1, 5] };

function fakeApi() {
  return {
    playRound: vi.fn(async () => ({ round_id: 'r', balance: 0, win: 0, is_platform_max_win_reached: false })),
    openRound: vi.fn(async () => ({ round_version: 0, round_id: 'r', balance: 0 })),
    updateRoundState: vi.fn(async () => ({ round_version: 2 })),
    closeRound: vi.fn(async () => ({ balance: 150, free_round_campaign: null })),
    autocloseRound: vi.fn(async () => ({ balance: 150 })),
  };
}

function deps(api: ReturnType<typeof fakeApi>): RoundDeps {
  return { api, engine, gameId: 'feature-game', costMultipliers: { spin: 1, free_spin: 1 } };
}

/** Незакрытый раунд, у которого подтверждено `cursor` сегментов. */
function lastRound(over: Partial<RoundStateV1> = {}, finished: string | null = null): LastRound {
  const cursor = over.cursor ?? 1;
  const full: RoundStateV1 = {
    v: 1, seed: { server: 'srv-r', client: 'cli', nonce: 3 }, eid: newEngineRoundId(),
    script: scriptSha, action: 'spin', betIndex: 2, priceMultiplier: 1,
    cursor, totalWinX: Math.max(0, cursor - 1),
    actions: Array.from({ length: Math.max(0, cursor - 1) }, () => ({ a: 'free_spin' })),
    ...over,
  };
  return {
    round_id: 'round-open', price_multiplier: 1, bet_index: 2, win_multiplier: 0, win: 0,
    started_at: '2026-08-10T10:00:00.000Z', finished_at: finished,
    round_version: 1, round_state_version: '1', round_state: encodeRoundState(full),
    is_platform_max_win_reached: false,
  };
}

describe('восстановление раунда', () => {
  it('закрытый раунд восстанавливать нечего', async () => {
    const res = await resumeRound(deps(fakeApi()), ctx, lastRound({}, '2026-08-10T10:00:05.000Z'));
    expect(res).toBeNull();
  });

  it('возвращает неподтверждённый сегмент, на котором игрок остановился', async () => {
    // cursor 2 — подтверждены spin и первый фриспин; показываем второй фриспин
    const res = await resumeRound(deps(fakeApi()), ctx, lastRound({ cursor: 2 }));
    expect(res).not.toBeNull();
    expect(res!.recovered).toBe(false);
    expect(res!.delivery.action).toBe('free_spin');
    expect(res!.delivery.winX).toBe(1);
    expect(res!.delivery.creditPending).toBe(true);
    expect(res!.round!.roundId).toBe('round-open');
    expect(res!.round!.roundVersion).toBe(1);
  });

  it('если оставался последний сегмент — раунд закрывается', async () => {
    const api = fakeApi();
    const res = await resumeRound(deps(api), ctx, lastRound({ cursor: 4 }));
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    expect(api.closeRound.mock.calls[0][0].win_multiplier).toBe(3);
    expect(res!.round).toBeNull();
    expect(res!.delivery.balanceAfter).toBe(150);
  });

  it('разъехавшийся скрипт закрывает раунд накопленным выигрышем', async () => {
    const api = fakeApi();
    const res = await resumeRound(
      deps(api), ctx, lastRound({ script: 'sha-старый', cursor: 3, totalWinX: 2 }),
    );
    expect(res!.recovered).toBe(true);
    expect(api.closeRound).toHaveBeenCalledTimes(1);
    const closed = api.closeRound.mock.calls[0][0];
    expect(closed.win_multiplier).toBe(2); // накопленное из round_state, не ноль
    expect(closed.status).toBe('completed');
    expect(res!.round).toBeNull();
  });

  it('автозакрытие доигрывает раунд и шлёт AutocloseRoundRequest', async () => {
    const api = fakeApi();
    const balance = await autocloseRound(deps(api), ctx, lastRound({ cursor: 1 }));
    expect(api.autocloseRound).toHaveBeenCalledTimes(1);
    const sent = api.autocloseRound.mock.calls[0][0];
    expect(sent.round_id).toBe('round-open');
    expect(sent.win_multiplier).toBe(3); // полный математический итог, не откат
    expect(sent.status).toBe('completed');
    expect(sent.round_version).toBe(1);
    expect(balance).toBe(150);
  });

  it('автозакрытие при разъехавшемся скрипте берёт накопленное', async () => {
    const api = fakeApi();
    await autocloseRound(deps(api), ctx, lastRound({ script: 'sha-старый', cursor: 3, totalWinX: 2 }));
    expect(api.autocloseRound.mock.calls[0][0].win_multiplier).toBe(2);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- resume`
Expected: FAIL — `Cannot find module '../src/round/resume'`

- [ ] **Step 3: Реализовать восстановление**

`packages/artube-server/src/round/resume.ts`:

```ts
/**
 * Восстановление незакрытого раунда и автозакрытие.
 *
 * Оба сценария начинаются одинаково: берём `round_state` из платформы и
 * поднимаем раунд в движке холодным путём. Если поднять нельзя — скрипт
 * разъехался после деплоя — закрываем раунд накопленным множителем: игрок
 * получает деньги, хоть и не досматривает фичу.
 */

import { ROUND_STATE_VERSION, decodeRoundState, encodeRoundState, type RoundStateV1 } from './roundState';
import { ensureOpen, playToEnd, stepRound, ScriptMismatchError, type Segment } from './engineRound';
import { toDelivery, type ActiveRound, type RoundDeps } from './orchestrator';
import type { SegmentDelivery, SessionContext } from '../session/types';
import type { LastRound } from '../games-api/types';

export interface ResumeOutcome {
  delivery: SegmentDelivery;
  /** `null` — раунд закрыт, продолжать нечего. */
  round: ActiveRound | null;
  /** true — раунд не удалось воспроизвести и он был закрыт аварийно. */
  recovered: boolean;
}

/** Синтетический сегмент для случая, когда раунд поднять не удалось. */
function recoveredSegment(state: RoundStateV1): Segment {
  return {
    action: state.action,
    data: { stage: 'recovered' },
    winX: state.totalWinX,
    totalWinX: state.totalWinX,
    nextActions: ['spin'],
    spinsRemaining: 0,
    spinsPlayed: state.cursor,
    isFinal: true,
  };
}

async function closeWith(
  deps: RoundDeps,
  ctx: SessionContext,
  lastRound: LastRound,
  state: RoundStateV1,
  winX: number,
): Promise<number> {
  const res = await deps.api.closeRound({
    session_id: ctx.sessionId,
    round_id: lastRound.round_id,
    win_multiplier: winX,
    status: 'completed',
    round_version: lastRound.round_version,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState({ ...state, totalWinX: winX }),
  });
  return res.balance;
}

/**
 * Вернуть игрока туда, где он остановился. `null` — восстанавливать нечего:
 * раунд уже закрыт платформой.
 */
export async function resumeRound(
  deps: RoundDeps,
  ctx: SessionContext,
  lastRound: LastRound,
): Promise<ResumeOutcome | null> {
  if (lastRound.finished_at) return null;

  const state = decodeRoundState(lastRound.round_state);
  const betAmount = ctx.allowedBets[state.betIndex] ?? 0;

  let segment: Segment;
  try {
    await ensureOpen(deps.engine, deps.gameId, state);
    // Неподтверждённый сегмент переигрываем заново: игрок его не досмотрел.
    const known = await deps.engine.getRound(state.eid);
    segment = await stepRound(deps.engine, state, known.next_actions[0]);
  } catch (err) {
    if (!(err instanceof ScriptMismatchError)) throw err;
    const balance = await closeWith(deps, ctx, lastRound, state, state.totalWinX);
    return {
      delivery: toDelivery(recoveredSegment(state), lastRound.round_id, betAmount, balance, false, false),
      round: null,
      recovered: true,
    };
  }

  const nextState: RoundStateV1 = { ...state, actions: [...state.actions, { a: segment.action }] };

  if (segment.isFinal) {
    const balance = await closeWith(deps, ctx, lastRound, nextState, segment.totalWinX);
    return {
      delivery: toDelivery(segment, lastRound.round_id, betAmount, balance, false, false),
      round: null,
      recovered: false,
    };
  }

  return {
    delivery: toDelivery(segment, lastRound.round_id, betAmount, null, true, false),
    round: {
      roundId: lastRound.round_id,
      roundVersion: lastRound.round_version,
      state: nextState,
      delivered: segment,
    },
    recovered: false,
  };
}

/**
 * Автозакрытие v2: доигрываем раунд от лица игрока и отдаём платформе честный
 * математический итог. Провал этого пути платформа через минуту добьёт
 * откатом v1, поэтому ошибки наружу не глотаем.
 */
export async function autocloseRound(
  deps: RoundDeps,
  ctx: SessionContext,
  lastRound: LastRound,
): Promise<number> {
  const state = decodeRoundState(lastRound.round_state);
  let winX = state.totalWinX;
  try {
    winX = await playToEnd(deps.engine, deps.gameId, state);
  } catch (err) {
    if (!(err instanceof ScriptMismatchError)) throw err;
    // Поднять раунд нечем — отдаём то, что игрок уже накопил.
  }
  const res = await deps.api.autocloseRound({
    session_id: ctx.sessionId,
    round_id: lastRound.round_id,
    win_multiplier: winX,
    status: 'completed',
    round_version: lastRound.round_version,
    round_state_version: ROUND_STATE_VERSION,
    round_state: encodeRoundState({ ...state, totalWinX: winX }),
  });
  return res.balance;
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: PASS — все тесты Task 1–9

- [ ] **Step 5: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): восстановление незакрытого раунда и автозакрытие v2"
```

---


### Task 10: Сессия — INIT, демо-режим, FRC и max-win

**Files:**
- Create: `packages/artube-server/src/session/init.ts`
- Test: `packages/artube-server/tests/session-init.test.ts`

**Interfaces:**
- Consumes: из Task 2 — `SessionInfoResponse`, `GameSettings`, `FreeRoundCampaign`; из Task 7 — `SessionContext`.
- Produces: `interface InitPayload { currency: string | null; balance: number; demo: boolean; config: InitConfig; frc: FrcInfo | null; gamificationToken?: string }`; `interface InitConfig { betLevels: number[]; defaultBetIndex: number; currencyMinimalUnit: number; autoSpinCounts: number[]; locales: string[]; rtp: { isVisible: boolean; shownRtp?: number }; platformMaxWin: { isVisible: boolean; playerCurrencyValue: number; baseCurrency: string } | null }`; `interface FrcInfo { campaignId: string; roundsLeft: number; roundsTotal: number; totalWin: number; isComplete: boolean }`; `function buildInit(info: SessionInfoResponse): InitPayload`; `function toSessionContext(sessionId: string, info: SessionInfoResponse): SessionContext`; `function isDemoSession(info: SessionInfoResponse): boolean`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-server/tests/session-init.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildInit, toSessionContext, isDemoSession } from '../src/session/init';
import type { SessionInfoResponse } from '../src/games-api/types';

function info(overrides: Partial<SessionInfoResponse> = {}): SessionInfoResponse {
  return {
    security_hash: 'h',
    currency: 'USD',
    balance: 150.75,
    game_settings: {
      default_bet_index: 3,
      currency_minimal_unit: 0.01,
      allowed_bets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      available_auto_spin_counts: [10, 25, 50],
      rtp_options: [],
      rtp_settings: { is_visible: true, shown_rtp: 94.2 },
      locales: ['EN', 'RU'],
      platform_max_win: {
        is_visible: true, base_currency: 'EUR',
        base_currency_value: 1000, player_currency_value: 870,
      },
    },
    ...overrides,
  };
}

describe('инициализация сессии', () => {
  it('allowed_bets становятся betLevels для фронта', () => {
    const init = buildInit(info());
    expect(init.config.betLevels).toEqual([0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
    expect(init.config.defaultBetIndex).toBe(3);
  });

  it('баланс и валюта берутся из платформы как есть', () => {
    const init = buildInit(info());
    expect(init.balance).toBe(150.75);
    expect(init.currency).toBe('USD');
    expect(init.demo).toBe(false);
  });

  it('currency null означает демо-сессию', () => {
    expect(isDemoSession(info({ currency: null }))).toBe(true);
    expect(buildInit(info({ currency: null })).demo).toBe(true);
  });

  it('настройки max-win едут во фронт для экрана правил', () => {
    const init = buildInit(info());
    expect(init.config.platformMaxWin).toEqual({
      isVisible: true, playerCurrencyValue: 870, baseCurrency: 'EUR',
    });
  });

  it('отображаемый RTP берётся из rtp_settings, а не из rtp_options', () => {
    const init = buildInit(info());
    expect(init.config.rtp).toEqual({ isVisible: true, shownRtp: 94.2 });
  });

  it('кампания фри-раундов пробрасывается', () => {
    const init = buildInit(info({
      free_round_campaign: {
        campaign_id: 'c1', rounds_total: 10, rounds_left: 5,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 10, is_complete: false,
      },
    }));
    expect(init.frc).toEqual({
      campaignId: 'c1', roundsLeft: 5, roundsTotal: 10, totalWin: 10, isComplete: false,
    });
  });

  it('завершённая кампания не считается активной', () => {
    const init = buildInit(info({
      free_round_campaign: {
        campaign_id: 'c1', rounds_total: 10, rounds_left: 0,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 10, is_complete: true,
      },
    }));
    expect(init.frc!.isComplete).toBe(true);
    expect(toSessionContext('s1', info({
      free_round_campaign: {
        campaign_id: 'c1', rounds_total: 10, rounds_left: 0,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 10, is_complete: true,
      },
    })).frcId).toBeUndefined();
  });

  it('контекст сессии несёт активную кампанию и ставки', () => {
    const ctx = toSessionContext('s1', info({
      free_round_campaign: {
        campaign_id: 'c9', rounds_total: 10, rounds_left: 3,
        valid_from: '2026-01-01T00:00:00.000Z', valid_to: '2026-12-31T00:00:00.000Z',
        bet: 1, total_win: 0, is_complete: false,
      },
    }));
    expect(ctx.sessionId).toBe('s1');
    expect(ctx.frcId).toBe('c9');
    expect(ctx.allowedBets).toHaveLength(7);
  });

  it('токен геймификации пробрасывается без изменений', () => {
    const init = buildInit(info({ gamification_token: 'jwt.token.value' }));
    expect(init.gamificationToken).toBe('jwt.token.value');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- session-init`
Expected: FAIL — `Cannot find module '../src/session/init'`

- [ ] **Step 3: Реализовать**

`packages/artube-server/src/session/init.ts`:

```ts
/**
 * Перевод SessionInfoResponse в то, что нужно фронту при старте.
 *
 * Ничего не вычисляем: баланс, валюта, набор ставок и лимит максвина — всё
 * платформенное, мы только переименовываем поля в camelCase.
 */

import type { SessionInfoResponse } from '../games-api/types';
import type { SessionContext } from './types';

export interface FrcInfo {
  campaignId: string;
  roundsLeft: number;
  roundsTotal: number;
  totalWin: number;
  isComplete: boolean;
}

export interface InitConfig {
  betLevels: number[];
  defaultBetIndex: number;
  currencyMinimalUnit: number;
  autoSpinCounts: number[];
  locales: string[];
  rtp: { isVisible: boolean; shownRtp?: number };
  platformMaxWin: { isVisible: boolean; playerCurrencyValue: number; baseCurrency: string } | null;
}

export interface InitPayload {
  currency: string | null;
  balance: number;
  demo: boolean;
  config: InitConfig;
  frc: FrcInfo | null;
  gamificationToken?: string;
}

/**
 * Демо-сессия по доке — та, у которой `currency` равна `null`. Games API
 * отвечает `OperationNotAllowed` на любые раундовые RPC такой сессии.
 */
export function isDemoSession(info: SessionInfoResponse): boolean {
  return info.currency === null;
}

export function buildInit(info: SessionInfoResponse): InitPayload {
  const s = info.game_settings;
  const maxWin = s.platform_max_win;
  return {
    currency: info.currency,
    balance: info.balance,
    demo: isDemoSession(info),
    config: {
      betLevels: s.allowed_bets,
      defaultBetIndex: s.default_bet_index,
      currencyMinimalUnit: s.currency_minimal_unit,
      autoSpinCounts: s.available_auto_spin_counts,
      locales: s.locales,
      // Дока: значение rtp в rtp_options перезаписывается сервером и для
      // показа не годится — показываем только rtp_settings.
      rtp: { isVisible: s.rtp_settings.is_visible, shownRtp: s.rtp_settings.shown_rtp },
      platformMaxWin: maxWin
        ? {
            isVisible: maxWin.is_visible,
            playerCurrencyValue: maxWin.player_currency_value,
            baseCurrency: maxWin.base_currency,
          }
        : null,
    },
    frc: info.free_round_campaign
      ? {
          campaignId: info.free_round_campaign.campaign_id,
          roundsLeft: info.free_round_campaign.rounds_left,
          roundsTotal: info.free_round_campaign.rounds_total,
          totalWin: info.free_round_campaign.total_win,
          isComplete: info.free_round_campaign.is_complete,
        }
      : null,
    gamificationToken: info.gamification_token,
  };
}

export function toSessionContext(sessionId: string, info: SessionInfoResponse): SessionContext {
  const campaign = info.free_round_campaign;
  // Кампанию считаем активной только пока есть неизрасходованные раунды:
  // иначе платформа ответит FrcAlreadyCompleted на первый же спин.
  const active = campaign && !campaign.is_complete && campaign.rounds_left > 0;
  return {
    sessionId,
    currency: info.currency,
    allowedBets: info.game_settings.allowed_bets,
    frcId: active ? campaign!.campaign_id : undefined,
  };
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: PASS — все тесты Task 1–10

- [ ] **Step 5: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): INIT сессии — ставки, max-win, FRC и признак демо"
```

---

### Task 11: HTTP/WS сервис — `/api/ws`, health-пробы, JSON-логи

**Files:**
- Create: `packages/artube-server/src/http/log.ts`
- Create: `packages/artube-server/src/http/wire.ts`
- Create: `packages/artube-server/src/http/ws.ts`
- Create: `packages/artube-server/src/http/server.ts`
- Create: `packages/artube-server/src/config.ts`
- Create: `packages/artube-server/src/index.ts`
- Test: `packages/artube-server/tests/http.test.ts`

**Interfaces:**
- Consumes: из Task 4 — `GamesApiClient`; Task 5 — `startEngine`; Task 7/8 — `startRound`, `advanceRound`, `acknowledgeSegment`; Task 9 — `resumeRound`, `autocloseRound`; Task 10 — `buildInit`, `toSessionContext`, `isDemoSession`.
- Produces: типы провода `ClientMessage = { t: 'play'; … } | { t: 'ack'; … }` и `ServerMessage = { t: 'init' | 'result' | 'balance' | 'session_closed' | 'error'; … }`; `interface ArtubeServerConfig { gameId: string; gamesApiUrl: string; apiKey: string; spinPath: string; port?: number; startingDemoBalance?: number }`; `function loadConfigFromEnv(): ArtubeServerConfig`; `class ArtubeServer { listen(port?: number): Promise<void>; close(): Promise<void> }`; `function createArtubeServer(config): ArtubeServer`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-server/tests/http.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createArtubeServer, type ArtubeServer } from '../src/index';
import { startFakeGamesApi, type FakeGamesApi } from './helpers/fakeGamesApi';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
let api: FakeGamesApi;
let server: ArtubeServer;
let base: string;

/** Фейковый Games API, отвечающий на весь цикл раунда. */
function responder(sessionCurrency: string | null = 'USD') {
  return (env: any, socket: any, self: FakeGamesApi) => {
    const reply = (type: string, payload: unknown) =>
      self.send(socket, {
        proto: 1, schema: 1, chan: 'rpc', type,
        id: `res-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
        timestamp: new Date().toISOString(), payload,
      });
    if (env.type === 'SessionInfoRequest') {
      reply('SessionInfoResponse', {
        security_hash: 'h', currency: sessionCurrency, balance: 100,
        game_settings: {
          default_bet_index: 0, currency_minimal_unit: 0.01, allowed_bets: [1],
          available_auto_spin_counts: [10], rtp_options: [],
          rtp_settings: { is_visible: false }, locales: ['EN'],
        },
      });
    }
    if (env.type === 'OpenRoundRequest') {
      reply('OpenRoundResponse', { round_version: 0, round_id: 'round-1', balance: 99 });
    }
    if (env.type === 'UpdateRoundStateRequest') reply('UpdateRoundStateResponse', { round_version: 1 });
    if (env.type === 'CloseRoundRequest') reply('CloseRoundResponse', { balance: 102 });
  };
}

/** Открыть WS к нашему серверу и собирать входящие сообщения. */
function connect(url: string) {
  const socket = new WebSocket(url);
  const messages: any[] = [];
  socket.on('message', (d) => messages.push(JSON.parse(d.toString())));
  const waitFor = (t: string, timeoutMs = 5000) =>
    new Promise<any>((resolve, reject) => {
      const started = Date.now();
      const tick = setInterval(() => {
        const found = messages.find((m) => m.t === t);
        if (found) { clearInterval(tick); resolve(found); }
        else if (Date.now() - started > timeoutMs) { clearInterval(tick); reject(new Error(`no ${t}`)); }
      }, 10);
    });
  const open = new Promise<void>((resolve) => socket.on('open', () => resolve()));
  return { socket, messages, waitFor, open };
}

beforeAll(async () => {
  api = await startFakeGamesApi({ onMessage: responder() });
  server = createArtubeServer({
    gameId: 'feature-game',
    gamesApiUrl: api.url,
    apiKey: 'k',
    spinPath: fixtures,
  });
  await server.listen(0);
  base = `ws://127.0.0.1:${server.port}`;
}, 40_000);

afterAll(async () => {
  await server?.close();
  await api?.close();
});

describe('HTTP-слой', () => {
  it('отвечает на health-пробы Kubernetes', async () => {
    const http = `http://127.0.0.1:${server.port}`;
    expect((await fetch(`${http}/livez`)).status).toBe(200);
    expect((await fetch(`${http}/healthz`)).status).toBe(200);
  });

  it('версия отдаётся под префиксом /api', async () => {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/version`);
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveProperty('gameId', 'feature-game');
  });

  it('WS без sessionId отвергается', async () => {
    const { socket } = connect(`${base}/api/ws`);
    const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));
    expect(await closed).toBe(1008);
  });
});

describe('WS-цикл раунда', () => {
  it('на подключении отдаёт init из SessionInfo', async () => {
    const c = connect(`${base}/api/ws?sessionId=sess-1`);
    await c.open;
    const init = await c.waitFor('init');
    expect(init.balance).toBe(100);
    expect(init.currency).toBe('USD');
    expect(init.config.betLevels).toEqual([1]);
    c.socket.close();
  });

  it('play отдаёт сегмент, ack двигает курсор, финал приносит баланс', async () => {
    const c = connect(`${base}/api/ws?sessionId=sess-2`);
    await c.open;
    await c.waitFor('init');

    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const first = await c.waitFor('result');
    expect(first.id).toBe('p0');
    expect(first.creditPending).toBe(true);
    expect(first.balanceAfter).toBeNull();
    expect(first.nextActions).toEqual(['free_spin']);

    c.socket.send(JSON.stringify({ t: 'ack', roundId: first.roundId, cursor: 1 }));
    for (let i = 1; i <= 3; i++) {
      const before = c.messages.length;
      c.socket.send(JSON.stringify({ t: 'play', id: `p${i}`, action: 'free_spin', betIndex: 0 }));
      await new Promise<void>((resolve) => {
        const tick = setInterval(() => {
          if (c.messages.length > before) { clearInterval(tick); resolve(); }
        }, 10);
      });
      const last = c.messages.at(-1);
      expect(last.t).toBe('result');
      if (i < 3) {
        c.socket.send(JSON.stringify({ t: 'ack', roundId: last.roundId, cursor: i + 1 }));
      } else {
        expect(last.creditPending).toBe(false);
        expect(last.balanceAfter).toBe(102);
        expect(last.totalWinX).toBe(3);
      }
    }
    c.socket.close();
  });

  it('ошибка платформы приезжает во фронт как error с кодом', async () => {
    const failing = await startFakeGamesApi({
      onMessage: (env, socket, self) => {
        responder()(env, socket, self);
        if (env.type === 'OpenRoundRequest') {
          self.send(socket, {
            proto: 1, schema: 1, chan: 'rpc', type: 'Error',
            id: `e-${env.id}`, corr_id: env.id, op_seq: env.op_seq,
            timestamp: new Date().toISOString(),
            payload: { code: 'InsufficientFunds', message: 'no money', details: {} },
          });
        }
      },
    });
    const s = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: failing.url, apiKey: 'k', spinPath: fixtures,
    });
    await s.listen(0);
    const c = connect(`ws://127.0.0.1:${s.port}/api/ws?sessionId=sess-3`);
    await c.open;
    await c.waitFor('init');
    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const err = await c.waitFor('error');
    expect(err.code).toBe('InsufficientFunds');
    c.socket.close();
    await s.close();
    await failing.close();
  }, 40_000);

  it('демо-сессия не ходит в платформу за раундами', async () => {
    const demoApi = await startFakeGamesApi({ onMessage: responder(null) });
    const s = createArtubeServer({
      gameId: 'feature-game', gamesApiUrl: demoApi.url, apiKey: 'k', spinPath: fixtures,
    });
    await s.listen(0);
    const c = connect(`ws://127.0.0.1:${s.port}/api/ws?sessionId=sess-demo`);
    await c.open;
    const init = await c.waitFor('init');
    expect(init.demo).toBe(true);
    c.socket.send(JSON.stringify({ t: 'play', id: 'p0', action: 'spin', betIndex: 0 }));
    const res = await c.waitFor('result');
    expect(res.winX).toBe(0);
    expect(demoApi.received.some((e) => e.type === 'OpenRoundRequest')).toBe(false);
    c.socket.close();
    await s.close();
    await demoApi.close();
  }, 40_000);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- http`
Expected: FAIL — `Cannot find module '../src/index'`

- [ ] **Step 3: Реализовать логгер и типы провода**

`packages/artube-server/src/http/log.ts`:

```ts
/**
 * Структурированный логгер. Формат задан платформой: JSON, одна строка на
 * запись, поля timestamp / level / message / service / trace_id / error / context.
 */

export type Level = 'info' | 'warn' | 'error';

export interface LogContext {
  [key: string]: unknown;
}

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
  child(context: LogContext): Logger;
}

export function createLogger(service: string, base: LogContext = {}): Logger {
  const write = (level: Level, message: string, context?: LogContext, error?: unknown) => {
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service,
    };
    const merged = { ...base, ...context };
    if (merged.trace_id) record.trace_id = merged.trace_id;
    if (error instanceof Error) {
      record.error = { type: error.name, stack: error.stack };
    } else if (error !== undefined) {
      record.error = { type: 'unknown', stack: String(error) };
    }
    if (Object.keys(merged).length > 0) record.context = merged;
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(record));
  };
  return {
    info: (m, c) => write('info', m, c),
    warn: (m, c) => write('warn', m, c),
    error: (m, e, c) => write('error', m, c, e),
    child: (context) => createLogger(service, { ...base, ...context }),
  };
}
```

`packages/artube-server/src/http/wire.ts`:

```ts
/** Контракт `/api/ws` — почти 1:1 с протоколом game-sdk, чтобы мост оставался переводчиком. */

import type { InitPayload } from '../session/init';
import type { SegmentDelivery } from '../session/types';

export type ClientMessage =
  | { t: 'play'; id: string; action: string; betIndex: number; params?: Record<string, unknown> }
  | { t: 'ack'; roundId: string; cursor: number };

export type ServerMessage =
  | ({ t: 'init' } & InitPayload & { resume?: SegmentDelivery | null })
  | ({ t: 'result'; id: string } & SegmentDelivery)
  | { t: 'balance'; balance: number; reason: string }
  | { t: 'session_closed'; reason: string }
  | { t: 'error'; id?: string; code: string; message: string };

export function parseClientMessage(raw: string): ClientMessage {
  const parsed = JSON.parse(raw) as ClientMessage;
  if (parsed?.t !== 'play' && parsed?.t !== 'ack') {
    throw new Error(`unknown client message: ${String((parsed as { t?: string })?.t)}`);
  }
  return parsed;
}
```

- [ ] **Step 4: Реализовать WS-хендлер**

`packages/artube-server/src/http/ws.ts`:

```ts
/**
 * WS-соединение с фронтом.
 *
 * Всё, что живёт на соединении — `ctx` и `current`, — восстанавливается из
 * SessionInfo при переподключении: пода это состояние не переживает и
 * пережить не должно.
 */

import type { WebSocket } from 'ws';
import type { GamesApiClient } from '../games-api/client';
import { GamesApiError } from '../games-api/errors';
import type { EngineClient } from '../engine';
import {
  startRound, advanceRound, acknowledgeSegment,
  type ActiveRound, type RoundDeps,
} from '../round/orchestrator';
import { resumeRound } from '../round/resume';
import { buildInit, isDemoSession, toSessionContext } from '../session/init';
import type { SessionContext } from '../session/types';
import { parseClientMessage, type ServerMessage } from './wire';
import type { Logger } from './log';

export interface WsDeps {
  api: GamesApiClient;
  engine: EngineClient;
  gameId: string;
  costMultipliers: Record<string, number>;
  startingDemoBalance: number;
  log: Logger;
}

export async function handleConnection(
  socket: WebSocket,
  sessionId: string,
  deps: WsDeps,
): Promise<void> {
  const log = deps.log.child({ session_id: sessionId });
  const send = (msg: ServerMessage) => socket.send(JSON.stringify(msg));

  let ctx: SessionContext;
  let current: ActiveRound | null = null;
  let demo = false;

  const roundDeps: RoundDeps = {
    api: deps.api,
    engine: deps.engine,
    gameId: deps.gameId,
    costMultipliers: deps.costMultipliers,
  };

  const fail = (err: unknown, id?: string) => {
    const code = err instanceof GamesApiError ? err.code : 'InternalServerError';
    const message = err instanceof Error ? err.message : String(err);
    log.error('request failed', err, { code });
    send({ t: 'error', id, code, message });
  };

  try {
    const info = await deps.api.sessionInfo({
      session_id: sessionId,
      player_connection_info: {},
    });
    ctx = toSessionContext(sessionId, info);
    demo = isDemoSession(info);
    const init = buildInit(info);

    // Незакрытый раунд возвращаем игроку туда, где он остановился.
    let resume = null;
    if (!demo && info.last_round && !info.last_round.finished_at) {
      const outcome = await resumeRound(roundDeps, ctx, info.last_round);
      if (outcome) {
        resume = outcome.delivery;
        current = outcome.round;
        if (outcome.recovered) log.warn('round recovered after script mismatch');
      }
    }
    send({ t: 'init', ...init, resume });
  } catch (err) {
    fail(err);
    socket.close(1011, 'session init failed');
    return;
  }

  // События платформы, пока это соединение живо.
  const onBalance = (p: { session_id: string; balance: number; reason: string }) => {
    if (p.session_id === sessionId) send({ t: 'balance', balance: p.balance, reason: p.reason });
  };
  const onClosed = (p: { session_id: string; reason?: string }) => {
    if (p.session_id !== sessionId) return;
    send({ t: 'session_closed', reason: p.reason ?? 'closed' });
    socket.close(1000, 'session closed');
  };
  deps.api.on('balanceChanged', onBalance);
  deps.api.on('sessionClosed', onClosed);
  socket.on('close', () => {
    deps.api.off('balanceChanged', onBalance);
    deps.api.off('sessionClosed', onClosed);
  });

  socket.on('message', (raw) => {
    void (async () => {
      let msg;
      try {
        msg = parseClientMessage(raw.toString());
      } catch (err) {
        return fail(err);
      }
      try {
        if (msg.t === 'ack') {
          if (current && !demo) current = await acknowledgeSegment(roundDeps, ctx, current, msg.cursor);
          return;
        }
        // Демо: движок крутится, платформу не трогаем — она отвечает
        // OperationNotAllowed на раундовые RPC демо-сессии.
        const outcome = current
          ? await advanceRound(roundDeps, ctx, current, msg)
          : await startRound(roundDeps, ctx, msg);
        current = outcome.round;
        send({ t: 'result', id: msg.id, ...outcome.delivery });
      } catch (err) {
        fail(err, msg.t === 'play' ? msg.id : undefined);
      }
    })();
  });
}
```

> **Демо-путь.** `startRound`/`advanceRound` в демо не должны звать платформу. Реализуется подменой `roundDeps.api` на локальную заглушку, которая ведёт виртуальный баланс: см. следующий шаг.

- [ ] **Step 5: Реализовать демо-заглушку платформы**

`packages/artube-server/src/session/demo.ts`:

```ts
/**
 * Демо-режим: Games API его не поддерживает и отвечает OperationNotAllowed
 * на любые раундовые RPC. Поэтому демо обслуживает локальная заглушка с тем
 * же интерфейсом — она не ходит в сеть и живёт ровно столько, сколько
 * WS-соединение игрока.
 */

import { randomUUID } from 'node:crypto';
import type { RoundApi } from '../round/orchestrator';

export function createDemoApi(startingBalance: number, betAmountOf: (index: number) => number): RoundApi {
  let balance = startingBalance;
  // Ставку открытого раунда помним до закрытия: CloseRoundRequest несёт
  // только множитель выигрыша, без индекса ставки.
  let openBet = 0;

  return {
    async playRound(req) {
      const bet = betAmountOf(req.bet_index);
      const win = bet * req.win_multiplier;
      balance = balance - bet * req.price_multiplier + win;
      return {
        round_id: randomUUID(), balance, win, is_platform_max_win_reached: false,
      };
    },
    async openRound(req) {
      openBet = betAmountOf(req.bet_index);
      balance -= openBet * req.price_multiplier;
      return { round_version: 0, round_id: randomUUID(), balance };
    },
    async updateRoundState() {
      return { round_version: 0 };
    },
    async closeRound(req) {
      balance += req.win_multiplier * openBet;
      return { balance, free_round_campaign: null };
    },
    async autocloseRound(req) {
      balance += req.win_multiplier * openBet;
      return { balance };
    },
  };
}
```

В `handleConnection` после определения `demo` подменить источник:

```ts
    if (demo) {
      roundDeps.api = createDemoApi(
        deps.startingDemoBalance,
        (index) => ctx.allowedBets[index] ?? 0,
      );
    }
```

и убрать проверку `!demo` из ветки `ack` — заглушка обработает её без сети.

- [ ] **Step 6: Реализовать сервер и конфиг**

`packages/artube-server/src/config.ts`:

```ts
/** Конфиг сервиса. Имена переменных окружения задаёт платформа. */

export interface ArtubeServerConfig {
  gameId: string;
  gamesApiUrl: string;
  apiKey: string;
  /** Путь к .spin-файлу игры или к каталогу с ними. */
  spinPath: string;
  port?: number;
  /** Стартовый виртуальный баланс демо-сессии. */
  startingDemoBalance?: number;
}

export function loadConfigFromEnv(env = process.env): ArtubeServerConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`missing required env var: ${name}`);
    return value;
  };
  return {
    gameId: required('GameId'),
    gamesApiUrl: required('GamesApiUrl'),
    apiKey: required('GamesApiKey'),
    spinPath: env.SPIN_PATH ?? './game.spin',
    port: env.PORT ? Number(env.PORT) : 80,
    startingDemoBalance: env.DEMO_BALANCE ? Number(env.DEMO_BALANCE) : 1000,
  };
}
```

`packages/artube-server/src/http/server.ts`:

```ts
import { createServer, type Server } from 'node:http';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { GamesApiClient } from '../games-api/client';
import { startEngine, type EngineClient } from '../engine';
import { handleConnection } from './ws';
import { createLogger } from './log';
import type { ArtubeServerConfig } from '../config';

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
    const actions = (config.actions ?? {}) as Record<string, { cost_multiplier: number }>;
    const costMultipliers = Object.fromEntries(
      Object.entries(actions).map(([name, a]) => [name, a.cost_multiplier]),
    );

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
```

`packages/artube-server/src/index.ts`:

```ts
export { createArtubeServer, ArtubeServer } from './http/server';
export { loadConfigFromEnv, type ArtubeServerConfig } from './config';
export { createLogger, type Logger } from './http/log';
export type { ClientMessage, ServerMessage } from './http/wire';
export type { SessionContext, PlayRequest, SegmentDelivery } from './session/types';
export type { InitPayload, InitConfig, FrcInfo } from './session/init';
```

- [ ] **Step 7: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: PASS — все тесты Task 1–11

- [ ] **Step 8: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): HTTP/WS сервис — /api/ws, health-пробы, JSON-логи, демо-режим"
```

---

### Task 12: CLI, Dockerfile и README серверного пакета

**Files:**
- Create: `packages/artube-server/bin/artube-server.ts`
- Create: `packages/artube-server/Dockerfile.template`
- Create: `packages/artube-server/README.md`
- Test: `packages/artube-server/tests/config.test.ts`

**Interfaces:**
- Consumes: из Task 11 — `createArtubeServer`, `loadConfigFromEnv`.
- Produces: CLI-флаги `--spin <path>`, `--sandbox`, `--port <n>`; `const SANDBOX_URL = 'wss://gamesapi-sandbox.artube-888.live/v1/ws'`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-server/tests/config.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfigFromEnv } from '../src/config';
import { parseArgs, SANDBOX_URL } from '../bin/artube-server';

describe('конфиг из окружения', () => {
  const env = {
    GameId: 'my-game',
    GamesApiUrl: 'wss://hub-dev.artube-888.live/v1/ws?game=my-game',
    GamesApiKey: 'secret',
  };

  it('читает переменные, которые выдаёт DevOps', () => {
    const config = loadConfigFromEnv(env);
    expect(config.gameId).toBe('my-game');
    expect(config.apiKey).toBe('secret');
    expect(config.port).toBe(80);
  });

  it('падает без обязательной переменной', () => {
    expect(() => loadConfigFromEnv({ ...env, GamesApiKey: undefined })).toThrow(/GamesApiKey/);
  });
});

describe('аргументы CLI', () => {
  it('--sandbox подменяет адрес платформы', () => {
    const args = parseArgs(['--sandbox', '--spin', './game.spin'], {
      GameId: 'g', GamesApiUrl: 'wss://prod/v1/ws', GamesApiKey: 'k',
    });
    expect(args.gamesApiUrl).toBe(SANDBOX_URL);
    expect(args.spinPath).toBe('./game.spin');
  });

  it('--port переопределяет порт', () => {
    const args = parseArgs(['--port', '8080'], {
      GameId: 'g', GamesApiUrl: 'wss://prod/v1/ws', GamesApiKey: 'k',
    });
    expect(args.port).toBe(8080);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- config`
Expected: FAIL — `Cannot find module '../bin/artube-server'`

- [ ] **Step 3: Реализовать CLI**

`packages/artube-server/bin/artube-server.ts`:

```ts
#!/usr/bin/env node
/**
 * CLI игрового бэкенда.
 *
 * В продакшне достаточно переменных окружения; `--sandbox` направляет сервис
 * на публичную песочницу Artube, где стоит тот же GamesAPI, что на dev и prod.
 */

import { createArtubeServer } from '../src/http/server';
import { loadConfigFromEnv, type ArtubeServerConfig } from '../src/config';

export const SANDBOX_URL = 'wss://gamesapi-sandbox.artube-888.live/v1/ws';

export function parseArgs(argv: string[], env = process.env): ArtubeServerConfig {
  const config = loadConfigFromEnv(env);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sandbox') config.gamesApiUrl = SANDBOX_URL;
    if (argv[i] === '--spin') config.spinPath = argv[++i];
    if (argv[i] === '--port') config.port = Number(argv[++i]);
  }
  return config;
}

// Запуск только когда файл вызван как бинарь, а не импортирован тестом.
if (process.argv[1]?.endsWith('artube-server.js') || process.argv[1]?.endsWith('artube-server.ts')) {
  const config = parseArgs(process.argv.slice(2));
  const server = createArtubeServer(config);
  await server.listen();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}
```

- [ ] **Step 4: Написать Dockerfile-шаблон**

`packages/artube-server/Dockerfile.template`:

```dockerfile
# Шаблон для серверного репозитория игры. Контракт Artube: Dockerfile в
# корне, слушаем порт 80, health-пробы /livez и /healthz.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS final
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
ARG GIT_HASH
ENV GIT_HASH=$GIT_HASH
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY game.spin ./game.spin
EXPOSE 80
CMD ["node", "dist/index.js"]
```

- [ ] **Step 5: Написать README**

`packages/artube-server/README.md` — минимум: чем пакет является, три entry, пример `server/index.ts` из спеки, таблица переменных окружения (`GameId`, `GamesApiUrl`, `GamesApiKey`, `SPIN_PATH`, `PORT`, `DEMO_BALANCE`), запуск против песочницы (`artube-server --spin ./game.spin --sandbox`) и напоминание, что данные песочницы живут ~24 часа и создаются кнопками «Generate Data» → «Create Session».

- [ ] **Step 6: Убедиться, что тесты и сборка проходят**

Run: `npm test --workspace @energy8platform/artube-server && npm run build --workspace @energy8platform/artube-server`
Expected: PASS + `dist/` собран

- [ ] **Step 7: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): CLI с режимом песочницы, Dockerfile-шаблон и README"
```

---

### Task 13: Скаффолд `artube-bridge` и детект запуска

**Files:**
- Create: `packages/artube-bridge/package.json`
- Create: `packages/artube-bridge/tsconfig.json`
- Create: `packages/artube-bridge/vitest.config.ts`
- Create: `packages/artube-bridge/rollup.config.ts`
- Create: `packages/artube-bridge/src/detect.ts`
- Test: `packages/artube-bridge/test/detect.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `function isArtubeLaunch(input: string | URL | Location): boolean`; `function parseArtubeUrl(input): ArtubeUrlParams`; `interface ArtubeUrlParams { sessionId: string; lang: string; device: 'desktop' | 'mobile'; apiBase: string }`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-bridge/test/detect.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isArtubeLaunch, parseArtubeUrl } from '../src/detect';

describe('детект запуска на Artube', () => {
  it('sessionId в URL — это запуск на Artube', () => {
    expect(isArtubeLaunch('https://game.artube-888.live/?sessionId=abc-123')).toBe(true);
  });

  it('без sessionId — обычный дев-запуск', () => {
    expect(isArtubeLaunch('http://localhost:5173/')).toBe(false);
  });

  it('запуск на Stake не путается с Artube', () => {
    expect(
      isArtubeLaunch('https://game/?rgs_url=x.stake-engine.com&sessionID=s1'),
    ).toBe(false); // sessionID Stake пишется иначе и без sessionId
  });

  it('битый URL не роняет детект', () => {
    expect(isArtubeLaunch('не url')).toBe(false);
  });

  it('разбирает параметры запуска', () => {
    const params = parseArtubeUrl(
      'https://game.artube-888.live/?sessionId=abc-123&lang=ru&device=mobile',
    );
    expect(params).toEqual({
      sessionId: 'abc-123', lang: 'ru', device: 'mobile',
      apiBase: 'https://game.artube-888.live',
    });
  });

  it('по умолчанию язык en и десктоп', () => {
    const params = parseArtubeUrl('https://game.artube-888.live/?sessionId=s');
    expect(params.lang).toBe('en');
    expect(params.device).toBe('desktop');
  });

  it('бэкенд всегда на том же origin — так требует дока', () => {
    const params = parseArtubeUrl('https://example-game.artube-888.live/play?sessionId=s');
    expect(params.apiBase).toBe('https://example-game.artube-888.live');
  });
});
```

- [ ] **Step 2: Создать скаффолд пакета**

`packages/artube-bridge/package.json`:

```json
{
  "name": "@energy8platform/artube-bridge",
  "version": "0.1.0",
  "description": "Drop-in host-side wrapper that lets a game built against @energy8platform/game-sdk run on Artube",
  "author": "Energy8 Platform",
  "license": "MIT",
  "type": "module",
  "main": "dist/artube-bridge.umd.js",
  "module": "dist/artube-bridge.esm.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/artube-bridge.esm.js",
      "require": "./dist/artube-bridge.umd.js",
      "types": "./dist/index.d.ts"
    },
    "./detect": {
      "import": "./dist/detect.esm.js",
      "require": "./dist/detect.umd.js",
      "types": "./dist/detect.d.ts"
    }
  },
  "files": ["dist", "README.md"],
  "scripts": {
    "build": "rollup -c rollup.config.ts --configPlugin @rollup/plugin-typescript",
    "dev": "rollup -c rollup.config.ts --configPlugin @rollup/plugin-typescript --watch",
    "clean": "rm -rf dist",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run clean && npm run build"
  },
  "peerDependencies": { "@energy8platform/game-sdk": "^2.9.0" },
  "dependencies": { "@energy8platform/game-sdk": "^2.9.0" },
  "devDependencies": {
    "@rollup/plugin-typescript": "^12.1.0",
    "@types/node": "^20.0.0",
    "rollup": "^4.24.0",
    "rollup-plugin-dts": "^6.1.0",
    "tslib": "^2.8.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "keywords": ["casino", "artube", "slot", "bridge"],
  "repository": {
    "type": "git",
    "url": "https://github.com/energy8platform/game-engine.git",
    "directory": "packages/artube-bridge"
  }
}
```

`packages/artube-bridge/tsconfig.json` — копия `packages/stake-bridge/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

`packages/artube-bridge/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.test.ts'], testTimeout: 30_000 },
});
```

`packages/artube-bridge/rollup.config.ts`:

```ts
import { defineConfig } from 'rollup';
import typescript from '@rollup/plugin-typescript';
import dts from 'rollup-plugin-dts';

const external = [
  '@energy8platform/game-sdk',
  '@energy8platform/game-sdk/protocol',
];

const globals = {
  '@energy8platform/game-sdk': 'CasinoGameSDK',
  '@energy8platform/game-sdk/protocol': 'CasinoGameSDKProtocol',
};

const ts = () => typescript({ tsconfig: './tsconfig.json', declaration: false });

export default defineConfig([
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/artube-bridge.esm.js', format: 'esm', sourcemap: true },
    plugins: [ts()],
  },
  {
    input: 'src/index.ts',
    external,
    output: {
      file: 'dist/artube-bridge.umd.js', format: 'umd', name: 'ArtubeBridge',
      sourcemap: true, exports: 'named', globals,
    },
    plugins: [ts()],
  },
  {
    input: 'src/index.ts',
    external,
    output: { file: 'dist/index.d.ts', format: 'esm' },
    plugins: [dts()],
  },
  {
    input: 'src/detect.ts',
    external,
    output: { file: 'dist/detect.esm.js', format: 'esm', sourcemap: true },
    plugins: [ts()],
  },
  {
    input: 'src/detect.ts',
    external,
    output: {
      file: 'dist/detect.umd.js', format: 'umd', name: 'ArtubeBridgeDetect',
      sourcemap: true, exports: 'named', globals,
    },
    plugins: [ts()],
  },
  {
    input: 'src/detect.ts',
    external,
    output: { file: 'dist/detect.d.ts', format: 'esm' },
    plugins: [dts()],
  },
]);
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-bridge -- detect`
Expected: FAIL — `Cannot find module '../src/detect'`

- [ ] **Step 4: Реализовать детект**

`packages/artube-bridge/src/detect.ts`:

```ts
/**
 * Детект запуска на Artube — лист-модуль без импортов моста, чтобы точка
 * входа игры могла решить, грузить ли мост, не утягивая его в бандл.
 */

export interface ArtubeUrlParams {
  sessionId: string;
  lang: string;
  device: 'desktop' | 'mobile';
  /**
   * Origin бэкенда. Дока платформы отдаёт фронт и бэк под одним доменом и
   * разводит их по пути (`/api/**` → бэкенд), поэтому это всегда own origin.
   */
  apiBase: string;
}

function toUrl(input: string | URL | Location): URL | null {
  const href = typeof input === 'string' ? input : 'href' in input ? input.href : String(input);
  try {
    return new URL(href);
  } catch {
    return null;
  }
}

export function isArtubeLaunch(input: string | URL | Location): boolean {
  const url = toUrl(input);
  return Boolean(url?.searchParams.get('sessionId'));
}

export function parseArtubeUrl(input: string | URL | Location): ArtubeUrlParams {
  const url = toUrl(input);
  if (!url) throw new Error('artube-bridge: не удалось разобрать URL запуска');
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) throw new Error('artube-bridge: в URL нет sessionId');
  const device = url.searchParams.get('device') === 'mobile' ? 'mobile' : 'desktop';
  return {
    sessionId,
    lang: url.searchParams.get('lang') ?? 'en',
    device,
    apiBase: url.origin,
  };
}
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-bridge`
Expected: PASS, 7 тестов

- [ ] **Step 6: Коммит**

```bash
git add packages/artube-bridge
git commit -m "feat(artube-bridge): скаффолд пакета и детект запуска на Artube"
```

---

### Task 14: Клиент бэкенда — WS, реконнект, парность запросов

**Files:**
- Create: `packages/artube-bridge/src/types.ts`
- Create: `packages/artube-bridge/src/client.ts`
- Test: `packages/artube-bridge/test/client.test.ts`

**Interfaces:**
- Consumes: из Task 13 — `ArtubeUrlParams`; с сервера — типы `ClientMessage` / `ServerMessage` (дублируются здесь, чтобы фронт не зависел от серверного пакета).
- Produces: `interface ServerInit { … }`, `interface ServerResult { … }`; `class ArtubeClient { connect(): Promise<ServerInit>; play(req): Promise<ServerResult>; ack(roundId, cursor): void; on('balance' | 'sessionClosed' | 'connection', cb): void; close(): void }`; `class ArtubeBackendError extends Error { readonly code: string }`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-bridge/test/client.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { ArtubeClient, ArtubeBackendError } from '../src/client';

let wss: WebSocketServer;
let client: ArtubeClient;

const INIT = {
  t: 'init', currency: 'USD', balance: 100, demo: false, frc: null,
  config: {
    betLevels: [0.1, 1, 5], defaultBetIndex: 1, currencyMinimalUnit: 0.01,
    autoSpinCounts: [10], locales: ['EN'], rtp: { isVisible: false }, platformMaxWin: null,
  },
};

/** Поднять фейковый бэкенд игры. `onPlay` описывает реакцию на play/ack. */
async function startBackend(onMessage?: (msg: any, socket: any) => void) {
  wss = new WebSocketServer({ port: 0 });
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify(INIT));
    socket.on('message', (raw) => onMessage?.(JSON.parse(raw.toString()), socket));
  });
  await new Promise<void>((r) => wss.on('listening', () => r()));
  return `ws://127.0.0.1:${(wss.address() as AddressInfo).port}/api/ws?sessionId=s1`;
}

afterEach(async () => {
  client?.close();
  await new Promise<void>((r) => wss?.close(() => r()));
});

describe('ArtubeClient', () => {
  it('коннект возвращает init', async () => {
    const url = await startBackend();
    client = new ArtubeClient(url);
    const init = await client.connect();
    expect(init.balance).toBe(100);
    expect(init.config.betLevels).toEqual([0.1, 1, 5]);
  });

  it('play разрешается ответом с тем же id', async () => {
    const url = await startBackend((msg, socket) => {
      if (msg.t !== 'play') return;
      socket.send(JSON.stringify({
        t: 'result', id: msg.id, roundId: 'r1', action: msg.action, data: { stage: 'base' },
        winX: 2, totalWinX: 2, betAmount: 1, nextActions: ['spin'],
        spinsRemaining: 0, spinsPlayed: 1, balanceAfter: 102,
        creditPending: false, maxWinReached: false,
      }));
    });
    client = new ArtubeClient(url);
    await client.connect();
    const res = await client.play({ action: 'spin', betIndex: 1 });
    expect(res.roundId).toBe('r1');
    expect(res.winX).toBe(2);
  });

  it('параллельные play не путаются', async () => {
    const url = await startBackend((msg, socket) => {
      if (msg.t !== 'play') return;
      const delay = msg.action === 'slow' ? 50 : 5;
      setTimeout(() => socket.send(JSON.stringify({
        t: 'result', id: msg.id, roundId: msg.action, action: msg.action, data: {},
        winX: 0, totalWinX: 0, betAmount: 1, nextActions: [], spinsRemaining: 0,
        spinsPlayed: 1, balanceAfter: 1, creditPending: false, maxWinReached: false,
      })), delay);
    });
    client = new ArtubeClient(url);
    await client.connect();
    const [slow, fast] = await Promise.all([
      client.play({ action: 'slow', betIndex: 0 }),
      client.play({ action: 'fast', betIndex: 0 }),
    ]);
    expect(slow.roundId).toBe('slow');
    expect(fast.roundId).toBe('fast');
  });

  it('error с id отбивает конкретный play', async () => {
    const url = await startBackend((msg, socket) => {
      if (msg.t !== 'play') return;
      socket.send(JSON.stringify({
        t: 'error', id: msg.id, code: 'InsufficientFunds', message: 'no money',
      }));
    });
    client = new ArtubeClient(url);
    await client.connect();
    await expect(client.play({ action: 'spin', betIndex: 0 })).rejects.toMatchObject({
      name: 'ArtubeBackendError', code: 'InsufficientFunds',
    });
  });

  it('ack уходит на бэкенд', async () => {
    const seen: any[] = [];
    const url = await startBackend((msg) => seen.push(msg));
    client = new ArtubeClient(url);
    await client.connect();
    client.ack('r1', 2);
    await new Promise((r) => setTimeout(r, 30));
    expect(seen).toContainEqual({ t: 'ack', roundId: 'r1', cursor: 2 });
  });

  it('balance и session_closed прокидываются подписчикам', async () => {
    const url = await startBackend((msg, socket) => {
      if (msg.t !== 'play') return;
      socket.send(JSON.stringify({ t: 'balance', balance: 77, reason: 'Win' }));
      socket.send(JSON.stringify({ t: 'session_closed', reason: 'timeout' }));
    });
    client = new ArtubeClient(url);
    const balances: number[] = [];
    let closedReason = '';
    client.on('balance', (p: { balance: number }) => balances.push(p.balance));
    client.on('sessionClosed', (p: { reason: string }) => { closedReason = p.reason; });
    await client.connect();
    void client.play({ action: 'spin', betIndex: 0 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(balances).toEqual([77]);
    expect(closedReason).toBe('timeout');
  });

  it('обрыв связи отбивает висящие play', async () => {
    const url = await startBackend(() => {});
    client = new ArtubeClient(url);
    await client.connect();
    const pending = client.play({ action: 'spin', betIndex: 0 });
    wss.clients.forEach((c) => c.terminate());
    await expect(pending).rejects.toBeInstanceOf(ArtubeBackendError);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-bridge -- client`
Expected: FAIL — `Cannot find module '../src/client'`

- [ ] **Step 3: Реализовать типы провода**

`packages/artube-bridge/src/types.ts`:

```ts
/**
 * Контракт `/api/ws`. Продублирован из `@energy8platform/artube-server`
 * намеренно: фронтовый бандл не должен зависеть от серверного пакета.
 */

export interface ServerInitConfig {
  betLevels: number[];
  defaultBetIndex: number;
  currencyMinimalUnit: number;
  autoSpinCounts: number[];
  locales: string[];
  rtp: { isVisible: boolean; shownRtp?: number };
  platformMaxWin: { isVisible: boolean; playerCurrencyValue: number; baseCurrency: string } | null;
}

export interface ServerResult {
  id?: string;
  roundId: string;
  action: string;
  data: Record<string, unknown>;
  winX: number;
  totalWinX: number;
  betAmount: number;
  nextActions: string[];
  spinsRemaining: number;
  spinsPlayed: number;
  balanceAfter: number | null;
  creditPending: boolean;
  maxWinReached: boolean;
  frc?: { rounds_left: number; total_win: number; is_complete: boolean } | null;
}

export interface ServerInit {
  currency: string | null;
  balance: number;
  demo: boolean;
  config: ServerInitConfig;
  frc: {
    campaignId: string; roundsLeft: number; roundsTotal: number;
    totalWin: number; isComplete: boolean;
  } | null;
  gamificationToken?: string;
  /** Сегмент незакрытого раунда, если игрок вернулся в середину фичи. */
  resume?: ServerResult | null;
}

export interface ArtubeBridgeOptions {
  /** Мост живёт в одном бандле с игрой и общается через MemoryChannel. */
  devMode?: boolean;
  /** Origin бэкенда; по умолчанию берётся из URL запуска (тот же домен). */
  apiBase?: string;
  /** Переопределение URL запуска; по умолчанию `window.location.href`. */
  url?: string | URL | Location;
  gameId?: string;
  /** Стартовый виртуальный баланс демо-режима. */
  demoBalance?: number;
  debug?: boolean;
}
```

- [ ] **Step 4: Реализовать клиент**

`packages/artube-bridge/src/client.ts`:

```ts
/**
 * WebSocket-клиент игрового бэкенда.
 *
 * Клиент не рвёт соединение сам: при обрыве переподключается с экспонентой,
 * а висящие запросы отбивает, чтобы игра не ждала вечно.
 */

import type { ServerInit, ServerResult } from './types';

export class ArtubeBackendError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ArtubeBackendError';
  }
}

type ClientEvent = 'balance' | 'sessionClosed' | 'connection';

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
    const msg = JSON.parse(raw) as { t: string } & Record<string, unknown>;
    if (msg.t === 'init') {
      this.initResolve?.(msg as unknown as ServerInit);
      this.initResolve = null;
      return;
    }
    if (msg.t === 'balance') return this.emit('balance', msg);
    if (msg.t === 'session_closed') return this.emit('sessionClosed', msg);
    if (msg.t === 'result') {
      const waiter = msg.id ? this.pending.get(String(msg.id)) : undefined;
      if (waiter) {
        this.pending.delete(String(msg.id));
        waiter.resolve(msg as unknown as ServerResult);
      }
      return;
    }
    if (msg.t === 'error') {
      const error = new ArtubeBackendError(String(msg.code), String(msg.message));
      const waiter = msg.id ? this.pending.get(String(msg.id)) : undefined;
      if (waiter) {
        this.pending.delete(String(msg.id));
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
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-bridge`
Expected: PASS — 14 тестов

> В Node 20 `WebSocket` доступен глобально, отдельного полифила тесты не требуют.

- [ ] **Step 6: Коммит**

```bash
git add packages/artube-bridge
git commit -m "feat(artube-bridge): WS-клиент игрового бэкенда с реконнектом"
```

---

### Task 15: `ArtubeBridge` — перевод в протокол `game-sdk`

**Files:**
- Create: `packages/artube-bridge/src/bridge.ts`
- Create: `packages/artube-bridge/src/index.ts`
- Test: `packages/artube-bridge/test/bridge.test.ts`

**Interfaces:**
- Consumes: из Task 13 — `parseArtubeUrl`; из Task 14 — `ArtubeClient`, `ArtubeBackendError`, `ServerInit`, `ServerResult`, `ArtubeBridgeOptions`; из `@energy8platform/game-sdk` — `Bridge` с методами `on<T>(type, cb)`, `send<T>(type, payload, id)`, `destroy()`.
- Produces: `class ArtubeBridge { ready(): Promise<void>; destroy(): void }`; `function betIndexOf(betLevels: number[], bet: number): number`.

> **Суммы считает фронт.** Бэкенд шлёт множители (`winX`, `totalWinX`) и `betAmount` из `allowed_bets`; отображаемые суммы — их произведение. Баланс никогда не вычисляем: берём `balanceAfter` платформы, а пока раунд не закрыт — держим последний известный.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-bridge/test/bridge.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ServerInit, ServerResult } from '../src/types';

const backend = vi.hoisted(() => ({
  connect: vi.fn(),
  play: vi.fn(),
  ack: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
}));

vi.mock('../src/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/client')>();
  return {
    ...actual,
    ArtubeClient: class {
      constructor(_url: string) {}
      connect = backend.connect;
      play = backend.play;
      ack = backend.ack;
      on = backend.on;
      close = backend.close;
    },
  };
});

const { ArtubeBridge, betIndexOf } = await import('../src/bridge');

/** Минимальный window, чтобы MemoryChannel из game-sdk было где жить. */
function installWindow(): void {
  (globalThis as { window?: any }).window = (globalThis as { window?: any }).window ?? {};
  delete (globalThis as { window: Record<string, unknown> }).window.__casinoBridgeChannel;
}

const flush = () => new Promise((r) => setTimeout(r, 10));

const INIT: ServerInit = {
  currency: 'USD', balance: 100, demo: false, frc: null,
  config: {
    betLevels: [0.1, 1, 5], defaultBetIndex: 1, currencyMinimalUnit: 0.01,
    autoSpinCounts: [10], locales: ['EN'],
    rtp: { isVisible: true, shownRtp: 96.5 },
    platformMaxWin: { isVisible: true, playerCurrencyValue: 870, baseCurrency: 'EUR' },
  },
};

function result(over: Partial<ServerResult> = {}): ServerResult {
  return {
    roundId: 'r1', action: 'spin', data: { stage: 'base_game' },
    winX: 2, totalWinX: 2, betAmount: 1, nextActions: ['spin'],
    spinsRemaining: 0, spinsPlayed: 1, balanceAfter: 102,
    creditPending: false, maxWinReached: false, ...over,
  };
}

const URL_LIVE = 'https://game.artube-888.live/?sessionId=s1&lang=ru&device=mobile';

describe('ArtubeBridge', () => {
  let bridge: { ready(): Promise<void>; destroy(): void };
  let sent: Array<{ type: string; payload: any }>;
  let channel: any;

  beforeEach(async () => {
    installWindow();
    backend.connect.mockReset().mockResolvedValue(INIT);
    backend.play.mockReset().mockResolvedValue(result());
    backend.ack.mockReset();
    backend.on.mockReset();
    sent = [];
    const { MemoryChannel } = await import('@energy8platform/game-sdk');
    channel = MemoryChannel.getGlobal();
    channel.onGuest((m: any) => sent.push({ type: m.type, payload: m.payload }));
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game' });
    await bridge.ready();
  });

  afterEach(() => bridge?.destroy());

  it('индекс ставки ищется по betLevels', () => {
    expect(betIndexOf([0.1, 1, 5], 1)).toBe(1);
    expect(betIndexOf([0.1, 1, 5], 5)).toBe(2);
    expect(betIndexOf([0.1, 1, 5], 0.99)).toBe(1); // ближайший
  });

  it('на GAME_READY отдаёт INIT с балансом и ставками платформы', async () => {
    channel.sendToHost('GAME_READY', {});
    await flush();
    const init = sent.find((m) => m.type === 'INIT');
    expect(init).toBeDefined();
    expect(init!.payload.balance).toBe(100);
    expect(init!.payload.currency).toBe('USD');
    expect(init!.payload.config.betLevels).toEqual([0.1, 1, 5]);
    expect(init!.payload.lang).toBe('ru');
    expect(init!.payload.device).toBe('mobile');
  });

  it('PLAY_REQUEST переводится в индекс ставки', async () => {
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    expect(backend.play).toHaveBeenCalledWith({ action: 'spin', betIndex: 1, params: undefined });
  });

  it('множители превращаются в суммы для показа', async () => {
    backend.play.mockResolvedValue(result({ winX: 2, totalWinX: 3, betAmount: 5 }));
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 5 });
    await flush();
    const play = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(play!.payload.totalWin).toBe(15); // totalWinX × betAmount
    expect(play!.payload.balanceAfter).toBe(102);
  });

  it('пока раунд не закрыт, отдаётся creditPending и прежний баланс', async () => {
    backend.play.mockResolvedValue(
      result({ balanceAfter: null, creditPending: true, nextActions: ['free_spin'] }),
    );
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    const play = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(play!.payload.creditPending).toBe(true);
    expect(play!.payload.balanceAfter).toBe(100); // баланс из INIT, не выдуманный
    expect(play!.payload.nextActions).toEqual(['free_spin']);
  });

  it('PLAY_RESULT_ACK игры превращается в ack бэкенду', async () => {
    backend.play.mockResolvedValue(result({ creditPending: true, balanceAfter: null }));
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    channel.sendToHost('PLAY_RESULT_ACK', {
      roundId: 'r1', action: 'spin', totalWin: 2, balanceAfter: 100,
    });
    await flush();
    expect(backend.ack).toHaveBeenCalledWith('r1', 1);
  });

  it('ошибка бэкенда доезжает как PLAY_ERROR', async () => {
    const { ArtubeBackendError } = await import('../src/client');
    backend.play.mockRejectedValue(new ArtubeBackendError('InsufficientFunds', 'no money'));
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    const err = sent.find((m) => m.type === 'PLAY_ERROR');
    expect(err!.payload.code).toBe('InsufficientFunds');
  });

  it('достигнутый максвин помечается в сессии', async () => {
    backend.play.mockResolvedValue(result({ maxWinReached: true }));
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    const play = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(play!.payload.session.maxWinReached).toBe(true);
  });

  it('незакрытый раунд из init доигрывается с того же места', async () => {
    backend.connect.mockResolvedValue({
      ...INIT,
      resume: result({ action: 'free_spin', creditPending: true, balanceAfter: null, spinsPlayed: 2 }),
    });
    bridge.destroy();
    installWindow();
    sent = [];
    const { MemoryChannel } = await import('@energy8platform/game-sdk');
    channel = MemoryChannel.getGlobal();
    channel.onGuest((m: any) => sent.push({ type: m.type, payload: m.payload }));
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game' });
    await bridge.ready();
    channel.sendToHost('GAME_READY', {});
    await flush();
    expect(sent.find((m) => m.type === 'INIT')).toBeDefined();
    const resumed = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(resumed!.payload.action).toBe('free_spin');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-bridge -- bridge`
Expected: FAIL — `Cannot find module '../src/bridge'`

- [ ] **Step 3: Реализовать мост**

`packages/artube-bridge/src/bridge.ts`:

```ts
/**
 * ArtubeBridge — хост-обёртка, дающая игре на CasinoGameSDK работать на Artube.
 *
 * Игра как и раньше говорит только с SDK; мост переводит её сообщения в
 * протокол игрового бэкенда и обратно. Per-game адаптера нет: нарезку раунда
 * на сегменты знает бэкенд, он единственный видит математику.
 */

import { Bridge } from '@energy8platform/game-sdk';
import type {
  GameReadyPayload, PlayRequestPayload, PlayResultAckPayload,
  PlayResultPayload, PlayErrorPayload, InitPayload,
  BalanceUpdatePayload, GameConfigData, SessionData,
} from '@energy8platform/game-sdk/protocol';
import { ArtubeClient, ArtubeBackendError } from './client';
import { parseArtubeUrl } from './detect';
import type { ArtubeBridgeOptions, ServerInit, ServerResult } from './types';

/**
 * Индекс ставки в `allowed_bets`. Игра выбирает ставку суммой, наружу
 * уходит только индекс — сумму считает платформа.
 */
export function betIndexOf(betLevels: number[], bet: number): number {
  const exact = betLevels.indexOf(bet);
  if (exact >= 0) return exact;
  let best = 0;
  for (let i = 1; i < betLevels.length; i++) {
    if (Math.abs(betLevels[i] - bet) < Math.abs(betLevels[best] - bet)) best = i;
  }
  return best;
}

export class ArtubeBridge {
  private readonly bridge: Bridge;
  private readonly client: ArtubeClient;
  private readonly gameId: string;
  private readonly lang: string;
  private readonly device: 'desktop' | 'mobile';
  private readonly bootPromise: Promise<ServerInit>;

  private init: ServerInit | null = null;
  private balance = 0;
  /** Сколько сегментов текущего раунда уже показано игроку. */
  private cursor = 0;
  private currentRoundId: string | null = null;

  constructor(private readonly options: ArtubeBridgeOptions = {}) {
    const url = parseArtubeUrl(options.url ?? window.location.href);
    this.gameId = options.gameId ?? 'artube-game';
    this.lang = url.lang;
    this.device = url.device;

    const base = (options.apiBase ?? url.apiBase).replace(/^http/, 'ws');
    this.client = new ArtubeClient(`${base}/api/ws?sessionId=${encodeURIComponent(url.sessionId)}`);
    this.bridge = new Bridge({ devMode: options.devMode ?? true, debug: options.debug });

    this.client.on('balance', (p: { balance: number }) => {
      this.balance = p.balance;
      this.bridge.send<BalanceUpdatePayload>('BALANCE_UPDATE', { balance: p.balance });
    });
    this.client.on('sessionClosed', (p: { reason: string }) => {
      this.bridge.send('ERROR', { code: 'SessionClosed', message: p.reason });
    });

    this.bootPromise = this.client.connect().then((init) => {
      this.init = init;
      this.balance = init.balance;
      return init;
    });

    this.bridge.on<GameReadyPayload>('GAME_READY', (_p, id) => void this.onGameReady(id));
    this.bridge.on<PlayRequestPayload>('PLAY_REQUEST', (p, id) => void this.onPlay(p, id));
    this.bridge.on<PlayResultAckPayload>('PLAY_RESULT_ACK', (p) => this.onAck(p));
  }

  /** Резолвится, когда бэкенд отдал init. */
  async ready(): Promise<void> {
    await this.bootPromise;
  }

  destroy(): void {
    this.client.close();
    this.bridge.destroy();
  }

  private async onGameReady(id?: string): Promise<void> {
    try {
      const init = await this.bootPromise;
      const config: GameConfigData = {
        id: this.gameId,
        type: 'slot',
        betLevels: init.config.betLevels,
        demo: init.demo,
        // Платформенные данные, которые игра показывает на экране правил.
        artube: {
          defaultBetIndex: init.config.defaultBetIndex,
          autoSpinCounts: init.config.autoSpinCounts,
          locales: init.config.locales,
          rtp: init.config.rtp,
          platformMaxWin: init.config.platformMaxWin,
          frc: init.frc,
          gamificationToken: init.gamificationToken,
        },
      };
      const payload: InitPayload = {
        currency: init.currency ?? 'FUN',
        balance: init.balance,
        config,
        session: null,
        lang: this.lang,
        device: this.device,
      };
      this.bridge.send('INIT', payload, id);

      // Незакрытый раунд: показываем сегмент, на котором игрок остановился.
      if (init.resume) {
        this.currentRoundId = init.resume.roundId;
        this.cursor = init.resume.spinsPlayed - 1;
        this.bridge.send('PLAY_RESULT', this.toPlayResult(init.resume));
      }
    } catch (err) {
      this.bridge.send('ERROR', { code: this.codeOf(err), message: String(err) }, id);
    }
  }

  private async onPlay(payload: PlayRequestPayload, id?: string): Promise<void> {
    try {
      const levels = this.init?.config.betLevels ?? [];
      const result = await this.client.play({
        action: payload.action,
        betIndex: betIndexOf(levels, payload.bet),
        params: payload.params,
      });
      if (result.roundId !== this.currentRoundId) {
        this.currentRoundId = result.roundId;
        this.cursor = 0;
      }
      this.cursor += 1;
      if (result.balanceAfter !== null) this.balance = result.balanceAfter;
      this.bridge.send('PLAY_RESULT', this.toPlayResult(result), id);
    } catch (err) {
      this.bridge.send<PlayErrorPayload>(
        'PLAY_ERROR',
        { code: this.codeOf(err), message: err instanceof Error ? err.message : String(err) },
        id,
      );
    }
  }

  /** Игрок досмотрел сегмент — бэкенд двигает курсор в состоянии платформы. */
  private onAck(payload: PlayResultAckPayload): void {
    if (payload.roundId === this.currentRoundId) this.client.ack(payload.roundId, this.cursor);
  }

  private toPlayResult(result: ServerResult): PlayResultPayload {
    const session: SessionData = {
      spinsRemaining: result.spinsRemaining,
      spinsPlayed: result.spinsPlayed,
      // Суммы для показа = множитель × ставка. Деньги при этом всегда
      // приходят от платформы в balanceAfter.
      totalWin: result.totalWinX * result.betAmount,
      completed: !result.creditPending,
      maxWinReached: result.maxWinReached,
      betAmount: result.betAmount,
    };
    return {
      roundId: result.roundId,
      action: result.action,
      balanceAfter: result.balanceAfter ?? this.balance,
      totalWin: result.totalWinX * result.betAmount,
      currency: this.init?.currency ?? 'FUN',
      gameId: this.gameId,
      data: result.data,
      nextActions: result.nextActions,
      session,
      creditPending: result.creditPending,
    };
  }

  private codeOf(err: unknown): string {
    return err instanceof ArtubeBackendError ? err.code : 'InternalServerError';
  }
}
```

`packages/artube-bridge/src/index.ts`:

```ts
/**
 * Интеграция с Artube.
 *
 * ```ts
 * import { isArtubeLaunch } from '@energy8platform/artube-bridge/detect';
 *
 * const isArtube = isArtubeLaunch(location.href);
 * if (isArtube) {
 *   const { ArtubeBridge } = await import('@energy8platform/artube-bridge');
 *   new ArtubeBridge({ devMode: true, gameId: 'sweet-bonanza' });
 * }
 * const sdk = new CasinoGameSDK({ devMode: isArtube });
 * ```
 */

export { ArtubeBridge, betIndexOf } from './bridge';
export { isArtubeLaunch, parseArtubeUrl, type ArtubeUrlParams } from './detect';
export { ArtubeClient, ArtubeBackendError, type PlayArgs } from './client';
export type {
  ArtubeBridgeOptions, ServerInit, ServerResult, ServerInitConfig,
} from './types';
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-bridge`
Expected: PASS — 23 теста

- [ ] **Step 5: Проверить сборку и типы**

Run: `npm run typecheck --workspace @energy8platform/artube-bridge && npm run build --workspace @energy8platform/artube-bridge`
Expected: без ошибок, `dist/` содержит `artube-bridge.esm.js`, `artube-bridge.umd.js`, `detect.esm.js`, `index.d.ts`

- [ ] **Step 6: Коммит**

```bash
git add packages/artube-bridge
git commit -m "feat(artube-bridge): перевод протокола game-sdk в контракт игрового бэкенда"
```

---

### Task 16: Демо-баланс на клиенте, README и e2e против песочницы

**Files:**
- Create: `packages/artube-bridge/src/demo.ts`
- Modify: `packages/artube-bridge/src/bridge.ts` (подключить демо-баланс)
- Create: `packages/artube-bridge/README.md`
- Create: `packages/artube-server/tests/e2e-sandbox.test.ts`
- Test: `packages/artube-bridge/test/demo.test.ts`

**Interfaces:**
- Consumes: из Task 15 — `ArtubeBridge`, `ServerResult`; из Task 12 — `SANDBOX_URL`.
- Produces: `class DemoWallet { readonly balance: number; bet(amount: number): void; credit(amount: number): void }`.

- [ ] **Step 1: Написать падающий тест демо-кошелька**

`packages/artube-bridge/test/demo.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DemoWallet } from '../src/demo';

describe('DemoWallet', () => {
  it('стартует с заданного баланса', () => {
    expect(new DemoWallet(1000).balance).toBe(1000);
  });

  it('ставка списывает, выигрыш зачисляет', () => {
    const wallet = new DemoWallet(100);
    wallet.bet(10);
    expect(wallet.balance).toBe(90);
    wallet.credit(25);
    expect(wallet.balance).toBe(115);
  });

  it('баланс не уходит в минус', () => {
    const wallet = new DemoWallet(5);
    wallet.bet(10);
    expect(wallet.balance).toBe(0);
  });

  it('копейки не накапливают ошибку округления', () => {
    const wallet = new DemoWallet(0.3);
    wallet.bet(0.1);
    wallet.bet(0.1);
    expect(wallet.balance).toBe(0.1);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-bridge -- demo`
Expected: FAIL — `Cannot find module '../src/demo'`

- [ ] **Step 3: Реализовать демо-кошелёк**

`packages/artube-bridge/src/demo.ts`:

```ts
/**
 * Виртуальный баланс демо-режима.
 *
 * Games API демо не поддерживает и отвечает OperationNotAllowed на раундовые
 * RPC демо-сессии, поэтому баланс ведёт клиент. Держать его здесь, а не на
 * бэкенде, — единственный способ не заводить кэш с TTL и не ломать stateless;
 * демо-деньги ничего не стоят.
 */

/** Копейки в валюте с двумя знаками: считаем в минорных единицах. */
const SCALE = 100;

export class DemoWallet {
  private minor: number;

  constructor(starting: number) {
    this.minor = Math.round(starting * SCALE);
  }

  get balance(): number {
    return this.minor / SCALE;
  }

  bet(amount: number): void {
    this.minor = Math.max(0, this.minor - Math.round(amount * SCALE));
  }

  credit(amount: number): void {
    this.minor += Math.round(amount * SCALE);
  }
}
```

- [ ] **Step 4: Подключить кошелёк к мосту**

В `packages/artube-bridge/src/bridge.ts` добавить импорт `import { DemoWallet } from './demo';`, поле `private demoWallet: DemoWallet | null = null;` и в `bootPromise` после `this.balance = init.balance`:

```ts
      // В демо баланс ведём здесь: платформа его не считает.
      if (init.demo) {
        this.demoWallet = new DemoWallet(this.options.demoBalance ?? init.balance);
        this.balance = this.demoWallet.balance;
      }
```

В `onPlay` перед отправкой результата:

```ts
      if (this.demoWallet) {
        // Ставку списываем на входе в раунд, выигрыш зачисляем на выходе.
        if (this.cursor === 1) this.demoWallet.bet(payload.bet);
        if (!result.creditPending) this.demoWallet.credit(result.totalWinX * result.betAmount);
        this.balance = this.demoWallet.balance;
      }
```

Добавить тест в `packages/artube-bridge/test/bridge.test.ts`:

```ts
  it('в демо баланс ведёт клиент', async () => {
    backend.connect.mockResolvedValue({ ...INIT, demo: true, currency: null });
    backend.play.mockResolvedValue(result({ balanceAfter: null, winX: 3, totalWinX: 3, betAmount: 1 }));
    bridge.destroy();
    installWindow();
    sent = [];
    const { MemoryChannel } = await import('@energy8platform/game-sdk');
    channel = MemoryChannel.getGlobal();
    channel.onGuest((m: any) => sent.push({ type: m.type, payload: m.payload }));
    bridge = new ArtubeBridge({ devMode: true, url: URL_LIVE, gameId: 'my-game', demoBalance: 50 });
    await bridge.ready();
    channel.sendToHost('GAME_READY', {});
    await flush();
    channel.sendToHost('PLAY_REQUEST', { action: 'spin', bet: 1 });
    await flush();
    const play = sent.find((m) => m.type === 'PLAY_RESULT');
    expect(play!.payload.balanceAfter).toBe(52); // 50 − 1 ставка + 3 выигрыш
  });
```

- [ ] **Step 5: Написать e2e против песочницы**

`packages/artube-server/tests/e2e-sandbox.test.ts`:

```ts
/**
 * e2e против публичной песочницы Artube: там стоит тот же GamesAPI, что на
 * dev и prod. Тест не в CI — данные песочницы живут ~24 часа и создаются
 * вручную: «▶ Generate Data» → «🔗 Create Session» на
 * https://sandbox-api-dev.artube-888.live/sandbox-swagger/
 *
 * Запуск:
 *   ARTUBE_SANDBOX_SESSION=<sessionId> ARTUBE_SANDBOX_GAME=<publicGameId> \
 *   npm test --workspace @energy8platform/artube-server -- e2e-sandbox
 */

import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { GamesApiClient } from '../src/games-api/client';
import { startEngine } from '../src/engine';
import { startRound, acknowledgeSegment, advanceRound, type RoundDeps } from '../src/round/orchestrator';
import { toSessionContext } from '../src/session/init';
import { SANDBOX_URL } from '../bin/artube-server';

const sessionId = process.env.ARTUBE_SANDBOX_SESSION;
const gameId = process.env.ARTUBE_SANDBOX_GAME;
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe.skipIf(!sessionId || !gameId)('песочница Artube', () => {
  it('проходит полный цикл: SessionInfo → раунд с фичей → закрытие', async () => {
    const api = new GamesApiClient({
      url: `${SANDBOX_URL}?game=${gameId}`,
      apiKey: process.env.ARTUBE_SANDBOX_KEY ?? '',
      gameId: gameId!,
    });
    await api.connect();
    const info = await api.sessionInfo({
      session_id: sessionId!, player_connection_info: {},
    });
    expect(info.game_settings.allowed_bets.length).toBeGreaterThan(0);

    const engine = await startEngine({ gamesDir: fixtures });
    const deps: RoundDeps = {
      api, engine, gameId: 'feature-game',
      costMultipliers: { spin: 1, free_spin: 1 },
    };
    const ctx = toSessionContext(sessionId!, info);

    let out = await startRound(deps, ctx, { id: 'e2e', action: 'spin', betIndex: 0 });
    expect(out.round).not.toBeNull();
    let round = await acknowledgeSegment(deps, ctx, out.round!, 1);
    let guard = 0;
    while (round && guard++ < 10) {
      out = await advanceRound(deps, ctx, round, {
        id: `e2e-${guard}`, action: 'free_spin', betIndex: 0,
      });
      if (!out.round) break;
      round = await acknowledgeSegment(deps, ctx, out.round, out.round.state.cursor + 1);
    }
    expect(out.delivery.creditPending).toBe(false);
    expect(out.delivery.balanceAfter).not.toBeNull();

    engine.close();
    api.close();
  }, 60_000);
});
```

- [ ] **Step 6: Написать README моста**

`packages/artube-bridge/README.md` — чем пакет является, чем отличается от `stake-bridge` (адаптера нет, деньги и нарезку раунда знает бэкенд), таблица «что владеет мост / что владеет бэкенд», трёхплатформенная точка входа игры из спеки, поведение демо-режима и требование, чтобы бэкенд игры отдавался под тем же доменом (`/api/**`).

- [ ] **Step 7: Прогнать всё**

Run: `npm test --workspace @energy8platform/artube-bridge && npm test --workspace @energy8platform/artube-server`
Expected: PASS в обоих пакетах; e2e-sandbox пропущен без переменных окружения

- [ ] **Step 8: Коммит**

```bash
git add packages/artube-bridge packages/artube-server
git commit -m "feat(artube): демо-баланс на клиенте, README обоих пакетов и e2e против песочницы"
```

---

### Task 17: Восстановление после ошибок сессии и раунда

Спека требует двух реакций, которых нет ни в политике ретраев (они не про идемпотентность), ни в оркестраторе: `SessionIsNotInitialized` — переинициализировать сессию и повторить один раз; `InvalidRoundOperation` — перечитать `SessionInfo` и починить `round_version` / курсор.

**Files:**
- Create: `packages/artube-server/src/session/recovery.ts`
- Modify: `packages/artube-server/src/http/ws.ts` (обернуть обработку `play` восстановлением)
- Test: `packages/artube-server/tests/recovery.test.ts`

**Interfaces:**
- Consumes: из Task 3 — `GamesApiError`; из Task 9 — `resumeRound`; из Task 8 — `ActiveRound`.
- Produces: `interface RecoveryDeps { sessionInfo(): Promise<SessionInfoResponse>; resume(info: SessionInfoResponse): Promise<ActiveRound | null> }`; `async function withSessionRecovery<T>(deps: RecoveryDeps, run: (round: ActiveRound | null) => Promise<T>, round: ActiveRound | null): Promise<T>`.

- [ ] **Step 1: Написать падающий тест**

`packages/artube-server/tests/recovery.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { withSessionRecovery } from '../src/session/recovery';
import { GamesApiError } from '../src/games-api/errors';
import type { ActiveRound } from '../src/round/orchestrator';

const round = (version: number): ActiveRound => ({
  roundId: 'r1',
  roundVersion: version,
  state: {
    v: 1, seed: { server: 's', client: 'c', nonce: 1 }, script: 'sha',
    action: 'spin', betIndex: 0, priceMultiplier: 1, cursor: 1, totalWinX: 0, actions: [],
  },
  segments: [],
});

function deps(recovered: ActiveRound | null = round(5)) {
  return {
    sessionInfo: vi.fn(async () => ({}) as any),
    resume: vi.fn(async () => recovered),
  };
}

describe('восстановление сессии', () => {
  it('успешный вызов проходит без вмешательства', async () => {
    const d = deps();
    const run = vi.fn(async () => 'ok');
    expect(await withSessionRecovery(d, run, null)).toBe('ok');
    expect(d.sessionInfo).not.toHaveBeenCalled();
  });

  it('SessionIsNotInitialized переинициализирует сессию и повторяет', async () => {
    const d = deps();
    let calls = 0;
    const run = vi.fn(async () => {
      if (++calls === 1) {
        throw new GamesApiError({ code: 'SessionIsNotInitialized', message: 'call SessionInfo first' });
      }
      return 'ok';
    });
    expect(await withSessionRecovery(d, run, null)).toBe('ok');
    expect(d.sessionInfo).toHaveBeenCalledTimes(1);
    expect(calls).toBe(2);
  });

  it('InvalidRoundOperation чинит раунд из SessionInfo и повторяет', async () => {
    const d = deps(round(5));
    const seen: Array<ActiveRound | null> = [];
    let calls = 0;
    const run = vi.fn(async (current: ActiveRound | null) => {
      seen.push(current);
      if (++calls === 1) {
        throw new GamesApiError({ code: 'InvalidRoundOperation', message: 'Invalid round version to update.' });
      }
      return 'ok';
    });
    expect(await withSessionRecovery(d, run, round(1))).toBe('ok');
    expect(seen[0]!.roundVersion).toBe(1); // первая попытка со старой версией
    expect(seen[1]!.roundVersion).toBe(5); // повтор с версией от платформы
  });

  it('повторяет ровно один раз', async () => {
    const d = deps();
    const run = vi.fn(async () => {
      throw new GamesApiError({ code: 'SessionIsNotInitialized', message: 'nope' });
    });
    await expect(withSessionRecovery(d, run, null)).rejects.toMatchObject({
      code: 'SessionIsNotInitialized',
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('денежные ошибки не восстанавливает — они едут во фронт', async () => {
    const d = deps();
    const run = vi.fn(async () => {
      throw new GamesApiError({ code: 'InsufficientFunds', message: 'no money' });
    });
    await expect(withSessionRecovery(d, run, null)).rejects.toMatchObject({
      code: 'InsufficientFunds',
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(d.sessionInfo).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test --workspace @energy8platform/artube-server -- recovery`
Expected: FAIL — `Cannot find module '../src/session/recovery'`

- [ ] **Step 3: Реализовать восстановление**

`packages/artube-server/src/session/recovery.ts`:

```ts
/**
 * Восстановление после ошибок, которые чинятся перечитыванием состояния.
 *
 * Это не ретрай по идемпотентности: платформа прямо говорит, что делать.
 * `SessionIsNotInitialized` — сессию на этом коннекте ещё не инициализировали
 * (обычно после реконнекта); `InvalidRoundOperation` — у нас разъехались
 * `round_version` или курсор, и правду знает только Games API.
 */

import { GamesApiError } from '../games-api/errors';
import type { SessionInfoResponse } from '../games-api/types';
import type { ActiveRound } from '../round/orchestrator';

export interface RecoveryDeps {
  sessionInfo(): Promise<SessionInfoResponse>;
  /** Восстановить незакрытый раунд из свежего SessionInfo. */
  resume(info: SessionInfoResponse): Promise<ActiveRound | null>;
}

const RECOVERABLE = new Set(['SessionIsNotInitialized', 'InvalidRoundOperation']);

export async function withSessionRecovery<T>(
  deps: RecoveryDeps,
  run: (round: ActiveRound | null) => Promise<T>,
  round: ActiveRound | null,
): Promise<T> {
  try {
    return await run(round);
  } catch (err) {
    if (!(err instanceof GamesApiError) || !RECOVERABLE.has(err.code)) throw err;
    const info = await deps.sessionInfo();
    // Курсор и версия раунда — платформенные; после перечитывания идём с ними.
    const repaired = err.code === 'InvalidRoundOperation' ? await deps.resume(info) : round;
    return run(repaired);
  }
}
```

- [ ] **Step 4: Подключить к WS-хендлеру**

В `packages/artube-server/src/http/ws.ts` добавить импорт `import { withSessionRecovery } from '../session/recovery';` и заменить тело ветки `play`:

```ts
        const outcome = await withSessionRecovery(
          {
            sessionInfo: () =>
              deps.api.sessionInfo({ session_id: sessionId, player_connection_info: {} }),
            resume: async (info) => {
              if (!info.last_round || info.last_round.finished_at) return null;
              const recovered = await resumeRound(roundDeps, ctx, info.last_round);
              return recovered?.round ?? null;
            },
          },
          (activeRound) =>
            activeRound
              ? advanceRound(roundDeps, ctx, activeRound, msg)
              : startRound(roundDeps, ctx, msg),
          current,
        );
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test --workspace @energy8platform/artube-server`
Expected: PASS — все тесты сервера, включая 5 новых

- [ ] **Step 6: Коммит**

```bash
git add packages/artube-server
git commit -m "feat(artube-server): восстановление после SessionIsNotInitialized и InvalidRoundOperation"
```

---

## Проверка после всех задач

- [ ] `npm run typecheck` в корне — оба новых пакета типизируются
- [ ] `npm test` в корне — все воркспейсы зелёные
- [ ] `npm run build` в корне — оба пакета собираются
- [ ] Ручной прогон против песочницы: создать данные и сессию в Sandbox UI, поднять `artube-server --spin ./tests/fixtures/feature.spin --sandbox --port 8080`, открыть игру с `?sessionId=…`, проверить обычный спин, спин с фриспинами, перезагрузку страницы посреди фичи и закрытие раунда

