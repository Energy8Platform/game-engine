# Срез 1a: проект собирает игру — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Игра перестаёт быть привилегированным ядром: её состав читается из формата проекта (профиль + бандлы + патч), а плагины догружаются в браузер по сети, а не вшиваются в бандл статическими импортами.

**Architecture:** Хост разрешает `e8.profile.yml` + бандлы + `e8.patch.yml` в плоский упорядоченный список строк состава и отдаёт его игре по HTTP. Браузерный загрузчик динамически импортирует `./runtime`-половину каждой строки и собирает из них cordis-контекст — ровно тем механизмом, которым IDE уже грузит `./client`-половины через `/plugin-client/:id`. Выбор провайдера шва (`renderer`, `session`) переезжает с зашитого импорта на объявленный матчер.

**Tech Stack:** TypeScript, cordis 4.0.0-rc.8, `@cordisjs/plugin-loader`, `@cordisjs/plugin-server`, vite 6, vitest 2, Playwright, YAML.

**Spec:** `docs/superpowers/specs/2026-08-27-slot-webide-cordis-design.md` — фазы §11.3 (проект: профиль, бандлы, патчи) и §5.4 (швы способностей). Долг, который этот план закрывает, описан в `docs/superpowers/notes/2026-08-31-runtime-carried-forward.md`, пункты 1 и частично 4.

**Предшествующая работа:** Срез 0 (`docs/superpowers/plans/2026-08-27-slot-webide-skeleton.md`, `2026-08-28-slot-webide-runtime.md`). Ветка `feat/slot-webide-cordis`.

---

## Global Constraints

Действуют на каждую задачу, повторять в брифах не нужно — но нарушение любой из них ревьюер обязан считать дефектом.

- Новый код живёт **только** в `engine/`. `packages/*` и верхнеуровневый `examples/*` — легаси: их можно **читать и импортировать**, но не редактировать.
- Скоуп пакетов — `@energy8engine/*`. Имя каждого нового пакета **уникально во всей монорепе** (корневой `workspaces` включает `engine/*/*`, и коллизия имён перевешивает симлинки в `node_modules` — этим уже был потерян день в Срезе 0).
- Комментарии и сообщения коммитов — **на английском**. Сообщения коммитов — короткие повествовательные предложения в голосе репозитория (`git log --oneline -20`), а не conventional-commit с номерами тикетов.
- **Контракты — словари, плагины — решения.** `engine/core/contracts` не импортирует ничего, кроме своих же относительных модулей; это проверяется тестом чистоты. Всё, что делает выбор, — плагин.
- **Отказ — это данные.** Швы хоста и рантайма возвращают `Diagnostic[]`, а не бросают. Ни один путь не должен приводить к белому прямоугольнику.
- Тесты запускаются **по рабочим пространствам**: `npm test --workspace @energy8engine/<pkg>`. Корневой `npm test` не запускать: три легаси-пакета падают по причинам окружения, к работе отношения не имеющим (`create-slot` — дрейф версий; `stake-bridge`/`stake-math-tools` — npm не ставит `execa` для их `vitest@1.6.1`).
- Playwright в `engine/apps/web` держит фиксированные порты и `workers: 1`. Не запускать параллельно с чем-либо ещё; после прогона проверять осиротевшие процессы `e8-server`/vite.
- `session-dev` импортируется **лениво** и только под условием `config.session`: его граф модулей тянет `node:child_process`/`node:fs`/`node:net`, и статический импорт роняет весь браузерный бандл ещё до вызова `createGame` (измерено в Срезе 0).

---

## Проверенные факты

Всё ниже **измерено** на текущем HEAD, а не восстановлено по памяти. Расхождение кода с этим разделом — повод остановиться и сказать, а не подгонять.

### Прецедент подгрузки половины плагина уже работает

`engine/ide/host/src/plugins/client-assets.ts:23` отдаёт `GET /plugin-client/:id`: находит запись загрузчика по id, читает `package.json` пакета, разбирает манифест и отдаёт файл, указанный в `e8.client.entry`. Браузерная сторона — `engine/ide/client/src/plugins/modules.ts:45-59`: динамический `import(/* @vite-ignore */ url)`, затем `module.apply?.(ctx)`. Модуль без `apply` — не ошибка, а no-op. Ошибка импорта становится диагностикой, и повтор ограничен ровно одной лишней попыткой за цикл.

**Это тот же механизм, который нужен игре.** Отличие одно: другая половина экспорта (`./runtime` вместо `./client`) и другой контекст, в который её применяют.

### Манифест сегодня не знает про рантайм-половину

`engine/core/contracts/src/manifest.ts` объявляет `E8Manifest = { client?: E8ClientHalf; hot: boolean }`. Поля `runtime` нет. Его добавление — расширение словаря, а не решение.

### Игра сегодня не читает ни одного файла

`engine/game/runtime/src/index.ts` статически импортирует обе механики, `renderer-pixi`, `stage`, `reels`, `boot` и жёстко перечисляет их в `createGame`. Конфигурация приходит **объектом JS** из `engine/examples/first-slot/src/main.ts:67`. Ни один модуль под `engine/game/**` не читает `e8.yml`.

`engine/examples/first-slot/e8.yml` содержит **одну** строку — `bridge1` → `@energy8engine/ide-bridge` с конфигом `{ base_game: classic }`, и её собирает загрузчик **хоста**, где `ide-bridge` — честный no-op. Настоящая работа моста происходит в браузере, куда его применяет `main.ts` вручную.

### Как игра и IDE доезжают до браузера

`e8 dev` поднимает `createIdeHost` **плюс** `dev-game` на порту **5679**; `dev-game` вешает catch-all маршрут vite-middleware на `/`, поэтому под одним только `e8 dev` никакого SPA редактора нет — там отдаётся игра. Редактор поднимается отдельным vite на **5680** (`engine/apps/web/vite.config.ts`) и проксирует `/api`, `/plugin-client` и сокет `/ide` на 5679.

Порт 5679 зашит в четырёх местах (`ide-host` по умолчанию, прокси vite, `computePreviewUrl`, конфиг Playwright). Этот план его не трогает.

### Два пространства имён в `Diagnostic.plugin`

Поле несёт либо id строки состава (сторона хоста, из файла проекта, произвольный текст), либо id шва/механики (сторона игры: `session`, `renderer-pixi`, `classic`). Сегодня они не сталкиваются только потому, что диагностика работающей игры не пересекает сокет `/ide`. **Этот план впервые делает столкновение возможным** — задача 10 выводит состав игры в экран редактора. Разделение обязано стать выраженным в коде, а не только в комментарии.

---

## Структура файлов

