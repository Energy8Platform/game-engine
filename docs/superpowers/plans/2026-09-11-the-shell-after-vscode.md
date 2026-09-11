# Срез 7: оболочка по образцу VS Code — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Оболочка IDE становится раскладкой VS Code — activity bar, sidebar, группа вкладок-документов, нижняя панель, статус-бар — и каждая область есть именованный слот. «Ассеты» и «Код» сливаются в один Explorer, открывающий файлы вкладками. Состав и Превью становятся документами. Внутренности экранов не меняются; меняется контейнер.

**Architecture:** `layout` переименовывается в `shell`; `screen()` уходит. Пять слотов на существующем `ctx.slots` — политика столкновений, диспозеры и диагностика уже проверены там. Документы из Explorer — экземпляры через `shell.open()`, не вклады. Активный документ живёт в хеше `#/doc/<key>`. Грязное состояние — свойство вкладки; страж ухода из Среза 6 переезжает на закрытие вкладки. `DESIGN.md` и `styles.css` переписываются под токены.

**Tech Stack:** TypeScript, cordis 4.0.0-rc.8, React 18, vite 6, vitest 2, Playwright, monaco-editor 0.56.

**Spec:** `docs/superpowers/specs/2026-09-11-vscode-shell-design.md` — целиком. Родительская: `2026-08-27-slot-webide-cordis-design.md` §8 (один список), Приложение Б (слоты как единственная точка входа).

**Долг, который гасится:** записка Среза 6, пункт 2 (ложное предупреждение при загрузке на `#/code`).

---

## Global Constraints

- Новый код — **только** в `engine/`. `packages/*` и верхнеуровневый `examples/*` — легаси. `engine/examples/first-slot` — наш.
- Комментарии и коммиты — по-английски, короткими повествовательными предложениями в голосе репозитория. Без списков в теле коммита; в заголовке не называть процесс проверки.
- **Отказ — это данные.** Ни один шов не бросает; ни один путь не заканчивается пустым экраном без объяснения. Ни одна надпись не утверждает причину, которой код не знает.
- **Ни одно правило Срезов 5 и 6 не теряется при переезде.** Проверка с debounce и стражем устаревшего ответа, сниф двоичного, порог размера, страж грязного, доклад отказа в общий список, «дерево обновляется после ответа хоста» — все переезжают вместе с тестами. Удалить тест можно только ответив: он проверял список, которого больше нет, или свойство, которое ещё важно? Второе переселяется.
- Заголовки областей и документов — русские (`Состав`, `Превью`, `Диагностика`, `Проводник`); подписи внутри следуют английским соседям.
- Тесты — по пакетам: `npm test --workspace @energy8engine/<pkg>`. Корневой прогон даёт ложные падения.
- Playwright в `engine/apps/web`: `workers: 1`, порт 5679, **в одиночку** от любой корневой команды `npm`. Потом перечислить процессы — `e8-server` отдельно, `vite` на 5680, — и проверить, что нет `engine/examples/e8-compose-*`.
- `data-testid` — единственный способ адресовать элементы в тестах. Таблица переезда в задаче 7.
- Каждое утверждение задаётся **вместе с мутацией, которая обязана его уронить**, и мутацию сначала надо убедиться, что она приземлилась — по числу тестов. Двадцать восемь раз на этой ветке утверждение проходило не через ту ветку, которую называет. Пять из них — экранные тесты, проверявшие свойство жизненного цикла через содержимое, одинаковое в обоих случаях. Этот срез — сплошь жизненный цикл вкладок. Тождество узла, счётчик монтирований, счётчик вызовов.

---

## Проверенные факты

Измерено на `ad5a496`.

### Слоты уже умеют всё, что нужно оболочке

`engine/ide/client/src/plugins/slots.tsx:33-35` — `register(meta, component): () => void`, `list(name)`, `subscribe(listener)`. Составной ключ `name::key`, замена с диагностикой, диспозер по тождеству, порядок вставки. Пять слотов оболочки — это пять имён на этом сервисе, а не пять реестров.

### `layout` знает четыре вещи, и три из них переезжают как есть

`layout.tsx` — `screen()`, `screens()`, `current()`, `go()`, `subscribe()`, `guard()`. Хеш как единственный источник истины для текущего; `hashchange` слушается и снимается при `dispose`; `guard()` — вето на `go()`. Всё это становится `shell` с документами вместо экранов. Уходит только `screen()`: регистрация — теперь слот.

### Две регистрации на экран уже есть, четыре экрана

`App.tsx:60,68,73,78` — четыре `ctx.layout.screen(...)`. Станут: три кнопки activity bar (`explorer`, `composition`, `preview`) + два документа-вклада (`composition`, `preview`) + вид sidebar (`explorer`) + вкладка panel (`diagnostics`) + элементы статуса.

### Что переезжает из двух умирающих экранов

`CodeScreen.tsx` (378 строк): `CHECK_DEBOUNCE_MS`, `isSpin`, `isEditable`, проверка с `checkSeq`, `openFile` с проверкой на открытии, сохранение с докладом в список и инлайн, страж грязного на смене файла и через `layout.guard`, `beforeunload`, сниф двоичного через `looksBinary` из `AssetsScreen`. `AssetsScreen.tsx` (363): дерево, просмотр картинки через `urlFor`, текст, `TOO_BIG_BYTES`, `looksBinary`, загрузка через `FileReader` с `onerror`, удаление с подтверждением, обновление дерева после ответа хоста. Всё это — либо в Explorer (дерево, загрузка, удаление), либо в документ-редактор (`.spin` и текст), либо в документ-просмотр (картинка, двоичный, большой).

