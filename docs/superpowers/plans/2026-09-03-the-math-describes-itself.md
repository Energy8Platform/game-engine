# Срез 1b: математика описывает себя, и чужая механика играет — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `.spin` начинает описывать себя машине: IDE читает форму результата спина и сверяет с ней требования механики **до** запуска. Словарь шагов презентации перестаёт быть закрытым, и третья механика — `reel-step` — приезжает **плагином проекта**, а не правкой движка.

**Architecture:** Парсер декларативной секции `.spin` (`game`/`action`/`record`/`enum … tag stage`) выдаёт `SpinSchema`. Хост отдаёт её вместе с составом; `expects` механики сверяется со стадией и даёт внятную диагностику вместо белого экрана после клика. Реестр `board.step` открывает словарь: плагин приносит недостающий шаг вместе с его исполнением на поле. `reel-step` живёт в `<project>/plugins/`, что требует научить хост разрешать плагины проекта.

**Tech Stack:** TypeScript, cordis 4.0.0-rc.8, vite 6, vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-slot-webide-cordis-design.md` — §6.1 (схема спина), §7.1 (тип игры — плагин; словарь шагов — реестр `board.step`), §5.4 (реестры), §7 (`spin-log`), §10 критерий 4 (чужая механика из `plugins/` играет).

**Предшествующая работа:** Срез 0 и Срез 1a. Долг, перенесённый из 1a, — `docs/superpowers/notes/2026-09-04-slice-1a-carried-forward.md`; пункт 1 оттуда закрывается здесь (задача 6), остальное остаётся.

---

## Global Constraints

Действуют на каждую задачу. Нарушение любой ревьюер обязан считать дефектом.

- Новый код — **только** в `engine/`. `packages/*` и верхнеуровневый `examples/*` — легаси: читать и импортировать можно, править нельзя. `engine/examples/first-slot` — наш.
- Скоуп `@energy8engine/*`; имя каждого нового пакета **уникально во всей монорепе** (корневой `workspaces` включает `engine/*/*`).
- Комментарии и коммиты — по-английски, короткими повествовательными предложениями в голосе репозитория (`git log --oneline -20`).
- **Контракты — словари, плагины — решения.** `engine/core/contracts` не импортирует ничего, кроме своих относительных модулей; это проверяет тест чистоты, и он строгий (ловит `require()`, динамический `import()`, побочный `import 'x'` и обе формы кавычек).
- **Отказ — это данные.** Швы возвращают `Diagnostic[]`, не бросают. Ни один путь не заканчивается пустым экраном без объяснения.
- **Движок не знает конкретных строк.** Ни id строки, ни имени составляемого пакета в `engine/game/runtime`.
- Тесты — по рабочим пространствам: `npm test --workspace @energy8engine/<pkg>`. **Корневой `npm test` не запускать**: три легаси-пакета падают по причинам окружения (`create-slot` — дрейф версий; `stake-bridge`/`stake-math-tools` — npm не ставит `execa` для их `vitest@1.6.1`).
- Playwright в `engine/apps/web` держит фиксированные порты и `workers: 1`. Запускать в одиночку; после — проверять осиротевшие процессы.
- Есть дымовой тест, запускающий настоящий `bin/e8.mjs`. Он существует потому, что vitest ходит через vite-node, который **подставляет** `__dirname`/`__filename`, а настоящий CLI на `tsx` — нет. Зелёная внутрипроцессная сюита не является свидетельством о продакшн-загрузчике.
- Утверждение в тесте задаётся **вместе с мутацией, которая обязана его уронить**. Этот проект нашёл шесть тестов, проходивших не через ту ветку, которую они называют; все шесть поймала мутация, ни одного не поймало чтение.

---

## Проверенные факты

Всё измерено на текущем HEAD. Расхождение кода с этим разделом — повод остановиться и сказать, а не подгонять.

### Декларативная грамматика `.spin` мала и регулярна

Из `docs/spinml.md` и `engine/examples/first-slot/game/script.spin`:

```spin
record Name { field: type }                 -- типы: int, float, bool, str, [T], [T; N], record-ссылки, `?` = optional
enum SpinData tag stage { base_game { … } } -- сумма-тип: имя варианта становится тегом `stage`
game "first-slot" { bet_levels = [...]  max_win = 500.0  vars = Vars  feature = Feat  data = SpinData }
action spin { stage = base_game  cost = 1.0 }
action free_spin { stage = free_spins  cost = 1.0  session = true  extends = retrigger_spins  ends when max_win_reached  opens = free_spin count free_spins_awarded  feature { ante = 1 } }
```

`feature {}` — поля через перевод строки, запятые запрещены. Исполнять ничего не нужно: это блоки с фиксированным синтаксисом.

### `<project>/plugins/<name>` сегодня не разрешается

`engine/ide/host/src/resolvePackage.ts` берёт `createRequire(join(cwd,'noop.js'))` и `require.resolve(name)`. Измерено напрямую: голое имя даёт `MODULE_NOT_FOUND`, относительный путь резолвится. Node смотрит только в `node_modules` вверх по дереву — каталог `plugins/` из раскладки §6 спеки не участвует.

**Поэтому критерий приёмки 4 недостижим не из-за механик, а из-за резолвинга.** Это задача 5, и она предшествует `reel-step`.

### Словарь шагов закрыт по типам, но открыт в рантайме

`engine/core/contracts/src/presentation.ts` объявляет шесть видов (`spinTo`, `revealWins`, `remove`, `refill`, `setMultiplier`, `wait`) закрытым объединением, а `BoardApi` (`engine/game/play-loop/src/index.ts:39-46`) — закрытым интерфейсом с методом на каждый.

Смягчающее и важное: `executePlan` диспатчит **по строковому ключу с рантайм-проверкой**, а не `switch` по литералам. Рантайм уже open-world; закрыты только типы. Реестру есть на что приземлиться.

Из шести видов `setMultiplier` и `wait` не эмитит никто — они умозрительны.

### `reel-step` устроен не так, как предполагала спека

Спека описывала `reel-step` как `[spinTo(reel 0), spinTo(reel 1), …]`. Настоящий `packages/game-engine/src/slot/cascade/ReelStepController.ts` работает иначе:

```ts
interface ReelStepData {
  winningCells: { col: number; row: number }[];  // подсвечиваются и оплачиваются ДО сдвига
  shifts: number[];                              // на сколько прокрутить каждый барабан; длина = число колонок
  settledGrid: CellData[][];                     // доска после того, как все барабаны прокрутились
}
```

`step()`: оплатить выигрышные клетки → прокрутить каждый барабан вниз на `shifts[col]` (все одновременно) → нормализовать на `settledGrid`.

**Это не перестановка существующего словаря, а недостающий шаг.** Что и делает `reel-step` настоящей проверкой заявки об открытости, а не её подтверждением по форме.

### Математика `first-slot` не эмитит данных для reel-step

Стадия `base_game` сегодня несёт `grid`, `win`, `base_win`, `lines`, `cascade_history`. Ничего похожего на `shifts`. Третьей механике нужна третья форма — то есть правка `engine/examples/first-slot/game/script.spin`, которая наша.

### `/@fs/` не проверяет выход за корень пакета

Пункт 1 записки о долге. `/plugin-runtime/:id` сравнивает realpath с обеих сторон и имеет тест с симлинком; живой путь `/@fs/` полагается только на `server.fs.allow` самого vite. Задача 5 расширяет то, что отдаётся (плагины проекта), поэтому закрыть это надо здесь, а не «когда-нибудь».

---

## Структура файлов

| Путь | Ответственность |
|---|---|
| `engine/core/contracts/src/spin-schema.ts` | **создать** — словарь `SpinSchema`, `RecordShape`, `ActionDef`, `FieldType` |
| `engine/core/spin-parser/` | **создать** пакет `@energy8engine/spin-parser` — чистый разбор декларативной секции, без ФС и cordis |
| `engine/ide/host/src/plugins/schema.ts` | **создать** — читает `game/script.spin`, разбирает, отдаёт `ctx.spinSchema`, диагностики как данные |
| `engine/ide/host/src/plugins/runtime-assets.ts` | изменить — схема едет вместе с составом; containment для `/@fs/` |
| `engine/ide/host/src/resolvePackage.ts` | изменить — `<project>/plugins/<name>` как кандидат |
| `engine/core/contracts/src/presentation.ts` | изменить — `PresentationStep` перестаёт быть закрытым объединением |
| `engine/game/play-loop/src/index.ts` | изменить — реестр `board.step`; `executePlan` диспатчит через него |
| `engine/game/runtime/src/plugins/mechanics.ts` | изменить — `expects` сверяется со `SpinSchema` до запуска |
| `engine/game/spin-log/` | **создать** пакет `@energy8engine/spin-log` — append-only лог, отделённый от живых событий |
| `engine/examples/first-slot/game/script.spin` | изменить — третья форма: пошаговые данные барабанов |
| `engine/examples/first-slot/plugins/reel-step/` | **создать** — механика как плагин проекта: свой шаг, своё исполнение на поле |
| `engine/apps/web/tests/e2e/reel-step.spec.ts` | **создать** — приёмка: чужая механика играет без правки движка |

---

## Task 1: Словарь схемы спина

**Files:**
- Create: `engine/core/contracts/src/spin-schema.ts`
- Modify: `engine/core/contracts/src/index.ts`
- Test: `engine/core/contracts/tests/spin-schema.test.ts`

**Interfaces:**
- Consumes: ничего (контракты не импортируют)
- Produces: типы ниже — их потребляют задачи 2, 3, 4

- [ ] **Шаг 1: Падающий тест**

```ts
import { describe, expect, it } from 'vitest';
import { isSpinSchema, type SpinSchema } from '../src/spin-schema';

