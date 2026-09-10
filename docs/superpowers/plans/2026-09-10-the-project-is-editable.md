# Срез 5: проект можно править — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Хост учится читать, писать и удалять файлы проекта, не выпуская за его каталог. Экран «Ассеты» это доказывает: дерево, просмотр, загрузка, удаление. Плюс отложенный вопрос Среза 4 — панель диагностик становится хромом и переживает смену экрана, чем §8 наконец выполняется буквально.

**Architecture:** `files` — хостовый сервис поверх `node:fs/promises`, с удержанием в каталоге проекта по образцу `client-assets.ts`: сравниваются **реальные** пути обеих сторон, поэтому символическая ссылка наружу не проходит. Четыре маршрута на `ctx.server`. Клиентский `files` ходит `fetch`-ем, как уже делает `game-composition`. Экран «Ассеты» показывает дерево файлов проекта целиком — отдельного каталога для ассетов в проекте нет, и заводить его этот срез не станет: то же дерево потом понадобится экрану «Код».

**Tech Stack:** TypeScript, cordis 4.0.0-rc.8, React 18, vite 6, vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-slot-webide-cordis-design.md` — §5 (пять экранов, из них «Ассеты» — дерево, CRUD, загрузка), §8 (отказ как данные; один список у игры, IDE и агента), §11 (Фаза 4).

**Долг, который гасится:** записка Среза 4, пункт 2 (один список не видно там, где игр много).

---

## Global Constraints

- Новый код — **только** в `engine/`. `packages/*` и верхнеуровневый `examples/*` — легаси: читать и импортировать можно, править нельзя. `engine/examples/first-slot` — наш.
- Комментарии и коммиты — по-английски, короткими повествовательными предложениями в голосе репозитория. Без списков в теле коммита; в заголовке не называть процесс проверки.
- **Контракты — словари, плагины — решения.** `engine/core/*` не импортирует ничего, кроме относительных модулей; строгий тест чистоты.
- **Отказ — это данные.** Ни один шов не бросает; ни один путь не заканчивается пустым экраном без объяснения. Ни одна надпись не утверждает причину, которой код не знает.
- Тесты — по пакетам: `npm test --workspace @energy8engine/<pkg>`. Корневой прогон даёт ложные падения.
- Playwright в `engine/apps/web`: `workers: 1`, порт 5679, **в одиночку** — в одиночку от любой корневой команды `npm`, а не только от vitest: временные копии `e8-compose-*` попадают в маску `engine/*/*` и дают `EDUPLICATEWORKSPACE`. Потом проверка осиротевших процессов **перечислением** (`pkill -f "$tmpdir"` совпадает по рабочему каталогу, а не по командной строке) и что не осталось `engine/examples/e8-compose-*`.
- Вкладки адресуются `data-testid="tab-<id>"`, не видимым текстом.
- Каждое утверждение задаётся **вместе с мутацией, которая обязана его уронить**. На этой ветке девятнадцать раз утверждение проходило не через ту ветку, которую называет — последний раз в самой приёмке.

---

## Проверенные факты

Измерено на текущем HEAD (`f0926e0`).

### Хост умеет только читать

`engine/ide/host/src/plugins/project.ts:39-44` — весь `ProjectService`: `composition`, `diagnostics`, `reload()`. Записи нет никакой. На это упираются три из пяти экранов спеки: «Ассеты», «Код» и «Воркспейс».

### Удержание в каталоге уже написано, и его надо повторить, а не выдумать

`engine/ide/host/src/plugins/client-assets.ts:45-79` сравнивает `realpathSync` **обеих** сторон, а не только запрошенной, и в комментарии объясняет почему: иначе символическая ссылка внутри каталога уводит наружу, пока путь выглядит своим. Там же обработан случай, когда `realpathSync` бросает на несуществующем пути. `dev-game.ts` имеет тесты именно на побег через ссылку (`refuses a symlink inside the served root whose target is outside it`) и на то, что отсутствующий файл — не отказ доступа.

Это готовый образец. Новый сервис берёт его форму; отличие одно и важное: **запись создаёт файл, которого ещё нет**, поэтому `realpath` проверяется по ближайшему существующему предку, а не по самому пути.

### Каталога ассетов в проекте нет

`engine/examples/first-slot/` содержит `e8.*.yml`, `game/` (`script.spin`, `spec.json`), `plugins/`, `src/`, `index.html`, `package.json`, `tsconfig.json`. Отдельного `assets/` нет ни у одного проекта.

**Решение:** соглашения не заводим. Сервис отдаёт дерево файлов проекта, экран показывает его целиком. Это и проще, и полезнее: экрану «Код» из спеки нужно то же самое дерево, а выдуманный `assets/` пришлось бы потом обходить.

### Маршруты и тела запросов

`ctx.server.get(path, handler)` и `ctx.server.post` уже в ходу (`client-assets.ts:23`, `dev-game.ts:295`, `runtime-assets.ts:266,368`). Разбор тела — `await req.json()`, обёрнутый в `try` (`dev-game.ts:297-302`).

Готового разбора `multipart/form-data` нет. Загрузка идёт base64 внутри JSON — новой зависимости не добавляем.

`// ponytail: base64-in-JSON раздувает тело на треть; multipart, если начнут возить видео.`