| Путь | Ответственность |
|---|---|
| `engine/core/contracts/src/project.ts` | **создать** — словарь формата проекта: `Profile`, `PatchRow`, `ResolvedRow`, `ResolvedComposition` |
| `engine/core/contracts/src/manifest.ts` | изменить — `E8Manifest` получает `runtime?: E8RuntimeHalf` |
| `engine/core/project/` | **создать** пакет `@energy8engine/project` — чистый послойный резолвер, без cordis и без ФС |
| `engine/ide/host/src/plugins/project.ts` | **создать** — читает файлы проекта, разрешает состав, отдаёт `ctx.project` |
| `engine/ide/host/src/plugins/runtime-assets.ts` | **создать** — `GET /api/composition` и `GET /plugin-runtime/:id` |
| `engine/game/loader/` | **создать** пакет `@energy8engine/game-loader` — браузерная сборка контекста из строк состава |
| `engine/game/seam/` | **создать** пакет `@energy8engine/seam` — выбор провайдера по матчеру |
| `engine/game/runtime/src/index.ts` | изменить — `createGame` делегирует загрузчику, зашитый состав удаляется |
| `engine/bundles/e8-base/` | **создать** — бандл базового состава игры |
| `engine/examples/first-slot/e8.profile.yml`, `e8.patch.yml` | **создать** — профиль и патч эталонной игры |
| `engine/apps/web/tests/e2e/composition.spec.ts` | **создать** — приёмка: правка профиля меняет работающую игру |

---

## Task 1: Спайк — браузер импортирует рантайм-половину, отданную хостом