### Долг, который гасится, и почему он здесь

Записка Среза 6, п. 2: при загрузке на `#/code` панель получает «экран code не зарегистрирован», потому что `layout.current()` докладывает между первым и последним эффектом регистрации в `App.tsx`. `shell` откладывает проверку хеша до конца первого рендера — `queueMicrotask` после первого `subscribe`, или явный `shell.ready()` из `App` после регистраций. Второе честнее: оболочка не угадывает, когда регистрация кончилась.

### Стили сейчас

`styles.css` — 507 строк под Cal.com; `DESIGN.md` — палитра Cal.com. Переписываются целиком, классы `e8-*` сохраняются там, где смысл не меняется.

---

## Структура файлов

| Путь | Ответственность |
|---|---|
| `engine/ide/client/src/plugins/shell.tsx` | **создать** из `layout.tsx` — пять слотов, документы, грязное, хеш, `ready()` |
| `engine/ide/client/src/plugins/layout.tsx` | **удалить** |
| `engine/ide/client/src/shell/Shell.tsx` | **создать** из `screens/Layout.tsx` — пять областей, граница на документ, пустые случаи, размеры |
| `engine/ide/client/src/shell/Explorer.tsx` | **создать** — дерево, открытие документов, загрузка, удаление |
| `engine/ide/client/src/shell/EditorDocument.tsx` | **создать** из `CodeScreen.tsx` — Monaco, проверка, сохранение, грязное |
| `engine/ide/client/src/shell/ViewerDocument.tsx` | **создать** из `AssetsScreen.tsx` — картинка, двоичный, большой |
| `engine/ide/client/src/shell/StatusItems.tsx` | **создать** — проект, `e8-server`, грязные, тема |
| `engine/ide/client/src/screens/{AssetsScreen,CodeScreen,Layout}.tsx` | **удалить** |
| `engine/ide/client/src/styles.css`, `DESIGN.md` | переписать под токены |
| `engine/apps/web/src/App.tsx` | изменить — регистрации в пять слотов, `shell.ready()` |
| `engine/examples/first-slot/plugins/screen-demo/` | изменить — кнопка + документ |
| `engine/apps/web/tests/e2e/shell.spec.ts` | **создать** — приёмка; testid переезжают в существующих |

---

## Task 1: Сервис `shell`

**Files:**
- Create: `engine/ide/client/src/plugins/shell.tsx`, `engine/ide/client/tests/shell.test.tsx`
- Delete: `engine/ide/client/src/plugins/layout.tsx`, `engine/ide/client/tests/layout.test.tsx` — **после** переноса каждого теста, который закреплял свойство, а не форму
- Modify: `engine/ide/client/src/plugins/slots.tsx`, `engine/ide/client/src/index.ts`, `engine/ide/client/src/context.ts`

**Проверенный факт для `slots`:** `slots.tsx` уже делает `{ ...meta, component }`, так что лишние поля меты доезжают до `SlotEntry` в рантайме — их отвергает только ТИП. Вклады оболочки несут `title`, `icon`, `order`, `opens`. Значит `register` и `list` становятся обобщёнными по мете, и `as any` в тестах ниже — временная запись до этого шага, в коде его быть не должно:

```ts
export interface SlotsService {
  register<M extends SlotMeta>(meta: M, component: ComponentType<any>): () => void;
  list<M extends SlotMeta = SlotMeta>(name: string): (M & { component: ComponentType<any> })[];
  subscribe(listener: () => void): () => void;
}
```

Существующие вызовы не меняются — `SlotMeta` остаётся значением по умолчанию.

**Interfaces:**
```ts
export type ActivityOpens = 'sidebar' | 'document';

export interface ActivityMeta { key: string; title: string; icon: string; order?: number; opens: ActivityOpens }
export interface SidebarMeta  { key: string; title: string }
export interface DocumentMeta { key: string; title: string; closable?: boolean }
export interface PanelMeta    { key: string; title: string }
export interface StatusMeta   { key: string; side: 'left' | 'right'; order?: number }

/** An open tab. Contributed documents and Explorer-opened ones both become this. */
export interface OpenDocument {
  key: string;
  title: string;
  component: ComponentType<{ ctx: Context }>;
  closable: boolean;
  dirty: boolean;
}

export interface ShellService {
  /** Slot names, so nobody spells them by hand. */
  readonly slots: {
    activity: 'shell.activity'; sidebar: 'shell.sidebar'; document: 'shell.document';
    panel: 'shell.panel'; status: 'shell.status';
  };

  /** Opens an instance tab — a file from Explorer. Same key twice activates. */
  open(doc: Omit<OpenDocument, 'dirty'>): void;
  /** Opens a CONTRIBUTED document by its slot key. Same key twice activates. */
  openContributed(key: string): void;
  /** Refuses when the tab is dirty and no guard has let it through. */
  close(key: string): boolean;
  activate(key: string): void;
  markDirty(key: string, dirty: boolean): void;

  documents(): readonly OpenDocument[];
  active(): OpenDocument | undefined;

  sidebar(): string | undefined;          // active sidebar key, or collapsed
  showSidebar(key: string | undefined): void;
  panelCollapsed(): boolean;
  togglePanel(): void;

  /** A dirty-tab guard: return false to keep the tab. Same shape as layout.guard(). */
  guard(fn: (key: string) => boolean): () => void;

  /** Called by the app once every registration effect has run. Until then the
   *  hash is not checked, so a deep link to a contributed document does not
   *  produce a false "not registered" diagnostic — slice 6's recorded debt. */
  ready(): void;

  subscribe(listener: () => void): () => void;
}

declare module 'cordis' { interface Context { shell: ShellService } }
export const name = 'shell';
export function apply(ctx: Context): void;
export function useShell(ctx: Context): { documents; active; sidebar; panelCollapsed };
```

