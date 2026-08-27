# Слот-WebIDE: Скелет — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Поднять `e8 ide`, в котором сторонний плагин приносит собственный UI и настраивается формой, отрисованной из его схемы, а правка значения горячо перезапускает плагин и записывается на диск.

**Architecture:** Хост — cordis-приложение в Node: `@cordisjs/plugin-loader` держит состав, `@cordisjs/plugin-server` отдаёт WS. Живой граф cordis — единственный источник истины; хост не хранит второй модели состава. Клиент — второе cordis-приложение, в браузере: `connection` (WS), `slots` (именованные точки UI), `modules` (подгрузка клиентских половинок плагинов в рантайме), React-рендерер schemastery-форм. Плагин — один пакет с двумя половинами, разведёнными картой экспортов.

**Tech Stack:** cordis 4.0.0-rc.8, @cordisjs/plugin-loader 1.0.0-rc.5, @cordisjs/plugin-include, @cordisjs/plugin-server 1.7.0, schemastery 3.18, TypeScript 5.6, Vitest 2, React 18, Vite 6, Playwright.

**Spec:** [docs/superpowers/specs/2026-08-27-slot-webide-cordis-design.md](../specs/2026-08-27-slot-webide-cordis-design.md)

## Global Constraints

- Новый код живёт **только** в `engine/`. `packages/*` и `examples/*` — легаси, не редактируются ни одной задачей этого плана.
- Скоуп пакетов — `@energy8engine/*`.
- Точные версии зависимостей: `cordis@4.0.0-rc.8`, `@cordisjs/plugin-loader@1.0.0-rc.5`, `@cordisjs/plugin-server@1.7.0`, `schemastery@3.18.0`, `typescript@^5.6.0`, `vitest@^2.0.0`, `react@^18.2.0`, `vite@^6.0.0`.
- Тесты запускаются только по рабочей области: `npm test --workspace @energy8engine/<pkg>`. Корневой `npx vitest run <path>` даёт ложные падения из-за конфигурации рабочих областей — не использовать.
- Каждый пакет: `tsconfig.json` расширяет `../../../tsconfig.base.json`, свой `vitest.config.ts`, скрипты `test` и `typecheck`.
- **Отказ — это данные.** Ни одна ошибка загрузки или валидации не выбрасывается наружу из сервисов хоста; она возвращается как `Diagnostic` и доезжает до UI.
- **Контракты не зависят от cordis.** Пакет `@energy8engine/contracts` не импортирует `cordis`, `schemastery` и ничего из Node — проверяется тестом.
- Комментарии в коде и сообщения коммитов — на английском, как в остальном репозитории.

---

## Проверенные факты о cordis 4 (не перепроверять — измерено 2026-08-27)

Эти вызовы прогнаны вживую на `cordis@4.0.0-rc.8`; на них опирается код ниже.

```js
const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'
await ctx.plugin(Loader)
await ctx.loader.create({ name: '@cordisjs/plugin-include', config: { path: './e8.yml' } })
await ctx.loader.await()

[...ctx.loader.entries()]            // Entry[]: { id, options: { name, config, disabled }, fiber?: Fiber }
await ctx.loader.update(id, { config })  // гасит эффекты, переподнимает плагин, ПИШЕТ yaml на диск
ctx.loader.import(name)              // импорт модуля плагина по имени
ctx.loader.unwrapExports(mod)        // достаёт объект плагина из модуля
```

- Внутри `apply(ctx, config)` сервис регистрируется **`ctx.provide(name, value)`**. `ctx.set(...)` без предварительного `provide` бросает `cannot set property "x" without provide`.
- `ctx.effect(fn, label)` — реверсивный эффект; `fiber.getEffects()` возвращает `{ label, children }[]`.
- `FiberState`: `PENDING 0, LOADING 1, ACTIVE 2, FAILED 3, DISPOSED 4, UNLOADING 5`.
- События для подписки: `internal/status(fiber, oldValue)`, `internal/plugin(fiber)`, `loader/config-update()`, `loader/entry-init(entry)`.
- Невалидный конфиг → `ValidationError` из `cordis`.
- Схема schemastery переживает сеть: `Schema.object({...}).toJSON()` → `JSON.stringify` → `new Schema(json)` сохраняет `type`, `dict`, `meta.min/max/step/description` и `meta.extra`.
- Метка «перезапуск» ставится как `Schema.number().extra('extra', { applies: 'restart' })` — сигнатура `extra(key, value)`, не `extra(object)`.
- Сервер: `ctx.plugin(Server, { host, port })`, маршруты `ctx.server.get(path, async (req, res) => { res.json(data) })`, сокеты `ctx.server.ws(path, async (req, accept) => { const socket = await accept() })`.

---

## Файловая структура

```
engine/
  core/contracts/                      @energy8engine/contracts — чистые типы, без зависимостей
    src/diagnostic.ts                  Diagnostic, severity, фабрика
    src/manifest.ts                    поле "e8" в package.json → E8Manifest
    src/protocol.ts                    формы сообщений WS
    src/index.ts
    tests/{diagnostic,manifest,purity}.test.ts
  ide/host/                            @energy8engine/ide-host
    src/index.ts                       createIdeHost()
    src/plugins/composition.ts         сервис composition поверх loader
    src/plugins/rpc.ts                 WS /ide: снапшот и приём правок
    src/plugins/client-assets.ts       раздача клиентских половинок плагинов
    src/resolvePackage.ts              путь к package.json плагина
    tests/fixtures/                    probe-plugin, broken-plugin
    tests/{host,composition,update,rpc,assets}.test.ts
  ide/client/                          @energy8engine/ide-client
    src/context.ts                     createIdeClient(): Context в браузере
    src/plugins/connection.ts          WS-канал, хранит снапшот
    src/plugins/slots.tsx              сервис slots + useSlot
    src/plugins/modules.ts             подгрузка клиентских половинок
    src/schema-form/SchemaForm.tsx     рендерер формы из JSON схемы
    src/schema-form/fields.tsx         контролы по видам
    src/screens/CompositionScreen.tsx  экран «Состав»
    tests/{slots,connection,modules,schema-form,composition-screen}.test.tsx
  apps/cli/                            @energy8engine/e8 — bin `e8`, команда `e8 ide`
    bin/e8.mjs, src/index.ts
  apps/web/                            оболочка: vite + React, точка входа клиента
    index.html, src/main.tsx, vite.config.ts
    tests/e2e/skeleton.spec.ts         playwright-приёмка
  examples/probe-plugin/               плагин с двумя половинами — доказательство модели
    package.json, src/index.ts, src/client.tsx
```

---

### Task 1: Каркас `engine/` и контракт диагностики

**Files:**
- Modify: `package.json:7-10` (добавить `engine/*/*` в `workspaces`)
- Create: `engine/core/contracts/package.json`
- Create: `engine/core/contracts/tsconfig.json`
- Create: `engine/core/contracts/vitest.config.ts`
- Create: `engine/core/contracts/src/diagnostic.ts`
- Create: `engine/core/contracts/src/index.ts`
- Test: `engine/core/contracts/tests/diagnostic.test.ts`
- Test: `engine/core/contracts/tests/purity.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces: `Diagnostic`, `Severity`, `diagnostic(severity, plugin, where, message, fix?): Diagnostic` из `@energy8engine/contracts`.

- [ ] **Step 1: Создать каркас пакета**

`package.json` в корне — в массив `workspaces` добавить `"engine/*/*"` третьим элементом.

`engine/core/contracts/package.json`:

```json
{
  "name": "@energy8engine/contracts",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.0.0" },
  "license": "MIT"
}
```

`engine/core/contracts/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["vitest/globals"] },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`engine/core/contracts/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 2: Написать падающий тест**

`engine/core/contracts/tests/diagnostic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { diagnostic } from '../src/index';

describe('diagnostic', () => {
  it('builds a diagnostic with the given fields', () => {
    const d = diagnostic('error', 'probe-plugin', 'config.speed', 'speed must be a number');
    expect(d).toEqual({
      severity: 'error',
      plugin: 'probe-plugin',
      where: 'config.speed',
      message: 'speed must be a number',
    });
  });

  it('includes the fix hint when given', () => {
    const d = diagnostic('warning', 'p', 'w', 'm', 'set it to 8');
    expect(d.fix).toBe('set it to 8');
  });

  it('omits the fix key entirely when not given', () => {
    expect('fix' in diagnostic('info', 'p', 'w', 'm')).toBe(false);
  });
});
```

`engine/core/contracts/tests/purity.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('contracts purity', () => {
  it('imports nothing — not cordis, not schemastery, not node builtins', () => {
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      const foreign = imports.filter((s) => !s.startsWith('.'));
      expect(foreign, `${file} imports ${foreign.join(', ')}`).toEqual([]);
    }
  });
});
```

- [ ] **Step 3: Запустить и убедиться, что падает**

Run: `npm install && npm test --workspace @energy8engine/contracts`
Expected: FAIL — `Failed to resolve import "../src/index"`.

- [ ] **Step 4: Реализовать**

`engine/core/contracts/src/diagnostic.ts`:

```ts
/** How much a failure matters. `error` stops the game; `warning` degrades it. */
export type Severity = 'error' | 'warning' | 'info';

/** A failure that reaches a human, in the same shape for the game, the IDE and the agent. */
export interface Diagnostic {
  severity: Severity;
  /** Entry id or package name the failure belongs to. */
  plugin: string;
  /** Where inside the plugin — a config path, a seam name, a file. */
  where: string;
  message: string;
  /** What the human can do about it, when we know. */
  fix?: string;
}

export function diagnostic(
  severity: Severity,
  plugin: string,
  where: string,
  message: string,
  fix?: string,
): Diagnostic {
  return fix === undefined
    ? { severity, plugin, where, message }
    : { severity, plugin, where, message, fix };
}
```

`engine/core/contracts/src/index.ts`:

```ts
export * from './diagnostic';
```

- [ ] **Step 5: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/contracts`
Expected: PASS, 4 теста.

- [ ] **Step 6: Коммит**

