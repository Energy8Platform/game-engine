# Слот-WebIDE: Рантайм игры — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Маленькая настоящая игра играется через `e8 dev` на реальной `.spin`-математике, двумя механиками, и видна в превью внутри IDE — где поворот ручки её меняет.

**Architecture:** Игра — второе браузерное cordis-приложение (третье в системе, после хоста и клиента IDE). Её состав собирается из того же `e8.yml`. Плагины: `boot`, `renderer-pixi`, `stage`, `reels`, `play-loop`, `session-dev`, `spin-log`, `ide-bridge`. Механика не анимирует — она выдаёт `PresentationPlan` из общего словаря шагов, который исполняет поле. Реализации не переписываются: `reels` оборачивает `createReelSystem` из легаси `@energy8platform/game-engine/slot`.

**Tech Stack:** cordis 4.0.0-rc.8, pixi.js (через легаси game-engine), `e8-server` (gRPC, SpinML), Vite 6, React 18 (только IDE), Vitest 2, Playwright.

**Spec:** [docs/superpowers/specs/2026-08-27-slot-webide-cordis-design.md](../specs/2026-08-27-slot-webide-cordis-design.md) — §7 (рантайм), §7.1 (тип игры как плагин), §6.1 (схема спина).

**Предыдущий план:** [2026-08-27-slot-webide-skeleton.md](2026-08-27-slot-webide-skeleton.md) — хост, клиент, слоты, форма из схемы, экран «Состав». Всё в `engine/`, ветка `feat/slot-webide-cordis`.

## Global Constraints

- Новый код живёт **только** в `engine/`. `packages/*` и верхнеуровневый `examples/*` — легаси: их можно **импортировать**, но не редактировать.
- Скоуп пакетов — `@energy8engine/*`; каждый новый пакет получает `"private": true`, `tsconfig.json` от `../../../tsconfig.base.json`, свой `vitest.config.ts`, скрипты `test` и `typecheck`.
- Версии: `cordis@4.0.0-rc.8`, `@cordisjs/plugin-loader@1.0.0-rc.5`, `@cordisjs/plugin-server@1.7.0`, `@cordisjs/plugin-include@1.0.4`, `schemastery@3.18.0`, `typescript@^5.6.0`, `vitest@^2.0.0`, `vite@^6.0.0`.
- Тесты — только по рабочей области: `npm test --workspace @energy8engine/<pkg>`.
- **Отказ — это данные.** Ни один сервис не выбрасывает наружу; возвращает `Diagnostic`.
- **Контракты не зависят от cordis, pixi и Node** — проверяется тестом чистоты в `@energy8engine/contracts`.
- Комментарии и сообщения коммитов — на английском.
- **Имя любого нового пакета уникально по всему монорепо.** Совпадение с существующим ломает резолюцию плагинов молча (см. ниже).

---

## Состояние этого плана: дописывается после Task 1

**Задачи 1–5 расписаны полностью** — с кодом тестов и точными значениями; их можно исполнять как есть.

**Задачи 6–12 даны на уровне намерения**, и это осознанно. Их тесты опираются на форму `SpinResult`,
которую Task 1 измеряет у настоящего `e8-server`, и на поверхность `createReelSystem`, которую там же
предстоит примерить. Написать их код сейчас — значит выдумать факты: ровно так предыдущий план трижды
предписал код, который тихо ломался, и трижды это ловило ревью.

**Порядок работы:** исполнить Task 1, зафиксировать измеренную форму результата, затем дописать
задачи 6–12 настоящим кодом и только потом исполнять их. Исполнителю задачи 6+ не начинать, пока её
текст содержит «Написать падающий тест» без самого теста.

---

## Проверенные факты (измерено; не перепроверять)

Из предыдущего плана, по-прежнему в силе:

- `ctx.provide(name, value)` внутри `apply`; `ctx.set` без provide бросает.
- `ctx.effect(fn, label)` — реверсивный эффект; `fiber.getEffects()` даёт метки.
- `FiberState`: PENDING 0, LOADING 1, ACTIVE 2, FAILED 3, DISPOSED 4, UNLOADING 5.
- `ctx.loader.update(id, {config})` **не дожидается** переподнятия — нужен `await entry.fiber?.await()`; отклонённое значение **не** откатывается само; запись состава на диск идёт через ненаблюдаемый `setTimeout(0)` — в тестах опрашивать.
- `ctx.loader.import(name)` резолвит **из корневого `node_modules`**, не относительно проекта.
- Схема schemastery едет по проводу только как `Config.toJSON()`; читатель делает `new Schema(json)`.
- `createIdeHost({ cwd, port })` → `{ ctx, url, diagnostics, stop() }`; сбои старта — в `diagnostics`, хост при этом поднимается.
- Клиент IDE: `createIdeClient` асинхронен; `ctx.slots.register({name,key}, C)`; `ctx.connection.report(d)` записывает и уведомляет.

Новое для этого плана, прочитано в исходниках (проверить в Task 1, не принимать на веру):

- `e8-server` — **gRPC**, не HTTP. Порт по умолчанию `20151` (`DEFAULT_SPIN_PORT` в `packages/platform-core/src/vite/spinPlugin.ts`). Бинарь ищется в порядке: явный путь → `E8_SERVER_BINARY` → `node_modules/@energy8platform/platform-core/bin/e8-server-<platform>-<arch>` → `e8-server` из PATH. В этом репозитории он **уже лежит**: `packages/platform-core/bin/e8-server-darwin-arm64`.
- `spinPlugin` — рабочий образец полного пути: спавн, выбор свободного порта, вызов, форма ответа. Читать его как справочник, а не копировать целиком.
- `createReelSystem({ resolve, config?, board?, features? })` из `@energy8platform/game-engine/slot` возвращает `{ root, setBoard, spin(target, opts?), cascade(steps, opts?), reelStep(steps, opts?), registerFeature, resize, skip, destroy }`. `root` — pixi-контейнер, который кладут в сцену.
- SpinML: минимальная игра — `record Vars`, `enum SpinData tag stage { … }`, `game "id" { bet_levels, max_win, vars, feature, data }`, `action spin { stage = …, cost = 1.0 }`, `fn execute(c: ctx, v: Vars) -> outcome`. `e8 check game/script.spin` компилирует и типизирует.

---

## Файловая структура

```
engine/
  core/contracts/src/
    presentation.ts            словарь шагов + PresentationPlan          [контракт]
    mechanic.ts                SpinMechanic, SpinShapeRequirement        [контракт]
    spin.ts                    форма результата спина на проводе          [контракт]
  game/
    runtime/                   @energy8engine/game-runtime — createGame()
    boot/                      порядок старта, экран ошибок
    renderer-pixi/             шов `renderer`
    stage/                     сцена, вьюпорт, ресайз
    reels/                     реестр reel.feature; обёртка createReelSystem
    play-loop/                 оркестрация спина; исполнитель PresentationPlan
    session-dev/               шов `session` поверх e8-server
    spin-log/                  append-only лог спинов
    mechanic-classic/          механика: spinTo → revealWins
    mechanic-cascade/          механика: цикл revealWins → remove → refill
    ide-bridge/                editor-фаза: WS к хосту, горячий форк
  ide/host/src/plugins/
    dev-game.ts                vite-middleware для игры + маршрут спина
  ide/client/src/screens/
    CompositionScreen.tsx      + панель превью (iframe)
  examples/first-slot/
    game/script.spin           минимальная честная математика 5×3       [РУКАМИ]
    game/spec.json             символы, паутаблица, беты
    e8.yml                     состав игры
    assets/                    плейсхолдеры символов
```

---

### Task 1: Спайк — настоящий спин из `.spin` через `e8-server`

Первой задачей идёт не код рантайма, а шов с математикой: форма результата спина задаёт контракт для всех механик ниже, и ошибка здесь переписывает всё.