**Зачем первой.** §11 спеки: «Первым делом **не ядро**, а самый неизвестный кусок». Весь план стоит на допущении, что браузер под vite сможет динамически импортировать модуль, который хост отдаёт по своему маршруту. Прецедент есть для `./client`-половины редактора, но игра отдаётся **другим** сервером (`dev-game`'s vite-middleware), и это отличие непроверено. Если допущение ложно — мы узнаём это сейчас, за одну задачу, а не на девятой.

**Это спайк.** Его продукт — ответ, а не код, который мы храним. Всё написанное помечается как одноразовое и удаляется в задаче 5, кроме того, что задача 5 явно заберёт.

**Files:**
- Create: `engine/examples/first-slot/probe-runtime-half.mjs` (одноразовый)
- Modify: `engine/ide/host/src/plugins/dev-game.ts` (одноразовый маршрут, помеченный к удалению)

**Interfaces:**
- Consumes: `ctx.server` (уже стоит), `dev-game`'s vite middleware
- Produces: **ответ**, записанный в отчёт, плюс, если всё работает, минимальный рабочий образец импорта для задачи 5

- [ ] **Шаг 1: Написать одноразовую рантайм-половину**

`engine/examples/first-slot/probe-runtime-half.mjs` — обычный ESM, без сборки:

```js
// THROWAWAY (task 1 spike). Deleted in task 5.
export function apply(ctx) {
  ctx.__probeApplied = (ctx.__probeApplied ?? 0) + 1;
}
```

- [ ] **Шаг 2: Отдать её с хоста одноразовым маршрутом**

В `dev-game.ts`, рядом с существующими маршрутами, с комментарием `THROWAWAY (task 1 spike)`:

```ts
ctx.server.get('/probe-runtime-half', async (_req, res) => {
  res.headers['content-type'] = 'application/javascript';
  res.body = await readFile(join(config.root, 'probe-runtime-half.mjs'), 'utf8');
});
```

- [ ] **Шаг 3: Импортировать её из браузера и проверить, что она применилась**

Во временный `<script type="module">` в `engine/examples/first-slot/index.html` (пометить `THROWAWAY`):

```js
const mod = await import(/* @vite-ignore */ '/probe-runtime-half');
const probe = {};
mod.apply(probe);
window.__probeResult = probe.__probeApplied;
```

- [ ] **Шаг 4: Наблюдать результат в настоящем браузере**

Одноразовым Playwright-тестом или `node` + `playwright` напрямую: поднять `e8 dev` в `engine/examples/first-slot`, открыть `http://127.0.0.1:5679/`, прочитать `window.__probeResult`.

Ожидание: `1`.

**Если не `1`** — это и есть результат спайка. Зафиксировать точную ошибку из консоли браузера и сети. Наиболее вероятные причины, каждую проверить отдельно: vite перехватывает маршрут своим catch-all раньше хоста; отсутствующий или неверный `content-type`; vite переписывает спецификатор несмотря на `@vite-ignore`; CORS между 5680 и 5679.

- [ ] **Шаг 5: Ответить на вопрос письменно**

В отчёт — прямым текстом, а не намёком:
1. Импортируется ли рантайм-половина, отданная хостом, в браузере под `e8 dev`? Да/нет.
2. Если да — какой ровно URL и заголовки сработали.
3. Если нет — что именно помешало и какой обходной путь вы **проверили** (не предположили).
4. Работает ли то же самое, когда страница открыта через прокси редактора на 5680, а не напрямую на 5679? Это разные origin, и задача 11 будет ходить именно через 5680.

- [ ] **Шаг 6: Коммит**

```bash
git add -A
git commit -m "Spike: can the browser import a runtime half the host serves?"
```

**Если ответ «нет» и обходного пути не нашлось — остановиться и доложить.** Весь остальной план опирается на этот механизм; строить девять задач поверх опровергнутого допущения нельзя.

---

## Task 2: Словарь формата проекта

**Files:**
- Create: `engine/core/contracts/src/project.ts`
- Modify: `engine/core/contracts/src/manifest.ts`, `engine/core/contracts/src/index.ts`
- Test: `engine/core/contracts/tests/project.test.ts`, существующий `tests/purity.test.ts` должен остаться зелёным

**Interfaces:**
- Consumes: `Diagnostic` из `./diagnostic`
- Produces: типы ниже — их потребляют задачи 3, 4, 5, 6, 10

- [ ] **Шаг 1: Написать падающий тест на форму**

`engine/core/contracts/tests/project.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isResolvedRow, type Profile, type ResolvedComposition } from '../src/project';

describe('project vocabulary', () => {
  it('a resolved row remembers which layer put it there', () => {
    const row = { id: 'reels1', name: '@energy8engine/reels', config: { grid: {} }, from: 'bundle:e8-base' };
    expect(isResolvedRow(row)).toBe(true);
  });

  it('a row without provenance is not a resolved row', () => {
    expect(isResolvedRow({ id: 'reels1', name: '@energy8engine/reels', config: {} })).toBe(false);
  });

  it('rejects a row whose id is not a string', () => {
    expect(isResolvedRow({ id: 1, name: 'x', config: {}, from: 'patch' })).toBe(false);
  });
});
```

- [ ] **Шаг 2: Запустить и убедиться, что падает**

`npm test --workspace @energy8engine/contracts` — ожидание: FAIL, `Cannot find module '../src/project'`.

- [ ] **Шаг 3: Написать словарь**

`engine/core/contracts/src/project.ts`. Импортов, кроме относительных, быть не может — это проверяет тест чистоты.

```ts
/**
 * The project format, as a vocabulary. Nothing here decides anything: the
 * layering RULE (bundles in profile order, then the profile's own patch,
 * then the home patch, then --patch) lives in `@energy8engine/project`, and
 * reading files lives in the host. These are the shapes those two agree on.
 */

/** `e8.profile.yml` — which bundles stack, and in what order. */
export interface Profile {
  bundles: string[];
}

/** One row of `e8.patch.yml` — a delta addressed by row id. */
export interface PatchRow {
  id: string;
  /** Absent when the row only overrides config of a row a bundle already placed. */
  name?: string;
  config?: Record<string, unknown>;
  /** `true` removes a row a bundle placed. */
  remove?: boolean;
}

/**
 * A row after layering, ready to compose. `from` records WHICH layer put it
 * here — the IDE shows it, and a person debugging "why is this plugin
 * loaded" needs it more than any other field.
 */
export interface ResolvedRow {
  id: string;
  name: string;
  config: Record<string, unknown>;
  /** `bundle:<name>` | `patch` | `cli` */
  from: string;
}

export interface ResolvedComposition {
  rows: ResolvedRow[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isResolvedRow(value: unknown): value is ResolvedRow {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    isRecord(value.config) &&
    typeof value.from === 'string'
  );
}
```

- [ ] **Шаг 4: Расширить манифест рантайм-половиной**

В `manifest.ts` — по образцу уже существующего `E8ClientHalf`, включая разбор с диагностиками:

```ts
/** The game half of a plugin, loaded into the running game at runtime. */
export interface E8RuntimeHalf {
  /** Module path inside the package, relative to its root. */
  entry: string;
  /** Runtime services this half needs before it can register anything. */
  inject: string[];
}
```

`E8Manifest` получает `runtime?: E8RuntimeHalf`. Разбор `raw.runtime` повторяет ветку `raw.client` **той же формой и теми же диагностиками** — не обобщайте их в один хелпер «на будущее», если это не выходит короче: две ветки по восемь строк читаются лучше одной параметризованной на двенадцать.

- [ ] **Шаг 5: Тест на разбор рантайм-половины**

Добавить в существующий `tests/manifest.test.ts` пару к каждому уже имеющемуся тесту про `client`: корректный разбор, `entry` не строка → диагностика, отсутствие поля → `manifest.runtime === undefined` без диагностики.

- [ ] **Шаг 6: Экспортировать из индекса**

`engine/core/contracts/src/index.ts` — явный ре-экспорт (не `export *`; так решено в Срезе 0, ruling 6).

- [ ] **Шаг 7: Прогнать тесты и тайпчек**

`npm test --workspace @energy8engine/contracts` — всё зелёное, включая тест чистоты.

- [ ] **Шаг 8: Коммит**

```bash
git add engine/core/contracts
git commit -m "The project format gets a vocabulary, and a plugin gets a runtime half"
```

---

## Task 3: Послойный резолвер

Отдельный пакет, потому что это чистая функция без cordis и без файловой системы: её можно проверить целиком таблицей случаев, и именно она хранит правило, которое иначе размажется по хосту.

**Files:**
- Create: `engine/core/project/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Test: `engine/core/project/tests/resolve.test.ts`

**Interfaces:**
- Consumes: `Profile`, `PatchRow`, `ResolvedRow`, `ResolvedComposition`, `Diagnostic`, `diagnostic` из `@energy8engine/contracts`
- Produces:
  ```ts
  interface Bundle { name: string; rows: { id: string; name: string; config?: Record<string, unknown> }[] }
  function resolveComposition(input: {
    profile: Profile;
    bundles: Map<string, Bundle>;
    patches: { layer: string; rows: PatchRow[] }[];
  }): { composition: ResolvedComposition; diagnostics: Diagnostic[] }
  ```

**Правило слоёв, дословно из §6 спеки:** бандлы в порядке профиля → патч профиля → домашний патч → `--patch` из CLI. Патч адресует строки по id, заменяя конфиг целиком или вставляя новую строку.

- [ ] **Шаг 1: Написать падающие тесты — таблицей случаев**

`engine/core/project/tests/resolve.test.ts`. Каждый случай отвечает на вопрос, который иначе решался бы догадкой:

```ts
import { describe, expect, it } from 'vitest';
import { resolveComposition } from '../src/index';

const base = { name: 'e8-base', rows: [
  { id: 'boot1', name: '@energy8engine/boot' },
  { id: 'reels1', name: '@energy8engine/reels', config: { speed: 1 } },
]};

describe('resolveComposition', () => {
  it('stacks bundles in profile order', () => {
    const extra = { name: 'e8-extra', rows: [{ id: 'x1', name: '@e/x' }] };
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base', 'e8-extra'] },
      bundles: new Map([['e8-base', base], ['e8-extra', extra]]),
      patches: [],
    });
    expect(composition.rows.map((r) => r.id)).toEqual(['boot1', 'reels1', 'x1']);
  });

  it('records which bundle placed each row', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] }, bundles: new Map([['e8-base', base]]), patches: [],
    });
    expect(composition.rows[0].from).toBe('bundle:e8-base');
  });

  it('a patch REPLACES a row config wholesale, it does not merge', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [{ layer: 'patch', rows: [{ id: 'reels1', config: { grid: 5 } }] }],
    });
    const reels = composition.rows.find((r) => r.id === 'reels1')!;
    expect(reels.config).toEqual({ grid: 5 });   // NOT { speed: 1, grid: 5 }
    expect(reels.from).toBe('patch');
  });

  it('a patch can insert a row the bundles never placed', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [{ layer: 'patch', rows: [{ id: 'new1', name: '@e/new', config: {} }] }],
    });
    expect(composition.rows.at(-1)).toMatchObject({ id: 'new1', from: 'patch' });
  });

  it('a patch can remove a row a bundle placed', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [{ layer: 'patch', rows: [{ id: 'reels1', remove: true }] }],
    });
    expect(composition.rows.map((r) => r.id)).toEqual(['boot1']);
  });

  it('later patch layers win over earlier ones', () => {
    const { composition } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [
        { layer: 'patch', rows: [{ id: 'reels1', config: { a: 1 } }] },
        { layer: 'cli', rows: [{ id: 'reels1', config: { a: 2 } }] },
      ],
    });
    expect(composition.rows.find((r) => r.id === 'reels1')!.config).toEqual({ a: 2 });
    expect(composition.rows.find((r) => r.id === 'reels1')!.from).toBe('cli');
  });

  it('a missing bundle is a diagnostic, not a throw', () => {
    const { composition, diagnostics } = resolveComposition({
      profile: { bundles: ['e8-base', 'nope'] },
      bundles: new Map([['e8-base', base]]),
      patches: [],
    });
    expect(composition.rows.map((r) => r.id)).toEqual(['boot1', 'reels1']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('nope');
  });

  it('patching a row that does not exist and gives no name is a diagnostic', () => {
    const { diagnostics } = resolveComposition({
      profile: { bundles: ['e8-base'] },
      bundles: new Map([['e8-base', base]]),
      patches: [{ layer: 'patch', rows: [{ id: 'ghost', config: {} }] }],
    });
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('ghost');
  });

  it('two bundles placing the same id is a diagnostic; the later one wins', () => {
    const clash = { name: 'e8-clash', rows: [{ id: 'reels1', name: '@e/other' }] };
    const { composition, diagnostics } = resolveComposition({
      profile: { bundles: ['e8-base', 'e8-clash'] },
      bundles: new Map([['e8-base', base], ['e8-clash', clash]]),
      patches: [],
    });
    expect(composition.rows.find((r) => r.id === 'reels1')!.name).toBe('@e/other');
    expect(diagnostics.some((d) => d.message.includes('reels1'))).toBe(true);
  });
});
```

- [ ] **Шаг 2: Запустить, убедиться, что падает**

`npm test --workspace @energy8engine/project` — ожидание: FAIL, модуль не найден.

- [ ] **Шаг 3: Реализовать резолвер**

`resolveComposition` — чистая функция. Ни `fs`, ни `cordis`, ни `yaml`. Порядок: пройти бандлы в порядке профиля, накапливая строки в `Map<id, ResolvedRow>` с сохранением порядка вставки; затем применить слои патчей по порядку. Отсутствующий бандл, патч в никуда и коллизия id — диагностики, а не исключения; функция всегда возвращает состав, пусть и неполный.

- [ ] **Шаг 4: Прогнать тесты**

`npm test --workspace @energy8engine/project` — 9/9 зелёных.

- [ ] **Шаг 5: Мутационная проверка**

Внести по одной ошибке и убедиться, что её ловит конкретный тест, а не «какой-нибудь»:
1. слить конфиги вместо замены → падает «REPLACES ... wholesale»;
2. применять слои патчей в обратном порядке → падает «later patch layers win»;
3. бросать на отсутствующем бандле → падает «missing bundle is a diagnostic».

Пережившая мутация — дыра в тестах; о ней сказать, а не умолчать.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/core/project
git commit -m "Layer bundles and patches into one ordered composition"
```

