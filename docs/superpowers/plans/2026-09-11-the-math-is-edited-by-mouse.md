# Срез 6: математику правят мышью — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Экран «Код»: `game/script.spin` и файлы `plugins/**` правятся в браузере, сохраняются через готовую запись, и ошибки разбора показываются маркерами прямо в поле — по позиции, а не по разбору прозы. Сохранение доезжает до игры.

**Architecture:** `Diagnostic` получает необязательное **структурное** место `at`, и его заполняет только `spin-parser`; никто больше не меняется. Разбор — чистая функция строки, поэтому проверка не требует записи: `POST /api/check` отдаёт диагностики для присланного текста, и редактор ставит маркеры до сохранения. Monaco приезжает настоящей зависимостью с настройкой в единственном vite-конфиге, и это главный риск среза.

**Tech Stack:** TypeScript, cordis 4.0.0-rc.8, React 18, vite 6, vitest 2, Playwright, monaco-editor.

**Spec:** `docs/superpowers/specs/2026-08-27-slot-webide-cordis-design.md` — §5 («Код» — Monaco для `plugins/**` и `game/script.spin`, маркеры от `e8 check`), §8 (отказ как данные; один список), §11 (Фаза 4).

**Долг, который гасится:** ничего напрямую. Записка Среза 5, пункты 7 и 8 (base64, дерево целиком) станут заметнее и остаются записанными.

---

## Global Constraints

- Новый код — **только** в `engine/`. `packages/*` и верхнеуровневый `examples/*` — легаси: читать и импортировать можно, править нельзя. `engine/examples/first-slot` — наш.
- Комментарии и коммиты — по-английски, короткими повествовательными предложениями в голосе репозитория. Без списков в теле коммита; в заголовке не называть процесс проверки.
- **Контракты — словари, плагины — решения.** `engine/core/*` не импортирует ничего, кроме относительных модулей; строгий тест чистоты.
- **Отказ — это данные.** Ни один шов не бросает; ни один путь не заканчивается пустым экраном без объяснения. Ни одна надпись не утверждает причину, которой код не знает.
- **Ни одно решение не принимается разбором прозы.** Срез 5 убрал `statusFor`'s regex по английскому тексту; этот срез не имеет права вернуть тот же приём ради позиции маркера.
- Тесты — по пакетам: `npm test --workspace @energy8engine/<pkg>`. Корневой прогон даёт ложные падения.
- Playwright в `engine/apps/web`: `workers: 1`, порт 5679, **в одиночку** — в одиночку от любой корневой команды `npm`: временные копии `e8-compose-*` попадают в маску `engine/*/*` и дают `EDUPLICATEWORKSPACE`. Потом проверка осиротевших процессов **перечислением** и что не осталось `engine/examples/e8-compose-*`.
- Вкладки адресуются `data-testid="tab-<id>"`, не видимым текстом.
- Каждое утверждение задаётся **вместе с мутацией, которая обязана его уронить**, и мутацию надо сначала убедиться, что она **приземлилась**: число тестов, а не строка «passed». На этой ветке двадцать четыре раза утверждение проходило не через ту ветку, которую называет.

---

## Проверенные факты

Измерено на текущем HEAD (`fe686f4`).

### Позиция существует, но едет прозой

`spin-parser/src/index.ts:479` — `diagnostic('error', PLUGIN, \`line ${line}\`, …)`. Номер строки живёт в поле `where`, как английский текст. Маркер Monaco требует числа.

Разбирать это обратно регулярным выражением нельзя: **Срез 5 только что убрал ровно такой приём** из `statusFor`, где HTTP-статус выбирался по `/was not found/i` — и причина та же, буквально: этот интерфейс переводят, а перевод молча превратил бы каждый 404 в 400. Позиция должна приехать полем.

### Разбор — чистая функция строки

`spin-parser/src/index.ts:1083` — `parseSpinSchema(source: string): { schema, diagnostics }`. Ни файла, ни состояния. Значит проверка присланного текста не требует ни записи, ни временного файла, и редактор может показывать ошибки **до** сохранения.

### Хост уже держит всю цепочку

`engine/ide/host/src/plugins/schema.ts` читает `game/script.spin`, зовёт `parseSpinSchema` (`:138`), превращает результат в диагностики и отдаёт сервисом `spinSchema` с `reload()` (`:76-81`, `:113`). Новый маршрут переиспользует разбор, а не заводит второй.