### Клиент уже ходит fetch-ем

`engine/ide/client/src/plugins/game-composition.tsx` берёт `/api/composition` обычным `fetch`, не через сокет. Файловый сервис делает так же: сокет — для того, что приходит само, `fetch` — для того, что спрашивают.

### Панель диагностик невидима там, где игр много

`engine/apps/web/src/App.tsx:84` регистрирует её как `composition.card`; карточки рисует только `CompositionScreen`; `<Layout/>` монтирует **только текущий экран**. Значит при открытой стене превью список недоступен, а уход к нему размонтирует все плитки и закроет их сокеты. Приёмка Среза 4 вынуждена открывать вторую страницу браузера и прямо об этом пишет (`screens.spec.ts:215-223`).

`rpc.ts:119-122` называет ровно такую форму «утечкой, а не устаревшим-но-верным фактом» — про хостовую карту. Здесь то же самое про видимость.

---

## Структура файлов

| Путь | Ответственность |
|---|---|
| `engine/ide/host/src/plugins/files.ts` | **создать** — сервис `files`: дерево, чтение, запись, удаление, удержание в каталоге |
| `engine/ide/host/src/index.ts` | изменить — составить `files` |
| `engine/core/contracts/src/files.ts` | **создать** — словарь: `FileEntry`, тела ответов |
| `engine/ide/client/src/plugins/files.ts` | **создать** — клиентский `files` поверх `fetch` |
| `engine/ide/client/src/screens/AssetsScreen.tsx` | **создать** — дерево, просмотр, загрузка, удаление |
| `engine/ide/client/src/screens/Layout.tsx` | изменить — панель диагностик становится хромом |
| `engine/apps/web/src/App.tsx` | изменить — панель уходит из карточек, экран «Ассеты» регистрируется |
| `engine/apps/web/tests/e2e/assets.spec.ts` | **создать** — приёмка |

---

## Task 1: Хостовый сервис `files` — дерево и чтение

**Files:**
- Create: `engine/core/contracts/src/files.ts`, `engine/ide/host/src/plugins/files.ts`, `engine/ide/host/tests/files.test.ts`
- Modify: `engine/core/contracts/src/index.ts`, `engine/ide/host/src/index.ts`

**Interfaces:**
```ts
// contracts/src/files.ts — словарь, без импортов кроме относительных
export interface FileEntry {
  /** Путь от корня проекта, через `/`, без ведущего слэша. */
  path: string;
  kind: 'file' | 'dir';
  /** Байты. Отсутствует у каталогов. */
  size?: number;
}

// host/src/plugins/files.ts
export interface FilesService {
  /** Всё дерево проекта, в порядке обхода. Никогда не бросает. */
  tree(): Promise<{ entries: FileEntry[]; diagnostics: Diagnostic[] }>;
  /** Содержимое одного файла. `bytes` отсутствует, если читать нечего. */
  read(path: string): Promise<{ bytes?: Uint8Array; diagnostics: Diagnostic[] }>;
}
```

**Interfaces produced:** `FileEntry` и `FilesService` — задачи 2, 3 и 4 их потребляют.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('lists the project tree, files and directories alike', async () => {
  const ctx = await hostFor(fixture('plain'));
  const { entries, diagnostics } = await ctx.files.tree();
  expect(diagnostics).toEqual([]);
  expect(entries.map((e) => e.path)).toContain('game/script.spin');
  expect(entries.find((e) => e.path === 'game')?.kind).toBe('dir');
});

it('reports a file size, and no size for a directory', async () => {
  const ctx = await hostFor(fixture('plain'));
  const { entries } = await ctx.files.tree();
  expect(entries.find((e) => e.path === 'game/script.spin')!.size).toBeGreaterThan(0);
  expect(entries.find((e) => e.path === 'game')!.size).toBeUndefined();
});

it('never lists node_modules, which is not the project', async () => {
  // Иначе дерево проекта — это дерево npm, и экран бесполезен.
  const ctx = await hostFor(fixture('with-node-modules'));
  const { entries } = await ctx.files.tree();
  expect(entries.filter((e) => e.path.startsWith('node_modules'))).toEqual([]);
});

it('reads a file back byte for byte', async () => {
  const ctx = await hostFor(fixture('plain'));
  const { bytes, diagnostics } = await ctx.files.read('game/spec.json');
  expect(diagnostics).toEqual([]);
  expect(JSON.parse(new TextDecoder().decode(bytes!)).id).toBe('first-slot');
});

