# Срез 3: объявлено, а не условлено — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Три договорённости становятся проверяемыми объявлениями: строка объявляет сервисы, без которых не работает, и движок это проверяет; коллекции по имени получают одну реализацию, а не три; два объявления одного порядка становятся одним значением. Плюс два остатка Среза 2, без которых «один список» не выполнен буквально.

**Architecture:** Рантайм-манифест получает `requires: string[]` — **проверку после сборки, а не подсказку порядка**; `createGame` сверяет требования каждой строки с тем, что оказалось на `ctx`. Новый маленький пакет даёт одну коллекцию по имени со столкновением-как-диагностикой, и три реестра берут её. Хост получает кадр «сервер → игра», который мост принимает через `seed`, поэтому сбои `/api/spin` попадают в собственный список игры без петли.

**Tech Stack:** TypeScript, cordis 4.0.0-rc.8, React 18, vite 6, vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-slot-webide-cordis-design.md` — §8 (отказ как данные; один список у игры, IDE и агента), §5.4 (реестры; ноль или двое кандидатов — диагностика).

**Долг, который гасится:** записка Среза 1a пункт 3; записка Среза 1b пункт 2; записка Среза 2 пункты 1, 2, 3.

---

## Global Constraints

- Новый код — **только** в `engine/`. `packages/*` и верхнеуровневый `examples/*` — легаси: читать и импортировать можно, править нельзя. `engine/examples/first-slot` — наш.
- Скоуп `@energy8engine/*`; имя нового пакета уникально во всей монорепе (корневой `workspaces` включает `engine/*/*`). Проверить **до** установки.
- Комментарии и коммиты — по-английски, короткими повествовательными предложениями в голосе репозитория.
- **Контракты — словари, плагины — решения.** `engine/core/contracts` не импортирует ничего, кроме относительных модулей; строгий тест чистоты.
- **Отказ — это данные.** Ни один шов не бросает; ни один путь не заканчивается пустым экраном без объяснения.
- Тесты — по пакетам: `npm test --workspace @energy8engine/<pkg>`. Корневой прогон зелёный, но медленный и неточный для этой работы.
- Playwright в `engine/apps/web`: фиксированные порты, `workers: 1`, в одиночку, потом проверка осиротевших процессов.
- Дымовой тест CLI запускает настоящий `bin/e8.mjs`: vitest ходит через vite-node, который подставляет `__dirname`/`__filename`, а `tsx` — нет.
- Каждое утверждение задаётся **вместе с мутацией, которая обязана его уронить**. Эта ветка нашла тринадцать случаев, когда утверждение проходило не через ту ветку, которую называет.

---

## Проверенные факты

Измерено на текущем HEAD.

### Два пункта долга оказались не тем, чем записаны

**`check()` уже гарантия, а не договорённость.** `mechanics.present()` вызывает `check()` внутри себя (`engine/game/runtime/src/plugins/mechanics.ts:310`), и обойти его нельзя: во всём `engine/` ровно два вызова `present` — служебный внутренний и вызов **сервиса** со страницы (`first-slot/src/main.ts:425`). Записка Среза 1a, пункт 4, устарела. **Ничего делать не нужно; пометить погашенным.**

**`inject` возвращать нельзя.** Мы удалили его в проходе по долгу с верным доводом, записанным в `manifest.ts:56-70`: рантайм-половина применяется **не** через `ctx.plugin()`, а прямым вызовом `module.apply?.(ctx, config)`, поэтому список зависимостей никто бы не читал, и порядок задаёт состав.

Отсюда форма задачи 1: `requires` — это **не** подсказка порядка, а список сервисов, чьё отсутствие проверяется **после** сборки. Обещания, которое загрузчик не держит, оно не возрождает. Скажите это в документации поля прямо, иначе следующий читатель примет его за вернувшийся `inject`.

### Что именно делает страница вручную

`engine/examples/first-slot/src/main.ts:131` — `REQUIRES` из записей `{ service, row, pkg, what }`, и `:162` фильтрует их через `game.ctx.reflect.get(need.service, false) === undefined`. Это и есть механизм, который надо поднять в движок; форма подсказана рабочим кодом, а не выдумана.

Сервисов, которые можно потребовать, сегодня одиннадцать: `board`, `boot`, `diagnostics`, `mechanics`, `mount`, `play`, `renderer`, `session`, `spinLog`, `steps`, `stage`.

### Петлю для канала «сервер → игра» изобретать не нужно

`DiagnosticsService` уже различает произведённое и полученное: `report` против `seed`, и `own()` против `list()`. Мост пересылает наверх **`own()`** (`ide-bridge/src/index.ts:308`), поэтому диагностика, пришедшая сверху и осевшая через `seed`, обратно не уйдёт.

Это свойство выпало побочно из починки двойной отрисовки в Срезе 2 и делает задачу 6 маленькой.

### Три коллекции по имени с тремя политиками

`createBoardStepRegistry` и `MechanicsService.register` диагностируют столкновение (первый побеждает); `ctx.slots.register` заменяет и тоже диагностирует (последний побеждает). Политики **разные и обе законные**: реестр — поиск единственного владельца, слоты — отрисовываемый список.

Значит, общий пакет обязан позволять **обе** политики, а не навязывать одну. Пакет, умеющий только «первый побеждает», не примет слоты, и гарантия снова не обобщится.

---

## Структура файлов

| Путь | Ответственность |
|---|---|
| `engine/core/contracts/src/manifest.ts` | изменить — `E8RuntimeHalf` получает `requires` |
| `engine/game/runtime/src/index.ts` | изменить — сверка требований после сборки |
| `engine/examples/first-slot/src/main.ts` | изменить — рукописный `REQUIRES` уходит |
| `engine/core/registry/` | **создать** пакет `@energy8engine/registry` — коллекция по имени, обе политики |
| `engine/game/play-loop/src/index.ts`, `engine/game/runtime/src/plugins/mechanics.ts`, `engine/ide/client/src/plugins/slots.tsx` | изменить — взять общую коллекцию |
| `engine/core/contracts/src/protocol.ts` | изменить — порядок источников как одно значение; кадр «сервер → игра» |
| `engine/ide/host/src/plugins/rpc.ts`, `engine/game/ide-bridge/src/index.ts` | изменить — канал вниз |
| `engine/ide/client/src/screens/DiagnosticsPanel.tsx`, `engine/apps/web/src/App.tsx` | изменить — третий источник: сам редактор |
| `engine/apps/web/tests/e2e/declared.spec.ts` | **создать** — приёмка |

---

## Task 1: Строка объявляет, что ей нужно

**Files:**
- Modify: `engine/core/contracts/src/manifest.ts`, `engine/core/contracts/tests/manifest.test.ts`

**Interfaces:**
```ts
export interface E8RuntimeHalf {
  entry: string;
  /**
   * Services this row cannot work without. Checked AFTER composition, never
   * used to order anything — see the note on why `inject` is not back.
   */
  requires?: string[];
}
```

- [ ] **Шаг 1: Падающие тесты**

```ts
it('reads a requires list off the runtime half', () => {
  const { manifest } = parseManifest({ e8: { runtime: { entry: './r.ts', requires: ['board'] } } }, 'row1');
  expect(manifest!.runtime!.requires).toEqual(['board']);
});

