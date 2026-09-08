# Срез 2: одно место, куда смотреть — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** У диагностики работающей игры появляется приёмник в движке и дорога до IDE. Сейчас всё, что рождается после старта, пишется в `<pre>`, принадлежащий примеру; настоящая игра не получает ничего, а экран состава выглядит авторитетным, показывая шесть здоровых строк рядом с лежащей игрой.

**Architecture:** Один живой сервис `ctx.diagnostics` в игре, куда пишут все производители и из которого читают `boot`, страница и мост. `ide-bridge` — единственная строка, живущая только в разработке и уже держащая сокет к хосту — пересылает список наверх; хост раздаёт его остальным клиентам сокета; клиент IDE показывает панель. Два пространства имён `Diagnostic.plugin` разделяет **тип сообщения на проводе**, а не догадка по имени.

**Tech Stack:** TypeScript, cordis 4.0.0-rc.8, React 18, vite 6, vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-slot-webide-cordis-design.md` — §8 («отказ — это данные, доходящие до человека»; «Тот же список видят игра, IDE и агент»), §5.3 (граф состава и список диагностик — рядовой экран IDE).

**Долг, который этот срез гасит:** пункт 2 записки Среза 1a и пункт 3 записки Среза 1b — это одна вещь с двух концов. Плюс два измеренных случая молчания из прохода по долгу.

---

## Global Constraints

- Новый код — **только** в `engine/`. `packages/*` и верхнеуровневый `examples/*` — легаси: читать и импортировать можно, править нельзя. `engine/examples/first-slot` — наш.
- Скоуп `@energy8engine/*`; имя каждого нового пакета уникально во всей монорепе (корневой `workspaces` включает `engine/*/*`).
- Комментарии и коммиты — по-английски, короткими повествовательными предложениями в голосе репозитория.
- **Контракты — словари, плагины — решения.** `engine/core/contracts` не импортирует ничего, кроме своих относительных модулей; строгий тест чистоты это проверяет.
- **Отказ — это данные.** Ни один шов не бросает; ни один путь не заканчивается пустым экраном без объяснения. Этот срез не имеет права нарушить правило, ради которого существует.
- Тесты — по рабочим пространствам: `npm test --workspace @energy8engine/<pkg>`. Корневой прогон теперь зелёный (29 пакетов, 2732 теста), но пользуйтесь пакетными — они быстрее и точнее адресуют.
- Playwright в `engine/apps/web`: фиксированные порты, `workers: 1`, запускать в одиночку, после — проверять осиротевшие процессы.
- Дымовой тест CLI запускает настоящий `bin/e8.mjs`. Он существует потому, что vitest ходит через vite-node, который подставляет `__dirname`/`__filename`, а настоящий CLI на `tsx` — нет.
- Каждое утверждение теста задаётся **вместе с мутацией, которая обязана его уронить**. Эта ветка нашла тринадцать случаев, когда утверждение проходило не через ту ветку, которую называет, — включая фичу, подключённую к пустоте, при 37 зелёных тестах из 38.

---

## Проверенные факты

Измерено на текущем HEAD. Расхождение кода с этим разделом — повод остановиться и сказать.

### Канал снизу вверх отсутствует физически

`engine/core/contracts/src/protocol.ts:35-38`:

```ts
ServerMessage = { type: 'snapshot'; snapshot: Snapshot } | { type: 'diagnostics'; diagnostics: Diagnostic[] }
ClientMessage = { type: 'update'; id: string; config: unknown }
```

`ide-bridge` в игре **только слушает**: в `engine/game/ide-bridge/src/index.ts` есть `socket.addEventListener('message', …)` и нет ни одного `socket.send`.

И хост явно отвергает всё, кроме одного типа — `engine/ide/host/src/plugins/rpc.ts`:
`if ((parsed as { type?: unknown }).type !== 'update') return;`. Новый тип сообщения потребует тронуть эту проверку, а рядом лежит комментарий, объясняющий, почему кривые кадры игнорируются молча.

### Семь мест производят диагностику, и у них нет общего адресата

`engine/game/{loader,ide-bridge,play-loop,runtime,session-dev,seam}/src/index.ts` и
`engine/game/runtime/src/plugins/mechanics.ts`.

До старта всё сходится: `createGame` собирает их в один массив, и `boot` рисует экран отказа. После старта — расходится: послеспиновая проверка, шаги плана и мост пишут в `<pre id="log">` из `engine/examples/first-slot/index.html`. Это собственность примера, а не движка.

### `boot` принимает массив, а не источник

`engine/game/boot/src/index.ts:34`: `renderBootFailure(root: HTMLElement, diagnostics: Diagnostic[])`. Он рисует один раз по снимку, и это правильно для экрана отказа — но означает, что «живой список» надо вводить рядом, а не вместо.

### У клиента IDE есть механизм слотов

`engine/ide/client/src/plugins/slots.tsx` даёт `ctx.slots` с `list(slotName)` и хук `useSlot`. Новая панель — обычная контрибуция в слот, а не правка экрана.

Отметьте деталь того же семейства, что чинили в прошлом срезе: «регистрация того же ключа заменяет прежнюю». Это последняя-запись-побеждает по имени. Проверить, стоит ли это диагностики, — часть задачи 8, а не отдельная работа.

### Сокет один на всех

И клиент IDE (через прокси vite с 5680), и игра (напрямую на 5679) подключаются к одному `/ide`. Хост держит `clients` как множество. Значит, пересылая диагностику игры, он обязан отдать её **остальным**, а не эхом обратно — и это надо решить явно, а не понадеяться, что отправитель проигнорирует своё.

---

## Структура файлов

| Путь | Ответственность |
|---|---|
| `engine/core/contracts/src/protocol.ts` | изменить — `ServerMessage` и `ClientMessage` получают тип для диагностики игры |
| `engine/game/diagnostics/` | **создать** пакет `@energy8engine/diagnostics` — живой список с подпиской, без cordis в ядре |
| `engine/game/runtime/src/index.ts` | изменить — `createGame` заводит сервис и наполняет его вместо локального массива |
| `engine/game/{loader,seam,play-loop,session-dev}/src/index.ts`, `runtime/src/plugins/mechanics.ts` | изменить — писать в сервис |
| `engine/game/ide-bridge/src/index.ts` | изменить — подписаться и пересылать наверх |
| `engine/ide/host/src/plugins/rpc.ts` | изменить — принять сообщение игры и раздать остальным |
| `engine/ide/client/src/plugins/diagnostics.tsx` | **создать** — приём и хранение на стороне редактора |
| `engine/ide/client/src/screens/DiagnosticsPanel.tsx` | **создать** — панель |
| `engine/examples/first-slot/src/main.ts`, `index.html` | изменить — `<pre>` читает сервис, а не служит адресатом |
| `engine/apps/web/tests/e2e/diagnostics.spec.ts` | **создать** — приёмка |

---

## Task 1: Живой список

**Files:**
- Create: `engine/game/diagnostics/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Test: `engine/game/diagnostics/tests/log.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface DiagnosticsService {
    /** Everything reported so far, oldest first. A copy: mutating it must not reach the service. */
    list(): readonly Diagnostic[];
    /** Adds one. Never throws. Returns nothing — a reporter is not a caller that checks. */
    report(diagnostic: Diagnostic): void;
    /** Called after every `report`. Returns a disposer. */
    subscribe(listener: () => void): () => void;
    /** How many the bound has forgotten. A panel that lies about completeness is worse than none. */
    dropped(): number;
  }
  function createDiagnostics(options?: { limit?: number }): DiagnosticsService
  ```