it('a path that is not there is a diagnostic, not a throw and not a lie', async () => {
  const ctx = await hostFor(fixture('plain'));
  const { bytes, diagnostics } = await ctx.files.read('game/nope.json');
  expect(bytes).toBeUndefined();
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].message).toContain('game/nope.json');
});

it('refuses a path that climbs out of the project', async () => {
  const ctx = await hostFor(fixture('plain'));
  const { bytes, diagnostics } = await ctx.files.read('../../../etc/passwd');
  expect(bytes).toBeUndefined();
  expect(diagnostics[0].message).toMatch(/outside the project/i);
});

it('refuses a symlink INSIDE the project whose target is outside it', async () => {
  // Тот же побег, который `dev-game` уже ловит: путь выглядит своим,
  // а ведёт наружу. Сравниваются реальные пути обеих сторон.
  const dir = fixture('plain');
  symlinkSync('/etc', join(dir, 'escape'));
  const ctx = await hostFor(dir);
  const { diagnostics } = await ctx.files.read('escape/passwd');
  expect(diagnostics[0].message).toMatch(/outside the project/i);
});

it('an absent file is not reported as an access refusal', async () => {
  // Иначе «нет такого файла» и «сюда нельзя» сливаются, и читатель
  // идёт чинить права там, где надо исправить опечатку.
  const ctx = await hostFor(fixture('plain'));
  const { diagnostics } = await ctx.files.read('game/nope.json');
  expect(diagnostics[0].message).not.toMatch(/outside the project/i);
});

it('a directory read is a diagnostic naming what it is', async () => {
  const ctx = await hostFor(fixture('plain'));
  const { bytes, diagnostics } = await ctx.files.read('game');
  expect(bytes).toBeUndefined();
  expect(diagnostics[0].message).toMatch(/directory/i);
});
```

- [ ] **Шаг 2: Прогнать, убедиться, что падают**

Run: `npm test --workspace @energy8engine/ide-host -- files`
Expected: FAIL — `ctx.files` не существует.

- [ ] **Шаг 3: Написать сервис**

Прочитайте `engine/ide/host/src/plugins/client-assets.ts:45-79` **до того**, как писать удержание. Форма там уже верная и объяснена: `realpathSync` обеих сторон, обработанный бросок на несуществующем пути, сравнение через `sep`. Повторите её; где отклоняетесь — скажите в комментарии почему.

Не листайте `node_modules` и `.git`. Это не аккуратность, а смысл: дерево проекта, в котором девяносто девять процентов — чужие пакеты, не дерево проекта.

- [ ] **Шаг 4: Прогнать, убедиться, что проходят**

- [ ] **Шаг 5: Мутации**

Уберите `realpath` с одной стороны сравнения → тест на символическую ссылку обязан покраснеть, а тест на `../../..` — остаться зелёным (это разные побеги). Сделайте отсутствующий файл отказом доступа → покраснеет тест, который их различает. Снимите отсев `node_modules` → покраснеет его тест.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/core/contracts engine/ide/host
git commit -m "The host can read the project it has only been resolving"
```

---

## Task 2: Запись и удаление

**Files:**
- Modify: `engine/ide/host/src/plugins/files.ts`, `engine/ide/host/tests/files.test.ts`

**Interfaces:**
```ts
export interface FilesService {
  tree(): Promise<{ entries: FileEntry[]; diagnostics: Diagnostic[] }>;
  read(path: string): Promise<{ bytes?: Uint8Array; diagnostics: Diagnostic[] }>;
  /** Создаёт или заменяет. Недостающие каталоги создаются. */
  write(path: string, bytes: Uint8Array): Promise<{ diagnostics: Diagnostic[] }>;
  /** Удаляет файл. Каталог не удаляет — это отдельное намерение. */
  remove(path: string): Promise<{ diagnostics: Diagnostic[] }>;
}
```

- [ ] **Шаг 1: Падающие тесты**