it('a runtime half with no requires is legal and means none', () => {
  const { manifest, diagnostics } = parseManifest({ e8: { runtime: { entry: './r.ts' } } }, 'row1');
  expect(manifest!.runtime!.requires).toBeUndefined();
  expect(diagnostics).toEqual([]);
});

it('a requires that is not an array of strings is a diagnostic naming the row', () => {
  const { diagnostics } = parseManifest({ e8: { runtime: { entry: './r.ts', requires: 'board' } } }, 'row1');
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].plugin).toBe('row1');
  expect(diagnostics[0].message).toContain('requires');
});

it('the entry still parses when requires is malformed — half a manifest beats none', () => {
  const { manifest } = parseManifest({ e8: { runtime: { entry: './r.ts', requires: 7 } } }, 'row1');
  expect(manifest!.runtime!.entry).toBe('./r.ts');
});
```

Последний — то же правило, что уже держит парсер `.spin`: разобранное не теряется из-за соседа.

- [ ] **Шаг 2: Убедиться, что падают** — `npm test --workspace @energy8engine/contracts`.
- [ ] **Шаг 3: Реализовать**, по образцу соседней ветки разбора `client`.
- [ ] **Шаг 4: Написать в документации поля, почему это не `inject`** — со ссылкой на довод в том же файле.
- [ ] **Шаг 5: Мутационная проверка.** Принимать не-массив — падает третий тест; терять `entry` при кривом `requires` — падает четвёртый.
- [ ] **Шаг 6: Коммит**

```bash
git add engine/core/contracts
git commit -m "A row can say which services it cannot work without"
```

---

## Task 2: Движок проверяет — и рукописный список уходит

**Files:**
- Modify: `engine/game/runtime/src/index.ts`, `engine/examples/first-slot/src/main.ts`
- Test: `engine/game/runtime/tests/compose.test.ts`

После сборки `createGame` сверяет `requires` каждой строки с `ctx`. Недостающий сервис — диагностика, называющая **строку, сервис и, если известно, строку-поставщика**.

**Что должно исчезнуть:** `REQUIRES` в `main.ts` и его фильтр. Если после этого странице всё ещё нужен свой список — механизм неполон, и это находка, а не повод оставить исключение.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('a row that requires a service nothing provides is a diagnostic naming both', async () => {
  const game = await createGame({ mount, loader: { /* reels1 requires board; no board row */ } });
  const d = game.diagnostics.find((x) => x.message.includes('board'))!;
  expect(d.plugin).toBe('reels1');
  expect(d.message).toContain('board');
});

it('names the row that would have provided it, when the composition has one', async () => {
  // reels1 IS in the composition but its half threw, so `board` never
  // appeared. "reels1 failed, so board is missing" points at the real cause;
  // "board is missing" sends the reader looking for a row that is right there.
  const game = await createGame({ mount, loader: {
    fetchFn: fakeFetch({ rows: [row('reels1'), row('playloop1')], diagnostics: [] }),
    importModule: async (url) => url.endsWith('reels1')
      ? { apply: () => { throw new Error('reels1 refused'); } }
      : { apply: (ctx: any) => { ctx.play = {}; } },
  } });
  const d = game.diagnostics.find((x) => x.message.includes('board'))!;
  expect(d.message).toContain('reels1');
});

it('a row requiring a service that IS provided says nothing', async () => {
  expect(game.diagnostics).toEqual([]);
});

it('requires is checked after ALL rows applied, not as each one lands', async () => {
  // A row requiring a service a LATER row provides must not be reported.
  // This is the property that keeps `requires` a check and not an ordering
  // constraint — get it wrong and it becomes `inject` by accident.
  expect(game.diagnostics).toEqual([]);
});
```