const SCHEMA: SpinSchema = {
  gameId: 'first-slot',
  betLevels: [0.2, 1, 5],
  maxWin: 500,
  vars: { max_win_reached: { kind: 'bool' } },
  stages: {
    base_game: {
      grid: { kind: 'list', of: { kind: 'list', of: { kind: 'int' } } },
      base_win: { kind: 'float' },
      lines: { kind: 'list', of: { kind: 'record', name: 'LineWin' } },
    },
  },
  records: { LineWin: { line: { kind: 'int' }, win: { kind: 'float' } } },
  actions: [{ name: 'spin', stage: 'base_game', cost: 1 }],
};

describe('spin schema vocabulary', () => {
  it('accepts a schema with a stage and an action', () => {
    expect(isSpinSchema(SCHEMA)).toBe(true);
  });

  it('rejects one whose stages is not an object', () => {
    expect(isSpinSchema({ ...SCHEMA, stages: [] })).toBe(false);
  });

  it('rejects one with no gameId', () => {
    const { gameId: _drop, ...rest } = SCHEMA;
    expect(isSpinSchema(rest)).toBe(false);
  });

  it('an action naming a stage the schema does not declare is still a well-formed schema', () => {
    // Vocabulary, not policy: whether that is a MISTAKE is task 3's diagnostic
    // to make, not this type guard's. The guard says "is this the right shape",
    // never "is this a good game".
    expect(isSpinSchema({ ...SCHEMA, actions: [{ name: 'x', stage: 'nope', cost: 1 }] })).toBe(true);
  });
});
```

- [ ] **Шаг 2: Убедиться, что падает** — `npm test --workspace @energy8engine/contracts`, ожидание: модуль не найден.

- [ ] **Шаг 3: Написать словарь**

```ts
/**
 * The shape a `.spin` declares, as a vocabulary. Nothing here decides
 * anything: parsing lives in `@energy8engine/spin-parser`, and judging a
 * schema (does this action name a stage that exists?) lives in the host.
 */