```ts
it('writes a new file, and reads back what it wrote', async () => {
  const ctx = await hostFor(fixture('plain'));
  const { diagnostics } = await ctx.files.write('art/logo.txt', bytes('hello'));
  expect(diagnostics).toEqual([]);
  const back = await ctx.files.read('art/logo.txt');
  expect(new TextDecoder().decode(back.bytes!)).toBe('hello');
});

it('creates the directories a new path needs', async () => {
  const ctx = await hostFor(fixture('plain'));
  await ctx.files.write('deep/er/still/x.txt', bytes('x'));
  const { entries } = await ctx.files.tree();
  expect(entries.map((e) => e.path)).toContain('deep/er/still/x.txt');
});

it('replaces an existing file whole', async () => {
  const ctx = await hostFor(fixture('plain'));
  await ctx.files.write('a.txt', bytes('first'));
  await ctx.files.write('a.txt', bytes('second'));
  const back = await ctx.files.read('a.txt');
  expect(new TextDecoder().decode(back.bytes!)).toBe('second');
});

it('refuses to write outside the project, and writes nothing', async () => {
  // Проверка удержания при записи отличается от чтения: файла ещё нет,
  // поэтому `realpath` берётся у ближайшего существующего предка.
  const dir = fixture('plain');
  const ctx = await hostFor(dir);
  const { diagnostics } = await ctx.files.write('../escaped.txt', bytes('x'));
  expect(diagnostics[0].message).toMatch(/outside the project/i);
  expect(existsSync(join(dir, '..', 'escaped.txt'))).toBe(false);
});

it('refuses to write THROUGH a symlink that leads out', async () => {
  const dir = fixture('plain');
  mkdirSync(join(dir, 'sub'));
  symlinkSync(tmpdir(), join(dir, 'sub', 'out'));
  const ctx = await hostFor(dir);
  const { diagnostics } = await ctx.files.write('sub/out/escaped.txt', bytes('x'));
  expect(diagnostics[0].message).toMatch(/outside the project/i);
  expect(existsSync(join(tmpdir(), 'escaped.txt'))).toBe(false);
});

it('removes a file', async () => {
  const ctx = await hostFor(fixture('plain'));
  await ctx.files.write('gone.txt', bytes('x'));
  const { diagnostics } = await ctx.files.remove('gone.txt');
  expect(diagnostics).toEqual([]);
  const { entries } = await ctx.files.tree();
  expect(entries.map((e) => e.path)).not.toContain('gone.txt');
});

it('removing what is not there says so instead of pretending it worked', async () => {
  const ctx = await hostFor(fixture('plain'));
  const { diagnostics } = await ctx.files.remove('never-existed.txt');
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].message).toContain('never-existed.txt');
});

it('refuses to remove a directory, naming what it is', async () => {
  // Удаление каталога — другое намерение с другой ценой ошибки.
  const dir = fixture('plain');
  const ctx = await hostFor(dir);
  const { diagnostics } = await ctx.files.remove('game');
  expect(diagnostics[0].message).toMatch(/directory/i);
  expect(existsSync(join(dir, 'game'))).toBe(true);
});

it('refuses to remove outside the project', async () => {
  const ctx = await hostFor(fixture('plain'));
  const { diagnostics } = await ctx.files.remove('../../../etc/hosts');
  expect(diagnostics[0].message).toMatch(/outside the project/i);
});
```

- [ ] **Шаг 2–4: Прогнать, реализовать, прогнать**

Удержание при записи — не то же, что при чтении, и это единственная новая мысль в задаче. Файла ещё нет, поэтому `realpath` его самого бросит. Проверяйте ближайший **существующий** предок и убеждайтесь, что он внутри; иначе символическая ссылка в середине пути проведёт запись наружу, а проверка её не заметит.

- [ ] **Шаг 5: Мутации**