Четвёртый — самый важный: он и есть граница между проверкой и подсказкой порядка.

- [ ] **Шаг 2–4: убедиться, что падают; реализовать; удалить `REQUIRES` со страницы.**
- [ ] **Шаг 5: Прогнать Playwright целиком.** Специи, утверждающие текст экрана при отсутствующей строке, должны остаться зелёными; правки допустимы только как оформление тех же событий, и каждую назвать.
- [ ] **Шаг 6: Мутационная проверка.** Проверять после каждой строки, а не после всех, — падает четвёртый тест.
- [ ] **Шаг 7: Коммит**

---

## Task 3: Один пакет для коллекций по имени

**Files:**
- Create: `engine/core/registry/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Test: `engine/core/registry/tests/registry.test.ts`

**Interfaces:**
```ts
export type CollisionPolicy = 'first-wins' | 'last-wins';

export interface NamedRegistry<T> {
  /** Adds under `key`. Returns a disposer that removes ONLY what it added. */
  add(key: string, value: T): () => void;
  get(key: string): T | undefined;
  keys(): readonly string[];
  /** One entry per collision seen, in the order they happened. A copy. */
  collisions(): readonly { key: string; kept: string; dropped: string }[];
}

export function createRegistry<T>(options: {
  policy: CollisionPolicy;
  /** How an entry names itself in a collision report. */
  describe: (value: T) => string;
}): NamedRegistry<T>
```

**Обе политики обязательны.** Реестр шагов и реестр механик — поиск единственного владельца, там первый побеждает; слоты редактора — отрисовываемый список, там побеждает последний. Пакет, умеющий одну политику, не примет слоты, и гарантия снова не обобщится — то есть задача провалится, выглядя выполненной.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('first-wins keeps the first and reports the collision', () => {
  const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
  r.add('x', 'alpha'); r.add('x', 'beta');
  expect(r.get('x')).toBe('alpha');
  expect(r.collisions()).toEqual([{ key: 'x', kept: 'alpha', dropped: 'beta' }]);
});

it('last-wins keeps the last and reports it too', () => {
  const r = createRegistry<string>({ policy: 'last-wins', describe: (v) => v });
  r.add('x', 'alpha'); r.add('x', 'beta');
  expect(r.get('x')).toBe('beta');
  expect(r.collisions()).toEqual([{ key: 'x', kept: 'beta', dropped: 'alpha' }]);
});

it('a disposer removes only what it added, never a newer entry for the same key', () => {
  // The stale-disposer race MechanicsService already guards against.
  const r = createRegistry<string>({ policy: 'last-wins', describe: (v) => v });
  const off = r.add('x', 'alpha');
  r.add('x', 'beta');
  off();
  expect(r.get('x')).toBe('beta');
});

it('double disposal is a no-op, not a throw', () => {
  const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
  const off = r.add('x', 'alpha');
  off(); expect(() => off()).not.toThrow();
});

it('re-adding after disposal works, and the new entry is what get() returns', () => {
  const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
  r.add('x', 'alpha')();
  r.add('x', 'gamma');
  expect(r.get('x')).toBe('gamma');
  expect(r.collisions()).toEqual([]);      // a disposed entry is not a collision
});

it('collisions() is a copy — a caller cannot edit the record', () => {
  const r = createRegistry<string>({ policy: 'first-wins', describe: (v) => v });
  r.add('x', 'a'); r.add('x', 'b');
  (r.collisions() as unknown[]).push({});
  expect(r.collisions()).toHaveLength(1);
});
```