**Files:**
- Create: `engine/examples/first-slot/game/script.spin`
- Create: `engine/examples/first-slot/game/spec.json`
- Create: `engine/game/session-dev/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `engine/game/session-dev/src/e8server.ts`
- Test: `engine/game/session-dev/tests/spin.test.ts`

**Interfaces:**
- Consumes: ничего из предыдущего плана.
- Produces: `startE8Server(opts): Promise<E8Handle>` где `E8Handle = { play(req): Promise<SpinResult>; stop(): Promise<void> }`, и **зафиксированная форма `SpinResult`**, которую потребляют все механики.

- [ ] **Step 1: Прочитать образец и снять протокол**

Прочитать `packages/platform-core/src/vite/spinPlugin.ts` целиком. Выписать в отчёт: как выбирается бинарь, как выбирается свободный порт, как формируется запрос, какой ответ приходит. Это справочник, а не донор кода — копировать оттуда в `engine/` нельзя (легаси импортируем, но этот файл — vite-плагин, не библиотека).

Если протокол окажется сложнее, чем «спавн + один вызов» — остановиться и доложить, не изобретая обвязку.

- [ ] **Step 2: Написать минимальную игру**

`engine/examples/first-slot/game/script.spin` — 5×3, выигрыши по линиям, без бонусной стадии. Минимум, который компилируется и возвращает осмысленный результат:

```spin
record Vars {
  max_win_reached: bool
}

record Feat {
  ante: int
}

enum SpinData tag stage {
  base_game {
    grid: [[int]]
    win: float
  }
}

game "first-slot" {
  bet_levels = [0.2, 1.0, 5.0]
  max_win = 500.0
  vars = Vars
  feature = Feat
  data = SpinData
}

action spin {
  stage = base_game
  cost = 1.0
}
```

`fn execute` заполняет `grid` через `rng_weighted` и считает выигрыш по трём горизонтальным линиям. Веса и паутаблицу взять любые разумные — RTP в этом плане не настраивается, это отдельное ремесло.

Проверить: `packages/platform-core/bin/e8-darwin-arm64 check engine/examples/first-slot/game/script.spin` компилируется без ошибок. Точную форму команды уточнить у бинаря (`--help`), не угадывать.

- [ ] **Step 3: Написать падающий тест**

`engine/game/session-dev/tests/spin.test.ts` — поднимает сервер на свободном порту против `first-slot`, делает один спин, проверяет форму:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { startE8Server, type E8Handle } from '../src/e8server';

const GAME = join(__dirname, '..', '..', '..', 'examples', 'first-slot');

let e8: E8Handle;
beforeAll(async () => {
  e8 = await startE8Server({ gamesDir: GAME, port: 0 });
}, 30_000);
afterAll(async () => {
  await e8?.stop();
});

describe('a real spin through e8-server', () => {
  it('returns a 5x3 grid of symbol ids', async () => {
    const result = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(result.stage).toBe('base_game');
    expect(result.data.grid).toHaveLength(5);
    expect(result.data.grid[0]).toHaveLength(3);
    for (const col of result.data.grid) {
      for (const cell of col) expect(typeof cell).toBe('number');
    }
  });

  it('reports a win as a bet multiplier', async () => {
    const result = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(typeof result.data.win).toBe('number');
    expect(result.data.win).toBeGreaterThanOrEqual(0);
  });

  it('gives different grids across spins', async () => {
    const a = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    const b = await e8.play({ gameId: 'first-slot', action: 'spin', betLevel: 1.0 });
    expect(JSON.stringify(a.data.grid)).not.toBe(JSON.stringify(b.data.grid));
  });

  it('stops cleanly — the port is released', async () => {
    const handle = await startE8Server({ gamesDir: GAME, port: 0 });
    const port = handle.port;
    await handle.stop();
    const second = await startE8Server({ gamesDir: GAME, port });
    expect(second.port).toBe(port);
    await second.stop();
  });
});
```

- [ ] **Step 4: Запустить и убедиться, что падает**

Run: `npm install && npm test --workspace @energy8engine/session-dev`
Expected: FAIL — `startE8Server` не существует.

- [ ] **Step 5: Реализовать**

`src/e8server.ts`: поиск бинаря (порядок из образца), выбор свободного порта при `port: 0`, спавн с `--games-dir`, ожидание готовности, вызов, корректная остановка. Ошибка запуска — отвергнутый промис с внятным текстом (это единственное место в плане, где отказ ещё не диагностика: сервис `session` появится в Task 8 и обернёт это).

Форму `SpinResult` зафиксировать в `src/types.ts` и **выписать в отчёт дословно** — Task 4 и далее строятся на ней.