Проверяйте по самому пути вместо предка → покраснеет тест записи через ссылку. Разрешите удаление каталога → покраснеет его тест. Сделайте удаление отсутствующего молчаливым → покраснеет его тест.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/host
git commit -m "The host can write the project, and refuses every way out of it"
```

---

## Task 3: Маршруты

**Files:**
- Modify: `engine/ide/host/src/plugins/files.ts`, `engine/ide/host/tests/files.test.ts`

**Interfaces:**
```
GET    /api/files            → { entries: FileEntry[], diagnostics: Diagnostic[] }
GET    /api/files/*          → тело файла, `Content-Type` по расширению
PUT    /api/files/*          → { base64: string } → { diagnostics: Diagnostic[] }
DELETE /api/files/*          → { diagnostics: Diagnostic[] }
```

- [ ] **Шаг 1: Падающие тесты**

```ts
it('GET /api/files returns the tree', async () => {
  const host = await startHost(fixture('plain'));
  const body = await (await fetch(`${host.url}/api/files`)).json();
  expect(body.entries.map((e) => e.path)).toContain('game/script.spin');
});

it('GET /api/files/* returns the bytes', async () => {
  const host = await startHost(fixture('plain'));
  const res = await fetch(`${host.url}/api/files/game/spec.json`);
  expect(res.status).toBe(200);
  expect(JSON.parse(await res.text()).id).toBe('first-slot');
});

it('a refused path answers with a diagnostic body, not an empty 500', async () => {
  // Пустой 500 уже стоил этой ветке одного среза: строка-соседка
  // теряла данные вместе с виноватой. Отказ — это данные.
  const host = await startHost(fixture('plain'));
  const res = await fetch(`${host.url}/api/files/../../../etc/passwd`);
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.diagnostics[0].message).toMatch(/outside the project/i);
});

it('PUT writes what it was given', async () => {
  const host = await startHost(fixture('plain'));
  const res = await fetch(`${host.url}/api/files/art/x.txt`, {
    method: 'PUT',
    body: JSON.stringify({ base64: btoa('hello') }),
  });
  expect((await res.json()).diagnostics).toEqual([]);
  expect(readFileSync(join(dir, 'art/x.txt'), 'utf8')).toBe('hello');
});

it('a PUT with a body that is not base64 says so and writes nothing', async () => {
  const host = await startHost(fixture('plain'));
  const res = await fetch(`${host.url}/api/files/art/x.txt`, {
    method: 'PUT',
    body: JSON.stringify({ base64: 'not really base64!!!' }),
  });
  expect((await res.json()).diagnostics).toHaveLength(1);
  expect(existsSync(join(dir, 'art/x.txt'))).toBe(false);
});

it('a PUT with no body at all is a diagnostic, not a crash', async () => {
  const host = await startHost(fixture('plain'));
  const res = await fetch(`${host.url}/api/files/art/x.txt`, { method: 'PUT' });
  expect(res.status).toBe(400);
  expect((await res.json()).diagnostics).toHaveLength(1);
});

it('DELETE removes it', async () => {
  const host = await startHost(fixture('plain'));
  writeFileSync(join(dir, 'bye.txt'), 'x');
  const res = await fetch(`${host.url}/api/files/bye.txt`, { method: 'DELETE' });
  expect((await res.json()).diagnostics).toEqual([]);
  expect(existsSync(join(dir, 'bye.txt'))).toBe(false);
});

it('serves an image with an image content type, so the screen can show it', async () => {
  const host = await startHost(fixture('with-png'));
  const res = await fetch(`${host.url}/api/files/art/logo.png`);
  expect(res.headers.get('content-type')).toBe('image/png');
});
```

- [ ] **Шаг 2–4: Прогнать, реализовать, прогнать**

Разбор тела оборачивается в `try`, как `dev-game.ts:297-302`. Отсутствующее или неразбираемое тело — диагностика, не бросок.

- [ ] **Шаг 5: Мутации**

Снимите `try` вокруг разбора тела → покраснеет тест пустого тела. Отдавайте `500` без тела на отказе → покраснеет тест диагностического тела. Отдавайте всё как `application/octet-stream` → покраснеет тест типа картинки.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/host
git commit -m "Four routes over the project's files, each answering with data when it refuses"
```

---

## Task 4: Клиентский `files`

**Files:**
- Create: `engine/ide/client/src/plugins/files.ts`, `engine/ide/client/tests/files.test.ts`
- Modify: `engine/ide/client/src/index.ts`, `engine/ide/client/src/context.ts`

**Interfaces:**
```ts
export interface FilesService {
  tree(): Promise<{ entries: FileEntry[]; diagnostics: Diagnostic[] }>;
  read(path: string): Promise<{ bytes?: Uint8Array; diagnostics: Diagnostic[] }>;
  write(path: string, bytes: Uint8Array): Promise<{ diagnostics: Diagnostic[] }>;
  remove(path: string): Promise<{ diagnostics: Diagnostic[] }>;
  /** Адрес для `<img src>` — читать байты ради показа не нужно. */
  urlFor(path: string): string;
}

declare module 'cordis' {
  interface Context { files: FilesService }
}

export const name = 'files';
export function apply(ctx: Context, config?: { fetchFn?: typeof fetch }): void;
```

**Interfaces consumed:** `FileEntry` из `@energy8engine/contracts`.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('asks the host for the tree and hands back what it got', async () => {
  const ctx = harness({ fetchFn: jsonOnce({ entries: [{ path: 'a.txt', kind: 'file', size: 3 }], diagnostics: [] }) });
  const { entries } = await ctx.files.tree();
  expect(entries.map((e) => e.path)).toEqual(['a.txt']);
});

it('a host that answers with diagnostics passes them through unchanged', async () => {
  // Клиент не переписывает чужие сообщения: их составил тот, кто знает
  // причину.
  const said = d('the project directory is gone');
  const ctx = harness({ fetchFn: jsonOnce({ entries: [], diagnostics: [said] }) });
  const { diagnostics } = await ctx.files.tree();
  expect(diagnostics).toEqual([said]);
});

it('a host that does not answer at all is a diagnostic of the client’s own', async () => {
  // Сеть упала. Молчание — не пустое дерево.
  const ctx = harness({ fetchFn: () => Promise.reject(new Error('offline')) });
  const { entries, diagnostics } = await ctx.files.tree();
  expect(entries).toEqual([]);
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].message).toContain('offline');
});

it('a body that is not the shape we asked for is a diagnostic, not a crash', async () => {
  const ctx = harness({ fetchFn: async () => new Response('<html>nope</html>') });
  const { diagnostics } = await ctx.files.tree();
  expect(diagnostics).toHaveLength(1);
});

it('urlFor escapes a path with a space in it', async () => {
  expect(ctx.files.urlFor('art/my logo.png')).toBe('/api/files/art/my%20logo.png');
});

it('is on the context the real createIdeClient hands back', async () => {
  // `layout` в прошлом срезе доказал сервис, которого не было в
  // `createIdeClient` — все тесты зелёные, приложение без сервиса.
  const ctx = await createIdeClient({ url: 'ws://localhost:1/ide' });
  expect(typeof ctx.files.tree).toBe('function');
});
```