export type FieldType =
  | { kind: 'int' } | { kind: 'float' } | { kind: 'bool' } | { kind: 'str' }
  | { kind: 'list'; of: FieldType }
  | { kind: 'array'; of: FieldType; length: number }
  | { kind: 'record'; name: string }
  | { kind: 'optional'; of: FieldType };

export type RecordShape = Record<string, FieldType>;

export interface ActionDef {
  name: string;
  stage: string;
  cost: number;
  session?: boolean;
  /** `extends = <Vars field>` — spins added mid-session. */
  extendsVar?: string;
  /** `ends when <Vars field>` — the bool that force-closes the session. */
  endsWhenVar?: string;
  /** `opens = <action> count <Vars field>`. */
  opens?: { action: string; countVar: string };
  feature?: Record<string, number>;
}

export interface SpinSchema {
  gameId: string;
  betLevels: number[];
  maxWin: number;
  vars: RecordShape;
  globals?: RecordShape;
  /** From `enum SpinData tag stage { … }` — one entry per variant. */
  stages: Record<string, RecordShape>;
  /** Every `record` declared, so a field of kind `record` can be followed. */
  records: Record<string, RecordShape>;
  actions: ActionDef[];
}
```

Плюс `isSpinSchema` — проверка формы, без суждений о смысле.

- [ ] **Шаг 4: Ре-экспорт** — `export * from './spin-schema';` в индексе, как все остальные модули этого файла.

- [ ] **Шаг 5: Тесты и тайпчек** — включая тест чистоты.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/core/contracts
git commit -m "Give the shape of a spin a vocabulary"
```

---

## Task 2: Парсер декларативной секции

**Files:**
- Create: `engine/core/spin-parser/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Test: `engine/core/spin-parser/tests/parse.test.ts`

**Interfaces:**
- Produces: `parseSpinSchema(source: string): { schema: SpinSchema | null; diagnostics: Diagnostic[] }`

Пакет чистый: строка на входе, схема и диагностики на выходе. Ни `fs`, ни cordis. Исполнять `.spin` не нужно — разбираются только блоки с фиксированным синтаксисом; всё остальное (функции, `const`, тело `execute`) пропускается.

**Правило, которое иначе выведут догадкой:** парсер **никогда не бросает**. Файл, который не удалось разобрать, даёт `schema: null` и диагностику, называющую строку и то, чего в ней не хватило. Половина разобранного лучше, чем ничего: если `game {}` прочитан, а один `record` сломан, верните схему без этого рекорда **и** диагностику.

- [ ] **Шаг 1: Падающие тесты — таблицей случаев**

```ts
import { describe, expect, it } from 'vitest';
import { parseSpinSchema } from '../src/index';

const MINIMAL = `
record Vars { max_win_reached: bool }
enum SpinData tag stage {
  base_game { grid: [[int]]  win: float }
}
game "demo" {
  bet_levels = [0.2, 1.0]
  max_win = 500.0
  vars = Vars
  data = SpinData
}
action spin { stage = base_game  cost = 1.0 }
`;

describe('parseSpinSchema', () => {
  it('reads the game block', () => {
    const { schema, diagnostics } = parseSpinSchema(MINIMAL);
    expect(diagnostics).toEqual([]);
    expect(schema).toMatchObject({ gameId: 'demo', betLevels: [0.2, 1], maxWin: 500 });
  });

  it('reads a stage from the tagged enum', () => {
    const { schema } = parseSpinSchema(MINIMAL);
    expect(schema!.stages.base_game).toEqual({
      grid: { kind: 'list', of: { kind: 'list', of: { kind: 'int' } } },
      win: { kind: 'float' },
    });
  });

  it('reads records, so a record-typed field can be followed', () => {
    const src = MINIMAL.replace('record Vars', 'record LineWin { line: int  win: float }\nrecord Vars');
    expect(parseSpinSchema(src).schema!.records.LineWin).toEqual({
      line: { kind: 'int' }, win: { kind: 'float' },
    });
  });

  it('reads an action with its session declarations', () => {
    const src = MINIMAL + `
action free_spin {
  stage = base_game
  cost = 1.0
  session = true
  extends = retrigger_spins
  ends when max_win_reached
  opens = free_spin count free_spins_awarded
}`;
    const free = parseSpinSchema(src).schema!.actions.find((a) => a.name === 'free_spin')!;
    expect(free).toMatchObject({
      stage: 'base_game', cost: 1, session: true,
      extendsVar: 'retrigger_spins', endsWhenVar: 'max_win_reached',
      opens: { action: 'free_spin', countVar: 'free_spins_awarded' },
    });
  });

  it('reads optional and fixed-size array types', () => {
    const src = MINIMAL.replace('win: float', 'win: float  mult: int?  reels: [int; 5]');
    expect(parseSpinSchema(src).schema!.stages.base_game.mult).toEqual({
      kind: 'optional', of: { kind: 'int' },
    });
    expect(parseSpinSchema(src).schema!.stages.base_game.reels).toEqual({
      kind: 'array', of: { kind: 'int' }, length: 5,
    });
  });

  it('ignores everything that is not a declaration', () => {
    const src = MINIMAL + `
const W: [int; 3] = [1, 2, 3]
fn helper(c: ctx) -> int { return 1 }
fn execute(c: ctx, v: Vars) -> outcome { return outcome { win: 0.0 } }`;
    expect(parseSpinSchema(src).diagnostics).toEqual([]);
    expect(parseSpinSchema(src).schema!.gameId).toBe('demo');
  });

  it('a source with no game block is a diagnostic, not a throw', () => {
    const { schema, diagnostics } = parseSpinSchema('record V { a: int }');
    expect(schema).toBeNull();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain('game');
  });

  it('a broken record does not lose the rest of the file', () => {
    const src = MINIMAL.replace('record Vars { max_win_reached: bool }', 'record Vars { max_win_reached: }');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(schema).not.toBeNull();
    expect(schema!.gameId).toBe('demo');
    expect(diagnostics.some((d) => d.message.includes('Vars'))).toBe(true);
  });

  it('parses first-slot for real', () => {
    // The one test that stops this being a parser for a language of one file.
    const src = readFileSync(
      new URL('../../../examples/first-slot/game/script.spin', import.meta.url), 'utf8');
    const { schema, diagnostics } = parseSpinSchema(src);
    expect(diagnostics).toEqual([]);
    expect(schema!.gameId).toBe('first-slot');
    expect(Object.keys(schema!.stages)).toEqual(['base_game']);
    expect(schema!.stages.base_game.cascade_history).toEqual({
      kind: 'list', of: { kind: 'record', name: 'CascadeStep' },
    });
    expect(schema!.actions).toEqual([{ name: 'spin', stage: 'base_game', cost: 1 }]);
  });
});
```

Последний тест — самый ценный: он единственный проверяет парсер против файла, который мы не писали под парсер.

- [ ] **Шаг 2: Убедиться, что падают.**

- [ ] **Шаг 3: Реализовать.** Разбор построчный или по блокам — на ваше усмотрение; регулярки допустимы, пока читаемы. Не тащите генератор парсеров: грамматика — пять форм блоков.

- [ ] **Шаг 4: Мутационная проверка.** Каждая обязана уронить свой тест: (1) не читать `?` как optional; (2) игнорировать `ends when`; (3) бросать на файле без `game`; (4) на сломанном рекорде возвращать `null` вместо частичной схемы.

- [ ] **Шаг 5: Коммит**

```bash
git add engine/core/spin-parser
git commit -m "Read the declarations a .spin already makes"
```

---

## Task 3: Хост отдаёт схему

**Files:**
- Create: `engine/ide/host/src/plugins/schema.ts`
- Modify: `engine/ide/host/src/index.ts`, `engine/ide/host/src/plugins/runtime-assets.ts`
- Test: `engine/ide/host/tests/schema.test.ts`

**Interfaces:**
- Produces: `ctx.spinSchema` = `{ schema: SpinSchema | null; diagnostics: Diagnostic[]; reload(): Promise<void> }`, и `GET /api/composition` начинает нести `schema` рядом с `rows` и `diagnostics`.

**Почему рядом с составом, а не отдельным маршрутом.** Задача 4 сверяет `expects` механики со стадией; это происходит в браузере, в момент сборки. Отдельный запрос — второй сетевой вызов и второй способ ошибиться в порядке. Схема — часть ответа на вопрос «из чего эта игра и что она отдаёт».

- [ ] **Шаг 1: Падающие тесты**

```ts
it('parses the project game/script.spin and exposes it', async () => {
  const host = await createIdeHost({ cwd: fixture('project-simple') });
  expect(host.ctx.spinSchema.schema!.gameId).toBe('demo');
  await host.stop();
});