- [ ] **Шаг 2–3: убедиться, что падают; реализовать.**
- [ ] **Шаг 4: Мутационная проверка.** Игнорировать политику — падают первые два; дать устаревшему освободителю выселять новую запись — падает третий.
- [ ] **Шаг 5: Коммит**

---

## Task 4: Три реестра берут общую коллекцию

**Files:**
- Modify: `engine/game/play-loop/src/index.ts`, `engine/game/runtime/src/plugins/mechanics.ts`, `engine/ide/client/src/plugins/slots.tsx`
- Test: сюиты этих трёх пакетов

Каждый сохраняет **свою нынешнюю политику и своё нынешнее сообщение** — задача про то, откуда берётся механика, а не про то, как она себя ведёт. Все существующие тесты обязаны пройти без правок; правка теста здесь — сигнал, что поведение изменилось, и её надо объяснить.

**Помните находку Среза 2:** `executePlan` читает `collisions()` на каждом вызове, и это верно — «затенённый вид есть факт про каждый план, который его называет». Устранение дублей живёт в сервисе диагностик, не в реестре. Не переносите его сюда.

- [ ] **Шаг 1: По одному пакету за раз, тесты до и после.**
- [ ] **Шаг 2: Убедиться, что ни один существующий тест не потребовал правки.**
- [ ] **Шаг 3: Мутационная проверка** — подменить политику в каждом из трёх и убедиться, что падает тест этого пакета, а не соседнего.
- [ ] **Шаг 4: Коммит**

---