### Запись в проект готова

Срез 5 дал `PUT /api/files/*` и клиентский `ctx.files.write`, с удержанием в каталоге, отказом по символическим ссылкам и защитой `.git`. Экран «Код» ничего из этого не повторяет.

### Monaco в репозитории нет, и это главный риск

`grep -rn monaco --include=package.json engine/ packages/` не даёт ничего. `engine/apps/web/vite.config.ts` — единственный vite-конфиг во всём `engine/`.

**Срез 4 уже получил урок этой формы.** Импорт из легаси-харнесса уронил **всё приложение** при загрузке и сломал `vite build`, потому что единственный вход пакета начинался с безусловных `node:fs`/`node:url`. Ни `npm test`, ни `typecheck` этого не видели — только сборка и настоящий браузер. Monaco тянет web workers и собственные правила сборки; та же проверка обязательна.

---

## Структура файлов

| Путь | Ответственность |
|---|---|
| `engine/core/contracts/src/diagnostic.ts` | изменить — `Diagnostic.at?: SourcePosition` |
| `engine/core/spin-parser/src/index.ts` | изменить — заполнить `at`, оставить `where` как было |
| `engine/ide/host/src/plugins/schema.ts` | изменить — маршрут `POST /api/check` |
| `engine/ide/client/src/plugins/check.ts` | **создать** — клиентская проверка текста |
| `engine/ide/client/src/editor/Monaco.tsx` | **создать** — обёртка: монтирование, размонтирование, маркеры |
| `engine/ide/client/src/screens/CodeScreen.tsx` | **создать** — выбор файла, правка, сохранение |
| `engine/apps/web/vite.config.ts` | изменить — настройка Monaco |
| `engine/apps/web/src/App.tsx` | изменить — экран «Код» регистрируется |
| `engine/apps/web/tests/e2e/code.spec.ts` | **создать** — приёмка |

---

## Task 1: Диагностика получает место

**Files:**
- Modify: `engine/core/contracts/src/diagnostic.ts`, `engine/core/contracts/tests/diagnostic.test.ts`
- Modify: `engine/core/spin-parser/src/index.ts`, `engine/core/spin-parser/tests/*`

**Interfaces:**
```ts
export interface SourcePosition {
  /** 1-based, as every editor counts. */
  line: number;
  /** 1-based. Absent when the producer knows the line and not the column. */
  column?: number;
}

export interface Diagnostic {
  // …unchanged…
  /**
   * Where in a source FILE this is, when the producer knows. Structured
   * because an editor needs a number: `where` carries prose for a human and
   * must never be parsed back — this branch removed exactly that pattern from
   * the host's status selection one slice ago.
   *
   * Absent everywhere except the spin parser today. Absent is not "line 1".
   */
  at?: SourcePosition;
}
```

**Interfaces produced:** `SourcePosition` and `Diagnostic.at` — tasks 2, 4 and 5 consume them.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('a record block with no name carries the line it was on', () => {
  const { diagnostics } = parseSpinSchema('record {\n  x = 1\n}\n');
  expect(diagnostics[0].at).toEqual({ line: 1 });
});

it('the line is 1-based, matching what an editor shows', () => {
  // Off by one here means every marker sits one row above its error, which
  // looks like the parser is wrong rather than the reporter.
  const { diagnostics } = parseSpinSchema('game = Spin\n\nrecord {\n}\n');
  expect(diagnostics[0].at!.line).toBe(3);
});

it('keeps `where` exactly as it was, for the human reading a list', () => {
  // `at` is for the editor. Removing the prose would empty every list that
  // shows diagnostics without a source file beside them.
  const { diagnostics } = parseSpinSchema('record {\n}\n');
  expect(diagnostics[0].where).toContain('line 1');
});

it('a diagnostic about no particular line has no `at` at all', () => {
  // Absent means "the producer does not know", not line 1. A marker at the
  // top of the file for a whole-file problem points at innocent code.
  const { diagnostics } = parseSpinSchema('');
  expect(diagnostics.some((d) => d.at !== undefined)).toBe(false);
});