---

## Task 4: Хост читает проект

**Files:**
- Create: `engine/ide/host/src/plugins/project.ts`
- Modify: `engine/ide/host/src/index.ts` (поднять плагин в `createIdeHost`)
- Test: `engine/ide/host/tests/project.test.ts`, фикстуры `engine/ide/host/tests/fixtures/project-*/`

**Interfaces:**
- Consumes: `resolveComposition` из `@energy8engine/project`; `Profile`, `PatchRow` из контрактов
- Produces: сервис `ctx.project` со следующей формой — его читают задачи 5 и 10:
  ```ts
  interface ProjectService {
    readonly composition: ResolvedComposition;
    readonly diagnostics: Diagnostic[];
    /** Re-reads the files and re-resolves. Never throws. */
    reload(): Promise<void>;
  }
  ```

**Правило владения фикстурами** (из Среза 0, ruling 6 и 8, действует и здесь): каждый мутирующий тест копирует шаблон фикстуры во **свежий временный каталог** (`mkdtempSync`) и указывает туда `cwd`. Никаких записей в закоммиченную фикстуру с восстановлением после теста — vitest гоняет файлы тестов параллельно, а запись на диск идёт неотслеживаемым `setTimeout(0)`; «восстановим потом» здесь гонка, которая уже один раз испортила фикстуру в репозитории.

- [ ] **Шаг 1: Написать падающие тесты**

`engine/ide/host/tests/project.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('project plugin', () => {
  it('resolves a profile that stacks one bundle', async () => {
    const host = await createIdeHost({ cwd: fixture('project-simple') });
    expect(host.ctx.project.composition.rows.map((r) => r.id)).toEqual(['boot1', 'reels1']);
    await host.stop();
  });

  it('applies e8.patch.yml on top of the bundles', async () => {
    const host = await createIdeHost({ cwd: fixture('project-patched') });
    const reels = host.ctx.project.composition.rows.find((r) => r.id === 'reels1')!;
    expect(reels.config).toEqual({ grid: { cols: 5, rows: 3 } });
    expect(reels.from).toBe('patch');
    await host.stop();
  });

  it('a missing e8.profile.yml is a diagnostic and the host still starts', async () => {
    const host = await createIdeHost({ cwd: fixture('project-none') });
    expect(host.ctx.project.composition.rows).toEqual([]);
    expect(host.ctx.project.diagnostics.some((d) => d.message.includes('e8.profile.yml'))).toBe(true);
    expect(host.url).toBeTruthy();          // it started anyway
    await host.stop();
  });

  it('malformed YAML is a diagnostic naming the file, not a throw', async () => {
    const host = await createIdeHost({ cwd: fixture('project-broken-yaml') });
    expect(host.ctx.project.diagnostics.some((d) => d.where.includes('e8.profile.yml'))).toBe(true);
    await host.stop();
  });

  it('a profile that is not an object with a bundles array is a diagnostic', async () => {
    const host = await createIdeHost({ cwd: fixture('project-wrong-shape') });
    expect(host.ctx.project.diagnostics.some((d) => d.message.includes('bundles'))).toBe(true);
    await host.stop();
  });

  it('reload() picks up an edited patch without restarting the host', async () => {
    const dir = copyFixtureToTemp('project-patched');
    const host = await createIdeHost({ cwd: dir });
    writeFileSync(join(dir, 'e8.patch.yml'), 'rows:\n  - id: reels1\n    config: { grid: 9 }\n');
    await host.ctx.project.reload();
    expect(host.ctx.project.composition.rows.find((r) => r.id === 'reels1')!.config).toEqual({ grid: 9 });
    await host.stop();
  });
});
```

- [ ] **Шаг 2: Запустить, убедиться, что падает по правильной причине**

`npm test --workspace @energy8engine/ide-host`. Ожидание: FAIL — `ctx.project` не существует. Не «модуль не найден в тесте»: если падает импорт самого теста, вы проверяете не то.

- [ ] **Шаг 3: Реализовать плагин**

Читает `<cwd>/e8.profile.yml`, каждый бандл из `<cwd>/node_modules/<name>/e8.bundle.yml` **или** из `engine/bundles/<name>/e8.bundle.yml`, затем `<cwd>/e8.patch.yml`. Разбор YAML — существующая зависимость репозитория, новую не вводить (проверить, что уже есть, прежде чем добавлять).

Три правила, ни одно не выводится из кода само:
1. **Ни один сбой не бросает.** Отсутствующий файл, битый YAML, неверная форма — диагностика в `ctx.project.diagnostics`, а состав остаётся тем, что удалось собрать. Хост стартует всегда: это прямое требование §8 спеки и уже установленный прецедент `createIdeHost` (ruling 4 Среза 0).
2. **`e8.yml` остаётся жив и не трогается.** Он описывает состав *редактора* (строки плагинов IDE), а профиль — состав *игры*. Это разные вещи, и слияние их в этой задаче было бы решением, которое план не принимал.
3. `reload()` не бросает никогда — тот же контракт, что у `connection.update()` в Срезе 0.

- [ ] **Шаг 4: Прогнать тесты**

`npm test --workspace @energy8engine/ide-host` — новые зелёные, **все 43 прежних тоже**. Регресс в прежних — это сигнал, что вы что-то сломали, а не что тест устарел.

- [ ] **Шаг 5: Коммит**

```bash
git add engine/ide/host engine/apps
git commit -m "The host reads the project: profile, bundles, patch"
```

---

## Task 5: Хост отдаёт состав и рантайм-половины

**Files:**
- Create: `engine/ide/host/src/plugins/runtime-assets.ts`
- Modify: `engine/ide/host/src/index.ts`
- Delete: всё одноразовое из задачи 1
- Test: `engine/ide/host/tests/runtime-assets.test.ts`

**Interfaces:**
- Consumes: `ctx.project`, `ctx.server`, `parseManifest`
- Produces: два HTTP-маршрута, их потребляет задача 6:
  - `GET /api/composition` → `{ rows: ResolvedRow[], diagnostics: Diagnostic[] }`
  - `GET /plugin-runtime/:id` → тело модуля `e8.runtime.entry`, `content-type: application/javascript`

**Два факта, измеренные спайком задачи 1 — не выводите их заново, но и не игнорируйте:**