- [ ] **Step 6: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/session-dev`
Expected: PASS, 4 теста.

- [ ] **Step 7: Коммит**

```bash
git add engine/examples/first-slot engine/game/session-dev
git commit -m "feat(session-dev): a real spin, from a real .spin, over e8-server"
```

---

### Task 2: Словарь шагов презентации

**Files:**
- Create: `engine/core/contracts/src/presentation.ts`
- Modify: `engine/core/contracts/src/index.ts`
- Test: `engine/core/contracts/tests/presentation.test.ts`

**Interfaces:**
- Produces: `PresentationStep` (размеченное объединение), `PresentationPlan = PresentationStep[]`, и предикат `isPresentationStep(v): v is PresentationStep`.

Это **контракт**, а не плагин: он не становится расширяемым в этом плане. Реестр `board.step` для чужих шагов — следующий план; здесь фиксируется словарь, на котором обе механики обязаны выразиться.

- [ ] **Step 1: Написать падающий тест**

`engine/core/contracts/tests/presentation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isPresentationStep } from '../src/index';

describe('presentation steps', () => {
  it('accepts every step the two Slice-0 mechanics need', () => {
    const plan = [
      { kind: 'spinTo', board: [[1, 2, 3]] },
      { kind: 'revealWins', lines: [{ line: 0, symbols: 3, amount: 1.5 }] },
      { kind: 'remove', cells: [{ col: 0, row: 1 }] },
      { kind: 'refill', board: [[4, 5, 6]] },
      { kind: 'setMultiplier', value: 2 },
      { kind: 'wait', ms: 300 },
    ];
    for (const step of plan) expect(isPresentationStep(step)).toBe(true);
  });

  it('rejects a step with an unknown kind', () => {
    expect(isPresentationStep({ kind: 'explode', force: 9 })).toBe(false);
  });

  it('rejects a well-shaped kind whose payload is wrong', () => {
    expect(isPresentationStep({ kind: 'wait', ms: 'soon' })).toBe(false);
    expect(isPresentationStep({ kind: 'spinTo' })).toBe(false);
  });

  it('rejects non-objects instead of throwing', () => {
    for (const value of [null, undefined, 42, 'spinTo', []]) {
      expect(isPresentationStep(value)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/contracts`
Expected: FAIL — `isPresentationStep is not a function`.

- [ ] **Step 3: Реализовать**

`presentation.ts`: типы шагов и предикат. Каждый шаг документируется одной строкой — что он означает для игрока, не как он реализован. Файл не импортирует ничего, кроме относительных путей (тест чистоты это проверяет).

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `npm test --workspace @energy8engine/contracts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add engine/core/contracts
git commit -m "feat(contracts): the presentation step vocabulary both mechanics speak"
```

---

### Task 3: Контракт механики

**Files:**
- Create: `engine/core/contracts/src/mechanic.ts`
- Modify: `engine/core/contracts/src/index.ts`
- Test: `engine/core/contracts/tests/mechanic.test.ts`

**Interfaces:**
- Consumes: `PresentationPlan` (Task 2), `Diagnostic`.
- Produces: `SpinMechanic`, `SpinShapeRequirement`, `checkShape(req, sample): Diagnostic[]` — сверка требований механики с фактической формой данных стадии.

`checkShape` — это то, что в спеке §7.1 названо «`expects` проверяется до запуска»: механика объявляет, какие поля стадии ей нужны, и несовпадение становится читаемой диагностикой, а не белым экраном после клика.

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from 'vitest';
import { checkShape } from '../src/index';

describe('checkShape', () => {
  it('passes when every required field is present with the right kind', () => {
    const req = { fields: { grid: 'grid', win: 'number' } } as const;
    expect(checkShape(req, { grid: [[1]], win: 0 }, 'classic', 'base_game')).toEqual([]);
  });

  it('names the mechanic, the stage and the missing field', () => {
    const req = { fields: { steps: 'list' } } as const;
    const [d] = checkShape(req, { grid: [[1]] }, 'cascade', 'base_game');
    expect(d.severity).toBe('error');
    expect(d.message).toContain('cascade');
    expect(d.message).toContain('base_game');
    expect(d.message).toContain('steps');
  });

  it('reports a field that exists with the wrong kind', () => {
    const req = { fields: { grid: 'grid' } } as const;
    const [d] = checkShape(req, { grid: 7 }, 'classic', 'base_game');
    expect(d.message).toContain('grid');
  });

  it('reports every mismatch, not just the first', () => {
    const req = { fields: { grid: 'grid', steps: 'list' } } as const;
    expect(checkShape(req, {}, 'cascade', 'base_game')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm test --workspace @energy8engine/contracts`
Expected: FAIL.

- [ ] **Step 3: Реализовать**

Виды полей на этот план: `number`, `grid` (массив массивов чисел), `list` (непустой массив). Больше не изобретать — расширение придёт от третьей механики, а не от воображения.

- [ ] **Step 4: Запустить и убедиться, что проходит** — PASS.

- [ ] **Step 5: Коммит**

```bash
git add engine/core/contracts
git commit -m "feat(contracts): a mechanic declares the spin shape it needs"
```

---

### Task 4: Механика `classic`

**Files:**
- Create: `engine/game/mechanic-classic/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `engine/game/mechanic-classic/src/index.ts`
- Test: `engine/game/mechanic-classic/tests/plan.test.ts`

**Interfaces:**
- Consumes: `PresentationPlan`, `RevealedLine`, `SpinShapeRequirement` from `@energy8engine/contracts`.
- Produces: `expects: SpinShapeRequirement` and `plan(data): PresentationPlan`, plus a cordis plugin
  that registers them under the id `classic` (the registry itself lands in Task 6; until then the
  plugin module exports `mechanic` and the tests call `plan` directly).

`data` is the measured stage data: `{ grid, win, base_win, lines: [{line,symbol,count,win,positions}], cascade_history }`.
`classic` reads `grid`, `base_win` and `lines`, and **ignores `cascade_history` entirely** — the same
game switched to `cascade` renders the chain instead. It reveals `base_win`, never `win`: the
credited total is the host's business and no step carries it.

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from 'vitest';
import { expects, plan } from '../src/index';

const WON = {
  grid: [[1, 2, 3], [4, 5, 6], [7, 8, 9], [1, 2, 3], [4, 5, 6]],
  win: 1.5,
  base_win: 0.5,
  lines: [{ line: 0, symbol: 1, count: 3, win: 0.5, positions: [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 2, row: 0 }] }],
  cascade_history: [{ grid: [[1]], removed: [{ col: 0, row: 0 }], win: 0.5 }],
};

const LOST = { ...WON, win: 0, base_win: 0, lines: [], cascade_history: [] };

describe('classic', () => {
  it('spins to the board, then reveals the base-game lines', () => {
    expect(plan(WON).map((s) => s.kind)).toEqual(['spinTo', 'revealWins']);
  });

  it('spins to the grid it was given', () => {
    expect(plan(WON)[0]).toEqual({ kind: 'spinTo', board: WON.grid });
  });

  it('reveals base_win, not the credited win', () => {
    const reveal = plan(WON)[1] as { total: number };
    expect(reveal.total).toBe(0.5);
  });

  it('passes the lines through unchanged, positions and all', () => {
    const reveal = plan(WON)[1] as { lines: unknown[] };
    expect(reveal.lines).toEqual(WON.lines);
  });

  it('stops after the spin when nothing won', () => {
    expect(plan(LOST).map((s) => s.kind)).toEqual(['spinTo']);
  });

  it('ignores cascade_history even when the math produced one', () => {
    expect(JSON.stringify(plan(WON))).not.toContain('cascade_history');
    expect(plan(WON)).toHaveLength(2);
  });

  it('declares the fields it needs and not the ones it does not', () => {
    expect(expects.fields).toEqual({ grid: 'grid', base_win: 'number', lines: 'list' });
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `npm install && npm test --workspace @energy8engine/mechanic-classic`
Expected: FAIL — модуля нет.

- [ ] **Step 3: Реализовать** — `plan()` возвращает `[spinTo]` либо `[spinTo, revealWins]`; `revealWins.total` берётся из `base_win`, `lines` передаются как есть.

- [ ] **Step 4: Запустить и убедиться, что проходит** — PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add engine/game/mechanic-classic
git commit -m "feat(mechanic-classic): a spin is a board and the base-game lines on it"
```

---

### Task 5: Механика `cascade`

**Files:**
- Create: `engine/game/mechanic-cascade/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `engine/game/mechanic-cascade/src/index.ts`
- Test: `engine/game/mechanic-cascade/tests/plan.test.ts`

Вторая механика — не украшение. Если словарь подогнан под одну, он развалится на второй, и лучше
узнать это сейчас. **Если шаг каскада не выражается словарём — остановиться и доложить**, а не
расширять словарь молча: он объявлен контрактом и в этом плане не растёт.

Каскадный раунд из математики — `{ grid, removed, win }`, без разбивки по линиям. Поэтому его
`revealWins` несёт `total` этого раунда и **пустой** `lines`: словарь это позволяет ровно для
такого случая.

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, expect, it } from 'vitest';
import { expects, plan } from '../src/index';

const CHAIN = {
  grid: [[1, 2, 3]],
  win: 1.5,
  base_win: 0.5,
  lines: [],
  cascade_history: [
    { grid: [[1, 2, 3]], removed: [{ col: 0, row: 0 }], win: 0.5 },
    { grid: [[7, 2, 3]], removed: [{ col: 0, row: 1 }], win: 1.0 },
    { grid: [[7, 8, 3]], removed: [], win: 0 },
  ],
};

describe('cascade', () => {
  it('spins to the first board, then reveals and collapses each paying round', () => {
    expect(plan(CHAIN).map((s) => s.kind)).toEqual([
      'spinTo', 'revealWins', 'remove', 'refill',
      'revealWins', 'remove', 'refill',
    ]);
  });

  it('spins to the first round board', () => {
    expect(plan(CHAIN)[0]).toEqual({ kind: 'spinTo', board: CHAIN.cascade_history[0].grid });
  });

  it("reveals each round's own win, with no line breakdown to give", () => {
    const reveals = plan(CHAIN).filter((s) => s.kind === 'revealWins') as { total: number; lines: unknown[] }[];
    expect(reveals.map((r) => r.total)).toEqual([0.5, 1.0]);
    expect(reveals.every((r) => r.lines.length === 0)).toBe(true);
  });

  it('removes the cells that round cleared', () => {
    const removes = plan(CHAIN).filter((s) => s.kind === 'remove');
    expect(removes[0]).toEqual({ kind: 'remove', cells: [{ col: 0, row: 0 }] });
  });

  it('refills with the NEXT round board, not the one just cleared', () => {
    const refills = plan(CHAIN).filter((s) => s.kind === 'refill') as { board: number[][] }[];
    expect(refills[0].board).toEqual(CHAIN.cascade_history[1].grid);
    expect(refills[1].board).toEqual(CHAIN.cascade_history[2].grid);
  });

  it('stops at the first round that cleared nothing', () => {
    const one = { ...CHAIN, cascade_history: [{ grid: [[1]], removed: [], win: 0 }] };
    expect(plan(one).map((s) => s.kind)).toEqual(['spinTo']);
  });

  it('declares that it needs the chain', () => {
    expect(expects.fields).toEqual({ cascade_history: 'list' });
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает** — FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить и убедиться, что проходит** — PASS, 7 тестов.
- [ ] **Step 5: Коммит**

```bash
git add engine/game/mechanic-cascade
git commit -m "feat(mechanic-cascade): a spin is a chain that collapses"
```

---

### Task 6: Ядро рантайма — `createGame()` и реестр механик

**Files:**
- Create: `engine/game/runtime/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `engine/game/runtime/src/index.ts`
- Create: `engine/game/runtime/src/plugins/mechanics.ts`
- Test: `engine/game/runtime/tests/{boot,mechanics}.test.ts`

**Interfaces:**
- Produces: `createGame(config): Promise<GameApp>` где `GameApp = { ctx, diagnostics, stop() }`; сервис `ctx.mechanics` с `register(mechanic)` (реверсивный эффект) и `forStage(stage)`.

Игра — cordis-приложение, как хост и клиент IDE. Здесь заводится контекст и первый реестр; рендерер и поле приходят следующими задачами.

- [ ] **Step 1: Написать падающий тест** — тесты на: контекст поднимается и гасится; механика регистрируется и находится по стадии; регистрация реверсивна (после `dispose` плагина механика исчезает); две механики на одну стадию — диагностика, а не молчаливый выбор.
- [ ] **Step 2: Запустить и убедиться, что падает** — FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить и убедиться, что проходит.**
- [ ] **Step 5: Коммит**

```bash
git add engine/game/runtime
git commit -m "feat(game-runtime): the game is a cordis app with a mechanic registry"
```

---

### Task 7: Исполнитель плана презентации

**Files:**
- Create: `engine/game/play-loop/{package.json,tsconfig.json,vitest.config.ts}`
- Create: `engine/game/play-loop/src/index.ts`
- Test: `engine/game/play-loop/tests/execute.test.ts`

**Interfaces:**
- Consumes: `PresentationPlan`, шов `board` (объявляется здесь, реализуется в Task 9).
- Produces: `executePlan(plan, board): Promise<void>` — исполняет шаги по порядку, каждый ждёт предыдущего.

Тестируется на **фейковом поле**, записывающем вызовы: это единственный способ проверить хореографию без pixi. Само поле проверяется отдельно в Task 9.

- [ ] **Step 1: Написать падающий тест** — порядок сохраняется; асинхронный шаг дожидается; шаг, которого поле не умеет, даёт диагностику и **не** прерывает остальные; `wait` действительно ждёт (через фейковые таймеры, не через сон).
- [ ] **Step 2–4: RED → реализация → GREEN.**
- [ ] **Step 5: Коммит**

```bash
git add engine/game/play-loop
git commit -m "feat(play-loop): steps in, choreography out"
```

---

### Task 8: Шов `session` поверх `e8-server`

**Files:**
- Modify: `engine/game/session-dev/src/index.ts` (плагин поверх `e8server.ts` из Task 1)
- Test: `engine/game/session-dev/tests/plugin.test.ts`

Здесь запуск сервера из Task 1 становится плагином: провайдер шва `session` с матчером `{ default: true }`, все отказы — диагностики, остановка сервера — реверсивный эффект.

- [ ] **Step 1: Написать падающий тест** — сервис появляется; спин отдаёт результат; недоступный бинарь даёт диагностику, а не исключение; при выгрузке плагина процесс сервера умирает.
- [ ] **Step 2–4: RED → реализация → GREEN.**
- [ ] **Step 5: Коммит**

```bash
git add engine/game/session-dev
git commit -m "feat(session-dev): the math seam, as a plugin that fails as data"
```

---

### Task 9: Поле — `renderer-pixi`, `stage`, `reels`

**Files:**
- Create: `engine/game/renderer-pixi/**`, `engine/game/stage/**`, `engine/game/reels/**`
- Test: соответствующие `tests/`

**Interfaces:**
- Produces: провайдер шва `renderer` (pixi `Application`), шов `stage`, и шов `board` — реализация словаря шагов поверх `createReelSystem`.

**Легаси оборачивается, не переписывается.** `reels` импортирует `createReelSystem` из `@energy8platform/game-engine/slot` и отображает шаги словаря на его методы: `spinTo` → `spin(target)`, `remove`+`refill` → `cascade(steps)`, и так далее. Если шаг не ложится на существующий API — доложить, не форкать легаси.

Тесты — без браузера: pixi инициализируется в jsdom плохо, поэтому `reels` тестируется через подставной `ReelSystem`, а настоящая отрисовка проверяется headless-петлёй в Task 12. Это осознанная граница: в тестах — контракт отображения, в headless — что оно живое.

- [ ] **Step 1: Написать падающие тесты.**
- [ ] **Step 2–4: RED → реализация → GREEN.**
- [ ] **Step 5: Коммит**

```bash
git add engine/game/renderer-pixi engine/game/stage engine/game/reels
git commit -m "feat(game): a board that speaks the step vocabulary, over the legacy reel system"
```

---

### Task 10: `boot` и экран ошибок

**Files:**
- Create: `engine/game/boot/**`
- Test: `engine/game/boot/tests/boot.test.ts`

Порядок старта и — важнее — что видит человек, когда состав игры сломан. Спека §8: на `error` игра не стартует и **показывает текст**, а не белый прямоугольник.

- [ ] **Step 1: Написать падающий тест** — при диагностике уровня `error` рендерится читаемый экран с текстом и списком причин; при `warning` игра стартует; экран ошибок не требует pixi (это DOM), иначе сломанный рендерер нечем показать.
- [ ] **Step 2–4: RED → реализация → GREEN.**
- [ ] **Step 5: Коммит**

```bash
git add engine/game/boot
git commit -m "feat(boot): a broken composition shows its reasons, not a white rectangle"
```

---

### Task 11: `e8 dev` — игра поднимается одной командой

**Files:**
- Create: `engine/ide/host/src/plugins/dev-game.ts`
- Modify: `engine/apps/cli/src/index.ts` (команда `dev`)
- Create: `engine/examples/first-slot/e8.yml`
- Test: `engine/ide/host/tests/dev-game.test.ts`

**Один сервер, два потребителя.** `e8 dev` поднимает тот же cordis-хост (у него уже есть `plugin-server`), плюс плагин `dev-game`: vite в middleware-режиме отдаёт бандл игры, маршрут спина ходит в `session-dev`. Превью в IDE (Task 12) смотрит в этот же сервер — отдельного не заводим.

- [ ] **Step 1: Написать падающий тест** — `e8 dev` отвечает на корне HTML игры; маршрут спина возвращает результат; хост при этом по-прежнему отдаёт `/api/health` и состав.
- [ ] **Step 2–4: RED → реализация → GREEN.**
- [ ] **Step 5: Проверить руками** — `npx e8 dev` в `engine/examples/first-slot`, открыть в браузере, покрутить спин. Записать в отчёт, что видно.
- [ ] **Step 6: Коммит**

```bash
git add engine/ide/host engine/apps/cli engine/examples/first-slot
git commit -m "feat(cli): e8 dev — one command, one server, a game that spins"
```

---

### Task 12: Превью в IDE и горячий форк до игры

**Files:**
- Create: `engine/game/ide-bridge/**`
- Modify: `engine/ide/client/src/screens/CompositionScreen.tsx`
- Test: `engine/ide/client/tests/preview.test.tsx`
- Test: `engine/apps/web/tests/e2e/runtime.spec.ts`

Замыкание критерия №2 спеки: крутнул ручку — увидел, как изменилась игра. `ide-bridge` — плагин фазы editor, которого нет в продовой сборке: он слушает патч по WS и перезапускает нужный форк на месте.

- [ ] **Step 1: Написать падающий тест** — панель превью показывает iframe на адрес `dev-game`; правка настройки доезжает до игры без перезагрузки страницы IDE; плагин, объявивший `hot: false`, вызывает честную перезагрузку iframe.
- [ ] **Step 2–4: RED → реализация → GREEN.**
- [ ] **Step 5: Приёмка в браузере** — Playwright: игра видна в превью, спин крутится, изменение скорости барабана меняет поведение игры **без** перезагрузки страницы.
- [ ] **Step 6: Коммит**

```bash
git add engine/game/ide-bridge engine/ide/client engine/apps/web
git commit -m "test(ide): turn a knob, watch the game change"
```

---

## Критерии приёмки

1. Маленькая настоящая игра играется через `e8 dev` на результатах из `.spin`, посчитанных `e8-server`.
2. Обе механики — `classic` и `cascade` — выражены словарём шагов; ни одна не анимирует сама.
3. Механика, чьи требования не сходятся с формой данных стадии, даёт читаемую диагностику **до** спина.
4. Сломанный состав показывает текст с причинами, а не белый прямоугольник.
5. В IDE видно превью игры, и поворот ручки меняет её без перезагрузки страницы.
6. Легаси не изменено ни одним файлом — только импортировано.

## Что этот план НЕ делает

- **Не настраивает RTP и волатильность.** Математика минимально честная: компилируется, возвращает осмысленный результат. Тюнинг — отдельное ремесло со своим пайплайном.
- **Не делает стену экранов.** Превью — один iframe. Пресеты устройств, ориентации и языки — план 4.
- **Не заводит реестр `board.step`.** Словарь шагов — контракт; чужой шаг от чужой механики появится, когда появится третья механика.
- **Не решает резолюцию плагинов из `plugins/` проекта.** `loader.import` резолвит из корневого `node_modules`; формат проекта и его резолюция — следующий план.
- **Не трогает звук, бонусные стадии, покупку бонуса, stake-таргет.**
- **Не чинит переподключение клиента IDE** после перезапуска хоста — записано в долги предыдущего плана.