**Interfaces consumed:** `ctx.slots` as it is.
**Interfaces produced:** everything above; Tasks 2-6 consume it.

- [ ] **Шаг 1: Перенос тестов из `layout.test.tsx`**

Прочитать каждый тест и ответить: он про `screen()` — форму, которая уходит, — или про свойство, которое остаётся (хеш как истина, `hashchange` снимается при `dispose`, страж с вето, снисходительное чтение `connection`, уведомление подписчиков)? Второе переносится в `shell.test.tsx` с заменой «экран» на «документ». Список перенесённых и удалённых — в отчёте, с ответом на вопрос по каждому.

- [ ] **Шаг 2: Падающие тесты на новое**

```tsx
it('opening an instance document adds a tab and activates it', () => {
  const ctx = harness();
  ctx.shell.open({ key: 'f:game/script.spin', title: 'script.spin', component: Dummy, closable: true });
  expect(ctx.shell.documents().map((d) => d.key)).toEqual(['f:game/script.spin']);
  expect(ctx.shell.active()?.key).toBe('f:game/script.spin');
  expect(location.hash).toBe('#/doc/f:game/script.spin');
});

it('opening the same key twice activates, and does not add a second tab', () => {
  const ctx = harness();
  ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
  ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
  ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
  expect(ctx.shell.documents().map((d) => d.key)).toEqual(['a', 'b']);
  expect(ctx.shell.active()?.key).toBe('a');
});

it('a contributed document opens from its slot key', () => {
  const ctx = harness();
  ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
  ctx.shell.openContributed('composition');
  expect(ctx.shell.active()?.key).toBe('composition');
});

it('opening a contributed key nobody registered is a diagnostic, not a blank tab', () => {
  const ctx = harness();
  ctx.shell.openContributed('ghost');
  expect(ctx.shell.documents()).toEqual([]);
  expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('ghost')]);
});

it('closing a clean tab removes it and activates the neighbour', () => {
  const ctx = harness();
  ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
  ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
  expect(ctx.shell.close('b')).toBe(true);
  expect(ctx.shell.documents().map((d) => d.key)).toEqual(['a']);
  expect(ctx.shell.active()?.key).toBe('a');
});

it('closing a dirty tab is refused until a guard lets it through', () => {
  // The slice-6 leave guard, re-homed: the thing that must not happen is
  // typed math vanishing on a click.
  const ctx = harness();
  ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
  ctx.shell.markDirty('a', true);
  expect(ctx.shell.close('a')).toBe(false);
  expect(ctx.shell.documents()).toHaveLength(1);
  const off = ctx.shell.guard(() => true);
  expect(ctx.shell.close('a')).toBe(true);
  off();
});

it('a non-closable contributed document has no close, and close() says so', () => {
  const ctx = harness();
  ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
  ctx.shell.openContributed('composition');
  expect(ctx.shell.close('composition')).toBe(false);
});

it('the hash names the active document, and a hashchange follows it', () => {
  const ctx = harness();
  ctx.shell.open({ key: 'a', title: 'A', component: Dummy, closable: true });
  ctx.shell.open({ key: 'b', title: 'B', component: Dummy, closable: true });
  location.hash = '#/doc/a';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(ctx.shell.active()?.key).toBe('a');
});

it('a deep link to a contributed document is NOT checked until ready()', () => {
  // Slice 6, debt 2: `layout.current()` reported "not registered" between
  // the first and last registration effect. The shell waits to be told.
  location.hash = '#/doc/preview';
  const ctx = harness();
  expect(ctx.connection.diagnostics).toEqual([]);          // nothing yet
  ctx.slots.register({ name: 'shell.document', key: 'preview' }, Dummy);
  ctx.shell.ready();
  expect(ctx.shell.active()?.key).toBe('preview');
  expect(ctx.connection.diagnostics).toEqual([]);          // and nothing after
});

it('a deep link to nothing, after ready(), is one diagnostic and the first document', () => {
  location.hash = '#/doc/gone';
  const ctx = harness();
  ctx.slots.register({ name: 'shell.document', key: 'composition' }, Dummy);
  ctx.shell.ready();
  expect(ctx.shell.active()?.key).toBe('composition');
  expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([expect.stringContaining('gone')]);
});

it('showSidebar toggles: the active key again collapses it', () => {
  const ctx = harness();
  ctx.shell.showSidebar('explorer');
  expect(ctx.shell.sidebar()).toBe('explorer');
  ctx.shell.showSidebar('explorer');
  expect(ctx.shell.sidebar()).toBeUndefined();
});

it('markDirty on an unknown key is a no-op, not a throw', () => {
  const ctx = harness();
  expect(() => ctx.shell.markDirty('nope', true)).not.toThrow();
});

it('stops listening to the address once disposed', async () => {
  const ctx = harness();
  let calls = 0;
  ctx.shell.subscribe(() => calls++);
  await ctx.fiber.dispose();
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(calls).toBe(0);
});

it('is on the context the real createIdeClient hands back', async () => {
  const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => fakeSocket() });
  expect(ctx.shell).toBeDefined();
  expect(ctx.layout).toBeUndefined();
});
```