## Task 5: Один порядок источников, одно значение

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts`, `engine/ide/host/src/plugins/rpc.ts`, `engine/ide/client/src/plugins/diagnostics.tsx`
- Test: `engine/core/contracts/tests/protocol.test.ts`

`SOURCES` на хосте и `SOURCE_ORDER` в клиенте — два объявления одного порядка, которые обязаны совпадать, чтобы строки панели шли так, как их шлёт хост. Оба задокументированы и закреплены тестами, но одним значением не являются.

Порядок источников — это словарь, а не решение: ему место в контрактах.

- [ ] **Шаг 1: Падающий тест**

```ts
it('there is exactly one declaration of the source order', () => {
  // Guard, not ceremony: this test exists because there used to be two.
  expect(DIAGNOSTIC_SOURCES).toEqual(['project', 'game', 'editor']);
});
```

- [ ] **Шаг 2–4: убедиться, что падает; перенести; удалить оба прежних объявления.**
- [ ] **Шаг 5: Коммит**

---

## Task 6: Сбои `/api/spin` попадают в список игры

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts`, `engine/ide/host/src/plugins/rpc.ts`, `engine/game/ide-bridge/src/index.ts`
- Test: сюиты `contracts`, `ide-host`, `ide-bridge`

§8 обещает буквально один список. Сегодня сбой `/api/spin` доезжает до редактора и **не доезжает до собственного списка игры** — единственный производитель, для которого обещание не выполнено.

Хост получает кадр вниз; мост его принимает и кладёт через **`seed`**, а не `report`. Петли не будет: мост пересылает наверх `own()`, а осевшее через `seed` туда не входит.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('the host sends its own game-side diagnostics down to the game', async () => {
  const { game } = await twoClients(host);       // as rpc.test.ts builds them
  await provokeHostSpinFailure(host);            // spec.json id is `not-a-game`
  await expect.poll(() => game.received.filter((m) => m.type === 'game-diagnostics'))
    .toHaveLength(1);
});

it('the bridge seeds what came down, and does not forward it back up', () => {
  // The loop this must not have: down -> report -> own() -> up -> down.
  const log = createDiagnostics();
  const socket = fakeSocket();
  attachDiagnosticsForwarding(socket, log);
  socket.deliver({ type: 'game-diagnostics', source: 'host', dropped: 0,
    diagnostics: [d('spin failed')] });
  expect(log.own()).toEqual([]);                 // seeded, not reported
  expect(log.list().map((x) => x.message)).toEqual(['spin failed']);
  expect(socket.sent.filter((f) => JSON.parse(f).diagnostics.length > 0)).toEqual([]);
});

it('a seeded diagnostic still shows on the game page', () => {
  // list() carries it, so `boot` and the page show the whole picture,
  // whoever first noticed each part of it.
  const log = createDiagnostics();
  log.seed(d('spin failed'));
  expect(log.list()).toHaveLength(1);
});

it('the bridge still ignores frames it has no business with', () => {
  // The strict filter is what keeps the namespaces apart. Widening it by one
  // type must not widen it by two.
  const log = createDiagnostics();
  const socket = fakeSocket();
  attachDiagnosticsForwarding(socket, log);
  socket.deliver({ type: 'diagnostics', diagnostics: [d('a project problem')] });
  expect(log.list()).toEqual([]);
});
```

- [ ] **Шаг 2–5: как обычно, с мутационной проверкой петли.**

---

## Task 7: Третий источник — сам редактор

**Files:**
- Modify: `engine/ide/client/src/screens/DiagnosticsPanel.tsx`, `engine/ide/client/src/screens/CompositionScreen.tsx`, `engine/apps/web/src/App.tsx`
- Test: `engine/ide/client/tests/diagnostics-panel.test.tsx`

Беды самого редактора — столкновение ключей слота и прочее — идут в отдельный список экрана состава. Срез, чей тезис «одно место, куда смотреть», не должен иметь второго места.

Панель получает третий источник, `editor`; собственный список экрана состава уходит.

- [ ] **Шаг 1: Падающие тесты**

```tsx
const d = (plugin: string, message: string) =>
  ({ severity: 'error' as const, plugin, where: 'w', message });