1. **Маршрут обязан терпеть `?import`.** `/* @vite-ignore */` **не** мешает vite переписывать спецификатор динамического импорта: он оборачивает его в `__vite__injectQuery(spec, 'import')`, дописывая `?import` к корне-относительным URL. Маршрут, сопоставляющий путь целиком со строкой запроса, будет 404-ить в браузере, проходя при этом все тесты на `fetch` без запроса. Добавьте тест именно с `?import`.
2. **Добавьте `/plugin-runtime` в список прокси `engine/apps/web/vite.config.ts`**, рядом с уже существующим `/plugin-client`. Игра живёт на 5679, и origin документа в iframe превью — тоже 5679, поэтому обычный путь работает; но документ верхнего уровня на 5680 импортировать с 5679 не может (путь 404-ит, абсолютный URL режется CORS). `/plugin-client` работает сегодня ровно благодаря этой строке прокси. Заголовок `access-control-allow-origin: *` вместо этого не ставить: он раздаёт больше, чем требует задача.

**Образец для подражания — `client-assets.ts`.** Прочитайте его целиком прежде, чем писать: там уже решены 404 на неизвестный id, 404 на пакет без нужной половины, и то, как из `package.json` достаётся путь входа. Ваш маршрут отличается ровно тем, что смотрит в `manifest.runtime`, а не в `manifest.client`, и что id берётся из `ctx.project.composition`, а не из `ctx.loader.entries()`.

- [ ] **Шаг 1: Написать падающие тесты**

```ts
it('serves the resolved composition', async () => {
  const res = await fetch(`${host.url}/api/composition`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.rows.map((r) => r.id)).toEqual(['boot1', 'reels1']);
});

it('carries the project diagnostics with the composition', async () => {
  // fixture with a missing bundle
  const body = await (await fetch(`${host.url}/api/composition`)).json();
  expect(body.diagnostics.length).toBeGreaterThan(0);
});

it('serves a row runtime half as javascript', async () => {
  const res = await fetch(`${host.url}/plugin-runtime/reels1`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('javascript');
  expect(await res.text()).toContain('export');
});

it('serves the same half when vite appends its ?import query', async () => {
  // Measured in the task 1 spike: @vite-ignore does not prevent this.
  const res = await fetch(`${host.url}/plugin-runtime/reels1?import`);
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('javascript');
});

it('404s an unknown row id', async () => {
  expect((await fetch(`${host.url}/plugin-runtime/nope`)).status).toBe(404);
});

it('404s a package with no runtime half, naming the package', async () => {
  const res = await fetch(`${host.url}/plugin-runtime/clientonly1`);
  expect(res.status).toBe(404);
  expect((await res.json()).error).toContain('no runtime half');
});

it('refuses to serve a path that escapes the package root', async () => {
  // a fixture package whose e8.runtime.entry is "../../../etc/passwd"
  expect((await fetch(`${host.url}/plugin-runtime/escapee1`)).status).toBe(404);
});
```

Последний тест — не паранойя, а тот же класс, что уже чинился в Срезе 0 (ruling 11): сравнивать надо **realpath с обеих сторон**, потому что npm-workspaces линкует пакеты симлинками, и наивная проверка префикса сломает все собственные фикстуры.

- [ ] **Шаг 2: Убедиться, что тесты падают**

- [ ] **Шаг 3: Реализовать маршруты**

- [ ] **Шаг 4: Удалить всё одноразовое из задачи 1**

`probe-runtime-half.mjs`, временный маршрут в `dev-game.ts`, временный `<script>` в `index.html`. Спайк дал ответ; код спайка не хранится. Убедиться, что `grep -rn THROWAWAY engine/` ничего не находит.

- [ ] **Шаг 5: Прогнать тесты**

- [ ] **Шаг 6: Коммит**

```bash
git add -A engine/
git commit -m "Serve the composition, and each row's runtime half"
```

---

## Task 6: Браузерный загрузчик

Сердце плана: здесь игра перестаёт знать свой состав заранее.

**Files:**
- Create: `engine/game/loader/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Test: `engine/game/loader/tests/load.test.ts`

**Interfaces:**
- Consumes: `ResolvedRow`, `Diagnostic` из контрактов; `Context` из cordis
- Produces:
  ```ts
  interface LoadOptions {
    /** Base URL of the host. Defaults to the page origin. */
    origin?: string;
    /** Injected for tests; defaults to global fetch. */
    fetchFn?: typeof fetch;
    /** Injected for tests; defaults to a dynamic import. */
    importModule?: (url: string) => Promise<unknown>;
  }
  function composeFromProject(ctx: Context, options?: LoadOptions): Promise<Diagnostic[]>
  ```

**Форма рантайм-половины — и чем она отличается от клиентской.** Клиентская половина редактора вызывается как `apply(ctx)`: её настройки живут в строке состава хоста, которую редактор и так держит. Рантайм-половина получает **два** аргумента:

```ts
export function apply(ctx: Context, config: Record<string, unknown>): void
```

Причина в том, что конфиг строки — это единственное, что отличает `reels1` с сеткой 5×3 от `reels1` с сеткой 6×4, и никакого другого канала до половины у него нет. Расхождение с клиентской половиной намеренное; объявите его комментарием в `loader`, чтобы следующий человек не счёл это опечаткой и не «починил» в одну сторону.

**Правила, каждое из которых куплено кровью в Срезе 0:**
- Функция **никогда не бросает**. Любой сбой — элемент возвращаемого `Diagnostic[]`.
- Половина без `apply` — **no-op, а не ошибка**: она честно загрузилась, ей просто нечего подключать (прецедент — `modules.ts`).
- Синхронный бросок из `apply` ловится так же, как отказ импорта.
- Строки применяются **по порядку** и **последовательно**: состав упорядочен, и `boot` обязан встать раньше того, о чьих сбоях он рассказывает.
- Сбой одной строки **не отменяет остальные** — §8 спеки требует изоляции, а не падения приложения.

- [ ] **Шаг 1: Написать падающие тесты**

```ts
it('applies each row runtime half, in composition order', async () => {
  const order: string[] = [];
  const diags = await composeFromProject(ctx, {
    fetchFn: fakeFetch({ rows: [row('a'), row('b')], diagnostics: [] }),
    importModule: async (url) => ({ apply: () => order.push(url) }),
  });
  expect(order).toEqual(['/plugin-runtime/a', '/plugin-runtime/b']);
  expect(diags).toEqual([]);
});

it('a half with no apply is a no-op, not a failure', async () => {
  const diags = await composeFromProject(ctx, {
    fetchFn: fakeFetch({ rows: [row('a')], diagnostics: [] }),
    importModule: async () => ({}),
  });
  expect(diags).toEqual([]);
});

it('one row failing to import does not stop the next row', async () => {
  const applied: string[] = [];
  const diags = await composeFromProject(ctx, {
    fetchFn: fakeFetch({ rows: [row('a'), row('b')], diagnostics: [] }),
    importModule: async (url) => {
      if (url.endsWith('a')) throw new Error('boom');
      return { apply: () => applied.push(url) };
    },
  });
  expect(applied).toEqual(['/plugin-runtime/b']);
  expect(diags).toHaveLength(1);
  expect(diags[0].plugin).toBe('a');
});

it('apply() throwing synchronously becomes a diagnostic', async () => {
  const diags = await composeFromProject(ctx, {
    fetchFn: fakeFetch({ rows: [row('a')], diagnostics: [] }),
    importModule: async () => ({ apply: () => { throw new Error('nope'); } }),
  });
  expect(diags).toHaveLength(1);
});