it('a missing script.spin is a diagnostic and the host still starts', async () => {
  const host = await createIdeHost({ cwd: fixture('project-no-spin') });
  expect(host.ctx.spinSchema.schema).toBeNull();
  expect(host.ctx.spinSchema.diagnostics.some((d) => d.where.includes('script.spin'))).toBe(true);
  expect(host.url).toBeTruthy();
  await host.stop();
});

it('an action naming a stage the enum does not declare is a diagnostic', async () => {
  // The judgement task 1's type guard deliberately refused to make.
  const host = await createIdeHost({ cwd: fixture('project-stage-typo') });
  expect(host.ctx.spinSchema.diagnostics.some((d) => d.message.includes('free_spins'))).toBe(true);
  await host.stop();
});

it('the composition response carries the schema', async () => {
  const body = await (await fetch(`${host.url}/api/composition`)).json();
  expect(body.schema.gameId).toBe('demo');
});

it('carries a null schema and its diagnostics rather than omitting the field', async () => {
  const body = await (await fetch(`${host.url}/api/composition`)).json();
  expect(body).toHaveProperty('schema');
  expect(body.schema).toBeNull();
  expect(body.diagnostics.length).toBeGreaterThan(0);
});
```

- [ ] **Шаг 2–4: Убедиться, что падают; реализовать; прогнать.** Все прежние тесты хоста обязаны остаться зелёными.

- [ ] **Шаг 5: Коммит**

```bash
git add engine/ide/host
git commit -m "The host reads what the math says about itself"
```

---

## Task 4: `expects` сверяется со схемой до запуска

**Files:**
- Modify: `engine/game/runtime/src/plugins/mechanics.ts`, `engine/game/runtime/src/index.ts`
- Test: `engine/game/runtime/tests/mechanics.test.ts`

**Interfaces:**
- Consumes: `SpinSchema` из контрактов; `SpinShapeRequirement` (уже есть на `SpinMechanic.requires`)
- Produces:
  ```ts
  function checkAgainstSchema(
    schema: SpinSchema | null,
    bindings: Record<string, SpinMechanic>,   // стадия -> привязанная механика
  ): Diagnostic[]
  ```
  Вызывается из `createGame` после сборки состава и до первого спина; результат идёт в общий список диагностик игры, поэтому попадает на экран отказа тем же путём, что и всё остальное.

Обещание §7.1 спеки, дословно: механика `cascade` требует у стадии массив шагов; если в математике его нет — IDE показывает «механика `cascade` на стадии `base_game` ждёт поле `cascade_history`, в математике его нет», **а не белый экран после клика**.

Сегодня `checkShape` сверяет требования с **данными одного спина**. Это правильно и остаётся. Новое — сверка со **схемой**, до первого спина.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('a mechanic whose required field is absent from the stage schema is a diagnostic at bind time', () => {
  const diagnostics = checkAgainstSchema(SCHEMA_WITHOUT_CASCADE, { base_game: cascadeMechanic });
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].message).toContain('cascade');
  expect(diagnostics[0].message).toContain('cascade_history');
  expect(diagnostics[0].message).toContain('base_game');
});

it('a mechanic whose fields are all present is silent', () => {
  expect(checkAgainstSchema(SCHEMA_WITH_CASCADE, { base_game: cascadeMechanic })).toEqual([]);
});

it('a field present but of the wrong kind is named, with both kinds', () => {
  // `cascade_history: float` where a list was required.
  const [d] = checkAgainstSchema(SCHEMA_CASCADE_IS_FLOAT, { base_game: cascadeMechanic });
  expect(d.message).toContain('cascade_history');
  expect(d.message).toContain('list');
  expect(d.message).toContain('float');
});

it('a stage the schema does not declare is a diagnostic naming the stages it does', () => {
  const [d] = checkAgainstSchema(SCHEMA, { free_spins: classicMechanic });
  expect(d.message).toContain('free_spins');
  expect(d.message).toContain('base_game');
});

it('no schema means no check, and no complaint', () => {
  // A project whose .spin could not be parsed already has ITS diagnostic;
  // inventing a second one here would report the same problem twice.
  expect(checkAgainstSchema(null, { base_game: cascadeMechanic })).toEqual([]);
});
```