- [ ] **Шаг 2–4: Прогнать, реализовать, прогнать**

Составьте `files` в `createIdeClient` (`engine/ide/client/src/context.ts`) и убедитесь тестом через **настоящий** `createIdeClient`, что `ctx.files` там есть. В прошлом срезе `layout` был доказан всеми юнит-тестами и отсутствовал в работающем приложении.

- [ ] **Шаг 5: Мутации**

Уберите `files` из `createIdeClient` → покраснеет тест через настоящий клиент. Снимите обёртку вокруг `fetch` → покраснеет тест упавшей сети. Снимите экранирование пути → покраснеет тест пробела.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client
git commit -m "The editor can ask the host about the project's files"
```

---

## Task 5: Экран «Ассеты»

**Files:**
- Create: `engine/ide/client/src/screens/AssetsScreen.tsx`, `engine/ide/client/tests/assets-screen.test.tsx`
- Modify: `engine/ide/client/src/index.ts`, `engine/apps/web/src/App.tsx`, `engine/apps/web/tests/App.test.tsx`

**Interfaces:**
```ts
export function AssetsScreen({ ctx }: { ctx: Context }): JSX.Element;
```

Заголовок экрана — `Ассеты`, как `Состав` и `Превью`: заголовки в этом интерфейсе русские, подписи внутри следуют своим английским соседям. `order` ставит его после превью.

- [ ] **Шаг 1: Падающие тесты**

```tsx
it('draws the project tree, directories before their files', async () => {
  render(<AssetsScreen ctx={harness(tree(['game', 'game/spec.json', 'index.html']))} />);
  expect(await screen.findAllByTestId(/^entry-/)).toHaveLength(3);
});

it('an empty project says it is empty instead of drawing nothing', async () => {
  render(<AssetsScreen ctx={harness(tree([]))} />);
  expect(await screen.findByTestId('assets-empty')).toBeTruthy();
});

it('a tree that could not be read shows the host’s own words', async () => {
  const ctx = harness({ diagnostics: [d('the project directory is gone')] });
  render(<AssetsScreen ctx={ctx} />);
  expect(await screen.findByText(/the project directory is gone/)).toBeTruthy();
});

it('clicking an image entry shows it, without reading its bytes', async () => {
  // `urlFor` существует ровно для этого: картинку показывает браузер.
  const ctx = harness(tree(['art/logo.png']));
  render(<AssetsScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('entry-art/logo.png'));
  expect(screen.getByRole('img').getAttribute('src')).toBe('/api/files/art/logo.png');
});

it('clicking a text entry shows its text', async () => {
  const ctx = harness(tree(['game/spec.json']), { 'game/spec.json': '{"id":"first-slot"}' });
  render(<AssetsScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('entry-game/spec.json'));
  expect(await screen.findByText(/first-slot/)).toBeTruthy();
});

it('a file too big to show says so instead of hanging', async () => {
  // ponytail: порог, а не потоковая отдача. Потоки — когда начнут
  // возить видео.
  const ctx = harness(tree([{ path: 'big.bin', kind: 'file', size: 50_000_000 }]));
  render(<AssetsScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('entry-big.bin'));
  expect(await screen.findByTestId('too-big')).toBeTruthy();
});

it('the screen survives a file that vanishes between listing and reading', async () => {
  // Дерево — снимок. Между щелчком и чтением файл могли удалить.
  const ctx = harness(tree(['gone.txt']), {});   // читается — но его уже нет
  render(<AssetsScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('entry-gone.txt'));
  expect(await screen.findByText(/gone\.txt/)).toBeTruthy();
  expect(screen.getByTestId('entry-gone.txt')).toBeTruthy();  // экран цел
});
```

- [ ] **Шаг 2–4: Прогнать, реализовать, прогнать**

- [ ] **Шаг 5: Мутации**

Снимите пустой случай → покраснеет его тест. Показывайте картинку через `read()` вместо `urlFor` → покраснеет тест `src`. Уроните диагностики дерева → покраснеет их тест.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client engine/apps/web
git commit -m "The assets screen shows the project as it is on disk"
```