it('every diagnostic that names a line in `where` also carries `at`', () => {
  // The guard against the two drifting: a future parser site that writes the
  // prose and forgets the field would show a line to a human and none to the
  // editor. Structural, over many malformed sources, not one fixture.
  //
  // The corpus is built here rather than read from disk: the real `.spin`
  // files in this repo mostly PARSE, and a source with nothing wrong produces
  // no diagnostic to check. Each entry below is one way to be wrong.
  const BROKEN = [
    'record {\n}\n',
    'game = Spin\n\nrecord {\n}\n',
    'action {\n  opens\n}\n',
    'enum {\n  a\n}\n',
    'game = Spin\naction Spin {\n  data = Missing\n}\n',
    'game = Spin\nrecord R {\n  x =\n}\n',
  ];
  for (const source of BROKEN) {
    for (const d of parseSpinSchema(source).diagnostics) {
      if (/line \d+/.test(d.where)) expect(d.at, d.where).toBeDefined();
    }
  }
});
```

- [ ] **Шаг 2: Прогнать, убедиться, что падают**

Run: `npm test --workspace @energy8engine/contracts` and `--workspace @energy8engine/spin-parser`

- [ ] **Шаг 3: Реализовать**

`contracts` — поле и его документация; ничего не импортировать, тест чистоты строгий. `spin-parser` — заполнить `at` там, где номер строки уже известен. Строк, где он известен, много (`:186`, `:272`, `:280`, `:328`, `:430`, `:479` и далее); пройти все, а не одну, иначе последний тест это и покажет.

- [ ] **Шаг 4: Прогнать**

- [ ] **Шаг 5: Мутации**

Сдвиньте `line` на единицу → покраснеет тест 1-based. Уберите `at` на одном сайте → покраснеет структурный тест по корпусу, и это то, ради чего он есть. Уберите `where` → покраснеет тест про прозу, доказывая, что поля не подменяют друг друга.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/core
git commit -m "A diagnostic can say where it is, in a number an editor can use"
```

---

## Task 2: `POST /api/check`

**Files:**
- Modify: `engine/ide/host/src/plugins/schema.ts`, `engine/ide/host/tests/schema.test.ts`
- Modify: `engine/core/contracts/src/files.ts` (тело ответа, рядом с остальными)

**Interfaces:**
```ts
/** `POST /api/check` — body `{ source: string }`. */
export interface CheckResponse {
  diagnostics: Diagnostic[];
}
```

Тело ответа кладётся в `contracts` рядом с телами Среза 5. Причина записана: одна задача завела форму, другая прочла её неверно, и обе проверки прошли, потому что типы не связывали концы.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('parses the source it was handed, without touching any file', async () => {
  const host = await startHost(fixture('plain'));
  const before = readFileSync(join(dir, 'game/script.spin'), 'utf8');
  const res = await fetch(`${host.url}/api/check`, {
    method: 'POST',
    body: JSON.stringify({ source: 'record {\n}\n' }),
  });
  expect((await res.json()).diagnostics[0].at).toEqual({ line: 1 });
  expect(readFileSync(join(dir, 'game/script.spin'), 'utf8')).toBe(before);
});

it('a source with nothing wrong answers with an empty list, not a null', async () => {
  // An editor clearing its markers needs "no problems" to be a value.
  const host = await startHost(fixture('plain'));
  const source = readFileSync(join(dir, 'game/script.spin'), 'utf8');
  const res = await fetch(`${host.url}/api/check`, {
    method: 'POST', body: JSON.stringify({ source }),
  });
  expect((await res.json()).diagnostics).toEqual([]);
});

it('a body with no source is a diagnostic, not a crash', async () => {
  const host = await startHost(fixture('plain'));
  const res = await fetch(`${host.url}/api/check`, {
    method: 'POST', body: JSON.stringify({ notSource: 'x' }),
  });
  expect(res.status).toBe(400);
  expect((await res.json()).diagnostics).toHaveLength(1);
});

it('a body that is not JSON is a diagnostic, not an empty 500', async () => {
  // The scar: an unwrapped parse once answered 500 with nothing in the body.
  const host = await startHost(fixture('plain'));
  const res = await fetch(`${host.url}/api/check`, { method: 'POST', body: '<html>' });
  expect(res.status).toBe(400);
  expect((await res.json()).diagnostics).toHaveLength(1);
});