`harness()` — из `layout.test.tsx`, с `slots` и `shell` вместо `layout`. `ctx.fiber.dispose()` — Срез 4 измерил, что `ctx.scope` не существует.

- [ ] **Шаг 3: Реализовать**

Слоты — пять имён на `ctx.slots`. Документы — `Map<string, OpenDocument>` в порядке вставки. Хеш — единственная истина для активного; `open()`/`activate()` пишут хеш, `hashchange` читает. `ready()` — флаг; до него `current()` из хеша не вычисляется и диагностика не пишется.

- [ ] **Шаг 4: Прогнать**

Run: `npm test --workspace @energy8engine/ide-client`

- [ ] **Шаг 5: Мутации**

Проверяйте хеш до `ready()` → покраснеет тест глубокой ссылки. Добавляйте вкладку при повторном `open()` → покраснеет тест «дважды». Закрывайте грязную без стража → покраснеет её тест. Уберите `layout` из `createIdeClient`, но оставьте `shell` → тест настоящего клиента остаётся зелёным; уберите `shell` → красный. Не снимайте `hashchange` при `dispose` → покраснеет тест утечки.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client
git commit -m "A shell with five slots replaces the one-screen layout"
```

---

## Task 2: `<Shell/>` — пять областей

**Files:**
- Create: `engine/ide/client/src/shell/Shell.tsx`
- Delete: `engine/ide/client/src/screens/Layout.tsx` — после переноса тестов
- Modify: `engine/ide/client/tests/shell.test.tsx`, `engine/ide/client/src/index.ts`

**Interfaces:**
```ts
export function Shell({ ctx }: { ctx: Context }): JSX.Element;
```

Регионы и их `data-testid`: `activity-bar`, `activity-<key>`, `sidebar`, `sidebar-<key>`, `doc-tabs`, `doc-<key>` (вкладка), `doc-close-<key>`, `doc-body`, `panel`, `panel-<key>`, `status-bar`, `status-<key>`.

- [ ] **Шаг 1: Перенос тестов из `Layout`**

Граница ошибки с ключом по документу, пустой случай, переживание навигации по тождеству узла, `composition.card` не задет — переносятся. Тест «вкладка по testid» становится «документ по testid».

- [ ] **Шаг 2: Падающие тесты на новое**

```tsx
it('draws one activity button per contribution, in order', () => {
  const ctx = harness();
  ctx.slots.register({ name: 'shell.activity', key: 'z', title: 'Z', icon: 'z', order: 9, opens: 'sidebar' } as any, Nop);
  ctx.slots.register({ name: 'shell.activity', key: 'a', title: 'A', icon: 'a', order: 1, opens: 'sidebar' } as any, Nop);
  render(<Shell ctx={ctx} />);
  expect(screen.getAllByTestId(/^activity-/).map((b) => b.dataset.testid)).toEqual(['activity-a', 'activity-z']);
});

it('an activity button that opens a sidebar shows that sidebar view', async () => {
  const ctx = harness();
  ctx.slots.register({ name: 'shell.activity', key: 'explorer', title: 'Проводник', icon: 'files', opens: 'sidebar' } as any, Nop);
  ctx.slots.register({ name: 'shell.sidebar', key: 'explorer', title: 'Проводник' } as any, () => <div>TREE</div>);
  render(<Shell ctx={ctx} />);
  await userEvent.click(screen.getByTestId('activity-explorer'));
  expect(screen.getByTestId('sidebar')).toHaveTextContent('TREE');
});

it('an activity button that opens a document opens ONE tab, and again activates it', async () => {
  const ctx = harness();
  ctx.slots.register({ name: 'shell.activity', key: 'composition', title: 'Состав', icon: 'c', opens: 'document' } as any, Nop);
  ctx.slots.register({ name: 'shell.document', key: 'composition', title: 'Состав' } as any, () => <div>COMP</div>);
  render(<Shell ctx={ctx} />);
  await userEvent.click(screen.getByTestId('activity-composition'));
  await userEvent.click(screen.getByTestId('activity-composition'));
  expect(screen.getAllByTestId(/^doc-composition$/)).toHaveLength(1);
  expect(screen.getByTestId('doc-body')).toHaveTextContent('COMP');
});

it('an activity button whose sidebar nobody registered explains itself', async () => {
  const ctx = harness();
  ctx.slots.register({ name: 'shell.activity', key: 'orphan', title: 'O', icon: 'o', opens: 'sidebar' } as any, Nop);
  render(<Shell ctx={ctx} />);
  await userEvent.click(screen.getByTestId('activity-orphan'));
  expect(screen.getByTestId('sidebar')).toHaveTextContent(/nothing registered/i);
});