```bash
git add package.json engine/core/contracts
git commit -m "feat(contracts): diagnostics as data, in a package that imports nothing"
```

---

### Task 2: Манифест плагина — поле `e8` в `package.json`

**Files:**
- Create: `engine/core/contracts/src/manifest.ts`
- Modify: `engine/core/contracts/src/index.ts`
- Test: `engine/core/contracts/tests/manifest.test.ts`

**Interfaces:**
- Consumes: `Diagnostic`, `diagnostic` (Task 1).
- Produces: `E8Manifest { client?: { entry: string; inject: string[] }; hot: boolean }`, `parseManifest(pkg: unknown, pkgName: string): { manifest: E8Manifest | null; diagnostics: Diagnostic[] }`.

- [ ] **Step 1: Написать падающий тест**

`engine/core/contracts/tests/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../src/index';

describe('parseManifest', () => {
  it('returns null for a package with no e8 field, without complaining', () => {
    expect(parseManifest({ name: 'lodash' }, 'lodash')).toEqual({ manifest: null, diagnostics: [] });
  });

  it('reads the client half and the hot flag', () => {
    const { manifest, diagnostics } = parseManifest(
      { e8: { client: { entry: './client.js', inject: ['ui-composition'] }, hot: true } },
      'probe-plugin',
    );
    expect(diagnostics).toEqual([]);
    expect(manifest).toEqual({ client: { entry: './client.js', inject: ['ui-composition'] }, hot: true });
  });

  it('defaults hot to false and inject to empty', () => {
    const { manifest } = parseManifest({ e8: { client: { entry: './c.js' } } }, 'p');
    expect(manifest).toEqual({ client: { entry: './c.js', inject: [] }, hot: false });
  });

  it('warns and drops the client half when entry is missing', () => {
    const { manifest, diagnostics } = parseManifest({ e8: { client: {} } }, 'p');
    expect(manifest).toEqual({ hot: false });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('warning');
    expect(diagnostics[0].where).toBe('e8.client.entry');
  });

  it('warns when e8 is not an object', () => {
    const { manifest, diagnostics } = parseManifest({ e8: 'yes' }, 'p');
    expect(manifest).toBeNull();
    expect(diagnostics[0].where).toBe('e8');
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/contracts`
Expected: FAIL — `parseManifest is not a function`.

- [ ] **Step 3: Реализовать**

`engine/core/contracts/src/manifest.ts`:

```ts
import { type Diagnostic, diagnostic } from './diagnostic';

/** The browser half of a plugin, loaded into the IDE at runtime. */
export interface E8ClientHalf {
  /** Module path inside the package, relative to its root. */
  entry: string;
  /** Client services this half needs before it can register anything. */
  inject: string[];
}

/** The `e8` field of a plugin's package.json. */
export interface E8Manifest {
  client?: E8ClientHalf;
  /** Whether a config change can restart this plugin in place. */
  hot: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseManifest(
  pkg: unknown,
  pkgName: string,
): { manifest: E8Manifest | null; diagnostics: Diagnostic[] } {
  if (!isRecord(pkg) || pkg.e8 === undefined) return { manifest: null, diagnostics: [] };

  const raw = pkg.e8;
  if (!isRecord(raw)) {
    return {
      manifest: null,
      diagnostics: [
        diagnostic('warning', pkgName, 'e8', 'the "e8" field must be an object', 'remove it or make it an object'),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const manifest: E8Manifest = { hot: raw.hot === true };

  if (raw.client !== undefined) {
    const client = raw.client;
    if (!isRecord(client) || typeof client.entry !== 'string') {
      diagnostics.push(
        diagnostic(
          'warning',
          pkgName,
          'e8.client.entry',
          'the client half needs a module path in "entry"',
          'add e8.client.entry, e.g. "./client.js"',
        ),
      );
    } else {
      const inject = Array.isArray(client.inject)
        ? client.inject.filter((v): v is string => typeof v === 'string')
        : [];
      manifest.client = { entry: client.entry, inject };
    }
  }

  return { manifest, diagnostics };
}
```

`engine/core/contracts/src/index.ts` — добавить строку:

```ts
export * from './manifest';
```

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/contracts`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Коммит**

```bash
git add engine/core/contracts
git commit -m "feat(contracts): read the e8 manifest, complain in data not exceptions"
```

---

### Task 3: Хост поднимается — `createIdeHost()` и `e8 ide`

**Files:**
- Create: `engine/ide/host/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `engine/ide/host/src/index.ts`
- Create: `engine/apps/cli/{package.json,tsconfig.json}`
- Create: `engine/apps/cli/src/index.ts`
- Test: `engine/ide/host/tests/host.test.ts`
- Test: `engine/ide/host/tests/fixtures/workspace/e8.yml`

**Interfaces:**
- Consumes: ничего из предыдущих задач.
- Produces: `createIdeHost(options: IdeHostOptions): Promise<IdeHost>`, где `IdeHostOptions = { cwd: string; port?: number; host?: string }` и `IdeHost = { ctx: Context; url: string; stop(): Promise<void> }`.

- [ ] **Step 1: Создать пакет**

`engine/ide/host/package.json`:

```json
{
  "name": "@energy8engine/ide-host",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@cordisjs/plugin-include": "*",
    "@cordisjs/plugin-loader": "1.0.0-rc.5",
    "@cordisjs/plugin-server": "1.7.0",
    "@energy8engine/contracts": "*",
    "cordis": "4.0.0-rc.8",
    "schemastery": "3.18.0"
  },
  "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.6.0", "vitest": "^2.0.0", "ws": "^8.19.0" },
  "license": "MIT"
}
```

`engine/ide/host/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["node", "vitest/globals"] },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

`engine/ide/host/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

- [ ] **Step 2: Написать падающий тест**

`engine/ide/host/tests/fixtures/workspace/e8.yml`:

```yaml
[]
```

`engine/ide/host/tests/host.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'workspace');

let host: IdeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
});

describe('createIdeHost', () => {
  it('serves a health route on an ephemeral port', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    const res = await fetch(`${host.url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('exposes the loader so composition can be read from the live graph', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    expect(typeof host.ctx.loader.entries).toBe('function');
  });

  it('stops cleanly — the port stops answering', async () => {
    host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
    const url = host.url;
    await host.stop();
    host = undefined;
    await expect(fetch(`${url}/api/health`)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Запустить и убедиться, что падает**

Run: `npm install && npm test --workspace @energy8engine/ide-host`
Expected: FAIL — `Failed to resolve import "../src/index"`.

- [ ] **Step 4: Реализовать**

`engine/ide/host/src/index.ts`:

```ts
import { pathToFileURL } from 'node:url';
import { Context } from 'cordis';
import Loader from '@cordisjs/plugin-loader';
import Server from '@cordisjs/plugin-server';

export interface IdeHostOptions {
  /** Project directory; its e8.yml is the composition. */
  cwd: string;
  /** 0 picks a free port — used by tests. */
  port?: number;
  host?: string;
}

export interface IdeHost {
  ctx: Context;
  /** Base URL the browser talks to, e.g. http://127.0.0.1:5679 */
  url: string;
  stop(): Promise<void>;
}

/**
 * The composition file. This is the Slice 0 stand-in for the profile + patch
 * format; the project package replaces it without touching this module's API.
 */
export const COMPOSITION_FILE = './e8.yml';

export async function createIdeHost(options: IdeHostOptions): Promise<IdeHost> {
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(options.cwd).href + '/';

  await ctx.plugin(Loader);
  await ctx.loader.create({
    name: '@cordisjs/plugin-include',
    config: { path: COMPOSITION_FILE },
  });

  await ctx.plugin(Server, { host: options.host ?? '127.0.0.1', port: options.port ?? 5679 });
  await ctx.loader.await();

  ctx.server.get('/api/health', async (_req, res) => {
    res.json({ ok: true });
  });

  return {
    ctx,
    url: `http://${ctx.server.host}:${ctx.server.port}`,
    stop: async () => {
      await ctx.fiber.dispose();
    },
  };
}
```

`engine/apps/cli/package.json`:

```json
{
  "name": "@energy8engine/e8",
  "version": "0.0.0",
  "type": "module",
  "bin": { "e8": "./bin/e8.mjs" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "@energy8engine/ide-host": "*", "tsx": "^4.19.0" },
  "devDependencies": { "@types/node": "^22.0.0", "typescript": "^5.6.0" },
  "license": "MIT"
}
```

Slice 0 runs the workspace straight from TypeScript sources, so the bin is a
thin JavaScript shim that registers `tsx` before importing the command. A real
build step arrives with packaging, not here.

`engine/apps/cli/bin/e8.mjs`:

```js
#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();
await import('../src/index.ts');
```

`engine/apps/cli/src/index.ts`:

```ts
#!/usr/bin/env node
import { createIdeHost } from '@energy8engine/ide-host';

const [command] = process.argv.slice(2);

if (command !== 'ide') {
  console.error('usage: e8 ide');
  process.exit(1);
}

const host = await createIdeHost({ cwd: process.cwd() });
console.log(`e8 ide listening on ${host.url}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void host.stop().then(() => process.exit(0));
  });
}
```

- [ ] **Step 5: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-host`
Expected: PASS, 3 теста.

- [ ] **Step 6: Коммит**

```bash
git add engine/ide/host engine/apps/cli
git commit -m "feat(ide-host): boot a cordis host with loader and server behind e8 ide"
```

---

### Task 4: Снапшот состава из живого графа

**Files:**
- Create: `engine/core/contracts/src/protocol.ts`
- Modify: `engine/core/contracts/src/index.ts`
- Create: `engine/ide/host/src/resolvePackage.ts`
- Create: `engine/ide/host/src/plugins/composition.ts`
- Modify: `engine/ide/host/src/index.ts`
- Test: `engine/ide/host/tests/composition.test.ts`
- Test: `engine/ide/host/tests/fixtures/probe-plugin/{package.json,index.js}`

**Interfaces:**
- Consumes: `createIdeHost` (Task 3), `parseManifest`, `Diagnostic` (Tasks 1–2).
- Produces: `CompositionRow`, `Snapshot` из `@energy8engine/contracts`; сервис `ctx.composition` с методом `snapshot(): Promise<Snapshot>`.

- [ ] **Step 1: Написать падающий тест**

Фикстура-плагин `engine/ide/host/tests/fixtures/probe-plugin/package.json`:

```json
{
  "name": "probe-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js", "./package.json": "./package.json" },
  "e8": { "client": { "entry": "./client.js" }, "hot": true }
}
```

`engine/ide/host/tests/fixtures/probe-plugin/index.js`:

```js
import Schema from 'schemastery';

export const name = 'probe';
export const Config = Schema.object({
  speed: Schema.number().min(1).max(20).default(8).description('reel speed'),
});

export function apply(ctx, config) {
  globalThis.__probeApplied ??= [];
  globalThis.__probeApplied.push(config.speed);
  ctx.effect(() => () => globalThis.__probeApplied.push('off'), 'probe-effect');
}
```

Рабочая область `engine/ide/host/tests/fixtures/workspace/e8.yml` — заменить содержимое на:

```yaml
- id: probe1
  name: probe-plugin
  config:
    speed: 12
```

Чтобы `probe-plugin` резолвился по имени, добавить его в `devDependencies` пакета `@energy8engine/ide-host`: `"probe-plugin": "file:./tests/fixtures/probe-plugin"`.

`engine/ide/host/tests/composition.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'workspace');