---

## Task 6: Загрузка и удаление

**Files:**
- Modify: `engine/ide/client/src/screens/AssetsScreen.tsx`, `engine/ide/client/tests/assets-screen.test.tsx`

- [ ] **Шаг 1: Падающие тесты**

```tsx
it('uploading a file puts it where the tree says it went', async () => {
  const ctx = harness(tree([]));
  render(<AssetsScreen ctx={ctx} />);
  await userEvent.upload(screen.getByTestId('upload'), new File(['x'], 'logo.png', { type: 'image/png' }));
  expect(ctx.files.written).toEqual([['logo.png', bytes('x')]]);
});

it('the tree refreshes after an upload, without a page reload', async () => {
  // Иначе загруженное видно только после перезагрузки, и человек грузит
  // второй раз.
  const ctx = harness(tree([]));
  render(<AssetsScreen ctx={ctx} />);
  ctx.files.nextTree(tree(['logo.png']));
  await userEvent.upload(screen.getByTestId('upload'), new File(['x'], 'logo.png'));
  expect(await screen.findByTestId('entry-logo.png')).toBeTruthy();
});

it('an upload the host refuses shows the host’s words and leaves the tree alone', async () => {
  const ctx = harness(tree([]), {}, { writeDiagnostics: [d('outside the project')] });
  render(<AssetsScreen ctx={ctx} />);
  await userEvent.upload(screen.getByTestId('upload'), new File(['x'], 'logo.png'));
  expect(await screen.findByText(/outside the project/)).toBeTruthy();
  expect(screen.queryByTestId('entry-logo.png')).toBeNull();
});

it('deleting asks first, and does nothing when the answer is no', async () => {
  // Удаление необратимо. Единственное место в этом экране, где
  // подтверждение стоит своей цены.
  const ctx = harness(tree(['logo.png']));
  render(<AssetsScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('delete-logo.png'));
  await userEvent.click(screen.getByTestId('confirm-no'));
  expect(ctx.files.removed).toEqual([]);
  expect(screen.getByTestId('entry-logo.png')).toBeTruthy();
});

it('deleting removes the entry from the tree', async () => {
  const ctx = harness(tree(['logo.png']));
  render(<AssetsScreen ctx={ctx} />);
  ctx.files.nextTree(tree([]));
  await userEvent.click(await screen.findByTestId('delete-logo.png'));
  await userEvent.click(screen.getByTestId('confirm-yes'));
  expect(ctx.files.removed).toEqual(['logo.png']);
  await waitFor(() => expect(screen.queryByTestId('entry-logo.png')).toBeNull());
});

it('a delete the host refuses leaves the entry where it was', async () => {
  const ctx = harness(tree(['game']), {}, { removeDiagnostics: [d('game is a directory')] });
  render(<AssetsScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('delete-game'));
  await userEvent.click(screen.getByTestId('confirm-yes'));
  expect(await screen.findByText(/is a directory/)).toBeTruthy();
  expect(screen.getByTestId('entry-game')).toBeTruthy();
});
```

- [ ] **Шаг 2–4: Прогнать, реализовать, прогнать**

- [ ] **Шаг 5: Мутации**

Снимите обновление дерева после загрузки → покраснеет его тест. Сделайте удаление без подтверждения → покраснеет его тест. Убирайте запись из дерева до ответа хоста → покраснеет тест отказа.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client
git commit -m "Files arrive and leave from the screen, and the tree keeps up"
```

---

## Task 7: Панель диагностик становится хромом

**Files:**
- Modify: `engine/ide/client/src/screens/Layout.tsx`, `engine/apps/web/src/App.tsx`, `engine/ide/client/tests/layout.test.tsx`, `engine/apps/web/tests/App.test.tsx`

Долг Среза 4, пункт 2. Панель — карточка экрана состава, `<Layout/>` монтирует только текущий экран, поэтому при открытой стене превью список недоступен, а уход к нему размонтирует все плитки. Приёмка прошлого среза вынуждена открывать вторую страницу браузера.

**Решение:** панель переезжает в `<Layout/>`, ниже текущего экрана. Регистрация `composition.card` уходит из `App.tsx`. Карточки как механизм остаются — уходит одна карточка, не механизм.

- [ ] **Шаг 1: Падающие тесты**

```tsx
it('the panel is visible on every screen, not only on composition', async () => {
  const ctx = harness();
  ctx.layout.screen({ id: 'other', title: 'Other' }, () => <div>OTHER</div>);
  render(<Layout ctx={ctx} />);
  await userEvent.click(screen.getByTestId('tab-other'));
  expect(screen.getByTestId('diagnostics-panel')).toBeTruthy();
});