it('the panel shows its contribution and collapses on demand', async () => {
  const ctx = harness();
  ctx.slots.register({ name: 'shell.panel', key: 'diagnostics', title: 'Диагностика' } as any, () => <div>DIAG</div>);
  render(<Shell ctx={ctx} />);
  expect(screen.getByTestId('panel')).toHaveTextContent('DIAG');
  await userEvent.click(screen.getByTestId('panel-toggle'));
  expect(screen.getByTestId('panel')).not.toHaveTextContent('DIAG');
});

it('a dirty tab shows a dot, and its close asks first', async () => {
  const ctx = harness();
  ctx.shell.open({ key: 'a', title: 'A', component: () => <div>A</div>, closable: true });
  ctx.shell.markDirty('a', true);
  render(<Shell ctx={ctx} />);
  expect(screen.getByTestId('doc-a')).toHaveTextContent('●');
  await userEvent.click(screen.getByTestId('doc-close-a'));
  expect(screen.getByTestId('confirm-yes')).toBeTruthy();
  expect(ctx.shell.documents()).toHaveLength(1);
});

it('a document that throws does not take the panel or the other tabs with it', () => {
  const ctx = harness();
  ctx.shell.open({ key: 'bad', title: 'B', component: () => { throw new Error('boom'); }, closable: true });
  ctx.shell.open({ key: 'ok', title: 'O', component: () => <div>OK</div>, closable: true });
  ctx.slots.register({ name: 'shell.panel', key: 'p', title: 'P' } as any, () => <div>PANEL</div>);
  ctx.shell.activate('bad');
  render(<Shell ctx={ctx} />);
  expect(screen.getByTestId('doc-error')).toHaveTextContent('boom');
  expect(screen.getByTestId('panel')).toHaveTextContent('PANEL');
  expect(screen.getByTestId('doc-ok')).toBeTruthy();
});

it('the panel node survives switching documents', async () => {
  // Lifecycle through identity, not content — the pattern five vacuous
  // assertions on this branch got wrong.
  const ctx = harness();
  ctx.slots.register({ name: 'shell.panel', key: 'p', title: 'P' } as any, () => <div>PANEL</div>);
  ctx.shell.open({ key: 'a', title: 'A', component: () => <div>A</div>, closable: true });
  ctx.shell.open({ key: 'b', title: 'B', component: () => <div>B</div>, closable: true });
  render(<Shell ctx={ctx} />);
  const before = screen.getByTestId('panel');
  await userEvent.click(screen.getByTestId('doc-a'));
  expect(screen.getByTestId('panel')).toBe(before);
});

it('status items sit left and right by side, ordered', () => {
  const ctx = harness();
  ctx.slots.register({ name: 'shell.status', key: 'r', side: 'right', order: 1 } as any, () => <span>R</span>);
  ctx.slots.register({ name: 'shell.status', key: 'l', side: 'left' } as any, () => <span>L</span>);
  render(<Shell ctx={ctx} />);
  const bar = screen.getByTestId('status-bar');
  expect(bar.querySelector('[data-side=left]')).toHaveTextContent('L');
  expect(bar.querySelector('[data-side=right]')).toHaveTextContent('R');
});

it('with nothing registered anywhere it explains itself instead of painting nothing', () => {
  render(<Shell ctx={harness()} />);
  expect(screen.getByTestId('shell-empty')).toHaveTextContent(/no contributions/i);
});
```

- [ ] **Шаг 3-5: Реализовать, прогнать, мутации**

Сделайте границу без ключа по документу → покраснеет тест «не забирает панель». Рендерьте панель внутри области документа → покраснеет тест тождества. Открывайте новую вкладку на повторный клик → покраснеет тест ONE tab.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client
git commit -m "The shell draws whatever its five slots were given"
```

---

## Task 3: Токены, `DESIGN.md`, `styles.css`

**Files:**
- Rewrite: `DESIGN.md`, `engine/ide/client/src/styles.css`
- Create: `engine/ide/client/src/shell/StatusItems.tsx` (переключатель темы + проект + `e8-server` + грязные)

**Interfaces:**
```css
:root { --e8-bg-0: …; --e8-bg-1; --e8-bg-2; --e8-bg-3; --e8-border; --e8-fg; --e8-fg-muted; --e8-accent;
        --e8-activity-w: 48px; --e8-sidebar-w: 260px; --e8-panel-h: 200px; --e8-status-h: 22px;
        --e8-font: -apple-system, "Segoe UI", …; --e8-font-mono: …; --e8-size: 13px; }
[data-theme="light"] { /* same names */ }
```

```ts
export function ProjectStatus({ ctx }): JSX.Element;      // left: project name
export function SessionStatus({ ctx }): JSX.Element;      // right: e8-server ● / ○ / restarting
export function DirtyStatus({ ctx }): JSX.Element;        // right: N unsaved
export function ThemeStatus({ ctx }): JSX.Element;        // right: toggle, persists to localStorage
```

- [ ] **Шаг 1: `DESIGN.md`**

Переписать целиком: анатомия, токены, принципы (плоско, без теней и градиентов, скругление ≤4px), обе темы, размеры. Источник назван честно: анатомия VS Code и его тёмная тема по умолчанию, без притязаний на версию.