let host: IdeHost;
beforeEach(async () => {
  (globalThis as any).__probeApplied = [];
  host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
});
afterEach(async () => {
  await host.stop();
});

describe('composition.snapshot', () => {
  it('lists the entry with its config and live fiber state', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin');
    expect(row).toBeDefined();
    expect(row!.config).toEqual({ speed: 12 });
    expect(row!.disabled).toBe(false);
    expect(row!.state).toBe(2); // FiberState.ACTIVE
  });

  it('carries the plugin schema as JSON the browser can rebuild', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;
    expect((row.schema as any).type).toBe('object');
    expect((row.schema as any).dict.speed.meta.min).toBe(1);
  });

  it('carries the manifest facts the IDE acts on', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;
    expect(row.hot).toBe(true);
    expect(row.clientUrl).toBe(`/plugin-client/${row.id}`);
  });

  it('says nothing about entries that have no schema, instead of inventing one', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const include = snapshot.rows.find((r) => r.name === '@cordisjs/plugin-include')!;
    expect(include.clientUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm install && npm test --workspace @energy8engine/ide-host -- composition`
Expected: FAIL — `Cannot read properties of undefined (reading 'snapshot')`.

- [ ] **Step 3: Добавить формы протокола**

`engine/core/contracts/src/protocol.ts`:

```ts
import type { Diagnostic } from './diagnostic';

/** One row of the composition: a plugin as the IDE shows it. */
export interface CompositionRow {
  /** Loader entry id, e.g. "a1b2c3:probe1". Stable across restarts. */
  id: string;
  /** Package name as written in the composition file. */
  name: string;
  disabled: boolean;
  /** cordis FiberState: 2 is ACTIVE, 3 is FAILED. */
  state: number | null;
  config: unknown;
  /** schemastery schema serialised with toJSON(), or null when the plugin declares none. */
  schema: unknown | null;
  /** Whether a config change restarts the plugin in place. */
  hot: boolean;
  /** Where the browser fetches this plugin's client half, or null when it has none. */
  clientUrl: string | null;
}

export interface Snapshot {
  rows: CompositionRow[];
  diagnostics: Diagnostic[];
}

/** Host to browser. Slice 0 sends whole snapshots: they are small, and diffing is a later problem. */
export type ServerMessage =
  | { type: 'snapshot'; snapshot: Snapshot }
  | { type: 'diagnostics'; diagnostics: Diagnostic[] };

/** Browser to host. */
export type ClientMessage = { type: 'update'; id: string; config: unknown };
```

Добавить в `engine/core/contracts/src/index.ts`:

```ts
export * from './protocol';
```

- [ ] **Step 4: Реализовать сервис**

`engine/ide/host/src/resolvePackage.ts`:

```ts
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Read a plugin package's package.json from the project's perspective.
 * Packages that export "./package.json" resolve directly; the rest are found
 * by walking up from their entry point.
 */
export function readPackageJson(cwd: string, name: string): { dir: string; json: unknown } | null {
  const require = createRequire(join(cwd, 'noop.js'));
  try {
    const file = require.resolve(`${name}/package.json`);
    return { dir: dirname(file), json: JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    // fall through to walking up from the entry point
  }
  try {
    let dir = dirname(require.resolve(name));
    for (let depth = 0; depth < 8; depth += 1) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        return { dir, json: JSON.parse(readFileSync(candidate, 'utf8')) };
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // unresolvable package — the caller turns this into a diagnostic
  }
  return null;
}
```

`engine/ide/host/src/plugins/composition.ts`:

```ts
import type { Context } from 'cordis';
import {
  type CompositionRow,
  type Diagnostic,
  type Snapshot,
  diagnostic,
  parseManifest,
} from '@energy8engine/contracts';
import { readPackageJson } from '../resolvePackage';

declare module 'cordis' {
  interface Context {
    composition: CompositionService;
  }
}

export interface CompositionService {
  snapshot(): Promise<Snapshot>;
}

export interface CompositionConfig {
  /** Project directory, used to resolve plugin packages. */
  cwd: string;
}

async function schemaOf(ctx: Context, name: string): Promise<unknown | null> {
  try {
    const plugin = ctx.loader.unwrapExports(await ctx.loader.import(name));
    const Config = (plugin as { Config?: { toJSON?: () => unknown } } | undefined)?.Config;
    return typeof Config?.toJSON === 'function' ? Config.toJSON() : null;
  } catch {
    return null;
  }
}

export const name = 'composition';

export function apply(ctx: Context, config: CompositionConfig) {
  const service: CompositionService = {
    async snapshot() {
      const rows: CompositionRow[] = [];
      const diagnostics: Diagnostic[] = [];

      for (const entry of ctx.loader.entries()) {
        const pkgName = entry.options.name;
        const pkg = readPackageJson(config.cwd, pkgName);
        if (!pkg) {
          diagnostics.push(
            diagnostic(
              'error',
              entry.id,
              'package',
              `cannot resolve package "${pkgName}"`,
              `install it, or fix the name in ${'e8.yml'}`,
            ),
          );
        }

        const parsed = pkg ? parseManifest(pkg.json, pkgName) : { manifest: null, diagnostics: [] };
        diagnostics.push(...parsed.diagnostics);

        rows.push({
          id: entry.id,
          name: pkgName,
          disabled: entry.disabled,
          state: entry.fiber?.state ?? null,
          config: entry.options.config ?? {},
          schema: await schemaOf(ctx, pkgName),
          hot: parsed.manifest?.hot ?? false,
          clientUrl: parsed.manifest?.client ? `/plugin-client/${entry.id}` : null,
        });
      }

      return { rows, diagnostics };
    },
  };

  ctx.provide('composition', service);
}
```

- [ ] **Step 5: Подключить к хосту**

В `engine/ide/host/src/index.ts` — импорт и регистрация до `ctx.loader.await()`:

```ts
import * as composition from './plugins/composition';
```

```ts
  await ctx.plugin(composition, { cwd: options.cwd });
```

- [ ] **Step 6: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-host`
Expected: PASS, 7 тестов.

- [ ] **Step 7: Коммит**

```bash
git add engine/core/contracts engine/ide/host
git commit -m "feat(ide-host): read composition off the live graph, schemas and all"
```

---

### Task 5: Горячая правка настройки

**Files:**
- Modify: `engine/ide/host/src/plugins/composition.ts`
- Test: `engine/ide/host/tests/update.test.ts`

**Interfaces:**
- Consumes: `CompositionService` (Task 4).
- Produces: `composition.update(id: string, config: unknown): Promise<Diagnostic[]>` — пустой массив означает «применено».

- [ ] **Step 1: Написать падающий тест**

`engine/ide/host/tests/update.test.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'workspace');
const FILE = join(WORKSPACE, 'e8.yml');

let host: IdeHost;
let original: string;

beforeEach(async () => {
  original = readFileSync(FILE, 'utf8');
  (globalThis as any).__probeApplied = [];
  host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
});

afterEach(async () => {
  await host.stop();
  writeFileSync(FILE, original);
});

async function probeId(host: IdeHost): Promise<string> {
  const snapshot = await host.ctx.composition.snapshot();
  return snapshot.rows.find((r) => r.name === 'probe-plugin')!.id;
}

describe('composition.update', () => {
  it('restarts the plugin in place with the new config', async () => {
    const diagnostics = await host.ctx.composition.update(await probeId(host), { speed: 3 });
    expect(diagnostics).toEqual([]);
    expect((globalThis as any).__probeApplied).toEqual([12, 'off', 3]);
  });

  it('writes the change back to the composition file', async () => {
    await host.ctx.composition.update(await probeId(host), { speed: 3 });
    expect(readFileSync(FILE, 'utf8')).toContain('speed: 3');
  });

  it('reports an invalid value as a diagnostic and keeps the old config', async () => {
    const diagnostics = await host.ctx.composition.update(await probeId(host), { speed: 999 });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].where).toContain('config');
    const snapshot = await host.ctx.composition.snapshot();
    expect(snapshot.rows.find((r) => r.name === 'probe-plugin')!.config).toEqual({ speed: 12 });
  });

  it('reports an unknown entry id instead of throwing', async () => {
    const diagnostics = await host.ctx.composition.update('nope', { speed: 3 });
    expect(diagnostics[0].message).toContain('nope');
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/ide-host -- update`
Expected: FAIL — `ctx.composition.update is not a function`.

- [ ] **Step 3: Реализовать**

В `engine/ide/host/src/plugins/composition.ts` расширить интерфейс и реализацию:

```ts
export interface CompositionService {
  snapshot(): Promise<Snapshot>;
  update(id: string, config: unknown): Promise<Diagnostic[]>;
}
```

Внутри `apply`, рядом со `snapshot`:

```ts
    async update(id, next) {
      const known = [...ctx.loader.entries()].some((entry) => entry.id === id);
      if (!known) {
        return [diagnostic('error', id, 'composition', `no entry with id "${id}"`)];
      }
      const before = [...ctx.loader.entries()].find((entry) => entry.id === id)!.options.config;
      try {
        await ctx.loader.update(id, { config: next });
        return [];
      } catch (error) {
        // The loader has already rolled the value back in memory; restore the file too.
        await ctx.loader.update(id, { config: before });
        return [
          diagnostic(
            'error',
            id,
            'config',
            error instanceof Error ? error.message : String(error),
            'fix the value and try again',
          ),
        ];
      }
    },
```

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-host`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Коммит**

```bash
git add engine/ide/host
git commit -m "feat(ide-host): turning a knob restarts the fiber and lands on disk"
```

---

### Task 6: WS-канал между хостом и браузером

**Files:**
- Create: `engine/ide/host/src/plugins/rpc.ts`
- Modify: `engine/ide/host/src/index.ts`
- Test: `engine/ide/host/tests/rpc.test.ts`

**Interfaces:**
- Consumes: `ctx.composition` (Tasks 4–5), `ServerMessage`, `ClientMessage` (Task 4).
- Produces: WS-эндпоинт `/ide`, шлющий `{ type: 'snapshot' }` при подключении и после каждого изменения состава.

- [ ] **Step 1: Написать падающий тест**

`engine/ide/host/tests/rpc.test.ts`:

```ts
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'workspace');
const FILE = join(WORKSPACE, 'e8.yml');

let host: IdeHost;
let socket: WebSocket;
let original: string;

function nextMessage(socket: WebSocket): Promise<ServerMessage> {
  return new Promise((resolve) => {
    socket.once('message', (data) => resolve(JSON.parse(String(data)) as ServerMessage));
  });
}

beforeEach(async () => {
  original = readFileSync(FILE, 'utf8');
  host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
  socket = new WebSocket(`${host.url.replace('http', 'ws')}/ide`);
  await new Promise((resolve) => socket.once('open', resolve));
});

afterEach(async () => {
  socket.close();
  await host.stop();
  writeFileSync(FILE, original);
});

describe('ide rpc', () => {
  it('pushes a snapshot as soon as the browser connects', async () => {
    const message = await nextMessage(socket);
    expect(message.type).toBe('snapshot');
    expect(message.type === 'snapshot' && message.snapshot.rows.some((r) => r.name === 'probe-plugin')).toBe(true);
  });

  it('pushes a fresh snapshot after an update arrives from the browser', async () => {
    const first = await nextMessage(socket);
    const id = first.type === 'snapshot' ? first.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id : '';
    socket.send(JSON.stringify({ type: 'update', id, config: { speed: 5 } }));
    const second = await nextMessage(socket);
    expect(second.type === 'snapshot' && second.snapshot.rows.find((r) => r.id === id)!.config).toEqual({ speed: 5 });
  });

  it('sends diagnostics when the update is rejected, and does not disconnect', async () => {
    const first = await nextMessage(socket);
    const id = first.type === 'snapshot' ? first.snapshot.rows.find((r) => r.name === 'probe-plugin')!.id : '';
    socket.send(JSON.stringify({ type: 'update', id, config: { speed: 999 } }));
    const second = await nextMessage(socket);
    expect(second.type).toBe('diagnostics');
    expect(socket.readyState).toBe(WebSocket.OPEN);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/ide-host -- rpc`
Expected: FAIL — сокет закрывается, `/ide` не обслуживается.

- [ ] **Step 3: Реализовать**

`engine/ide/host/src/plugins/rpc.ts`:

```ts
import type { Context } from 'cordis';
import type { ClientMessage, ServerMessage } from '@energy8engine/contracts';
import type { WebSocket } from 'ws';

export const name = 'ide-rpc';
export const inject = ['composition', 'server'];

export function apply(ctx: Context) {
  const clients = new Set<WebSocket>();

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
  };

  const broadcast = async () => {
    if (!clients.size) return;
    const snapshot = await ctx.composition.snapshot();
    for (const socket of clients) send(socket, { type: 'snapshot', snapshot });
  };

  ctx.server.ws('/ide', async (_req, accept) => {
    const socket = await accept();
    clients.add(socket);
    socket.on('close', () => clients.delete(socket));

    socket.on('message', async (data) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(data)) as ClientMessage;
      } catch {
        return; // malformed frames are ignored; the browser is ours
      }
      if (message.type !== 'update') return;
      const diagnostics = await ctx.composition.update(message.id, message.config);
      if (diagnostics.length) {
        send(socket, { type: 'diagnostics', diagnostics });
      } else {
        await broadcast();
      }
    });

    send(socket, { type: 'snapshot', snapshot: await ctx.composition.snapshot() });
  });

  // The graph is the source of truth: whenever it moves, the browser hears about it.
  ctx.on('internal/status', () => void broadcast());
  ctx.on('loader/config-update', () => void broadcast());
}
```

- [ ] **Step 4: Подключить к хосту**

В `engine/ide/host/src/index.ts`:

```ts
import * as rpc from './plugins/rpc';
```

```ts
  await ctx.plugin(rpc);
```

- [ ] **Step 5: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-host`
Expected: PASS, 14 тестов.

- [ ] **Step 6: Коммит**

```bash
git add engine/ide/host
git commit -m "feat(ide-host): a websocket that carries the whole composition both ways"
```

---

### Task 7: Раздача клиентских половинок плагинов

**Files:**
- Create: `engine/ide/host/src/plugins/client-assets.ts`
- Modify: `engine/ide/host/src/index.ts`
- Create: `engine/ide/host/tests/fixtures/probe-plugin/client.js`
- Test: `engine/ide/host/tests/assets.test.ts`

**Interfaces:**
- Consumes: `readPackageJson` (Task 4), `parseManifest` (Task 2).
- Produces: HTTP-маршрут `GET /plugin-client/:id`, отдающий модуль клиентской половины как `text/javascript`.

- [ ] **Step 1: Написать падающий тест**

`engine/ide/host/tests/fixtures/probe-plugin/client.js`:

```js
export function apply(ctx) {
  globalThis.__probeClientApplied = true;
  void ctx;
}
```

`engine/ide/host/tests/assets.test.ts`:

```ts
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

const WORKSPACE = join(__dirname, 'fixtures', 'workspace');

let host: IdeHost;
beforeEach(async () => {
  host = await createIdeHost({ cwd: WORKSPACE, port: 0 });
});
afterEach(async () => {
  await host.stop();
});

describe('plugin client assets', () => {
  it('serves the client half as a javascript module', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'probe-plugin')!;
    const res = await fetch(`${host.url}${row.clientUrl}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toContain('__probeClientApplied');
  });

  it('404s for an entry that has no client half', async () => {
    const snapshot = await host.ctx.composition.snapshot();
    const include = snapshot.rows.find((r) => r.name === '@cordisjs/plugin-include')!;
    const res = await fetch(`${host.url}/plugin-client/${include.id}`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/ide-host -- assets`
Expected: FAIL — маршрут не зарегистрирован, статус не 200.

- [ ] **Step 3: Реализовать**

`engine/ide/host/src/plugins/client-assets.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from 'cordis';
import { parseManifest } from '@energy8engine/contracts';
import { readPackageJson } from '../resolvePackage';

export const name = 'client-assets';
export const inject = ['server'];

export interface ClientAssetsConfig {
  cwd: string;
}

export function apply(ctx: Context, config: ClientAssetsConfig) {
  ctx.server.get('/plugin-client/:id', async (req, res) => {
    const entry = [...ctx.loader.entries()].find((candidate) => candidate.id === req.params.id);
    if (!entry) {
      res.status = 404;
      res.json({ error: `no entry with id "${req.params.id}"` });
      return;
    }

    const pkg = readPackageJson(config.cwd, entry.options.name);
    const manifest = pkg ? parseManifest(pkg.json, entry.options.name).manifest : null;
    if (!pkg || !manifest?.client) {
      res.status = 404;
      res.json({ error: `"${entry.options.name}" has no client half` });
      return;
    }

    res.headers.set('content-type', 'text/javascript; charset=utf-8');
    res.text(readFileSync(join(pkg.dir, manifest.client.entry), 'utf8'));
  });
}
```

- [ ] **Step 4: Подключить к хосту**

В `engine/ide/host/src/index.ts`:

```ts
import * as clientAssets from './plugins/client-assets';
```

```ts
  await ctx.plugin(clientAssets, { cwd: options.cwd });
```

- [ ] **Step 5: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-host`
Expected: PASS, 16 тестов.

- [ ] **Step 6: Коммит**

```bash
git add engine/ide/host
git commit -m "feat(ide-host): hand the browser each plugin's client half"
```

---

### Task 8: Клиент — cordis в браузере и канал к хосту

**Files:**
- Create: `engine/ide/client/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `engine/ide/client/src/context.ts`
- Create: `engine/ide/client/src/plugins/connection.ts`
- Create: `engine/ide/client/src/index.ts`
- Test: `engine/ide/client/tests/connection.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `ServerMessage`, `ClientMessage` (Task 4).
- Produces: `createIdeClient(options: { url: string; socketFactory?: (url: string) => WebSocketLike }): Context`; сервис `ctx.connection` с `snapshot: Snapshot | null`, `subscribe(listener): () => void`, `update(id, config): void`.

- [ ] **Step 1: Создать пакет**

`engine/ide/client/package.json`:

```json
{
  "name": "@energy8engine/ide-client",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit" },
  "dependencies": { "@energy8engine/contracts": "*", "cordis": "4.0.0-rc.8", "schemastery": "3.18.0" },
  "peerDependencies": { "react": "^18.2.0" },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/react": "^18.3.0",
    "jsdom": "^25.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  },
  "license": "MIT"
}
```

`engine/ide/client/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'jsdom', include: ['tests/**/*.test.tsx', 'tests/**/*.test.ts'] },
});
```

`engine/ide/client/tsconfig.json`:

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "types": ["vitest/globals"] },
  "include": ["src/**/*.ts", "src/**/*.tsx", "tests/**/*.ts", "tests/**/*.tsx"]
}
```

- [ ] **Step 2: Написать падающий тест**

`engine/ide/client/tests/connection.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage, Snapshot } from '@energy8engine/contracts';
import { createIdeClient, type WebSocketLike } from '../src/index';