it('the panel survives a change of screen without losing what it held', async () => {
  // Это и есть смысл переезда: список переживает навигацию.
  const ctx = harness();
  ctx.layout.screen({ id: 'other', title: 'Other' }, () => <div>OTHER</div>);
  ctx.connection.report(d('something went wrong'));
  render(<Layout ctx={ctx} />);
  await userEvent.click(screen.getByTestId('tab-other'));
  expect(screen.getByText(/something went wrong/)).toBeTruthy();
});

it('the composition screen no longer registers the panel as a card', () => {
  const ctx = harness();
  render(<App ctx={ctx} />);
  expect(ctx.slots.list('composition.card').map((c) => c.key)).not.toContain('diagnostics');
});

it('composition.card still works for anything else', () => {
  // Уходит одна карточка, не механизм.
  const ctx = harness();
  ctx.slots.register({ name: 'composition.card', key: 'other' }, () => <div>CARD</div>);
  render(<Layout ctx={ctx} />);
  expect(screen.getByText('CARD')).toBeTruthy();
});

it('a crashed screen does not take the panel with it', async () => {
  // Панель важнее всего именно тогда, когда что-то сломалось.
  const ctx = harness();
  ctx.layout.screen({ id: 'bad', title: 'Bad' }, () => { throw new Error('boom'); });
  render(<Layout ctx={ctx} />);
  expect(screen.getByTestId('screen-error')).toBeTruthy();
  expect(screen.getByTestId('diagnostics-panel')).toBeTruthy();
});
```

- [ ] **Шаг 2–4: Прогнать, реализовать, прогнать**

- [ ] **Шаг 5: Мутации**

Верните панель в карточки → покраснеет тест «видна на каждом экране». Поставьте её **внутрь** границы ошибки → покраснеет тест упавшего экрана.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client engine/apps/web
git commit -m "The one list outlives the screen you happen to be looking at"
```

---

## Task 8: Приёмка

**Files:**
- Create: `engine/apps/web/tests/e2e/assets.spec.ts`
- Modify: `engine/apps/web/tests/e2e/screens.spec.ts` — там, где Срез 4 открывал вторую страницу браузера ради панели, теперь не нужно; уберите обход и объясните в комментарии, что его заменило

Приёмка **не имеет права** исключать класс случаев на том основании, что он «и так работает». Это стоило Срезу 2 половины ценности, а Срез 3 едва не повторил. Скажите в отчёте, какие случаи рассмотрены и почему каждый внутри или снаружи.

- [ ] **Шаг 1: Тесты**

```ts
test('the assets screen shows the real project on disk', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/#/assets');
    await expect(page.getByTestId('entry-game/script.spin')).toBeVisible();
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('a file uploaded through the screen is on disk afterwards', async ({ page }) => {
  // Через живой хост и настоящий браузер: экран, маршрут, диск.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/#/assets');
    await page.getByTestId('upload').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG_BYTES });
    await expect(page.getByTestId('entry-logo.png')).toBeVisible();
    expect(existsSync(join(dir, 'logo.png'))).toBe(true);
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('a file deleted through the screen is gone from disk', async ({ page }) => {
  const dir = projectCopy();
  writeFileSync(join(dir, 'bye.txt'), 'x');
  const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/#/assets');
    await page.getByTestId('delete-bye.txt').click();
    await page.getByTestId('confirm-yes').click();
    await expect(page.getByTestId('entry-bye.txt')).toHaveCount(0);
    expect(existsSync(join(dir, 'bye.txt'))).toBe(false);
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('a path that climbs out of the project is refused, and says why', async ({ page }) => {
  // §8 буквально: отказ доходит до человека словами. Через маршрут,
  // потому что экран такой путь построить не даёт — а curl даёт.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    const res = await page.request.get(`${host.url}/api/files/../../../etc/passwd`);
    expect(res.status()).toBe(400);
    expect((await res.json()).diagnostics[0].message).toMatch(/outside the project/i);
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('the diagnostics panel is visible while the preview wall is open', async ({ page }) => {
  // Долг Среза 4. Прошлая приёмка вынуждена была открывать вторую
  // страницу; эта проверяет, что вторая больше не нужна.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/#/preview');
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible();
    await expect(page.getByTestId('diagnostics-panel')).toBeVisible();
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Шаг 2: Прогнать в одиночку**

В одиночку от любой корневой команды `npm`. Потом перечислить процессы и убедиться, что не осталось `engine/examples/e8-compose-*`.

- [ ] **Шаг 3: Подтвердить, что каждый тест упал бы без среза**

Откатите нужную часть и убедитесь, что тест краснеет. Зелёный приёмочный тест, который был бы зелёным и без среза, не доказывает ничего.

- [ ] **Шаг 4: Коммит**

```bash
git add engine/apps/web
git commit -m "Acceptance: the project is editable, and the one list is always there"
```