it('does not disturb the schema service the project is already using', async () => {
  // `/api/check` is a pure question about a string. If it reloaded or
  // replaced `spinSchema`, typing in the editor would rewrite what the
  // composition screen believes about a file nobody saved.
  const host = await startHost(fixture('plain'));
  const before = host.ctx.spinSchema.schema;
  await fetch(`${host.url}/api/check`, { method: 'POST', body: JSON.stringify({ source: 'record {\n}\n' }) });
  expect(host.ctx.spinSchema.schema).toBe(before);
});
```

- [ ] **Шаг 2–4: Прогнать, реализовать, прогнать**

- [ ] **Шаг 5: Мутации**

Заставьте маршрут писать во временный файл → покраснеет тест «не трогает файл». Заставьте его звать `spinSchema.reload()` → покраснеет тест про сервис. Снимите `try` вокруг разбора тела → покраснеет тест про не-JSON.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/core/contracts engine/ide/host
git commit -m "The host can answer what is wrong with a source nobody saved yet"
```

---

## Task 3: Клиентская проверка

**Files:**
- Create: `engine/ide/client/src/plugins/check.ts`, `engine/ide/client/tests/check.test.ts`
- Modify: `engine/ide/client/src/index.ts`, `engine/ide/client/src/context.ts`

**Interfaces:**
```ts
export interface CheckService {
  /** Diagnostics for this text. Never throws; a dead network is a diagnostic. */
  check(source: string): Promise<{ diagnostics: Diagnostic[] }>;
}
declare module 'cordis' { interface Context { check: CheckService } }
export const name = 'check';
export function apply(ctx: Context, config?: { fetchFn?: typeof fetch }): void;
```

- [ ] **Шаг 1: Падающие тесты**

Возьмите форму из `engine/ide/client/src/plugins/files.ts` — она уже решает ровно эти задачи: пронести чужие диагностики без изменений, отличить мёртвую сеть от пустого ответа, отличить тело неверной формы от тела, которого нет.

```ts
it('passes the host’s diagnostics through unchanged', async () => {
  const d = { severity: 'error', plugin: 'schema', where: 'line 3',
              message: 'record block has no name', at: { line: 3 } };
  const ctx = harness({ fetchFn: async () => jsonOnce({ diagnostics: [d] }) });
  expect((await ctx.check.check('record {\n}\n')).diagnostics).toEqual([d]);
});

it('a dead network is a diagnostic of the client’s own', async () => {
  const ctx = harness({ fetchFn: () => Promise.reject(new Error('offline')) });
  const { diagnostics } = await ctx.check.check('x');
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].message).toContain('offline');
});

it('a body carrying diagnostics is carried, even when it lacks the key we asked for', () => {
  // The mistake slice 5 made once: `tree()` checked its own key first and
  // threw away the host's explanation. Check the shared key first.
});

it('is on the context the real createIdeClient hands back', async () => {
  // Slice 4 shipped a service every unit test proved and no running IDE had.
});
```

- [ ] **Шаг 2–5: Прогнать, реализовать, прогнать, мутации**

Уберите `check` из `createIdeClient` → покраснеет последний тест. Проверяйте свой ключ раньше общего → покраснеет тест про чужие слова.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client
git commit -m "The editor can ask what is wrong before it writes anything"
```

---

## Task 4: Monaco приезжает

**Files:**
- Create: `engine/ide/client/src/editor/Monaco.tsx`, `engine/ide/client/tests/monaco.test.tsx`
- Modify: `engine/ide/client/package.json`, `engine/apps/web/vite.config.ts`

**Это главный риск среза, и он не в коде, а в сборке.** Срез 4 уже получил урок: чужой пакет уронил всё приложение при загрузке и сломал `vite build`, а ни `npm test`, ни `typecheck` этого не увидели. Monaco тянет web workers и собственные правила.

**Interfaces:**
```ts
export interface MonacoProps {
  value: string;
  language: string;
  /** Markers, placed by `Diagnostic.at`. A diagnostic without `at` is not drawn. */
  diagnostics: readonly Diagnostic[];
  onChange(next: string): void;
}
export function Monaco(props: MonacoProps): JSX.Element;
```

- [ ] **Шаг 1: Проверить сборку ПЕРЕД тем, как писать экран**

Поставьте зависимость, настройте vite, смонтируйте пустой редактор — и сразу:

```bash
npm run build --workspace @energy8engine/ide-web
```

Потом откройте приложение в настоящем браузере и убедитесь, что оно загружается. Не «тесты зелёные» — загружается. Если это не работает, дальше идти нечего, и об этом надо сказать сразу, а не после экрана.

- [ ] **Шаг 2: Падающие тесты**

```tsx
it('shows the text it was given', async () => {
  render(<Monaco value="game = Spin" language="spin" diagnostics={[]} onChange={() => {}} />);
  expect(await screen.findByTestId('editor')).toHaveTextContent('game = Spin');
});