it('carries the host project diagnostics through', async () => {
  const diags = await composeFromProject(ctx, {
    fetchFn: fakeFetch({ rows: [], diagnostics: [{ severity: 'error', plugin: 'p', where: 'w', message: 'm' }] }),
    importModule: async () => ({}),
  });
  expect(diags).toHaveLength(1);
});

it('a failed composition fetch is a diagnostic, not a throw', async () => {
  const diags = await composeFromProject(ctx, {
    fetchFn: async () => { throw new Error('offline'); },
    importModule: async () => ({}),
  });
  expect(diags).toHaveLength(1);
  expect(diags[0].message).toContain('offline');
});

it('a row config reaches the half', async () => {
  let seen: unknown;
  await composeFromProject(ctx, {
    fetchFn: fakeFetch({ rows: [{ id: 'a', name: '@e/a', config: { speed: 7 }, from: 'patch' }], diagnostics: [] }),
    importModule: async () => ({ apply: (_c: Context, cfg: unknown) => { seen = cfg; } }),
  });
  expect(seen).toEqual({ speed: 7 });
});
```

- [ ] **Шаг 2: Убедиться, что падают**

- [ ] **Шаг 3: Реализовать**

- [ ] **Шаг 4: Мутационная проверка**

По одной ошибке, каждая должна ловиться конкретным тестом: применять строки параллельно (`Promise.all`) → падает тест порядка; прекращать цикл на первом сбое → падает тест изоляции; считать отсутствие `apply` ошибкой → падает no-op-тест.

- [ ] **Шаг 5: Коммит**

```bash
git add engine/game/loader
git commit -m "The browser composes the game from what the host resolved"
```

---

## Task 7: Швы способностей с матчерами

**Files:**
- Create: `engine/game/seam/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Test: `engine/game/seam/tests/seam.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface SeamMatcher { buildTarget?: string; urlParam?: string; default?: true }
  interface SeamCandidate { seam: string; provider: string; matcher: SeamMatcher }
  interface SeamContext { buildTarget?: string; urlParams?: Record<string, string> }
  function selectProvider(
    seam: string, candidates: SeamCandidate[], env: SeamContext,
  ): { provider: string | null; diagnostics: Diagnostic[] }
  ```

**Требование §5.4 спеки, дословно:** «Ноль кандидатов или двое — диагностика **с перечислением кандидатов и их матчеров**». Диагностика, которая просто говорит «не выбрался провайдер», требование не выполняет: смысл в том, чтобы человек увидел, из чего выбирали и почему не сошлось.

- [ ] **Шаг 1: Падающие тесты**

```ts
import { describe, expect, it } from 'vitest';
import { selectProvider, type SeamCandidate } from '../src/index';

const stake: SeamCandidate = { seam: 'session', provider: 'session-stake', matcher: { buildTarget: 'stake' } };
const dev: SeamCandidate = { seam: 'session', provider: 'session-dev', matcher: { default: true } };
const byParam: SeamCandidate = { seam: 'session', provider: 'session-url', matcher: { urlParam: 'sessionId' } };

describe('selectProvider', () => {
  it('picks the single matching provider', () => {
    const { provider, diagnostics } = selectProvider('session', [stake], { buildTarget: 'stake' });
    expect(provider).toBe('session-stake');
    expect(diagnostics).toEqual([]);
  });

  it('a specific matcher beats { default: true }', () => {
    const { provider, diagnostics } = selectProvider('session', [dev, stake], { buildTarget: 'stake' });
    expect(provider).toBe('session-stake');
    expect(diagnostics).toEqual([]);
  });

  it('falls back to the default when nothing specific matches', () => {
    const { provider } = selectProvider('session', [dev, stake], { buildTarget: 'e8platform' });
    expect(provider).toBe('session-dev');
  });

  it('zero candidates lists what was considered, and why each was rejected', () => {
    const { provider, diagnostics } = selectProvider('session', [stake], { buildTarget: 'e8platform' });
    expect(provider).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('session-stake');
    expect(diagnostics[0].message).toContain('stake');        // its matcher, not just its name
  });

  it('an empty candidate list still names the seam', () => {
    const { provider, diagnostics } = selectProvider('renderer', [], {});
    expect(provider).toBeNull();
    expect(diagnostics[0].message).toContain('renderer');
  });

  it('two equally-specific candidates is a diagnostic naming BOTH', () => {
    const other: SeamCandidate = { seam: 'session', provider: 'session-two', matcher: { buildTarget: 'stake' } };
    const { provider, diagnostics } = selectProvider('session', [stake, other], { buildTarget: 'stake' });
    expect(provider).toBeNull();
    expect(diagnostics[0].message).toContain('session-stake');
    expect(diagnostics[0].message).toContain('session-two');
  });

  it('two defaults are also ambiguous — "default" is not a tiebreak', () => {
    const other: SeamCandidate = { seam: 'session', provider: 'session-two', matcher: { default: true } };
    const { provider } = selectProvider('session', [dev, other], {});
    expect(provider).toBeNull();
  });

  it('urlParam matcher reads the passed env, never a global location', () => {
    const { provider } = selectProvider('session', [byParam, dev], { urlParams: { sessionId: 'abc' } });
    expect(provider).toBe('session-url');
  });

  it('urlParam does not match when the param is absent', () => {
    const { provider } = selectProvider('session', [byParam, dev], { urlParams: {} });
    expect(provider).toBe('session-dev');
  });
});
```

**Правило разрешения, чтобы оно не выводилось догадкой:** кандидаты делятся на «специфичные» (`buildTarget` или `urlParam`) и «умолчания» (`default: true`). Сначала берутся подошедшие специфичные; если их ровно один — он и есть ответ. Если их больше одного — неоднозначность, диагностика с перечислением. Если ни одного — берутся умолчания по тому же правилу. `default: true` **не** разрешает неоднозначность между двумя умолчаниями.

- [ ] **Шаг 2–4: Убедиться, что падает; реализовать; прогнать**

- [ ] **Шаг 5: Коммит**

```bash
git add engine/game/seam
git commit -m "A seam picks its provider by declared matcher, and says so when it cannot"
```

---

## Task 8: Бандл `e8-base` и профиль эталонной игры

**Files:**
- Create: `engine/bundles/e8-base/{package.json,e8.bundle.yml}`
- Create: `engine/examples/first-slot/e8.profile.yml`, `engine/examples/first-slot/e8.patch.yml`
- Modify: `package.json` каждого пакета рантайма — добавить `e8.runtime` в манифест

**Внимание к именам.** Корневой `workspaces` — `["packages/*","examples/*","engine/*/*"]`. `engine/bundles/e8-base` попадает под `engine/*/*` и станет рабочим пространством: его имя обязано быть уникальным во всей монорепе. Проверить `node -e "…"` по всем `package.json` **до** первого `npm install`, а не после: именно коллизия имён однажды перелинковала `node_modules` и увела семь тестов хоста из зелёных в красные.

- [ ] **Шаг 1: Описать бандл**

`engine/bundles/e8-base/e8.bundle.yml` — те строки, которые сегодня зашиты в `createGame`:

```yaml
rows:
  - id: boot1
    name: '@energy8engine/boot'
  - id: renderer1
    name: '@energy8engine/renderer-pixi'
  - id: stage1
    name: '@energy8engine/stage'
  - id: reels1
    name: '@energy8engine/reels'
  - id: mechanics1
    name: '@energy8engine/game-runtime'
  - id: playloop1
    name: '@energy8engine/play-loop'
```