it('shows an editor diagnostic, marked as the editor’s', () => {
  render(<DiagnosticsPanel project={[]} game={[]} editor={[d('slots', 'two cards claim key "x"')]} />);
  expect(screen.getByTestId('diag-0')).toHaveTextContent('two cards claim key');
  expect(screen.getByTestId('diag-0')).toHaveTextContent(/editor/i);
});

it('one id in all three namespaces renders as three rows, each attributed', () => {
  const same = d('session', 'm');
  render(<DiagnosticsPanel project={[same]} game={[same]} editor={[same]} />);
  expect(screen.getAllByText(/^m$/)).toHaveLength(3);
  expect(screen.getByTestId('diag-0')).toHaveTextContent(/project/i);
  expect(screen.getByTestId('diag-1')).toHaveTextContent(/game/i);
  expect(screen.getByTestId('diag-2')).toHaveTextContent(/editor/i);
});

it('the composition screen no longer keeps a diagnostics list of its own', () => {
  render(<CompositionScreen ctx={harness()} />);
  expect(document.querySelector('.e8-diagnostics')).toBeNull();
});
```

- [ ] **Шаг 2–5: как обычно.**

---

## Task 8: Приёмка

**Files:**
- Create: `engine/apps/web/tests/e2e/declared.spec.ts`

**Урок Среза 2, применённый заранее:** приёмка **не имеет права** исключать класс случаев на том основании, что он «и так работает». Прошлый раз это стоило среза: тест не проверял загрузочные сбои, потому что они «и так видны на экране», — верно про экран игры, неверно про редактор.

Поэтому здесь проверяется и то, и другое, и **отсутствие второго места**.

```ts
test('a row that requires a missing service says so, naming both', async ({ page }) => {
  const project = projectCopy();
  writeFileSync(join(project, 'e8.patch.yml'),
    readFileSync(join(project, 'e8.patch.yml'), 'utf8') + '\n  - id: reels1\n    remove: true\n');
  const host = await startDevHost(project);
  try {
    await page.goto(host.gameUrl);
    const log = page.locator('#log');
    await expect(log).toContainText('board');       // the service
    await expect(log).toContainText('playloop1');   // the row that required it
  } finally { await host.stop(); }
});

test('a /api/spin failure appears in the game’s own log, not only in the IDE', async ({ page }) => {
  // §8's literal promise, for the one producer that did not keep it.
  const project = projectCopy({ specId: 'not-a-game' });
  const host = await startDevHost(project);
  try {
    await page.goto(host.gameUrl);
    await page.locator('#spin').click();
    await expect(page.locator('#log')).toContainText('spin failed');
  } finally { await host.stop(); }
});

test('the editor’s own trouble appears in the panel, and nowhere else', async ({ page }) => {
  const project = projectCopy({ duplicateSlotKey: true });
  const host = await startDevHost(project);
  try {
    await page.goto('http://127.0.0.1:5680/');
    await expect(page.getByTestId('diagnostics-panel')).toContainText(/editor/i);
    expect(await page.locator('.e8-diagnostics').count()).toBe(0);
  } finally { await host.stop(); }
});
```

- [ ] **Шаги 1–4**, вся сюита Playwright в одиночку, проверка осиротевших процессов.

---

## Чего этот план НЕ обещает

- **`requires` не упорядочивает.** Это проверка после сборки. Порядок по-прежнему задаёт состав, и вернуть `inject` этот срез не пытается.
- **Устранение дублей остаётся побайтовым.** По-настоящему повторившийся сбой показывается один раз; менять это стоит только вместе с осью времени у диагностики.
- **Достаточность состава проверяется по объявлениям строк, а не по смыслу игры.** Игра, которой нужен сервис, но чья строка о нём не сказала, по-прежнему промолчит. Объявление — обязанность автора строки.
- **Панель по-прежнему не ведёт к источнику.** Список и текст; переход к строке или файлу — отдельная работа.