it('a diagnostic with `at` becomes a marker on that line', async () => {
  const placed: unknown[] = [];
  render(<Monaco value="a\nb\nc" language="spin" onChange={() => {}}
    diagnostics={[{ severity: 'error', plugin: 'schema', where: 'line 2',
                    message: 'bad', at: { line: 2 } }]} />);
  expect(await markersOn(screen.getByTestId('editor'))).toEqual([
    expect.objectContaining({ startLineNumber: 2, message: 'bad' }),
  ]);
});

it('a diagnostic without `at` is not drawn as a marker', async () => {
  // A marker at line 1 for a whole-file problem accuses innocent code.
});

it('replaces its markers when the diagnostics change, rather than adding', async () => {
  // Otherwise every keystroke leaves its errors behind and the gutter fills
  // with problems that are already fixed.
});

it('tears its editor down when unmounted', async () => {
  // Monaco holds workers and DOM. A screen you can navigate away from and
  // back to must not leak one editor per visit.
});

it('survives being mounted where Monaco cannot start, and says so', async () => {
  // jsdom is that place. Failures are data: no crash, no blank pane.
});
```

Последний тест важен вдвойне: он же и есть способ проверить обёртку в jsdom, если настоящий Monaco там не запускается. Если запускается — скажите об этом в отчёте, это меняет остальные тесты.

- [ ] **Шаг 3–4: Реализовать, прогнать**

- [ ] **Шаг 5: Мутации**

Рисуйте маркер для диагностики без `at` → покраснеет её тест. Добавляйте маркеры вместо замены → покраснеет тест замены. Снимите размонтирование → покраснеет тест утечки.

- [ ] **Шаг 6: Сборка и браузер ещё раз, потом коммит**

```bash
npm run build --workspace @energy8engine/ide-web
git add engine/ide/client engine/apps/web
git commit -m "Monaco arrives, with its build settled before anything depends on it"
```

---

## Task 5: Экран «Код»

**Files:**
- Create: `engine/ide/client/src/screens/CodeScreen.tsx`, `engine/ide/client/tests/code-screen.test.tsx`
- Modify: `engine/ide/client/src/index.ts`, `engine/apps/web/src/App.tsx`, `engine/apps/web/tests/App.test.tsx`

Заголовок — `Код`. `order` после `Ассеты`. Дерево берётся тем же `ctx.files.tree()`, что и у «Ассетов» — второго обхода не заводить.

- [ ] **Шаг 1: Падающие тесты**

```tsx
it('lists the files worth editing, and not the whole tree', async () => {
  // `game/script.spin` and `plugins/**`, per the spec. A PNG in the list is
  // a file this screen cannot help with.
});

it('opening a file shows its text', async () => {
  const ctx = harness(tree(['game/script.spin']), { 'game/script.spin': 'game = Spin' });
  render(<CodeScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('file-game/script.spin'));
  expect(await screen.findByTestId('editor')).toHaveTextContent('game = Spin');
});

it('typing checks, and the markers arrive without saving', async () => {
  const ctx = harness(tree(['game/script.spin']), { 'game/script.spin': 'game = Spin' });
  render(<CodeScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('file-game/script.spin'));
  await userEvent.type(screen.getByTestId('editor'), '\nrecord {\n}');
  await expect.poll(() => ctx.check.calls.length).toBeGreaterThan(0);
  expect(ctx.files.written).toEqual([]);          // nothing saved
});

it('saving writes through ctx.files.write, and says when the host refused', async () => {
  const ctx = harness(tree(['game/script.spin']), { 'game/script.spin': 'game = Spin' },
    { writeDiagnostics: [d('that is outside the project')] });
  render(<CodeScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('file-game/script.spin'));
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  expect(await screen.findByText(/outside the project/)).toBeTruthy();
});