- [ ] **Шаг 2: Дать каждому пакету рантайм-половину**

В `package.json` каждого перечисленного пакета — поле `e8.runtime` с `entry` и `inject`, плюс соответствующий вход в карте экспортов (`./runtime`). Это и есть «фаза = экспорт» из спеки.

- [ ] **Шаг 3: Профиль и патч эталонной игры**

```yaml
# engine/examples/first-slot/e8.profile.yml
bundles:
  - e8-base
```

`e8.patch.yml` несёт то, что сегодня передаётся объектом из `main.ts`: размеры рендерера, сетку барабанов, привязку механики стадии.

- [ ] **Шаг 4: Проверить уникальность имён и переустановить**

- [ ] **Шаг 5: Коммит**

```bash
git add -A engine/
git commit -m "e8-base becomes a bundle, and first-slot becomes a profile plus a patch"
```

---

## Task 9: `createGame` отдаёт состав загрузчику

Задача, ради которой всё предыдущее.

**Files:**
- Modify: `engine/game/runtime/src/index.ts` — удалить зашитый состав
- Modify: `engine/examples/first-slot/src/main.ts`
- Test: `engine/game/runtime/tests/compose-from-project.test.ts`

- [ ] **Шаг 1: Падающий тест**

```ts
import { describe, expect, it } from 'vitest';
// Duplicated deliberately, not imported across the package boundary: each
// engine package has its own vitest config and alias, and a relative climb
// into another workspace's test directory resolves on one machine and not
// the next. Twelve lines are cheaper than a shared test-utils package for
// two callers — see Приложение for the canonical text.
import { fakeFetch, row } from './helpers';

// Stands in for the real network + dynamic import: each row resolves to a
// half that marks the context, so the test observes composition ORDER and
// CONTENT without needing a server or a bundler.
const halves: Record<string, (ctx: any, cfg: any) => void> = {
  reels1: (ctx, cfg) => { ctx.reels = { config: cfg }; },
  renderer1: (ctx) => { ctx.renderer = { app: { canvas: document.createElement('canvas') } }; },
};
const importHalf = async (url: string) => ({ apply: halves[url.split('/').pop()!] });

describe('createGame composes from the project', () => {
  it('composes what the project says, not what the module imports', async () => {
    const mount = document.createElement('div');
    const game = await createGame({
      mount,
      loader: {
        fetchFn: fakeFetch({ rows: [row('renderer1'), row('reels1', { grid: { cols: 5, rows: 3 } })], diagnostics: [] }),
        importModule: importHalf,
      },
    });
    expect(game.diagnostics).toEqual([]);
    expect(game.ctx.reels.config).toEqual({ grid: { cols: 5, rows: 3 } });
  });

  it('a project with no renderer row still boots and says why the screen is empty', async () => {
    const mount = document.createElement('div');
    const game = await createGame({
      mount,
      loader: { fetchFn: fakeFetch({ rows: [row('reels1')], diagnostics: [] }), importModule: importHalf },
    });
    expect(game.ctx.renderer).toBeUndefined();
    // Visible text, not a field: `boot` already knows how to draw the reason,
    // and that is what a person would actually be looking at.
    expect(mount.textContent).toContain('renderer');
  });
});
```

Второй тест — прямая проверка того, что мы не завели новый путь к белому прямоугольнику. Он обязан утверждать **видимый текст**, а не значение поля: `boot` уже умеет рисовать причину, и именно это должно происходить.

- [ ] **Шаг 2: Убедиться, что падает**

- [ ] **Шаг 3: Удалить статические импорты состава и делегировать загрузчику**

Механики, `renderer-pixi`, `stage`, `reels`, `play-loop` больше не импортируются в `runtime/src/index.ts`. Ленивый импорт `session-dev` под `config.session` — **сохранить как есть**: причина, по которой он ленивый, никуда не делась.

- [ ] **Шаг 3b: Выбирать провайдера шва через `selectProvider`, а не «какой нашёлся»**

Задача 7 построила `@energy8engine/seam`; **здесь он подключается**, иначе это пакет, чей единственный потребитель — его собственные тесты. `createGame` собирает кандидатов на швы `renderer` и `session` из строк состава (матчер объявлен в манифесте строки) и выбирает провайдера через `selectProvider`. Диагностики выбора попадают в общий список игры.

Дополнительный тест, обязательный:

```ts
it('a project offering two renderer providers boots with an ambiguity diagnostic, not a silent pick', async () => {
  const mount = document.createElement('div');
  const game = await createGame({
    mount,
    loader: {
      fetchFn: fakeFetch({ rows: [row('renderer1'), row('renderer2')], diagnostics: [] }),
      importModule: importHalf,
    },
  });
  expect(game.ctx.renderer).toBeUndefined();
  expect(game.diagnostics.some((d) => d.message.includes('renderer1') && d.message.includes('renderer2'))).toBe(true);
  expect(mount.textContent).toMatch(/renderer/i);
});
```

Молчаливый выбор первого подошедшего — худший из возможных исходов: игра запускается, выглядит рабочей и рендерит не тем, чем человек думает.

- [ ] **Шаг 4: Прогнать все затронутые сюиты**

- [ ] **Шаг 5: Коммит**

```bash
git add -A engine/
git commit -m "createGame stops deciding the composition and starts obeying it"
```

---

## Task 10: Экран состава показывает слои

**Files:**
- Modify: `engine/ide/client/src/screens/CompositionScreen.tsx`
- Modify: `engine/core/contracts/src/diagnostic.ts` — сделать разделение пространств имён выраженным в коде
- Test: `engine/ide/client/tests/composition-layers.test.tsx`

**Здесь впервые сталкиваются два пространства имён `Diagnostic.plugin`** (см. «Проверенные факты»). До этой задачи они не пересекались, и Срез 0 разошёлся документацией. Теперь состав игры выводится в тот же экран — договорённости больше не хватает.

Решение принять и выразить в коде: диагностики игры и диагностики редактора приходят **разными каналами и хранятся раздельно**, как `connection.ts` уже держит раздельно свои и хостовые. Не сливать в один массив и не полагаться на то, что id не совпадут: id строки патча пишет человек, и `id: session` он написать вправе.

- [ ] **Шаг 1: Падающие тесты**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const rows = [
  { id: 'boot1', name: '@energy8engine/boot', config: {}, from: 'bundle:e8-base' },
  { id: 'reels1', name: '@energy8engine/reels', config: { grid: 5 }, from: 'patch' },
];