const SNAPSHOT: Snapshot = {
  rows: [
    { id: 'a:probe1', name: 'probe-plugin', disabled: false, state: 2, config: { speed: 8 }, schema: null, hot: true, clientUrl: null },
  ],
  diagnostics: [],
};

class FakeSocket implements WebSocketLike {
  sent: string[] = [];
  listeners: Record<string, ((event: any) => void)[]> = {};
  addEventListener(type: string, listener: (event: any) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
  receive(message: ServerMessage) {
    for (const listener of this.listeners.message ?? []) listener({ data: JSON.stringify(message) });
  }
  open() {
    for (const listener of this.listeners.open ?? []) listener({});
  }
}

describe('connection', () => {
  it('stores the snapshot the host pushes and notifies subscribers', async () => {
    const socket = new FakeSocket();
    const ctx = createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
    const listener = vi.fn();
    ctx.connection.subscribe(listener);

    socket.open();
    socket.receive({ type: 'snapshot', snapshot: SNAPSHOT });

    expect(ctx.connection.snapshot).toEqual(SNAPSHOT);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('sends an update message shaped for the host', () => {
    const socket = new FakeSocket();
    const ctx = createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
    socket.open();
    ctx.connection.update('a:probe1', { speed: 3 });

    expect(JSON.parse(socket.sent[0])).toEqual({ type: 'update', id: 'a:probe1', config: { speed: 3 } });
  });

  it('keeps diagnostics from the host without dropping the snapshot', () => {
    const socket = new FakeSocket();
    const ctx = createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
    socket.open();
    socket.receive({ type: 'snapshot', snapshot: SNAPSHOT });
    socket.receive({
      type: 'diagnostics',
      diagnostics: [{ severity: 'error', plugin: 'a:probe1', where: 'config', message: 'nope' }],
    });

    expect(ctx.connection.diagnostics).toHaveLength(1);
    expect(ctx.connection.snapshot).toEqual(SNAPSHOT);
  });
});
```

- [ ] **Step 3: Запустить и убедиться, что падает**

Run: `npm install && npm test --workspace @energy8engine/ide-client`
Expected: FAIL — `Failed to resolve import "../src/index"`.

- [ ] **Step 4: Реализовать**

`engine/ide/client/src/plugins/connection.ts`:

```ts
import type { Context } from 'cordis';
import type { ClientMessage, Diagnostic, ServerMessage, Snapshot } from '@energy8engine/contracts';

/** The slice of WebSocket we use — so tests can hand us a fake. */
export interface WebSocketLike {
  addEventListener(type: string, listener: (event: any) => void): void;
  send(data: string): void;
  close(): void;
}

declare module 'cordis' {
  interface Context {
    connection: ConnectionService;
  }
}

export interface ConnectionService {
  snapshot: Snapshot | null;
  diagnostics: Diagnostic[];
  subscribe(listener: () => void): () => void;
  update(id: string, config: unknown): void;
}

export interface ConnectionConfig {
  url: string;
  socketFactory?: (url: string) => WebSocketLike;
}

export const name = 'connection';

export function apply(ctx: Context, config: ConnectionConfig) {
  const listeners = new Set<() => void>();
  const socket = (config.socketFactory ?? ((url) => new WebSocket(url) as WebSocketLike))(config.url);

  const service: ConnectionService = {
    snapshot: null,
    diagnostics: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(id, next) {
      const message: ClientMessage = { type: 'update', id, config: next };
      socket.send(JSON.stringify(message));
    },
  };

  socket.addEventListener('message', (event: { data: string }) => {
    let message: ServerMessage;
    try {
      message = JSON.parse(event.data) as ServerMessage;
    } catch {
      return;
    }
    if (message.type === 'snapshot') {
      service.snapshot = message.snapshot;
      service.diagnostics = message.snapshot.diagnostics;
    } else {
      service.diagnostics = message.diagnostics;
    }
    for (const listener of listeners) listener();
  });

  ctx.effect(() => () => socket.close(), 'ide-socket');
  ctx.provide('connection', service);
}
```

`engine/ide/client/src/context.ts`:

```ts
import { Context } from 'cordis';
import * as connection from './plugins/connection';
import type { ConnectionConfig } from './plugins/connection';

/** Boot the browser-side cordis application. */
export function createIdeClient(config: ConnectionConfig): Context {
  const ctx = new Context();
  void ctx.plugin(connection, config);
  return ctx;
}
```

`engine/ide/client/src/index.ts`:

```ts
export * from './context';
export * from './plugins/connection';
```

- [ ] **Step 5: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-client`
Expected: PASS, 3 теста.

- [ ] **Step 6: Коммит**

```bash
git add engine/ide/client
git commit -m "feat(ide-client): a browser cordis app that speaks to the host over one socket"
```

---

### Task 9: Сервис слотов

**Files:**
- Create: `engine/ide/client/src/plugins/slots.tsx`
- Modify: `engine/ide/client/src/context.ts`
- Modify: `engine/ide/client/src/index.ts`
- Test: `engine/ide/client/tests/slots.test.tsx`

**Interfaces:**
- Consumes: `createIdeClient` (Task 8).
- Produces: `ctx.slots.register(meta: SlotMeta, component: ComponentType<any>): () => void`, `ctx.slots.list(name: string): SlotEntry[]`, React-хук `useSlot(ctx, name): SlotEntry[]`, где `SlotMeta = { name: string; key: string }` и `SlotEntry = SlotMeta & { component: ComponentType<any> }`.

- [ ] **Step 1: Написать падающий тест**

`engine/ide/client/tests/slots.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createIdeClient, useSlot } from '../src/index';

function fakeSocket() {
  return { addEventListener() {}, send() {}, close() {} };
}

function Host({ ctx }: { ctx: ReturnType<typeof createIdeClient> }) {
  const entries = useSlot(ctx, 'composition.card');
  return (
    <div>
      {entries.map((entry) => (
        <entry.component key={entry.key} />
      ))}
    </div>
  );
}

describe('slots', () => {
  it('renders what a plugin registered', async () => {
    const ctx = createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
    ctx.slots.register({ name: 'composition.card', key: 'reels' }, () => <span>reel card</span>);

    render(<Host ctx={ctx} />);
    expect(await screen.findByText('reel card')).toBeTruthy();
  });

  it('is reversible — unregistering removes it', () => {
    const ctx = createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
    const dispose = ctx.slots.register({ name: 'composition.card', key: 'reels' }, () => <span>x</span>);
    expect(ctx.slots.list('composition.card')).toHaveLength(1);
    dispose();
    expect(ctx.slots.list('composition.card')).toHaveLength(0);
  });

  it('keeps slots apart by name', () => {
    const ctx = createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => null);
    ctx.slots.register({ name: 'sidebar.item', key: 'b' }, () => null);
    expect(ctx.slots.list('composition.card')).toHaveLength(1);
    expect(ctx.slots.list('sidebar.item')).toHaveLength(1);
  });

  it('replaces a registration with the same key instead of duplicating it', () => {
    const ctx = createIdeClient({ url: 'ws://x/ide', socketFactory: fakeSocket });
    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => <span>first</span>);
    ctx.slots.register({ name: 'composition.card', key: 'a' }, () => <span>second</span>);
    expect(ctx.slots.list('composition.card')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/ide-client -- slots`
Expected: FAIL — `ctx.slots is undefined`.

- [ ] **Step 3: Реализовать**

`engine/ide/client/src/plugins/slots.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { Context } from 'cordis';

export interface SlotMeta {
  /** Named extension point, e.g. "composition.card". */
  name: string;
  /** Identity within the slot; registering the same key twice replaces it. */
  key: string;
}

export interface SlotEntry extends SlotMeta {
  component: ComponentType<any>;
}

declare module 'cordis' {
  interface Context {
    slots: SlotsService;
  }
}

export interface SlotsService {
  register(meta: SlotMeta, component: ComponentType<any>): () => void;
  list(name: string): SlotEntry[];
  subscribe(listener: () => void): () => void;
}

export const name = 'slots';

export function apply(ctx: Context) {
  const entries = new Map<string, SlotEntry>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  const service: SlotsService = {
    register(meta, component) {
      const id = `${meta.name}::${meta.key}`;
      entries.set(id, { ...meta, component });
      notify();
      return () => {
        entries.delete(id);
        notify();
      };
    },
    list(slotName) {
      return [...entries.values()].filter((entry) => entry.name === slotName);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  ctx.provide('slots', service);
}

/** Subscribe a component to one slot. */
export function useSlot(ctx: Context, slotName: string): SlotEntry[] {
  const [entries, setEntries] = useState<SlotEntry[]>(() => ctx.slots.list(slotName));
  useEffect(() => {
    setEntries(ctx.slots.list(slotName));
    return ctx.slots.subscribe(() => setEntries(ctx.slots.list(slotName)));
  }, [ctx, slotName]);
  return entries;
}
```

В `engine/ide/client/src/context.ts` добавить регистрацию до возврата контекста:

```ts
import * as slots from './plugins/slots';
```

```ts
  void ctx.plugin(slots);
```

В `engine/ide/client/src/index.ts` добавить:

```ts
export * from './plugins/slots';
```

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-client`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add engine/ide/client
git commit -m "feat(ide-client): named slots as the only door into the UI"
```

---

### Task 10: Подгрузка клиентских половинок в рантайме

**Files:**
- Create: `engine/ide/client/src/plugins/modules.ts`
- Modify: `engine/ide/client/src/context.ts`
- Modify: `engine/ide/client/src/index.ts`
- Test: `engine/ide/client/tests/modules.test.ts`

**Interfaces:**
- Consumes: `ctx.connection` (Task 8), `ctx.slots` (Task 9).
- Produces: `ctx.modules.loaded(): string[]`; конфиг плагина принимает `importModule?: (url: string) => Promise<unknown>` для подмены в тестах.

- [ ] **Step 1: Написать падающий тест**

`engine/ide/client/tests/modules.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage, Snapshot } from '@energy8engine/contracts';
import { createIdeClient } from '../src/index';

function snapshotWith(clientUrl: string | null): Snapshot {
  return {
    rows: [
      { id: 'a:probe1', name: 'probe-plugin', disabled: false, state: 2, config: {}, schema: null, hot: true, clientUrl },
    ],
    diagnostics: [],
  };
}

function harness(importModule: (url: string) => Promise<unknown>) {
  const listeners: ((event: any) => void)[] = [];
  const socket = {
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send() {},
    close() {},
  };
  const ctx = createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket, importModule });
  const push = (message: ServerMessage) => {
    for (const listener of listeners) listener({ data: JSON.stringify(message) });
  };
  return { ctx, push };
}

describe('modules', () => {
  it('imports a client half once the snapshot mentions it and applies it', async () => {
    const apply = vi.fn();
    const importModule = vi.fn(async () => ({ apply }));
    const { ctx, push } = harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));

    expect(importModule).toHaveBeenCalledWith('/plugin-client/a:probe1');
    expect(ctx.modules.loaded()).toEqual(['a:probe1']);
  });

  it('does not import the same half twice across snapshots', async () => {
    const importModule = vi.fn(async () => ({ apply() {} }));
    const { push } = harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(importModule).toHaveBeenCalledTimes(1));
  });

  it('skips rows with no client half', async () => {
    const importModule = vi.fn(async () => ({ apply() {} }));
    const { push } = harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith(null) });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(importModule).not.toHaveBeenCalled();
  });

  it('survives a broken client half and reports it as a diagnostic', async () => {
    const importModule = vi.fn(async () => {
      throw new Error('boom');
    });
    const { ctx, push } = harness(importModule);

    push({ type: 'snapshot', snapshot: snapshotWith('/plugin-client/a:probe1') });
    await vi.waitFor(() => expect(ctx.connection.diagnostics.length).toBeGreaterThan(0));
    expect(ctx.connection.diagnostics[0].message).toContain('boom');
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/ide-client -- modules`
Expected: FAIL — `ctx.modules is undefined`.

- [ ] **Step 3: Реализовать**

`engine/ide/client/src/plugins/modules.ts`:

```ts
import type { Context } from 'cordis';
import { diagnostic } from '@energy8engine/contracts';

declare module 'cordis' {
  interface Context {
    modules: ModulesService;
  }
}

export interface ModulesService {
  /** Entry ids whose client half has been applied. */
  loaded(): string[];
}

export interface ModulesConfig {
  importModule?: (url: string) => Promise<unknown>;
}

export const name = 'modules';
export const inject = ['connection', 'slots'];

export function apply(ctx: Context, config: ModulesConfig) {
  const loaded = new Set<string>();
  const importModule = config.importModule ?? ((url: string) => import(/* @vite-ignore */ url));

  const sync = () => {
    const snapshot = ctx.connection.snapshot;
    if (!snapshot) return;

    for (const row of snapshot.rows) {
      if (!row.clientUrl || loaded.has(row.id)) continue;
      // Claim the id before awaiting, so a second snapshot cannot start a duplicate import.
      loaded.add(row.id);
      void importModule(row.clientUrl)
        .then((module) => {
          const half = module as { apply?: (ctx: Context) => void };
          half.apply?.(ctx);
        })
        .catch((error: unknown) => {
          loaded.delete(row.id);
          ctx.connection.diagnostics = [
            ...ctx.connection.diagnostics,
            diagnostic(
              'error',
              row.id,
              'client',
              error instanceof Error ? error.message : String(error),
              'check the plugin client entry in its package.json',
            ),
          ];
        });
    }
  };

  ctx.effect(() => ctx.connection.subscribe(sync), 'modules-sync');
  ctx.provide('modules', { loaded: () => [...loaded] });
  sync();
}
```

В `engine/ide/client/src/context.ts` расширить конфиг и зарегистрировать:

```ts
import * as modules from './plugins/modules';
import type { ModulesConfig } from './plugins/modules';
```

```ts
export function createIdeClient(config: ConnectionConfig & ModulesConfig): Context {
  const ctx = new Context();
  void ctx.plugin(connection, config);
  void ctx.plugin(slots);
  void ctx.plugin(modules, config);
  return ctx;
}
```

В `engine/ide/client/src/index.ts` добавить:

```ts
export * from './plugins/modules';
```

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-client`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Коммит**

```bash
git add engine/ide/client
git commit -m "feat(ide-client): load plugin client halves at runtime, survive the broken ones"
```

---

### Task 11: Рендерер формы из схемы

**Files:**
- Create: `engine/ide/client/src/schema-form/fields.tsx`
- Create: `engine/ide/client/src/schema-form/SchemaForm.tsx`
- Modify: `engine/ide/client/src/index.ts`
- Test: `engine/ide/client/tests/schema-form.test.tsx`

**Interfaces:**
- Consumes: JSON-схему из `CompositionRow.schema` (Task 4).
- Produces: `<SchemaForm schema={unknown} value={Record<string, unknown>} onChange={(next: Record<string, unknown>) => void} />`.

- [ ] **Step 1: Написать падающий тест**

`engine/ide/client/tests/schema-form.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import Schema from 'schemastery';
import { describe, expect, it, vi } from 'vitest';
import { SchemaForm } from '../src/index';

const schema = JSON.parse(
  JSON.stringify(
    Schema.object({
      speed: Schema.number().min(1).max(20).step(1).default(8).description('reel speed'),
      title: Schema.string().default('Moon').description('game title'),
      loud: Schema.boolean().default(false).description('loud mode'),
      direction: Schema.union(['up', 'down']).default('up').description('fill direction'),
      holdSpins: Schema.number().default(1).description('held spins').extra('extra', { applies: 'restart' }),
    }).toJSON(),
  ),
);

describe('SchemaForm', () => {
  it('labels each field with its description', () => {
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText('reel speed')).toBeTruthy();
    expect(screen.getByLabelText('game title')).toBeTruthy();
  });

  it('renders a number field with the bounds from the schema', () => {
    render(<SchemaForm schema={schema} value={{ speed: 8 }} onChange={() => {}} />);
    const input = screen.getByLabelText('reel speed') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.min).toBe('1');
    expect(input.max).toBe('20');
  });

  it('emits the whole value with the edited field replaced', () => {
    const onChange = vi.fn();
    render(<SchemaForm schema={schema} value={{ speed: 8, title: 'Moon' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('reel speed'), { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ speed: 3, title: 'Moon' });
  });

  it('renders a union as a select of its constants', () => {
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    const select = screen.getByLabelText('fill direction') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['up', 'down']);
  });

  it('marks fields that need a restart, so the cost is visible before the click', () => {
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    expect(screen.getByText('перезапуск')).toBeTruthy();
  });

  it('falls back to the schema default when the value has no entry', () => {
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    expect((screen.getByLabelText('reel speed') as HTMLInputElement).value).toBe('8');
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/ide-client -- schema-form`
Expected: FAIL — `SchemaForm is not exported`.

- [ ] **Step 3: Реализовать контролы**

`engine/ide/client/src/schema-form/fields.tsx`:

```tsx
import type { ChangeEvent } from 'react';

/** The parts of a serialised schemastery schema the form reads. */
export interface SchemaNode {
  type: string;
  value?: unknown;
  list?: SchemaNode[];
  dict?: Record<string, SchemaNode>;
  meta?: {
    default?: unknown;
    description?: string;
    min?: number;
    max?: number;
    step?: number;
    extra?: { applies?: 'restart' };
  };
}

export interface FieldProps {
  id: string;
  node: SchemaNode;
  value: unknown;
  onChange: (next: unknown) => void;
}

export function label(node: SchemaNode, key: string): string {
  return node.meta?.description ?? key;
}

export function needsRestart(node: SchemaNode): boolean {
  return node.meta?.extra?.applies === 'restart';
}

/** Union of constants — the only union shape Slice 0 renders. */
function constants(node: SchemaNode): string[] | null {
  if (node.type !== 'union' || !node.list) return null;
  const values = node.list.map((member) => member.value);
  return values.every((value) => typeof value === 'string') ? (values as string[]) : null;
}

export function Field({ id, node, value, onChange }: FieldProps) {
  const current = value ?? node.meta?.default;

  const options = constants(node);
  if (options) {
    return (
      <select id={id} value={String(current ?? '')} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (node.type === 'number') {
    return (
      <input
        id={id}
        type="number"
        value={current === undefined ? '' : String(current)}
        min={node.meta?.min}
        max={node.meta?.max}
        step={node.meta?.step}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
    );
  }

  if (node.type === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        checked={current === true}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
    );
  }

  return (
    <input
      id={id}
      type="text"
      value={current === undefined ? '' : String(current)}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}
```

- [ ] **Step 4: Реализовать форму**

`engine/ide/client/src/schema-form/SchemaForm.tsx`:

```tsx
import { Field, label, needsRestart, type SchemaNode } from './fields';

export interface SchemaFormProps {
  /** Serialised schemastery schema, as it arrives in CompositionRow.schema. */
  schema: unknown;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

export function SchemaForm({ schema, value, onChange }: SchemaFormProps) {
  const node = schema as SchemaNode | null;
  if (!node?.dict) return null;

  return (
    <div className="e8-schema-form">
      {Object.entries(node.dict).map(([key, child]) => {
        const id = `field-${key}`;
        return (
          <div className="e8-field" key={key}>
            <label htmlFor={id}>{label(child, key)}</label>
            <Field
              id={id}
              node={child}
              value={value[key]}
              onChange={(next) => onChange({ ...value, [key]: next })}
            />
            {needsRestart(child) ? <span className="e8-badge">перезапуск</span> : null}
          </div>
        );
      })}
    </div>
  );
}
```

В `engine/ide/client/src/index.ts` добавить:

```ts
export * from './schema-form/SchemaForm';
export * from './schema-form/fields';
```

- [ ] **Step 5: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-client`
Expected: PASS, 17 тестов.

- [ ] **Step 6: Коммит**

```bash
git add engine/ide/client
git commit -m "feat(ide-client): draw the settings form from the schema, restart cost included"
```

---

### Task 12: Экран «Состав» и оболочка

**Files:**
- Create: `engine/ide/client/src/screens/CompositionScreen.tsx`
- Modify: `engine/ide/client/src/index.ts`
- Create: `engine/apps/web/{package.json,index.html,vite.config.ts,tsconfig.json}`
- Create: `engine/apps/web/src/main.tsx`
- Create: `engine/apps/web/src/App.tsx`
- Test: `engine/ide/client/tests/composition-screen.test.tsx`

**Interfaces:**
- Consumes: `useSlot`, `SchemaForm`, `ctx.connection` (Tasks 8–11).
- Produces: компонент `CompositionScreen`, регистрируемый в слот `screen.main`; оболочка в `engine/apps/web`, обслуживаемая vite на порту 5680 с прокси `/ide`, `/api`, `/plugin-client` на хост.

- [ ] **Step 1: Написать падающий тест**

`engine/ide/client/tests/composition-screen.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import Schema from 'schemastery';
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@energy8engine/contracts';
import { CompositionScreen, createIdeClient } from '../src/index';

const SCHEMA = JSON.parse(
  JSON.stringify(Schema.object({ speed: Schema.number().min(1).max(20).default(8).description('reel speed') }).toJSON()),
);

function harness() {
  const listeners: ((event: any) => void)[] = [];
  const sent: string[] = [];
  const socket = {
    addEventListener(type: string, listener: (event: any) => void) {
      if (type === 'message') listeners.push(listener);
    },
    send(data: string) {
      sent.push(data);
    },
    close() {},
  };
  const ctx = createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket });
  const push = (message: ServerMessage) => {
    for (const listener of listeners) listener({ data: JSON.stringify(message) });
  };
  return { ctx, push, sent };
}

describe('CompositionScreen', () => {
  it('lists the composition with each plugin as a row', () => {
    const { ctx, push } = harness();
    render(<CompositionScreen ctx={ctx} />);
    push({
      type: 'snapshot',
      snapshot: {
        rows: [{ id: 'a:probe1', name: 'probe-plugin', disabled: false, state: 2, config: { speed: 8 }, schema: SCHEMA, hot: true, clientUrl: null }],
        diagnostics: [],
      },
    });
    expect(screen.getByText('probe-plugin')).toBeTruthy();
  });

  it('sends the edited config to the host', () => {
    const { ctx, push, sent } = harness();
    render(<CompositionScreen ctx={ctx} />);
    push({
      type: 'snapshot',
      snapshot: {
        rows: [{ id: 'a:probe1', name: 'probe-plugin', disabled: false, state: 2, config: { speed: 8 }, schema: SCHEMA, hot: true, clientUrl: null }],
        diagnostics: [],
      },
    });
    fireEvent.change(screen.getByLabelText('reel speed'), { target: { value: '3' } });
    expect(JSON.parse(sent[0])).toEqual({ type: 'update', id: 'a:probe1', config: { speed: 3 } });
  });

  it('shows diagnostics instead of swallowing them', () => {
    const { ctx, push } = harness();
    render(<CompositionScreen ctx={ctx} />);
    push({
      type: 'snapshot',
      snapshot: { rows: [], diagnostics: [{ severity: 'error', plugin: 'x', where: 'package', message: 'cannot resolve package "x"' }] },
    });
    expect(screen.getByText(/cannot resolve package/)).toBeTruthy();
  });

  it('renders cards plugins contributed to composition.card', () => {
    const { ctx, push } = harness();
    ctx.slots.register({ name: 'composition.card', key: 'extra' }, () => <span>extra card</span>);
    render(<CompositionScreen ctx={ctx} />);
    push({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
    expect(screen.getByText('extra card')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/ide-client -- composition-screen`
Expected: FAIL — `CompositionScreen is not exported`.

- [ ] **Step 3: Реализовать экран**

Создать `engine/ide/client/src/screens/CompositionScreen.tsx`:

```tsx
import { useEffect, useState } from 'react';
import type { Context } from 'cordis';
import type { Snapshot } from '@energy8engine/contracts';
import { SchemaForm } from '../schema-form/SchemaForm';
import { useSlot } from '../plugins/slots';

const STATE_LABEL: Record<number, string> = {
  0: 'ждёт',
  1: 'грузится',
  2: 'активен',
  3: 'сбой',
  4: 'выгружен',
  5: 'выгружается',
};

export function CompositionScreen({ ctx }: { ctx: Context }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(ctx.connection.snapshot);
  const [diagnostics, setDiagnostics] = useState(ctx.connection.diagnostics);
  const cards = useSlot(ctx, 'composition.card');

  useEffect(
    () =>
      ctx.connection.subscribe(() => {
        setSnapshot(ctx.connection.snapshot);
        setDiagnostics([...ctx.connection.diagnostics]);
      }),
    [ctx],
  );

  return (
    <main className="e8-composition">
      <h1>Состав</h1>

      {diagnostics.length > 0 && (
        <ul className="e8-diagnostics">
          {diagnostics.map((d, index) => (
            <li key={index} data-severity={d.severity}>
              {d.plugin} · {d.where}: {d.message}
              {d.fix ? ` — ${d.fix}` : ''}
            </li>
          ))}
        </ul>
      )}

      {(snapshot?.rows ?? []).map((row) => (
        <section className="e8-row" key={row.id}>
          <header>
            <strong>{row.name}</strong>
            <span className="e8-state">{row.state === null ? '—' : STATE_LABEL[row.state]}</span>
            {row.hot ? <span className="e8-badge">горячий</span> : null}
          </header>
          <SchemaForm
            schema={row.schema}
            value={(row.config ?? {}) as Record<string, unknown>}
            onChange={(next) => ctx.connection.update(row.id, next)}
          />
        </section>
      ))}

      {cards.map((card) => (
        <card.component key={card.key} />
      ))}
    </main>
  );
}
```

В `engine/ide/client/src/index.ts` добавить:

```ts
export * from './screens/CompositionScreen';
```

- [ ] **Step 4: Собрать оболочку**

`engine/apps/web/package.json`:

```json
{
  "name": "@energy8engine/ide-web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "typecheck": "tsc --noEmit" },
  "dependencies": { "@energy8engine/ide-client": "*", "react": "^18.2.0", "react-dom": "^18.2.0" },
  "devDependencies": { "@vitejs/plugin-react": "^4.3.0", "typescript": "^5.6.0", "vite": "^6.0.0" }
}
```

`engine/apps/web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const HOST = 'http://127.0.0.1:5679';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5680,
    proxy: {
      '/api': HOST,
      '/plugin-client': HOST,
      '/ide': { target: HOST, ws: true },
    },
  },
});
```

`engine/apps/web/index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>e8 ide</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`engine/apps/web/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client';
import { CompositionScreen, createIdeClient } from '@energy8engine/ide-client';

const ctx = createIdeClient({ url: `ws://${location.host}/ide` });

createRoot(document.getElementById('root')!).render(<CompositionScreen ctx={ctx} />);
```

- [ ] **Step 5: Запустить и убедиться, что проходит**

Run: `npm install && npm test --workspace @energy8engine/ide-client`
Expected: PASS, 21 тест.

- [ ] **Step 6: Коммит**

```bash
git add engine/ide/client engine/apps/web
git commit -m "feat(ide): the composition screen — the game's parts, not a package list"
```

---

### Task 13: Сбойный плагин не роняет хост

**Files:**
- Create: `engine/ide/host/tests/fixtures/broken-plugin/{package.json,index.js}`
- Modify: `engine/ide/host/src/plugins/composition.ts`
- Test: `engine/ide/host/tests/broken.test.ts`

**Interfaces:**
- Consumes: `composition.snapshot` (Task 4).
- Produces: строка со `state === 3` (FAILED) и диагностика уровня `error` для плагина, упавшего в `apply`.

- [ ] **Step 1: Написать падающий тест**

`engine/ide/host/tests/fixtures/broken-plugin/package.json`:

```json
{
  "name": "broken-plugin",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "exports": { ".": "./index.js", "./package.json": "./package.json" }
}
```

`engine/ide/host/tests/fixtures/broken-plugin/index.js`:

```js
export const name = 'broken';

export function apply() {
  throw new Error('this plugin is broken on purpose');
}
```

Добавить `"broken-plugin": "file:./tests/fixtures/broken-plugin"` в `devDependencies` пакета `@energy8engine/ide-host`.

`engine/ide/host/tests/broken.test.ts`:

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

let host: IdeHost | undefined;
afterEach(async () => {
  await host?.stop();
  host = undefined;
});

function workspace(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'e8-ide-'));
  writeFileSync(join(dir, 'e8.yml'), yaml);
  return dir;
}

describe('a broken plugin', () => {
  it('does not stop the host from serving', async () => {
    host = await createIdeHost({
      cwd: workspace('- id: b1\n  name: broken-plugin\n'),
      port: 0,
    });
    const res = await fetch(`${host.url}/api/health`);
    expect(res.status).toBe(200);
  });

  it('shows up as a failed row with a diagnostic naming it', async () => {
    host = await createIdeHost({
      cwd: workspace('- id: b1\n  name: broken-plugin\n'),
      port: 0,
    });
    const snapshot = await host.ctx.composition.snapshot();
    const row = snapshot.rows.find((r) => r.name === 'broken-plugin')!;
    expect(row.state).toBe(3); // FiberState.FAILED
    const failure = snapshot.diagnostics.find((d) => d.plugin === row.id && d.where === 'apply');
    expect(failure?.severity).toBe('error');
    expect(failure?.message).toContain('broken on purpose');
  });

  it('reports an unresolvable package instead of crashing the snapshot', async () => {
    host = await createIdeHost({
      cwd: workspace('- id: g1\n  name: no-such-plugin-anywhere\n'),
      port: 0,
    });
    const snapshot = await host.ctx.composition.snapshot();
    expect(snapshot.diagnostics.some((d) => d.message.includes('no-such-plugin-anywhere'))).toBe(true);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm install && npm test --workspace @energy8engine/ide-host -- broken`
Expected: FAIL — диагностики с `where === 'apply'` нет.

- [ ] **Step 3: Реализовать**

В `engine/ide/host/src/plugins/composition.ts` — собирать ошибки фиберов. Добавить в `apply` до объявления `service`:

```ts
  // A plugin that throws in apply must not take the host with it: remember the
  // failure, keep serving, and let it reach the human as a diagnostic.
  const failures = new Map<string, string>();

  ctx.on('internal/status', (fiber) => {
    const entryId = fiber.entry?.id;
    if (!entryId) return;
    if (fiber.state === 3) {
      const error = (fiber as unknown as { _error?: unknown })._error;
      failures.set(entryId, error instanceof Error ? error.message : String(error ?? 'plugin failed'));
    } else if (fiber.state === 2) {
      failures.delete(entryId);
    }
  });
```

И внутри цикла `snapshot`, после диагностики про пакет:

```ts
        const failure = failures.get(entry.id);
        if (failure) {
          diagnostics.push(
            diagnostic('error', entry.id, 'apply', failure, 'fix the plugin, then reload the composition'),
          );
        }
```

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/ide-host`
Expected: PASS, 19 тестов.

- [ ] **Step 5: Коммит**

```bash
git add engine/ide/host
git commit -m "fix(ide-host): a plugin that throws becomes a red row, not a dead host"
```

---

### Task 14: Плагин-образец с двумя половинами

**Files:**
- Create: `engine/examples/probe-plugin/{package.json,tsconfig.json}`
- Create: `engine/examples/probe-plugin/src/index.ts`
- Create: `engine/examples/probe-plugin/src/client.tsx`
- Create: `engine/examples/workspace/e8.yml`
- Create: `engine/examples/workspace/package.json`

**Interfaces:**
- Consumes: `ctx.provide`, `ctx.effect` (хост), `ctx.slots.register` (Task 9), `SchemaForm` (Task 11).
- Produces: пакет `probe-plugin`, чья клиентская половина регистрирует карточку в слот `composition.card`; рабочая область `engine/examples/workspace`, которую открывает `e8 ide`.

- [ ] **Step 1: Написать хостовую половину**

`engine/examples/probe-plugin/package.json`:

```json
{
  "name": "probe-plugin",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./client": "./src/client.tsx",
    "./package.json": "./package.json"
  },
  "e8": { "client": { "entry": "./src/client.tsx" }, "hot": true },
  "dependencies": { "schemastery": "3.18.0" },
  "peerDependencies": { "cordis": "4.0.0-rc.8", "react": "^18.2.0" },
  "license": "MIT"
}
```

`engine/examples/probe-plugin/src/index.ts`:

```ts
import type { Context } from 'cordis';
import Schema from 'schemastery';

export interface Config {
  speed: number;
  direction: 'up' | 'down';
  holdSpins: number;
}

export const name = 'probe';

export const Config: Schema<Config> = Schema.object({
  speed: Schema.number().min(1).max(20).step(1).default(8).description('скорость барабана'),
  direction: Schema.union(['up', 'down'] as const).default('up').description('направление заполнения'),
  holdSpins: Schema.number().min(0).max(10).default(1).description('удержаний').extra('extra', { applies: 'restart' }),
});

export interface ProbeService {
  describe(): string;
}

export function apply(ctx: Context, config: Config) {
  ctx.effect(() => {
    console.info(`probe up at speed ${config.speed}`);
    return () => console.info('probe down');
  }, 'probe-effect');

  ctx.provide('probe', { describe: () => `${config.direction} @ ${config.speed}` } satisfies ProbeService);
}
```

- [ ] **Step 2: Написать клиентскую половину**

`engine/examples/probe-plugin/src/client.tsx`:

```tsx
import type { Context } from 'cordis';

/**
 * The browser half. The IDE fetches this module at runtime and calls apply();
 * nothing in the shell knows this plugin exists.
 */
export function apply(ctx: Context) {
  ctx.slots.register({ name: 'composition.card', key: 'probe' }, () => (
    <aside className="e8-card">
      <h2>Проба</h2>
      <p>Эта карточка пришла из плагина, а не из оболочки.</p>
    </aside>
  ));
}
```

- [ ] **Step 3: Собрать рабочую область**

`engine/examples/workspace/package.json`:

```json
{
  "name": "@energy8engine/example-workspace",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "probe-plugin": "*" }
}
```

`engine/examples/workspace/e8.yml`:

```yaml
- id: probe1
  name: probe-plugin
  config:
    speed: 12
    direction: up
    holdSpins: 1
```

- [ ] **Step 4: Проверить руками**

```bash
npm install
npx e8 ide            # из engine/examples/workspace — хост на 5679
npm run dev --workspace @energy8engine/ide-web   # оболочка на 5680
```

Открыть `http://127.0.0.1:5680`. Ожидается: строка `probe-plugin` с формой из трёх полей, у `holdSpins` — метка «перезапуск», ниже — карточка «Проба», пришедшая из плагина.

- [ ] **Step 5: Коммит**

```bash
git add engine/examples
git commit -m "feat(examples): a plugin that brings its own UI into an IDE that never heard of it"
```

---

### Task 15: Приёмка — сквозная проверка в браузере

**Files:**
- Create: `engine/apps/web/playwright.config.ts`
- Create: `engine/apps/web/tests/e2e/skeleton.spec.ts`
- Modify: `engine/apps/web/package.json` (скрипт `test:e2e`, devDep `@playwright/test`)

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: `npm run test:e2e --workspace @energy8engine/ide-web` — проверка, что карточка чужого плагина видна, а правка формы доезжает до диска.

- [ ] **Step 1: Настроить playwright**

Добавить в `engine/apps/web/package.json`: скрипт `"test:e2e": "playwright test"`, а в `devDependencies` — `"@playwright/test": "^1.49.0"` и `"@energy8engine/ide-host": "*"` (тест поднимает хост сам).

`engine/apps/web/playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: { baseURL: 'http://127.0.0.1:5680' },
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5680',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
```

- [ ] **Step 2: Написать падающий тест**

`engine/apps/web/tests/e2e/skeleton.spec.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { createIdeHost, type IdeHost } from '@energy8engine/ide-host';

const WORKSPACE = join(__dirname, '..', '..', '..', '..', 'examples', 'workspace');
const COMPOSITION = join(WORKSPACE, 'e8.yml');

let host: IdeHost;
let original: string;

// The host runs in-process: one less moving part than spawning the CLI, and the
// browser cannot tell the difference — it only ever sees port 5679.
test.beforeAll(async () => {
  original = readFileSync(COMPOSITION, 'utf8');
  host = await createIdeHost({ cwd: WORKSPACE, port: 5679 });
});

test.afterAll(async () => {
  await host.stop();
  writeFileSync(COMPOSITION, original);
});

test('a third-party plugin brings its own UI without the shell being rebuilt', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('probe-plugin')).toBeVisible();
  await expect(page.getByText('Эта карточка пришла из плагина, а не из оболочки.')).toBeVisible();
});

test('the restart cost of a field is visible before it is clicked', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('перезапуск')).toBeVisible();
});

test('turning a knob lands on disk', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('скорость барабана').fill('5');
  await expect
    .poll(() => readFileSync(COMPOSITION, 'utf8'), { timeout: 10_000 })
    .toContain('speed: 5');
});
```

- [ ] **Step 3: Запустить и убедиться, что падает**

Run: `npx playwright install chromium && npm run test:e2e --workspace @energy8engine/ide-web`
Expected: FAIL, пока предыдущие задачи не собраны в одну работающую цепочку.

- [ ] **Step 4: Довести до зелёного**

Чинить по фактическим сообщениям. Типичные причины и их места:
- карточка не появилась → `modules` не импортировал половину: проверить `clientUrl` в снапшоте (Task 4) и маршрут `/plugin-client/:id` (Task 7);
- форма пустая → `schema` в строке `null`: `Config` не экспортирован из плагина или `toJSON` не вызвался (Task 4, `schemaOf`);
- значение не доехало до диска → правка не долетела по сокету: проверить `connection.update` (Task 8) и обработчик `message` (Task 6).

- [ ] **Step 5: Запустить и убедиться, что проходит**

Run: `npm run test:e2e --workspace @energy8engine/ide-web`
Expected: PASS, 3 теста.

- [ ] **Step 6: Прогнать всё вместе**

```bash
npm test --workspace @energy8engine/contracts
npm test --workspace @energy8engine/ide-host
npm test --workspace @energy8engine/ide-client
npm run test:e2e --workspace @energy8engine/ide-web
```

Expected: 4 зелёных прогона. Легаси-пакеты не запускались и не менялись.

- [ ] **Step 7: Коммит**

```bash
git add engine/apps/web
git commit -m "test(ide): prove the whole spine in a browser — plugin UI in, knob out to disk"
```

---

## Что этот план НЕ делает

Названо вслух, чтобы не искали:

- **Профиль, бандлы и патчи.** Здесь состав — один плоский `e8.yml`, читаемый `@cordisjs/plugin-include`. Формат из §3 спеки приходит планом 3 и заменяет только содержимое `COMPOSITION_FILE`, не API хоста.
- **Рантайм игры.** Ни pixi, ни барабанов, ни `.spin` — план 2.
- **Остальные экраны.** Воркспейс, Превью, Код, Ассеты — план 4.
- **Откат на перезагрузку iframe.** Флаг `hot` уже доезжает до UI и показывается, но ветки «не горячий → перезагрузи превью» нет: перезагружать нечего, пока нет превью.
- **Диффы снапшотов.** Хост шлёт снапшот целиком. На десятке плагинов это дешевле разницы; когда станет дорого, поменяется одна функция `broadcast`.
- **Песочница хостовых плагинов.** Локальный режим, чужой код исполняется в нашем процессе — как и записано в §6 спеки.