- [ ] **Шаг 2: Падающие тесты**

```tsx
it('every colour in the stylesheet is a token, not a literal', () => {
  // Guard against the palette leaking back in one hex at a time.
  const css = readFileSync('src/styles.css', 'utf8').replace(/:root\s*{[^}]*}|\[data-theme[^{]*{[^}]*}/g, '');
  expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
});

it('the theme toggle flips data-theme and survives a reload via localStorage', async () => {
  render(<ThemeStatus ctx={harness()} />);
  await userEvent.click(screen.getByTestId('status-theme'));
  expect(document.documentElement.dataset.theme).toBe('light');
  expect(localStorage.getItem('e8.theme')).toBe('light');
  cleanup();
  render(<ThemeStatus ctx={harness()} />);           // "reload"
  expect(document.documentElement.dataset.theme).toBe('light');
});

it('SessionStatus follows the live session state, not a boot-time snapshot', async () => {
  // Slice 6 made pid a getter for exactly this; a status item that read it
  // once would show a dead process as alive after a restart. The status is
  // fed by the game-diagnostics channel: a `restarting` code shows one
  // state, an empty list after it another.
  const ctx = harness();
  render(<SessionStatus ctx={ctx} />);
  act(() => ctx.gameDiagnostics.push({ source: 'host', diagnostics: [d('restarting', { code: 'restarting' })] }));
  expect(screen.getByTestId('status-session')).toHaveTextContent(/restart/i);
  act(() => ctx.gameDiagnostics.push({ source: 'host', diagnostics: [] }));
  expect(screen.getByTestId('status-session')).not.toHaveTextContent(/restart/i);
});
```

- [ ] **Шаг 3-6: Реализовать, прогнать, мутации, коммит**

```bash
git add DESIGN.md engine/ide/client
git commit -m "Tokens and a flat theme, with the design document to match"
```

---

## Task 4: Explorer

**Files:**
- Create: `engine/ide/client/src/shell/Explorer.tsx`, `engine/ide/client/tests/explorer.test.tsx`
- Modify: `engine/apps/web/src/App.tsx` (кнопка + вид)

**Interfaces:**
```ts
export function Explorer({ ctx }: { ctx: Context }): JSX.Element;
/** What Explorer opens for a path. Task 5 provides the two document kinds. */
export function openPath(ctx: Context, path: string, entry: FileEntry): void;
```

`data-testid`: `explorer-<path>` на каждой записи, `explorer-upload`, `explorer-delete-<path>`, `confirm-yes`/`confirm-no`.

- [ ] **Шаг 1: Перенос из `assets-screen.test.tsx`**

Дерево, каталоги перед файлами (порядок — по тождеству последовательности testid, как Срез 5 исправил), пустой проект, дерево не прочитано, загрузка обновляет после ответа, отказ оставляет дерево, удаление спрашивает и «нет» не шлёт DELETE, `FileReader.onerror` — всё переносится. Остаётся в `assets-screen.test.tsx` только то, что про просмотр — оно едет в задачу 5.

- [ ] **Шаг 2: Падающие тесты на новое**

```tsx
it('clicking a file opens a document with that path as key', async () => {
  const ctx = harness(tree(['game/script.spin']));
  render(<Explorer ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('explorer-game/script.spin'));
  expect(ctx.shell.active()?.key).toBe('f:game/script.spin');
});

it('clicking a directory folds it, and does not open anything', async () => {
  const ctx = harness(tree(['game', 'game/spec.json']));
  render(<Explorer ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('explorer-game'));
  expect(screen.queryByTestId('explorer-game/spec.json')).toBeNull();   // folded
  expect(ctx.shell.documents()).toEqual([]);
  await userEvent.click(screen.getByTestId('explorer-game'));
  expect(screen.getByTestId('explorer-game/spec.json')).toBeTruthy();  // unfolded
});

it('clicking the same file twice activates the one tab', async () => {
  const ctx = harness(tree(['a.txt', 'b.txt']));
  render(<Explorer ctx={ctx} />);
  await userEvent.click(await screen.findByTestId('explorer-a.txt'));
  await userEvent.click(screen.getByTestId('explorer-b.txt'));
  await userEvent.click(screen.getByTestId('explorer-a.txt'));
  expect(ctx.shell.documents().map((d) => d.key)).toEqual(['f:a.txt', 'f:b.txt']);
  expect(ctx.shell.active()?.key).toBe('f:a.txt');
});

it('the tree is one tree() call, not one per fold', async () => {
  // Observed through fetchFn, as every screen test here does — the harness
  // goes through the real createIdeClient with a fake fetch.
  const { ctx, calls } = harnessWithCalls(tree(['a/x', 'b/y']));
  render(<Explorer ctx={ctx} />);
  await screen.findByTestId('explorer-a');
  await userEvent.click(screen.getByTestId('explorer-a'));
  await userEvent.click(screen.getByTestId('explorer-b'));
  expect(calls.filter((u) => u.endsWith('/api/files')).length).toBe(1);
});
```

- [ ] **Шаг 3-6**

```bash
git add engine/ide/client engine/apps/web
git commit -m "One Explorer instead of two screens over one tree"
```

---

## Task 5: Документы — редактор и просмотр