describe('composition screen — layers', () => {
  it('shows which layer placed each row', () => {
    render(<CompositionScreen rows={rows} />);
    expect(screen.getByTestId('row-boot1')).toHaveTextContent('e8-base');
    expect(screen.getByTestId('row-reels1')).toHaveTextContent('patch');
  });

  it('a row the patch overrode reads as overridden, not as newly added', () => {
    render(<CompositionScreen rows={rows} bundleIds={['boot1', 'reels1']} />);
    expect(screen.getByTestId('row-reels1')).toHaveTextContent(/overrid/i);
  });

  it('a game diagnostic never renders as an editor row name, even when ids collide', () => {
    // The patch is free to name a row `session`; the game independently
    // stamps `session` on its own seam diagnostics. These are two different
    // namespaces and the screen must not conflate them.
    render(
      <CompositionScreen
        rows={[{ id: 'session', name: '@e/some-plugin', config: {}, from: 'patch' }]}
        gameDiagnostics={[{ severity: 'error', plugin: 'session', where: 'start', message: 'e8-server not found' }]}
      />,
    );
    const diag = screen.getByTestId('game-diagnostic-0');
    expect(diag).toHaveTextContent('e8-server not found');
    expect(diag).not.toHaveTextContent('@e/some-plugin');
  });
});
```

- [ ] **Шаг 2–4: Убедиться, что падают; реализовать; прогнать**

- [ ] **Шаг 5: Коммит**

```bash
git add -A engine/
git commit -m "The composition screen shows where each row came from"
```

---

## Task 11: Приёмка — правка профиля меняет работающую игру

**Files:**
- Create: `engine/apps/web/tests/e2e/composition.spec.ts`

Критерий, который этот план обязан удовлетворить: **состав игры меняется правкой файла проекта, без единой правки кода движка, и это видно на экране.**

- [ ] **Шаг 1: Написать e2e**

Утверждать надо то, что увидел бы человек, а не значение в YAML. Тест, проверяющий `e8.patch.yml` вместо экрана, проверяет не тот конец трубы — этой ошибкой уже был потрачен раунд в Срезе 0.

```ts
import { expect, test } from '@playwright/test';
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The fixture is COPIED, never edited in place: this test writes a patch
// file, and writing into the checked-in example would corrupt it for every
// other test and for the developer's own `e8 dev`.
function projectCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'e8-compose-'));
  cpSync('../../examples/first-slot', dir, { recursive: true });
  return dir;
}

test('removing the reels row from the patch visibly changes the running game', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);          // helper: see Приложение
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('canvas')).toBeVisible();

    writeFileSync(join(dir, 'e8.patch.yml'), 'rows:\n  - id: reels1\n    remove: true\n');

    // Composition is not hot (see "Чего этот план НЕ обещает") — reload.
    await page.reload();

    // What a person would see: no board, and a stated reason. NOT a check
    // that the YAML file contains `remove: true` — that would be checking
    // the wrong end of the pipe.
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.locator('#mount')).toContainText(/reels/i);
  } finally {
    await host.stop();
  }
});

test('the composition screen lists the rows the profile resolved to', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    // Through the IDE on 5680, not the game on 5679 — the screen under test
    // is the editor's, and it reaches the host through vite's proxy.
    await page.goto('http://127.0.0.1:5680/');
    for (const id of ['boot1', 'renderer1', 'stage1', 'reels1']) {
      await expect(page.getByTestId(`row-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('row-boot1')).toContainText('e8-base');
  } finally {
    await host.stop();
  }
});
```

- [ ] **Шаг 2: Прогнать всю сюиту целиком**

`cd engine/apps/web && npx playwright test`, не параллельно ни с чем. После — проверить осиротевшие процессы.

- [ ] **Шаг 3: Прогнать все сюиты `engine/*`**

- [ ] **Шаг 4: Коммит**

```bash
git add -A engine/
git commit -m "Prove it: the project file decides what the game is made of"
```

---

## Чего этот план НЕ обещает

Названо явно, чтобы не выяснилось на ревью:

- **Горячести состава нет.** Смена строк профиля требует перезагрузки страницы игры. Горячим остаётся только то, что уже было горячим в Срезе 0, — привязка механики через `ide-bridge`. Горячая пересборка состава — отдельная работа.
- **`e8.yml` не исчезает.** Он остаётся составом *редактора*. Слияние двух форматов — решение, которого этот план не принимал.
- **Словарь шагов не открывается, третьей механики нет, парсера `.spin` нет, `spin-log` нет.** Это Срез 1b, и он стоит поверх этого.
- **Мёртвый ресайз в `stage` и дробление «фабрика + обёртка»** остаются как есть (пункт 4 записки о долге). Их место — рядом с проектированием вьюпорта.


---

## Приложение: тестовые хелперы

Определены здесь один раз, потому что на них ссылаются несколько задач. Реализовать в той задаче, которая использует их первой, и переиспользовать дальше — не переписывать заново в каждом файле тестов.

### `fixture(name)` и `copyFixtureToTemp(name)` — задачи 4 и 5

```ts
import { cpSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

/** Path to a READ-ONLY fixture. Never write into what this returns. */
export function fixture(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/**
 * A private copy of a fixture, for any test that writes. vitest runs test
 * FILES in parallel and the host's own config write is an untracked
 * setTimeout(0) — sharing a mutable fixture is a race, and "restore it
 * afterwards" is a race against unbounded disk latency.
 */
export function copyFixtureToTemp(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `e8-${name}-`));
  cpSync(fixture(name), dir, { recursive: true });
  return dir;
}
```

Требуемые фикстуры (каждая — каталог с указанными файлами):

| Фикстура | Содержимое | Проверяет |
|---|---|---|
| `project-simple` | `e8.profile.yml` со списком `[e8-base]` | обычный разбор |
| `project-patched` | то же + `e8.patch.yml`, переопределяющий `reels1` | применение патча |
| `project-none` | пустой каталог | отсутствующий профиль → диагностика |
| `project-broken-yaml` | `e8.profile.yml` с невалидным YAML | битый разбор → диагностика |
| `project-wrong-shape` | `e8.profile.yml`, содержащий `bundles: 5` | неверная форма → диагностика |

**Фикстуры самодостаточны.** Каждый каталог фикстуры несёт свой минимальный `bundles/<name>/e8.bundle.yml`. Хост ищет бандл **сначала рядом с проектом** (`<cwd>/bundles/<name>` и `<cwd>/node_modules/<name>`), и лишь затем — в `engine/bundles/<name>`. Порядок именно такой, потому что у настоящего проекта пользователя нашего репозитория под рукой нет, и фикстура, тайно зависящая от нашей раскладки каталогов, проверяла бы не то. Настоящий `e8-base` появляется только в задаче 8 — фикстуры задачи 4 не должны его ждать.

### `fakeFetch(body)` и `row(id)` — задача 6

```ts
import type { ResolvedRow } from '@energy8engine/contracts';

export function row(id: string, config: Record<string, unknown> = {}): ResolvedRow {
  return { id, name: `@energy8engine/${id}`, config, from: 'bundle:e8-base' };
}

/** A fetch that answers /api/composition with `body` and nothing else. */
export function fakeFetch(body: { rows: ResolvedRow[]; diagnostics: unknown[] }): typeof fetch {
  return (async (url: string) => {
    if (!String(url).includes('/api/composition')) throw new Error(`unexpected fetch: ${url}`);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}
```

Обратите внимание: `fakeFetch` **бросает** на неожиданном URL, а не возвращает пустой ответ. Тест, который молча проглатывает обращение не туда, перестаёт быть тестом.

### `startDevHost(dir)` — задача 11

Поднимает `e8 dev` в указанном каталоге тем же способом, каким это делает существующий `engine/apps/web/tests/e2e/runtime.spec.ts` (прочитать его и повторить приём, а не изобретать второй). Возвращает `{ gameUrl, stop() }`. `stop()` обязан дожидаться выхода процесса: сюита ходит по фиксированным портам, и не дождавшийся teardown роняет следующий тест по `EADDRINUSE`.