**Почему отдельный пакет, а не поле на контексте.** Он должен быть проверяем без cordis, без DOM и без сети — как `@energy8engine/project` и `@energy8engine/seam`. Строка состава, отдающая его в `ctx`, появляется в задаче 2.

- [ ] **Шаг 1: Падающие тесты**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDiagnostics } from '../src/index';

const d = (message: string) => ({ severity: 'error' as const, plugin: 'p', where: 'w', message });

describe('createDiagnostics', () => {
  it('keeps what was reported, oldest first', () => {
    const log = createDiagnostics();
    log.report(d('first')); log.report(d('second'));
    expect(log.list().map((x) => x.message)).toEqual(['first', 'second']);
  });

  it('a caller cannot edit the service through what list() returns', () => {
    const log = createDiagnostics();
    log.report(d('kept'));
    (log.list() as Diagnostic[]).push(d('smuggled'));
    expect(log.list()).toHaveLength(1);
  });

  it('notifies subscribers once per report', () => {
    const log = createDiagnostics();
    const seen = vi.fn();
    log.subscribe(seen);
    log.report(d('one'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a disposed subscriber stops hearing', () => {
    const log = createDiagnostics();
    const seen = vi.fn();
    log.subscribe(seen)();
    log.report(d('one'));
    expect(seen).not.toHaveBeenCalled();
  });

  it('a subscriber that throws does not stop the others, and does not stop the report', () => {
    // A panel that blows up while rendering must not cost the next listener
    // its notification, nor lose the diagnostic that triggered it.
    const log = createDiagnostics();
    const after = vi.fn();
    log.subscribe(() => { throw new Error('listener blew up'); });
    log.subscribe(after);
    expect(() => log.report(d('one'))).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
    expect(log.list()).toHaveLength(1);
  });

  it('is bounded, and says how many it forgot', () => {
    const log = createDiagnostics({ limit: 2 });
    log.report(d('a')); log.report(d('b')); log.report(d('c'));
    expect(log.list().map((x) => x.message)).toEqual(['b', 'c']);
    expect(log.dropped()).toBe(1);
  });
});
```

Последний тест — урок из `spin-log`, где предел добавили правкой после ревью: неограниченный список, который читает панель, растёт, пока страница открыта.

- [ ] **Шаг 2: Убедиться, что падают** — `npm test --workspace @energy8engine/diagnostics`.
- [ ] **Шаг 3: Реализовать.**
- [ ] **Шаг 4: Мутационная проверка.** (1) Отдавать внутренний массив из `list()` — падает второй тест. (2) Не ловить бросок подписчика — падает пятый. (3) Не считать отброшенные — падает шестой.
- [ ] **Шаг 5: Коммит**

```bash
git add engine/game/diagnostics
git commit -m "A place a running game can put what went wrong"
```

---

## Task 2: Сервис в составе, и `createGame` наполняет его

**Files:**
- Create: `engine/game/diagnostics/src/runtime.ts` (рантайм-половина: `ctx.provide('diagnostics', …)`)
- Modify: `engine/game/diagnostics/package.json` (манифест `e8.runtime`), `engine/bundles/e8-base/e8.bundle.yml`, `engine/game/runtime/src/index.ts`
- Test: `engine/game/runtime/tests/compose.test.ts`

`createGame` сегодня копит диагностики в локальном массиве и отдаёт их в `GameApp.diagnostics`. Пусть копит **в сервисе**, а поле остаётся снимком для тех, кто его уже читает.

**Порядок важен и должен быть проверен.** Строка `diagnostics` обязана применяться **раньше** всех, кто в неё пишет, — раньше `boot`, потому что даже он о своих бедах сообщает. Состав упорядочен, так что это свойство бандла, и его надо закрепить тестом, а не порядком строк в файле.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('the diagnostics row is applied before anything that reports', async () => {
  const game = await createGame({ mount, loader: { fetchFn: fakeFetch({ rows: BASE_ROWS, diagnostics: [] }), importModule: importHalf } });
  expect(game.ctx.diagnostics).toBeDefined();
});

it('what createGame collected is in the service, not only in the field', async () => {
  const game = await createGame({ mount, loader: { /* a row whose half throws */ } });
  expect(game.diagnostics.length).toBeGreaterThan(0);
  expect(game.ctx.diagnostics.list().map((d) => d.message)).toEqual(game.diagnostics.map((d) => d.message));
});

it('a game composed without the diagnostics row still runs', async () => {
  // The row is optional, like spin-log. Its absence costs the panel, not the game.
  const game = await createGame({ mount, loader: { fetchFn: fakeFetch({ rows: ROWS_WITHOUT_DIAGNOSTICS, diagnostics: [] }), importModule: importHalf } });
  expect(game.ctx.diagnostics).toBeUndefined();
  expect(game.diagnostics).toEqual([]);
});
```

- [ ] **Шаг 2–4: Убедиться, что падают; реализовать; прогнать.**
- [ ] **Шаг 5: Коммит**

---

## Task 3: Производители пишут в сервис

**Files:**
- Modify: `engine/game/{loader,seam,play-loop,session-dev}/src/index.ts`, `engine/game/runtime/src/plugins/mechanics.ts`
- Test: сюиты каждого затронутого пакета

Семь мест сегодня **возвращают** `Diagnostic[]` вызывающему. Возврат остаётся — он и есть контракт «отказ — это данные», и ломать его незачем. Добавляется другое: там, где диагностика рождается **после** сборки — исполнение шага плана, послеспиновая проверка, разрыв связи у моста, — она должна дойти до сервиса, а не только до того, кто случайно оказался рядом.

**Правило, чтобы не размазать ответственность:** пакет, который возвращает диагностику вызывающему, не пишет её в сервис сам — иначе она удвоится. Пишет тот, кто её **потребляет и никуда дальше не передаёт**. Для шагов плана это `executePlan`'s caller, для послеспиновой проверки — страница. Разберитесь по каждому из семи и напишите в отчёте, кто где пишет и почему.

- [ ] **Шаг 1: Тест на отсутствие удвоения**

```ts
it('a diagnostic that is both returned and recorded appears once', async () => {
  // The failure mode this rule exists to prevent: two writers for one event.
  const diagnostics = await executePlan([{ kind: 'nope' }], board, registry);
  reportAll(ctx.diagnostics, diagnostics);
  expect(ctx.diagnostics.list()).toHaveLength(1);
});
```

- [ ] **Шаг 2–4: реализовать по каждому производителю, прогнать все затронутые сюиты.**
- [ ] **Шаг 5: Коммит**

---

## Task 4: Протокол получает дорогу наверх

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts`
- Test: `engine/core/contracts/tests/protocol.test.ts`

```ts
// client -> server: the game telling the host what went wrong inside it
{ type: 'game-diagnostics'; diagnostics: Diagnostic[] }
// server -> client: the host passing that on to the editor
{ type: 'game-diagnostics'; diagnostics: Diagnostic[] }
```

**Почему отдельный тип, а не переиспользование `diagnostics`.** Существующий `{type:'diagnostics'}` несёт диагностику **проекта**, чей `plugin` — id строки состава. Диагностика игры несёт id шва или механики. Это два разных пространства имён в одном поле, и Срез 1a развёл их документацией только потому, что тогда они не могли встретиться. Теперь могут. **Тип сообщения — то, что их разделяет**; иначе принимающая сторона будет угадывать по имени, а имя строки пишет человек и вправе написать `session`.

- [ ] **Шаг 1: Падающие тесты** — включая тот, который это и закрепляет:

```ts
it('a project diagnostic and a game diagnostic are different messages, even with the same plugin id', () => {
  const same = { severity: 'error' as const, plugin: 'session', where: 'w', message: 'm' };
  expect(isServerMessage({ type: 'diagnostics', diagnostics: [same] })).toBe(true);
  expect(isServerMessage({ type: 'game-diagnostics', diagnostics: [same] })).toBe(true);
  // and nothing in the shape lets a reader mistake one for the other
});
```

- [ ] **Шаг 2–4: убедиться, что падают; реализовать; прогнать.**
- [ ] **Шаг 5: Коммит**

---

## Task 5: Мост пересылает

**Files:**
- Modify: `engine/game/ide-bridge/src/index.ts`
- Test: `engine/game/ide-bridge/tests/index.test.ts`

`ide-bridge` подписывается на `ctx.diagnostics` и шлёт список наверх. Это единственная строка, живущая только в разработке, — и потому единственное место, где игре уместно разговаривать с хостом.

**Три вещи, которые надо решить и записать:**
1. **Что шлём — весь список или добавку?** Весь список проще и переживает переподключение; добавка дешевле. Выберите и объясните.
2. **Игра без моста молчит.** Строки `ide-bridge` нет в продакшн-составе, и её отсутствие не должно стоить игре ничего.
3. **Сокет может быть закрыт.** Отправка в закрытый сокет не бросает и не теряется молча: прецедент — `connection.update()` в клиенте, который при закрытом сокете записывает диагностику вместо броска. Здесь ирония в том, что записать её некуда, кроме того же сервиса; не устройте рекурсию.

- [ ] **Шаг 1: Падающие тесты**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDiagnostics } from '@energy8engine/diagnostics';

/** A socket whose readyState the test owns, recording every frame sent. */
function fakeSocket(readyState = 1) {
  const sent: string[] = [];
  return { readyState, send: (frame: string) => sent.push(frame), sent,
           addEventListener() {}, close() {} };
}
const d = (message: string) => ({ severity: 'error' as const, plugin: 'p', where: 'w', message });

describe('ide-bridge forwards the game diagnostics', () => {
  it('sends what the service holds, as one game-diagnostics frame, when it changes', () => {
    const socket = fakeSocket();
    const log = createDiagnostics();
    attachDiagnosticsForwarding(socket, log);          // the unit under test
    log.report(d('reels blew up'));
    expect(socket.sent).toHaveLength(1);
    const frame = JSON.parse(socket.sent[0]);
    expect(frame.type).toBe('game-diagnostics');
    expect(frame.diagnostics.map((x: { message: string }) => x.message)).toEqual(['reels blew up']);
  });

  it('sends nothing when the socket is not open, and does not throw', () => {
    const socket = fakeSocket(0);                       // CONNECTING
    const log = createDiagnostics();
    attachDiagnosticsForwarding(socket, log);
    expect(() => log.report(d('while closed'))).not.toThrow();
    expect(socket.sent).toEqual([]);
  });

  it('a send that throws does not trigger another send', () => {
    // The recursion this must not have: forward -> throws -> reports the
    // failure -> the service notifies -> forward again. A dev-only bridge
    // that spins on a broken socket is worse than one that says nothing.
    const log = createDiagnostics();
    let calls = 0;
    const socket = { readyState: 1, sent: [] as string[], addEventListener() {}, close() {},
      send() { calls += 1; throw new Error('socket died mid-send'); } };
    attachDiagnosticsForwarding(socket, log);
    log.report(d('first'));
    expect(calls).toBe(1);
  });

  it('a game with no bridge row costs the game nothing', () => {
    // Nothing to assert on the bridge itself — this is the composition test
    // in task 2 restated here so the property has a home in this file too.
    const log = createDiagnostics();
    expect(() => log.report(d('no bridge present'))).not.toThrow();
    expect(log.list()).toHaveLength(1);
  });
});
```

**Решения, которые надо принять и записать в отчёте:**
1. **Весь список или добавка?** Весь проще и переживает переподключение; добавка дешевле. Тесты выше написаны под «весь список» — если выберете добавку, перепишите первый тест и объясните.
2. Отсутствие строки моста не стоит игре ничего.
3. Ошибка отправки не порождает вторую отправку — третий тест это и закрепляет.

- [ ] **Шаг 2: Убедиться, что падают** — `npm test --workspace @energy8engine/ide-bridge`.
- [ ] **Шаг 3: Реализовать.**
- [ ] **Шаг 4: Мутационная проверка.** Сделать так, чтобы ошибка отправки писалась в тот же сервис, — падает третий тест (`calls` вырастет). Убрать проверку `readyState` — падает второй.
- [ ] **Шаг 5: Коммит**

---

## Task 6: Хост раздаёт

**Files:**
- Modify: `engine/ide/host/src/plugins/rpc.ts`
- Test: `engine/ide/host/tests/rpc.test.ts`

Сегодня хост отвергает всё, кроме `update`. Принять новый тип и раздать **остальным** клиентам сокета — не эхом отправителю.

- [ ] **Шаг 1: Падающие тесты**

```ts
/** Two sockets on one host: the game that reports, and the editor that watches. */
async function twoClients(host: IdeHost) {
  const game = await connect(host.url);            // as rpc.test.ts already connects one
  const editor = await connect(host.url);
  await Promise.all([game.drainSnapshot(), editor.drainSnapshot()]);
  return { game, editor };
}
const frame = { type: 'game-diagnostics', diagnostics: [
  { severity: 'error', plugin: 'reels', where: 'runtime', message: 'reels blew up' }] };

it('passes a game diagnostic on to the other clients', async () => {
  const { game, editor } = await twoClients(host);
  game.send(frame);
  await expect.poll(() => editor.received).toContainEqual(expect.objectContaining(frame));
});

it('does not echo it back to the game that sent it', async () => {
  const { game, editor } = await twoClients(host);
  game.send(frame);
  await expect.poll(() => editor.received.length).toBeGreaterThan(0);
  expect(game.received.filter((m) => m.type === 'game-diagnostics')).toEqual([]);
});

it('still ignores a malformed frame', async () => {
  // The existing guard's reason is in a comment above it — null, an array and
  // a primitive all survive JSON.parse and would throw on `.type` outside the
  // catch. Do not lose that while widening the accepted set.
  const { game, editor } = await twoClients(host);
  for (const bad of ['null', '[]', '42', '{"type":"nope"}']) game.sendRaw(bad);
  game.send(frame);                                 // a good one after, to prove liveness
  await expect.poll(() => editor.received.filter((m) => m.type === 'game-diagnostics')).toHaveLength(1);
});

it('a game diagnostic does not become a project diagnostic', async () => {
  const { game, editor } = await twoClients(host);
  game.send(frame);
  await expect.poll(() => editor.received.length).toBeGreaterThan(0);
  expect(editor.received.filter((m) => m.type === 'diagnostics')).toEqual([]);
});
```

- [ ] **Шаг 2–5: как обычно.**

---

## Task 7: Клиент принимает и хранит

**Files:**
- Create: `engine/ide/client/src/plugins/diagnostics.tsx`
- Test: `engine/ide/client/tests/diagnostics.test.ts`

По образцу `connection.ts` и `game-composition.tsx` — те же приёмы, не второй способ. Держит диагностику игры **отдельно** от проектной, потому что это разные пространства имён.

**Interfaces:**
```ts
interface GameDiagnosticsState {
  /** What the game has reported. Null until the first frame arrives — absent is not empty. */
  readonly diagnostics: readonly Diagnostic[] | null;
  subscribe(listener: () => void): () => void;
}
```

- [ ] **Шаг 1: Падающие тесты**

```ts
it('holds what a game-diagnostics frame carried', async () => {
  const ctx = harness();                                  // as connection.test.ts builds one
  deliver(ctx, { type: 'game-diagnostics', diagnostics: [d('reels blew up')] });
  await vi.waitFor(() => expect(ctx.gameDiagnostics.diagnostics).not.toBeNull());
  expect(ctx.gameDiagnostics.diagnostics!.map((x) => x.message)).toEqual(['reels blew up']);
});

it('null until a frame arrives — absent is not the same as none', () => {
  expect(harness().gameDiagnostics.diagnostics).toBeNull();
});

it('a project diagnostics frame does not land here', async () => {
  const ctx = harness();
  deliver(ctx, { type: 'diagnostics', diagnostics: [d('bad row')] });
  expect(ctx.gameDiagnostics.diagnostics).toBeNull();
});

it('notifies subscribers exactly once per frame', async () => {
  const ctx = harness();
  const seen = vi.fn();
  ctx.gameDiagnostics.subscribe(seen);
  deliver(ctx, { type: 'game-diagnostics', diagnostics: [] });
  await vi.waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
});
```

Второй и третий — про разделение пространств имён; без них панель может показать проектную строку как игровую и наоборот.

- [ ] **Шаг 2: Убедиться, что падают.**
- [ ] **Шаг 3: Реализовать.**
- [ ] **Шаг 4: Мутационная проверка.** Принимать оба типа кадра — падает третий тест. Начинать с `[]` вместо `null` — падает второй.
- [ ] **Шаг 5: Коммит**

---

## Task 8: Панель

**Files:**
- Create: `engine/ide/client/src/screens/DiagnosticsPanel.tsx`
- Modify: `engine/apps/web/src/App.tsx`
- Test: `engine/ide/client/tests/diagnostics-panel.test.tsx`

Один список всего, что случилось, с пометкой откуда — проект или игра. §8 спеки называет её прямо.

- [ ] **Шаг 1: Падающие тесты — утверждают видимый текст, а не состояние компонента**

```tsx
it('shows a game diagnostic, with its severity and where it came from', () => {
  render(<DiagnosticsPanel project={[]} game={[d('error', 'reels', 'runtime', 'reels blew up')]} />);
  expect(screen.getByText(/reels blew up/)).toBeVisible();
  expect(screen.getByTestId('diag-0')).toHaveTextContent('reels');
  expect(screen.getByTestId('diag-0')).toHaveTextContent(/game/i);
});

it('marks a project diagnostic as the project’s, not the game’s', () => {
  render(<DiagnosticsPanel project={[d('error', 'reels1', 'package', 'could not resolve')]} game={[]} />);
  expect(screen.getByTestId('diag-0')).toHaveTextContent(/project/i);
});

it('one plugin id in both namespaces renders as two separate rows', () => {
  // The collision Slice 1a settled with a comment and Slice 1b kept apart at
  // render. Here they finally meet, and the wire type is what tells them apart.
  const same = { severity: 'error' as const, plugin: 'session', where: 'w', message: 'm' };
  render(<DiagnosticsPanel project={[same]} game={[same]} />);
  expect(screen.getAllByText(/^m$/)).toHaveLength(2);
  expect(screen.getByTestId('diag-0')).toHaveTextContent(/project/i);
  expect(screen.getByTestId('diag-1')).toHaveTextContent(/game/i);
});

it('says nothing rather than inventing an empty state when the game has not reported yet', () => {
  render(<DiagnosticsPanel project={[]} game={null} />);
  expect(screen.queryByTestId('diag-0')).toBeNull();
  expect(screen.getByTestId('diagnostics-panel')).toHaveTextContent(/no game connected|not connected/i);
});

it('a bounded log that forgot something says so', () => {
  render(<DiagnosticsPanel project={[]} game={[d('error','p','w','last')]} droppedFromGame={3} />);
  expect(screen.getByTestId('diagnostics-panel')).toHaveTextContent('3');
});
```

Последний — почему `dropped()` вообще существует: панель, умалчивающая, что список неполон, хуже отсутствующей.

- [ ] **Шаг 2: Убедиться, что падают.**
- [ ] **Шаг 3: Реализовать и подключить в слот** — по образцу того, как в слот попадает существующий потребитель; не изобретайте второй способ.
- [ ] **Шаг 4: Мутационная проверка.** Слить два массива в один — падает третий тест. Показывать пустой список вместо «не подключено» — падает четвёртый.
- [ ] **Шаг 5:** Заодно решите, стоит ли молчаливая замена по ключу в `ctx.slots` диагностики: это та же последняя-запись-побеждает, что мы дважды чинили. Если да — почините; если нет — объясните в отчёте, чем этот случай отличается.
- [ ] **Шаг 6: Коммит**

---

## Task 9: Страница читает сервис

**Files:**
- Modify: `engine/examples/first-slot/src/main.ts`, `index.html`

`<pre id="log">` перестаёт быть адресатом и становится читателем. Это и есть проверка, что сервис годится: **если примеру после этого всё ещё нужен свой канал, сервис неполон** — и это находка, а не повод дописать примеру исключение.

- [ ] **Шаг 1: Найти все места, где страница пишет в лог напрямую**

`grep -n 'log(' engine/examples/first-slot/src/main.ts` — сегодня туда пишут послеспиновая проверка, сбой презентации, мост и обработчик клика. Выпишите список в отчёт, прежде чем менять: он и есть мера того, что сервис должен принять.

- [ ] **Шаг 2: Переключить `<pre>` на подписку**

Читает `ctx.diagnostics` и перерисовывается по `subscribe`. Ни одного прямого `log(...)` из перечисленных мест не остаётся.

- [ ] **Шаг 3: Убедиться, что видно то же самое**

Прогнать Playwright целиком: специи, которые уже утверждают содержимое лога (`schema.spec.ts` проверяет предупреждение парсера, приёмка Среза 1b — чистоту лога после показа), обязаны остаться зелёными без правок. Если какой-то тест пришлось тронуть — это сигнал, что видно стало другое, и надо объяснить, что именно.

- [ ] **Шаг 4: Мутационная проверка.** Отписать `<pre>` от сервиса — падают те специи, что читают лог, и никакие другие.

- [ ] **Шаг 5: Коммит**

---

## Task 10: Приёмка

**Files:**
- Create: `engine/apps/web/tests/e2e/diagnostics.spec.ts`

**Утверждать надо то, что увидел бы человек.** Сбой внутри работающей игры появляется в панели IDE, и появляется **с тем же текстом**, что на странице игры. Спека обещает «тот же список видят игра, IDE и агент» — вот это и проверяем.

```ts
import { expect, test } from '@playwright/test';

test('a failure inside the running game reaches the IDE panel, word for word', async ({ page, context }) => {
  const project = projectCopy();                    // helper from composition.spec.ts
  const host = await startDevHost(project);
  try {
    // The game page first: provoke a failure AFTER boot, not at boot — a boot
    // failure already reaches the screen, and would prove the old path.
    const game = await context.newPage();
    await game.goto(host.gameUrl);
    await expect(game.locator('#status')).toHaveText('ready');
    await game.locator('#spin').click();            // the fixture's bound mechanic fails to present
    await expect(game.locator('#log')).toContainText('presentation failed');
    const onTheGame = await game.locator('#log').textContent();

    // Now the editor, which was never told anything directly.
    await page.goto('http://127.0.0.1:5680/');
    const panel = page.getByTestId('diagnostics-panel');
    await expect(panel).toContainText('presentation failed');

    // §8's promise, checked rather than assumed: the same list, not a summary.
    const message = /presentation failed[^\n]*/.exec(onTheGame ?? '')![0];
    await expect(panel).toContainText(message);
  } finally {
    await host.stop();
  }
});

test('one id in both namespaces renders as two rows, not one', async ({ page }) => {
  // A project row the human named `session`, plus the game's own `session`
  // seam diagnostic. The panel must show both and attribute each correctly.
  const project = projectCopy({ patchRowId: 'session' });
  const host = await startDevHost(project);
  try {
    await page.goto('http://127.0.0.1:5680/');
    const rows = page.getByTestId(/^diag-/);
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText(/project/i);
    await expect(rows.nth(1)).toContainText(/game/i);
  } finally {
    await host.stop();
  }
});
```

**Ловушка, стоившая этой ветке раунда:** утверждать наличие текста в панели мало — надо утверждать, что это **тот же** текст, что видит игра. Панель, показывающая свою формулировку той же беды, пройдёт слабую проверку и нарушит обещание §8.

- [ ] **Шаг 1: Написать e2e.**
- [ ] **Шаг 2: Убедиться, что падает по правильной причине** — до задач 5–7 панель пуста; проверьте, что падает утверждение о тексте, а не поиск самой панели.
- [ ] **Шаг 3: Вся сюита Playwright в одиночку**, проверка осиротевших процессов.
- [ ] **Шаг 4: Прогнать все пакеты `engine/*`.**
- [ ] **Шаг 5: Коммит**

---

## Чего этот план НЕ обещает

- **Достаточность состава и `check()` как гарантия** остаются — это следующий срез («объявления вместо договорённостей») вместе с обобщением защиты от коллизий.
- **Панель не редактирует и не переходит к источнику.** Список и его текст; переход к строке или к файлу — отдельная работа.
- **Диагностика не переживает перезагрузку страницы.** Сервис живёт в игре; durable-лог — это `spin-log`, и связывать их здесь не будем.
- **Агент из §8 не получает ничего нового.** Спека называет его третьим читателем того же списка; канал к нему — не этот срез.