**Files:**
- Create: `engine/ide/client/src/shell/EditorDocument.tsx`, `engine/ide/client/src/shell/ViewerDocument.tsx`, tests
- Delete: `engine/ide/client/src/screens/CodeScreen.tsx`, `AssetsScreen.tsx` и их тесты — **после** переноса
- Modify: `engine/ide/client/src/shell/Explorer.tsx` (`openPath` выбирает документ)

**Interfaces:**
```ts
export function EditorDocument({ ctx, path }: { ctx: Context; path: string }): JSX.Element;
export function ViewerDocument({ ctx, path, entry }: { ctx: Context; path: string; entry: FileEntry }): JSX.Element;
```

- [ ] **Шаг 1: Перенос из `code-screen.test.tsx` и остатка `assets-screen.test.tsx`**

Каждый тест — с ответом «список или свойство». Редактор: проверка по нажатию с debounce и стражем устаревшего (два ответа не по порядку → маркеры по последнему), проверка на открытии, `.spin`-only, `at`-less диагностика в абзаце, сохранение с докладом в общий список и инлайн, грязное → `shell.markDirty`, сниф двоичного, порог. Просмотр: картинка через `urlFor`, двоичный и большой — «не показан, почему», исчезнувший между списком и открытием.

- [ ] **Шаг 2: Падающие тесты на новое**

```tsx
it('typing marks the tab dirty; saving clears it', async () => {
  const ctx = harness(...);
  render(<EditorDocument ctx={ctx} path="game/script.spin" />);
  await userEvent.type(await screen.findByTestId('editor'), 'x');
  expect(ctx.shell.documents()[0].dirty).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(ctx.shell.documents()[0].dirty).toBe(false));
});

it('a refused save leaves the tab dirty', async () => {
  const ctx = harness(files({ 'game/script.spin': 'x' }), { writeDiagnostics: [d('outside the project')] });
  ctx.shell.open({ key: 'f:game/script.spin', title: 'script.spin', component: Nop, closable: true });
  render(<EditorDocument ctx={ctx} path="game/script.spin" />);
  await userEvent.type(await screen.findByTestId('editor'), 'y');
  await userEvent.click(screen.getByRole('button', { name: /save/i }));
  await screen.findByText(/outside the project/);
  expect(ctx.shell.documents()[0].dirty).toBe(true);
});

it('Cmd/Ctrl+S saves', async () => {
  const { ctx, calls } = harnessWithCalls(files({ 'game/script.spin': 'x' }));
  ctx.shell.open({ key: 'f:game/script.spin', title: 'script.spin', component: Nop, closable: true });
  render(<EditorDocument ctx={ctx} path="game/script.spin" />);
  await userEvent.type(await screen.findByTestId('editor'), 'y');
  await userEvent.keyboard('{Meta>}s{/Meta}');
  await waitFor(() => expect(calls.some((u) => u.includes('/api/files/game/script.spin'))).toBe(true));
});

it('unmounting a dirty editor does not lose the guard racing the tab', async () => {
  // The shell closes the tab only after the guard says yes; the editor's
  // own unmount must not clear dirty before the shell has asked.
});
```

- [ ] **Шаг 3-6**

Мутации: сохраняйте без `markDirty(false)` → покраснеет первый. Уберите `.spin`-only → покраснеет перенесённый тест. Снимите `checkSeq` → покраснеет перенесённый тест устаревшего ответа.

```bash
git add engine/ide/client
git commit -m "A file opens as a document, edited or viewed, and the two screens go"
```

---

## Task 6: Переезд остального и `App.tsx`

**Files:**
- Modify: `engine/apps/web/src/App.tsx`, `engine/apps/web/tests/App.test.tsx`
- Modify: `engine/examples/first-slot/plugins/screen-demo/src/client.js`, его `package.json`
- Modify: `engine/ide/client/src/index.ts` (экспорты; `Layout`, `CodeScreen`, `AssetsScreen` уходят)

- [ ] **Шаг 1: Падающие тесты**

```tsx
it('App registers explorer, composition and preview in the activity bar, in that order', () => {
  const ctx = harness();
  render(<App ctx={ctx} />);
  expect(ctx.slots.list('shell.activity').map((e) => e.key)).toEqual(['explorer', 'composition', 'preview']);
});

it('App registers the diagnostics panel, and nothing as a composition.card', () => {
  const ctx = harness();
  render(<App ctx={ctx} />);
  expect(ctx.slots.list('shell.panel').map((e) => e.key)).toEqual(['diagnostics']);
  expect(ctx.slots.list('composition.card')).toEqual([]);
});

it('App calls shell.ready() after every registration', () => {
  // Slice 6 debt 2: no false "not registered" on a deep link.
  location.hash = '#/doc/preview';
  const ctx = harness();
  render(<App ctx={ctx} />);
  expect(ctx.connection.diagnostics).toEqual([]);
  expect(ctx.shell.active()?.key).toBe('preview');
});

it('the demo plugin brings an activity button AND a document', async () => {
  // Through `modules`, the real loader: a fake snapshot names the plugin's
  // client half, and `importModule` hands back its real source.
  const ctx = await createIdeClient({ url: 'ws://x/ide', socketFactory: () => socket,
    importModule: async () => import('../../../examples/first-slot/plugins/screen-demo/src/client.js') });
  socket.push({ type: 'snapshot', snapshot: { rows: [{ id: 'demo1', clientUrl: '/x', clientInject: ['slots'] }] } });
  await waitFor(() => expect(ctx.slots.list('shell.activity').map((e) => e.key)).toContain('demo'));
  expect(ctx.slots.list('shell.document').map((e) => e.key)).toContain('demo');
});
```