it('a refusal reaches the one list, not only this screen', async () => {
  // Slice 5's finding: the assets screen reported into its own paragraph and
  // nowhere else, so navigating away lost it. Both readers, one report.
  const ctx = harness(tree(['game/script.spin']), { 'game/script.spin': 'x' },
    { writeDiagnostics: [d('that is outside the project')] });
  render(<CodeScreen ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('file-game/script.spin'));
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  expect(ctx.connection.diagnostics.map((x) => x.message))
    .toContain('that is outside the project');
});

it('leaving with unsaved changes asks first', async () => {
  // Losing typed math silently is the one irreversible thing here.
});

it('a file that vanished between listing and opening says so', async () => {
  // The tree is a snapshot; slice 5 met this on its own screen.
});
```

- [ ] **Шаг 2–5: Прогнать, реализовать, прогнать, мутации**

Снимите доклад в общий список → покраснеет его тест. Проверяйте после сохранения вместо до → покраснеет тест маркеров без сохранения. Покажите весь список файлов → покраснеет первый тест.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client engine/apps/web
git commit -m "The math is edited where the game is watched"
```

---

## Task 6: Сохранение доезжает до игры

**Files:**
- Modify: `engine/ide/host/src/plugins/schema.ts` или `dev-game.ts` — по тому, что покажет измерение
- Modify: соответствующие тесты

**Сначала измерьте, потом стройте.** Правка `game/script.spin` сохраняется на диск; вопрос в том, что сегодня замечает эту правку и что нет. `spinSchema` имеет `reload()`, и кто-то должен его позвать. Игра в превью перезапускается своими правилами. Выясните цепочку **на живом хосте**, запишите в отчёт, что именно вы увидели, и стройте только недостающее звено.

Если окажется, что цепочка уже полна — скажите это и не добавляйте ничего. Задача существует, потому что правка, которая не доезжает, бессмысленна, а не потому, что заведомо чего-то не хватает.

- [ ] **Шаг 1: Измерить и записать**

- [ ] **Шаг 2–6: Падающие тесты на недостающее звено, реализация, мутации, коммит**

---

## Task 7: Приёмка

**Files:**
- Create: `engine/apps/web/tests/e2e/code.spec.ts`

Приёмка **не имеет права** исключать класс случаев на том основании, что он «и так работает».

**И одна проверка, которой на этой ветке уже не хватало дважды:** приёмка обязана открыть IDE в настоящем браузере и убедиться, что приложение **загружается** с Monaco внутри. Сборка и браузер — единственное, что видит этот класс отказа.

- [ ] **Шаг 1: Тесты**

```ts
test('the IDE still loads with Monaco in it', async ({ page }) => {
  // Не про редактор — про то, что зависимость не уронила приложение.
});

test('editing the math and saving changes the file on disk', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/#/code');
    await page.getByTestId('file-game/script.spin').click();
    await page.getByTestId('editor').click();
    await page.keyboard.type('\n// edited from the browser\n');
    await page.getByRole('button', { name: /save/i }).click();
    await expect.poll(() => readFileSync(join(dir, 'game/script.spin'), 'utf8'))
      .toContain('edited from the browser');
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('a mistake in the math shows a marker before anything is saved', async ({ page }) => {
  const dir = projectCopy();
  const host = await startDevHost(dir);
  const before = readFileSync(join(dir, 'game/script.spin'), 'utf8');
  try {
    await page.goto('http://127.0.0.1:5680/#/code');
    await page.getByTestId('file-game/script.spin').click();
    await page.getByTestId('editor').click();
    await page.keyboard.type('\nrecord {\n}\n');
    await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible();
    expect(readFileSync(join(dir, 'game/script.spin'), 'utf8')).toBe(before);
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('the marker is on the line the mistake is on', async ({ page }) => {
  // Позиция — это то, ради чего задача 1 существует.
});

test('a refused save reaches the diagnostics panel, on any screen', async ({ page }) => {
  // The panel is chrome since slice 5, so this needs no second page.
  const dir = projectCopy();
  const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/#/code');
    await provokeRefusedSave(page);
    await page.getByTestId('tab-composition').click();
    await expect(page.getByTestId('diagnostics-panel')).toContainText(/outside the project/);
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Шаг 2: Прогнать в одиночку, проверить процессы и копии**

- [ ] **Шаг 3: Подтвердить, что каждый тест упал бы без среза**

- [ ] **Шаг 4: Коммит**

```bash
git add engine/apps/web
git commit -m "Acceptance: the math is editable, and a mistake shows where it is"
```