- [ ] **Шаг 2–4: Убедиться, что падают; реализовать; прогнать.**

- [ ] **Шаг 5: Мутационная проверка.** (1) Считать любое присутствие поля достаточным, игнорируя вид — падает третий тест. (2) Молчать при неизвестной стадии — падает четвёртый. (3) Жаловаться при `schema === null` — падает пятый.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/game/runtime
git commit -m "Tell the developer the math lacks a field, before the first spin"
```

---

## Task 5: Плагины проекта резолвятся

**Files:**
- Modify: `engine/ide/host/src/resolvePackage.ts`
- Test: `engine/ide/host/tests/resolve-package.test.ts`

**Измеренный факт, с которого всё начинается:** `require.resolve('reel-step')` из корня проекта даёт `MODULE_NOT_FOUND`. Node смотрит только в `node_modules` вверх по дереву. Каталог `plugins/` из раскладки §6 спеки не участвует, поэтому **сегодня чужая механика физически не может доехать до состава** — независимо от того, насколько хороша сама механика.

**Порядок поиска, и он должен быть именно таким:**
1. `<cwd>/plugins/<name>` — плагины проекта, правятся руками;
2. обычное разрешение Node (`node_modules`, включая симлинки рабочих пространств).

Проект побеждает установленный пакет: человек, положивший плагин в свой `plugins/`, делает это, чтобы он использовался. Обратный порядок дал бы поведение, зависящее от того, что установлено рядом.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('finds a plugin the project keeps in plugins/', () => {
  const dir = projectWith({ 'plugins/acme-thing/package.json': '{"name":"acme-thing","version":"1.0.0"}' });
  expect(readPackageJson(dir, 'acme-thing')!.dir).toBe(join(dir, 'plugins', 'acme-thing'));
});

it('a project plugin beats an installed package of the same name', () => {
  const dir = projectWith({
    'plugins/dup/package.json': '{"name":"dup","version":"1.0.0"}',
    'node_modules/dup/package.json': '{"name":"dup","version":"9.9.9"}',
    'node_modules/dup/index.js': '',
  });
  expect(readPackageJson(dir, 'dup')!.dir).toBe(join(dir, 'plugins', 'dup'));
});

it('still finds installed packages when the project has no plugins/ at all', () => {
  const dir = projectWith({ 'node_modules/only/package.json': '{"name":"only","version":"1.0.0"}', 'node_modules/only/index.js': '' });
  expect(readPackageJson(dir, 'only')!.dir).toBe(join(dir, 'node_modules', 'only'));
});

it('a plugins/ entry with no package.json is not a package', () => {
  const dir = projectWith({ 'plugins/empty/index.js': '' });
  expect(readPackageJson(dir, 'empty')).toBeNull();
});

it('a name that escapes the plugins directory resolves nothing', () => {
  // `name: '../../../etc'` in a patch must not walk out of the project.
  const dir = projectWith({ 'plugins/ok/package.json': '{"name":"ok","version":"1.0.0"}' });
  expect(readPackageJson(dir, '../../../etc')).toBeNull();
});
```

Последний тест — не паранойя: `name` строки пишет человек в `e8.patch.yml`, и путь из него попадает в `join`. Проверяйте realpath с обеих сторон, как это уже делает `/plugin-runtime/:id`; помните, что рабочие пространства линкуются симлинками, поэтому наивная проверка префикса на неразрешённых путях сломает существующие фикстуры.

- [ ] **Шаг 2–4: Убедиться, что падают; реализовать; прогнать.** Все прежние тесты хоста остаются зелёными; дымовой тест CLI тоже.

- [ ] **Шаг 5: Коммит**

```bash
git add engine/ide/host
git commit -m "A project's own plugins directory becomes a place packages live"
```

---

## Task 6: Containment для `/@fs/`

Пункт 1 записки о долге. Делается **здесь**, а не «когда-нибудь», потому что задача 5 расширила множество того, что хост готов отдать: теперь это ещё и каталог, куда человек кладёт чужой код.

**Files:**
- Modify: `engine/ide/host/src/plugins/runtime-assets.ts` (и/или `dev-game.ts`)
- Test: `engine/ide/host/tests/runtime-assets.test.ts`

Сегодня `/plugin-runtime/:id` сравнивает realpath с обеих сторон и имеет тест с симлинком, а живой путь `/@fs/` полагается только на `server.fs.allow` vite, то есть на корень рабочего пространства. Выстраданная проверка сторожит дверь, мимо которой перестали ходить.

- [ ] **Шаг 1: Падающий тест** — по образцу уже существующего симлинк-теста, но против URL, который реально выдаётся в `runtimeUrl`. Строка, чей `e8.runtime.entry` — симлинк на файл вне корня пакета, не должна отдаваться.

- [ ] **Шаг 2: Убедиться, что падает** — и убедиться, что падает **по правильной причине**: не «файла нет», а «выходит за пределы пакета». Цель симлинка обязана существовать, иначе запрос умрёт раньше на `ENOENT` и вы проверите не ту ветку. Этой ошибкой в Срезе 1a уже был потрачен раунд.