- [ ] **Шаг 2: Демо-плагин**

Написать против опубликованной поверхности — `ctx.slots.register` в `shell.activity` и `shell.document`, React из `globalThis.__E8_IDE__` — **не читая** `shell.tsx` и `Shell.tsx`. Если поверхности не хватает, это находка о поверхности — в отчёт, не обходить. Тот же приём, что нашёл в Срезе 4, что слой экранов недостижим из плагина.

- [ ] **Шаг 3-6**

```bash
git add engine/apps/web engine/ide/client engine/examples/first-slot
git commit -m "Everything the old tabs held now lives in the shell's slots"
```

---

## Task 7: Приёмка и переезд testid

**Files:**
- Create: `engine/apps/web/tests/e2e/shell.spec.ts`
- Modify: каждый существующий `*.spec.ts`, где testid переехал

**Таблица переезда:**

| Было | Стало |
|---|---|
| `tab-composition`, `tab-preview`, `tab-demo` | `activity-composition`, `activity-preview`, `activity-demo` (клик) и `doc-composition` … (вкладка) |
| `tab-assets`, `tab-code` | `activity-explorer` |
| `entry-<path>`, `file-<path>` | `explorer-<path>` |
| `upload`, `delete-<path>` | `explorer-upload`, `explorer-delete-<path>` |
| `demo-screen` | `doc-body` при активном `doc-demo` |
| `editor`, `diagnostics-panel`, `confirm-yes`, `tile-*`, `row-*`, `diag-*` | без изменений |

**Правило:** поведение существующих тестов не меняется. Если тест пришлось переписать глубже, чем адресация, — это находка о переезде, в отчёт.

- [ ] **Шаг 1: Тесты**

```ts
test('a project plugin brings an activity button and a document, both usable', async ({ page }) => {
  const dir = projectCopy(); const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/');
    await page.getByTestId('activity-demo').click();
    await expect(page.getByTestId('doc-demo')).toBeVisible();
    await expect(page.getByTestId('doc-body')).toContainText(/a screen from a project plugin/);
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('Explorer opens .spin as an editor, PNG as a viewer, a binary as an explanation', async ({ page }) => {
  const dir = projectCopy({ withPng: true, withBinary: true }); const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/');
    await page.getByTestId('activity-explorer').click();
    await page.getByTestId('explorer-game/script.spin').click();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.getByTestId('explorer-art/logo.png').click();
    await expect(page.getByTestId('doc-body').getByRole('img')).toBeVisible();
    await page.getByTestId('explorer-art/blob.bin').click();
    await expect(page.getByTestId('doc-body')).toContainText(/doesn't look like text/);
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('a dirty tab does not close without asking, and beforeunload holds', async ({ page }) => {
  const dir = projectCopy(); const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/#/doc/f:game/script.spin');
    await page.getByTestId('editor').click();
    await page.keyboard.type('x');
    await page.getByTestId('doc-close-f:game/script.spin').click();
    await expect(page.getByTestId('confirm-yes')).toBeVisible();
    await expect(page.getByTestId('doc-f:game/script.spin')).toBeVisible();   // still there
    page.once('dialog', (d) => d.dismiss());
    await page.reload({ waitUntil: 'commit' }).catch(() => {});                  // held
    await expect(page.getByTestId('editor')).toBeVisible();
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});
test('a deep link to the preview opens it with no false warning', async ({ page }) => {
  await page.goto('http://127.0.0.1:5680/#/doc/preview');
  await expect(page.getByTestId(/^tile-/).first()).toBeVisible();
  await expect(page.getByTestId('diagnostics-panel')).not.toContainText(/not registered/);
});
test('a document that throws leaves the panel and the other tabs usable', async ({ page }) => {
  const dir = projectCopy(); const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/#/doc/demo?screen-demo-crash=1');
    await expect(page.getByTestId('doc-error')).toBeVisible();
    await expect(page.getByTestId('diagnostics-panel')).toBeVisible();
    await page.getByTestId('activity-composition').click();
    await expect(page.getByTestId('doc-body')).toContainText('Состав');
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('the IDE still loads with Monaco in it, console clean', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const dir = projectCopy(); const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/#/doc/f:game/script.spin');
    await expect(page.locator('.monaco-editor')).toBeVisible();
    expect(errors).toEqual([]);
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('the theme toggle persists across a reload', async ({ page }) => {
  const dir = projectCopy(); const host = await startDevHost(dir);
  try {
    await page.goto('http://127.0.0.1:5680/');
    await page.getByTestId('status-theme').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  } finally { await host.stop(); rmSync(dir, { recursive: true, force: true }); }
});
```

- [ ] **Шаг 2: Прогнать всё в одиночку, дважды**

- [ ] **Шаг 3: Каждый новый тест — красный без своей части**

- [ ] **Шаг 4: Коммит**

```bash
git add engine/apps/web
git commit -m "Acceptance: the shell holds, and every old test still finds its element"
```