- [ ] **Шаг 3: Реализовать.** Либо своя проверка перед тем, как отдать `/@fs/`-URL, либо сужение `fs.allow` до корней пакетов-строк. Выберите и объясните в отчёте; второе строже, но может задеть транзитивные импорты в `node_modules`, что легко проверить и надо проверить.

- [ ] **Шаг 4: Прогнать всё, включая Playwright** — этот шов держит загрузку каждой строки, и сломать его значит сломать игру целиком.

- [ ] **Шаг 5: Коммит**

```bash
git add engine/ide/host
git commit -m "Guard the path we actually serve halves through"
```

---

## Task 7: Реестр `board.step`

Здесь словарь перестаёт быть закрытым.

**Files:**
- Modify: `engine/core/contracts/src/presentation.ts`, `engine/game/play-loop/src/index.ts`
- Test: `engine/game/play-loop/tests/registry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface StepHandler { kind: string; run(step: PresentationStep, board: unknown): Promise<void> }
  interface BoardStepRegistry { register(handler: StepHandler): () => void; has(kind: string): boolean }
  ```
- **Меняет сигнатуру:** `executePlan(plan, board)` становится
  `executePlan(plan, board, registry?)`. Реестр необязателен — вызывающий, у которого его нет,
  получает прежнее поведение, и все существующие тесты `play-loop` продолжают работать без правок.
  Это проверяется отдельно: ни один из десяти нынешних тестов пакета не должен измениться.
  Потребители сигнатуры — `engine/game/runtime` (передаёт реестр из состава) и задача 9.

**Что меняется в контракте.** `PresentationStep` перестаёт быть закрытым объединением: шесть известных видов остаются как именованные типы, но шаг определяется как `{ kind: string }` плюс собственные поля. Рантайм уже open-world — `executePlan` диспатчит по строковому ключу; здесь это перестаёт противоречить типам.

**Что НЕ меняется.** Шесть встроенных видов и их методы на `BoardApi` остаются: это словарь, на котором стоят две существующие механики, и ломать его ради симметрии незачем. Реестр — путь для **недостающего** шага, а не замена существующим.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('runs a registered step the built-in board does not know', async () => {
  const seen: string[] = [];
  registry.register({ kind: 'reelStep', run: async () => { seen.push('reelStep'); } });
  const diagnostics = await executePlan([{ kind: 'reelStep', shifts: [1, 0] }], board, registry);
  expect(seen).toEqual(['reelStep']);
  expect(diagnostics).toEqual([]);
});

it('a built-in kind still goes to the board, not the registry', async () => {
  registry.register({ kind: 'spinTo', run: async () => { throw new Error('registry must not win'); } });
  const diagnostics = await executePlan([{ kind: 'spinTo', board: [[1]] }], board, registry);
  expect(diagnostics).toEqual([]);
  expect(board.calls).toEqual(['spinTo']);
});

it('an unknown kind is a diagnostic naming the kind and what IS known', async () => {
  const [d] = await executePlan([{ kind: 'nope' }], board, registry);
  expect(d.message).toContain('nope');
  expect(d.message).toContain('spinTo');
});

it('unregistering removes the handler', async () => {
  const off = registry.register({ kind: 'x', run: async () => {} });
  off();
  expect(registry.has('x')).toBe(false);
});

it('a handler that rejects becomes a diagnostic, and the plan continues', async () => {
  registry.register({ kind: 'boom', run: async () => { throw new Error('handler blew up'); } });
  const diagnostics = await executePlan([{ kind: 'boom' }, { kind: 'spinTo', board: [[1]] }], board, registry);
  expect(diagnostics).toHaveLength(1);
  expect(board.calls).toEqual(['spinTo']);      // the next step still ran
});
```

Второй тест важнее, чем кажется: он запрещает реестру перехватывать встроенные виды. Без него плагин смог бы молча подменить `spinTo` у всех игр разом.

- [ ] **Шаг 2–3: Убедиться, что падают; реализовать.** Регистрация — реверсивный эффект (`ctx.effect`), снимается вместе с плагином: это требование §5.4 спеки, и оно же спасает от строки, которая ушла из состава, но оставила обработчик.

- [ ] **Шаг 4: Мутационная проверка.** (1) Дать реестру приоритет над `BoardApi` — падает второй тест. (2) Прерывать план на сбое обработчика — падает пятый. (3) Не перечислять известные виды в диагностике — падает третий.

- [ ] **Шаг 5: Коммит**

```bash
git add engine/core/contracts engine/game/play-loop
git commit -m "A plugin can bring a step the board did not have"
```

---

## Task 8: Математика эталонной игры отдаёт третью форму

**Files:**
- Modify: `engine/examples/first-slot/game/script.spin`, `engine/game/session-dev/src/types.ts`
- Test: `engine/game/session-dev/tests/spin.test.ts`

`reel-step` нужны данные, которых у `first-slot` нет: на каждом шаге — выигрышные клетки, на сколько прокрутить каждый барабан, и осевшая доска. Форма снята с настоящего `ReelStepController` (см. «Проверенные факты»), а не выдумана:

```spin
record ReelStep {
  winning: [CellPos]
  shifts: [int]      -- длина = число колонок; 0 = барабан не двигается
  settled: [[int]]   -- доска после того, как все барабаны прокрутились
}
```

Стадия `base_game` получает `reel_steps: [ReelStep]` — **третью** форму того же спина, рядом с `lines` и `cascade_history`.

**Инвариант, который надо и объявить, и проверить тестом:** `sum` выплат по `reel_steps` относится к тому же спину, что `win`. Как именно — решать вам при написании математики, но `types.ts` обязан сказать это прямо, как он уже говорит про `win` против `base_win`. Молчаливое расхождение трёх форм одного спина — ровно тот дефект, который в Срезе 0 стоил раунда.

- [ ] **Шаг 1: Написать математику** — по образцу уже существующего каскадного цикла в том же файле.

- [ ] **Шаг 2: Проверить компилятором** — `e8 check` (бинарь в `packages/platform-core/bin/`). Ошибка компиляции здесь означает, что дальше идти нельзя.

- [ ] **Шаг 3: Тест на форму, против настоящего сервера**

```ts
it('a spin carries all three shapes of the same result', async () => {
  const r = await play();
  expect(Array.isArray(r.data.lines)).toBe(true);
  expect(Array.isArray(r.data.cascade_history)).toBe(true);
  expect(Array.isArray(r.data.reel_steps)).toBe(true);
});

it('every reel step shifts as many reels as the grid has columns', async () => {
  const r = await play();
  for (const s of r.data.reel_steps) expect(s.shifts).toHaveLength(r.data.grid.length);
});

it('a reel step settles onto a board of the same shape as the grid', async () => {
  const r = await play();
  for (const s of r.data.reel_steps) {
    expect(s.settled).toHaveLength(r.data.grid.length);
    expect(s.settled[0]).toHaveLength(r.data.grid[0].length);
  }
});
```

- [ ] **Шаг 4: Обновить `types.ts`** — новая форма и её инвариант, в том же голосе, каким там уже описано отличие `win` от `base_win`.

- [ ] **Шаг 5: Коммит**

```bash
git add engine/examples/first-slot engine/game/session-dev
git commit -m "The same spin, told a third way"
```

---

## Task 9: `reel-step` — механика как плагин проекта

Задача, ради которой писался этот срез.

**Files:**
- Create: `engine/examples/first-slot/plugins/reel-step/{package.json,src/index.ts}`
- Modify: `engine/examples/first-slot/e8.patch.yml`
- Test: `engine/examples/first-slot/plugins/reel-step/tests/plan.test.ts`

**Плагин обязан приносить обе половины:**
1. **Механику** — `{ id: 'reel-step', requires, present(data): PresentationPlan }`, выдающую шаги вида `reelStep`;
2. **Обработчик шага** — регистрацию в `board.step`, которая знает, как исполнить `reelStep` на поле.

Это и есть проверка заявки. `classic` и `cascade` укладывались в готовый словарь; `reel-step` приносит недостающий шаг **вместе с его исполнением** — и всё это лежит в `plugins/` проекта, а не в движке.

**Ни одна строка под `engine/game/` и `engine/core/` в этой задаче не меняется.** Если окажется, что без правки движка не обойтись — **остановитесь и доложите**. Это не препятствие, а результат: он означает, что заявка об открытости неверна, и лучше узнать это здесь, чем убеждать себя обратном.

- [ ] **Шаг 1: Падающие тесты на план**

```ts
const DATA = {
  grid: [[1, 2, 3], [4, 5, 6]],
  reel_steps: [
    { winning: [{ col: 0, row: 0 }], shifts: [1, 0], settled: [[7, 1, 2], [4, 5, 6]] },
    { winning: [], shifts: [0, 0], settled: [[7, 1, 2], [4, 5, 6]] },
  ],
};

it('lands the reels, then walks the steps', () => {
  expect(plan(DATA).map((s) => s.kind)).toEqual(['spinTo', 'revealWins', 'reelStep']);
});

it('the reelStep step carries the shifts and the settled board', () => {
  const step = plan(DATA).find((s) => s.kind === 'reelStep')!;
  expect(step).toMatchObject({ shifts: [1, 0], settled: DATA.reel_steps[0].settled });
});

it('stops at a step that neither pays nor shifts', () => {
  // The second entry moves nothing and wins nothing — the chain is over.
  expect(plan(DATA).filter((s) => s.kind === 'reelStep')).toHaveLength(1);
});

it('a spin with no reel steps is just the landing', () => {
  expect(plan({ ...DATA, reel_steps: [] }).map((s) => s.kind)).toEqual(['spinTo']);
});
```

- [ ] **Шаг 2: Убедиться, что падают.**

- [ ] **Шаг 3: Написать механику и обработчик шага.** Исполнение на поле — по образцу легаси `ReelStepController` (`packages/game-engine/src/slot/cascade/ReelStepController.ts`): читать можно, править нельзя.

- [ ] **Шаг 4: Добавить строку в `e8.patch.yml`** и привязать `base_game` к `reel-step`.

- [ ] **Шаг 5: Прогнать всё и записать, что менялось.** В отчёте — прямой ответ: понадобилась ли правка чего-либо под `engine/game/` или `engine/core/`, и если да, то какая именно и почему.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/examples/first-slot
git commit -m "A third mechanic arrives as a project plugin, bringing its own step"
```

---

## Task 10: `spin-log`

**Files:**
- Create: `engine/game/spin-log/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`
- Test: `engine/game/spin-log/tests/log.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface SpinLogEntry {
    request: unknown;
    result: unknown;
    plan: PresentationPlan;
  }
  interface SpinLog {
    append(entry: SpinLogEntry): void;   // never throws
    entries(): readonly SpinLogEntry[];  // a copy; mutating it must not reach the log
  }
  function createSpinLog(): SpinLog
  ```
  Плюс рантайм-половина плагина (`apply(ctx)` → `ctx.provide('spinLog', createSpinLog())`), чтобы
  строка состава могла его принести. Отметки времени в запись **не** кладите здесь: тестам
  понадобилось бы подменять часы, а сама запись от времени не зависит. Кому нужно время — ставит
  его снаружи.

§7 спеки, дословно: durable-лог («что произошло») против живых событий («что сейчас видно»). Результат сервера — факт, анимация — интерпретация. «Заводим сразу; задним числом такое не вставляется».

**Что он пишет:** для каждого спина — запрос, результат целиком, выданный `PresentationPlan` и время. **Чего он не делает:** ничего не решает, никого не рендерит и никогда не бросает. Append-only: запись не меняется после добавления.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('records a spin: what was asked, what came back, how it was presented', () => {
  const log = createSpinLog();
  log.append({ request: { bet: 1 }, result: RESULT, plan: PLAN });
  expect(log.entries()).toHaveLength(1);
  expect(log.entries()[0]).toMatchObject({ request: { bet: 1 }, result: RESULT, plan: PLAN });
});

it('entries are append-only — a returned entry cannot be edited into the log', () => {
  const log = createSpinLog();
  log.append({ request: {}, result: RESULT, plan: PLAN });
  (log.entries()[0] as { request: unknown }).request = 'tampered';
  expect(log.entries()[0].request).not.toBe('tampered');
});

it('keeps insertion order', () => {
  const log = createSpinLog();
  log.append({ request: { n: 1 }, result: RESULT, plan: [] });
  log.append({ request: { n: 2 }, result: RESULT, plan: [] });
  expect(log.entries().map((e) => (e.request as { n: number }).n)).toEqual([1, 2]);
});

it('never throws on a result it cannot serialise', () => {
  const log = createSpinLog();
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expect(() => log.append({ request: {}, result: cyclic, plan: [] })).not.toThrow();
  expect(log.entries()).toHaveLength(1);
});
```

Второй тест — суть слова «durable»: лог, чью запись можно поправить снаружи, не является записью о том, что произошло.

- [ ] **Шаг 2–3: Убедиться, что падают; реализовать.**

- [ ] **Шаг 4: Подключить к игре** — `play-loop` пишет в лог, если он есть в составе. Отсутствие строки `spin-log` не ошибка: лог необязателен.

- [ ] **Шаг 5: Коммит**

```bash
git add engine/game/spin-log engine/game/play-loop
git commit -m "Write down what happened, apart from what was shown"
```

---

## Task 11: Приёмка — чужая механика играет

**Files:**
- Create: `engine/apps/web/tests/e2e/reel-step.spec.ts`

Критерий: **третья механика, лежащая в `plugins/` проекта, играет тот же спин третьим способом, и в движке для этого ничего не менялось.**

- [ ] **Шаг 1: Написать e2e**

Утверждать надо то, что увидел бы человек. Приём с захватом одного результата и повторным показом уже отработан в `runtime.spec.ts` — прочитайте его и повторите, а не изобретайте второй способ.

```ts
import { expect, test } from '@playwright/test';

test('the same spin, presented a third way, by a plugin from the project', async ({ page }) => {
  const project = projectCopy();                  // helper from composition.spec.ts
  const host = await startDevHost(project);
  try {
    await page.goto(host.gameUrl);
    await expect(page.locator('#status')).toHaveText('ready');

    // ONE result, captured once. Two spins would prove nothing: two random
    // results differ anyway.
    const captured = await page.evaluate(async () => {
      const res = await fetch('/api/spin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      return res.json();
    });

    // Rebinding goes through the IDE's composition screen, exactly as
    // runtime.spec.ts already does it — NOT through a helper on `window.__e8`.
    // Measured before writing this plan: that harness exposes only
    // `diagnostics`, `spin()` and `present()`; there is no `bind()`. Going
    // through the IDE is also the stronger test, since it exercises the whole
    // pipe rather than the mechanic alone.
    const kindsUnder = async (mechanic: string) => {
      await rebindFromIde(page, 'base_game', mechanic);   // see runtime.spec.ts
      return page.evaluate(
        async (r) => (await window.__e8.present(r.stage, r.data)).map((s) => s.kind),
        captured,
      );
    };

    const cascadeKinds = await kindsUnder('cascade');
    const reelStepKinds = await kindsUnder('reel-step');

    expect(reelStepKinds).not.toEqual(cascadeKinds);
    expect(reelStepKinds).toContain('reelStep');
    expect(cascadeKinds).not.toContain('reelStep');
  } finally {
    await host.stop();
  }
});

test('the third mechanic is genuinely the project\'s, not the engine\'s', async () => {
  // Two independent facts, both checkable without a browser.
  // 1. It lives in the project.
  expect(existsSync(join(PROJECT, 'plugins', 'reel-step', 'package.json'))).toBe(true);
  // 2. The engine never learned its name — no file under engine/game or
  //    engine/core mentions it. This is the assertion that would fail if
  //    someone "made it work" by special-casing the mechanic in the runtime.
  const hits = execSync(
    `grep -rl "reel-step" ${ENGINE}/game ${ENGINE}/core || true`, { encoding: 'utf8' },
  ).trim();
  expect(hits).toBe('');
});
```

**Про второй тест.** Он проверяет утверждение, которое иначе останется словами в отчёте: движок не знает имени этой механики. Если он падает, у него ровно две причины — либо кто-то прописал `reel-step` в движке, либо словарь шагов оказался недостаточно открыт и пришлось. Обе стоят того, чтобы узнать. Если `grep` окажется слишком грубым (имя встретилось в комментарии), сузьте до кода, но **не удаляйте проверку** — замените на такую, которая ловит то же самое.

- [ ] **Шаг 2: Прогнать всю сюиту Playwright целиком**, в одиночку, и проверить осиротевшие процессы.

- [ ] **Шаг 3: Прогнать все пакеты `engine/*`.**

- [ ] **Шаг 4: Коммит**

```bash
git add engine/apps/web
git commit -m "Prove it: a stranger's mechanic plays, and the engine never learned its name"
```

---

## Чего этот план НЕ обещает

- **Достаточность состава движок по-прежнему не проверяет.** `first-slot` объявляет, что ему нужно; общего механизма нет. Пункт 3 записки о долге остаётся.
- **Диагностика работающей игры по-прежнему не доезжает до IDE.** Пункт 2 записки остаётся.
- **`check()` остаётся договорённостью, а не гарантией** (пункт 4). Реестр `board.step` — шаг к тому, чтобы это исправить, но исправление не здесь.
- **`setMultiplier` и `wait` по-прежнему никем не эмитятся.** Реестр не делает их живыми; он лишь перестаёт требовать, чтобы новые виды добавлялись правкой контракта.
- **Горячей смены состава нет.** Как и в Срезе 1a, смена профиля требует перезагрузки страницы.
