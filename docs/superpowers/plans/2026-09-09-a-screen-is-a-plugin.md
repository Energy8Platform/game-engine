# Срез 4: экран — тоже плагин — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** В IDE появляется слой экранов: `layout` держит навигацию, экраны приходят вкладами, и второй экран — стена превью — собран только из опубликованных поверхностей. Стена открывает несколько игр разом и тем вскрывает дефект: хост хранит список диагностик по источнику, а не по игре, поэтому две игры затирают друг друга. Плюс долг Среза 3: нужды страницы выводятся из её же чтений, а не из списка рядом.

**Architecture:** `layout` — клиентский сервис поверх `@energy8engine/registry` (четвёртая коллекция по имени, принимающая пакет с рождения). Экран объявляется `ctx.layout.screen({ id, title, order, component })`; `App` рендерит `<Layout/>` и об экранах не знает. Текущий экран живёт в хеше адреса, поэтому перезагрузка и глубокая ссылка работают. Кадр диагностик игры получает опознание игры, и хост ключует хранимое им по паре «источник + игра».

**Tech Stack:** TypeScript, cordis 4.0.0-rc.8, React 18, vite 6, vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-slot-webide-cordis-design.md` — §5 (клиентские сервисы, включая `layout`; пять экранов, из них «Превью» — стена, а не рамка с зумом), §8 (отказ как данные; один список), §11 (Фаза 4).

**Долг, который гасится:** записка Среза 3, пункты 1 и 2.

---

## Global Constraints

- Новый код — **только** в `engine/`. `packages/*` и верхнеуровневый `examples/*` — легаси: читать и импортировать можно, править нельзя. `engine/examples/first-slot` — наш.
- Комментарии и коммиты — по-английски, короткими повествовательными предложениями в голосе репозитория. Без списков в теле коммита; в заголовке не называть процесс проверки.
- **Контракты — словари, плагины — решения.** `engine/core/*` не импортирует ничего, кроме относительных модулей; строгий тест чистоты.
- **Отказ — это данные.** Ни один шов не бросает; ни один путь не заканчивается пустым экраном без объяснения. Ни одна надпись не утверждает причину, которой код не знает.
- Тесты — по пакетам: `npm test --workspace @energy8engine/<pkg>`. Корневой прогон даёт ложные падения.
- Playwright в `engine/apps/web`: `workers: 1`, порт 5679, **в одиночку**, потом проверка осиротевших процессов **перечислением** — `pkill -f "$tmpdir"` здесь не работает, он совпадает по рабочему каталогу, а не по командной строке. И проверка, что не осталось копий `engine/examples/e8-compose-*`.
- Каждое утверждение задаётся **вместе с мутацией, которая обязана его уронить**. На этой ветке шестнадцать раз утверждение проходило не через ту ветку, которую называет.

---

## Проверенные факты

Измерено на текущем HEAD (`c449fa6`).

### Экран в IDE ровно один, и он вшит

`engine/apps/web/src/App.tsx:74` — `return <CompositionScreen ctx={ctx} rows={rows ?? undefined} />`. Второй экран добавить нельзя иначе как правкой этого файла. Сервиса `layout`, который спека называет в списке клиентских, нет вовсе: `grep -rn "layout" engine/ide/client/src engine/apps/web/src` не даёт ничего.

Зато **карточки** уже приходят вкладами: `CompositionScreen.tsx:196` — `useSlot(ctx, 'composition.card')`, и `App.tsx:68` регистрирует туда панель диагностик. Механизм для экранов не надо изобретать, надо повторить на уровень выше.

### Превью уже есть, но не то

`Preview` и `computePreviewUrl` живут внутри `CompositionScreen.tsx` (строки 113 и 146) — одна рамка рядом с составом. Спека просит другого: «стена экранов: пресеты устройств, ориентации, языки одновременно… Не одна рамка с зумом». Файл при этом держит три заботы разом: хук диагностик редактора, превью и сам экран состава. Разделение — не уборка ради уборки, а следствие: превью уезжает на свой экран.

### Плагин уже умеет рисовать в IDE

`modules.ts:67` вызывает `half.apply?.(ctx)` для клиентской половины каждой строки, а `main.tsx:13` публикует React в `globalThis.__E8_IDE__`, чтобы половинки пользовались хуками без своего импорта. Значит экран, объявленный плагином проекта, работает тем же путём, что и карточка, — доказывать openness есть чем.

### Две игры затирают диагностики друг друга

`engine/ide/host/src/plugins/rpc.ts:186` — `lastGameDiagnostics.set('game', {…})`. Ключ — **источник**, не игра. И `:196-198` рассылает кадр каждой другой клиентской розетке. Стена превью открывает несколько игр сразу, каждая шлёт свой **целый** список, и хранимое хостом становится списком той, что заговорила последней; панель показывает его как «список игры».

Это ровно тот класс, который Срез 2 закрыл для пары «хост — игра» (`protocol.ts:70-76`: «ни один из них никогда не держит список другого»), вернувшийся для пары «игра — игра». Стена его вскрывает, и молчать про это нельзя: вводящая в заблуждение надпись хуже отсутствующей — это постоянное правило ветки.

### Пресеты экранов уже написаны, в легаси

`packages/harness/src/screens.ts` — `SCREEN_PRESETS`, семь штук, чистые данные; `packages/harness/src/langs.ts` — языки. Прецедент импорта из легаси есть: `engine/game/runtime/package.json:35` зависит от `@energy8platform/game-engine`.

**Решение:** импортируем, не копируем. Спека прямо говорит, что они «уже лежат в `harness`», а два источника правды для размеров, на которых мы проверяем поведение, хуже одной зависимости на чистые данные.

### Долг: `PAGE_NEEDS` — список рядом с чтениями

`engine/examples/first-slot/src/main.ts` держит две записи (`mechanics`, `play`) и сверяет их при загрузке. Ничто не связывает список с тем, что страница действительно читает: третье незащищённое чтение, добавленное позже, предупреждения не получит. А `ctx.board` защищён лишь тем, что `playloop1` объявляет его соседом и запись `play` стоит перед единственной строкой, читающей `ctx.board`.

---

## Структура файлов

| Путь | Ответственность |
|---|---|
| `engine/ide/client/src/plugins/layout.tsx` | **создать** — сервис `layout`: реестр экранов, текущий экран, подписка |
| `engine/ide/client/src/screens/Layout.tsx` | **создать** — навигация, граница ошибки экрана, пустой случай |
| `engine/ide/client/src/screens/CompositionScreen.tsx` | изменить — `Preview` и `computePreviewUrl` уезжают |
| `engine/ide/client/src/screens/PreviewWall.tsx` | **создать** — стена: пресеты, ориентация, языки |
| `engine/apps/web/src/App.tsx` | изменить — рендерит `<Layout/>`, об экранах не знает |
| `engine/core/contracts/src/protocol.ts` | изменить — кадр диагностик игры несёт опознание игры |
| `engine/ide/host/src/plugins/rpc.ts` | изменить — хранить по паре «источник + игра» |
| `engine/game/ide-bridge/src/index.ts` | изменить — игра называет себя |
| `engine/ide/client/src/plugins/diagnostics.tsx`, `screens/DiagnosticsPanel.tsx` | изменить — список игры больше не один |
| `engine/examples/first-slot/plugins/screen-demo/` | **создать** — чужой экран, доказательство открытости |
| `engine/examples/first-slot/src/main.ts` | изменить — нужды выводятся из чтений |
| `engine/apps/web/tests/e2e/screens.spec.ts` | **создать** — приёмка |

---

## Task 1: Сервис `layout` — реестр экранов

**Files:**
- Create: `engine/ide/client/src/plugins/layout.tsx`, `engine/ide/client/tests/layout.test.tsx`
- Modify: `engine/ide/client/src/index.ts`, `engine/ide/client/package.json`

**Interfaces:**
```ts
export interface ScreenMeta {
  /** Identity, and what goes in the address hash: `#/composition`. */
  id: string;
  /** What the navigation shows a human. */
  title: string;
  /** Ascending; ties break by registration order. */
  order?: number;
}

export interface ScreenEntry extends ScreenMeta {
  component: ComponentType<{ ctx: Context }>;
}

export interface LayoutService {
  /** Registers a screen. Returns a disposer, as `slots.register` does. */
  screen(meta: ScreenMeta, component: ComponentType<{ ctx: Context }>): () => void;
  /** Every screen, in `order` then registration order. */
  screens(): readonly ScreenEntry[];
  /** The screen the address currently names, or the first one. */
  current(): ScreenEntry | undefined;
  /** Navigates. Writes the address hash; the hash is the source of truth. */
  go(id: string): void;
  subscribe(listener: () => void): () => void;
}

declare module 'cordis' {
  interface Context {
    layout: LayoutService;
  }
}

export const name = 'layout';
export function apply(ctx: Context): void;
export function useLayout(ctx: Context): {
  screens: readonly ScreenEntry[];
  current: ScreenEntry | undefined;
};
```

**Interfaces consumed:** `createRegistry` from `@energy8engine/registry` — `createRegistry<T>({ policy })` giving `add(key, value): () => void`, `get(key)`, `keys()`. Add `@energy8engine/registry` to this package's dependencies.

**Interfaces produced:** everything above. Tasks 2, 3, 5 and 6 consume `ctx.layout` and `useLayout`.

- [ ] **Шаг 1: Падающие тесты**

```tsx
const Dummy = () => <div>x</div>;

it('a registered screen shows up, and its disposer takes it away', () => {
  const ctx = harness();
  const off = ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
  expect(ctx.layout.screens().map((s) => s.id)).toEqual(['a']);
  off();
  expect(ctx.layout.screens()).toEqual([]);
});

it('orders by order, then by when it was registered', () => {
  const ctx = harness();
  ctx.layout.screen({ id: 'late', title: 'L', order: 9 }, Dummy);
  ctx.layout.screen({ id: 'first', title: 'F', order: 1 }, Dummy);
  ctx.layout.screen({ id: 'alsolate', title: 'A', order: 9 }, Dummy);
  expect(ctx.layout.screens().map((s) => s.id)).toEqual(['first', 'late', 'alsolate']);
});

it('a screen with no order sorts after every screen that has one', () => {
  // Otherwise an unordered screen would land at position zero and shove
  // the deliberate ordering aside — the opposite of what omitting it means.
  const ctx = harness();
  ctx.layout.screen({ id: 'none', title: 'N' }, Dummy);
  ctx.layout.screen({ id: 'ordered', title: 'O', order: 5 }, Dummy);
  expect(ctx.layout.screens().map((s) => s.id)).toEqual(['ordered', 'none']);
});

it('two screens claiming one id is a diagnostic, and the last one wins', () => {
  // Same policy as `slots`, for the same reason: this is a rendered LIST,
  // and a project that forks a plugin must be able to replace its screen.
  const ctx = harness();
  ctx.layout.screen({ id: 'a', title: 'First' }, Dummy);
  ctx.layout.screen({ id: 'a', title: 'Second' }, Dummy);
  expect(ctx.layout.screens().map((s) => s.title)).toEqual(['Second']);
  expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
    expect.stringContaining('"a"'),
  ]);
});

it('the address hash names the current screen', () => {
  const ctx = harness();
  ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
  ctx.layout.screen({ id: 'b', title: 'B' }, Dummy);
  ctx.layout.go('b');
  expect(location.hash).toBe('#/b');
  expect(ctx.layout.current()?.id).toBe('b');
});

it('reads the hash it was loaded with, so a deep link opens that screen', () => {
  location.hash = '#/b';
  const ctx = harness();
  ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
  ctx.layout.screen({ id: 'b', title: 'B' }, Dummy);
  expect(ctx.layout.current()?.id).toBe('b');
});

it('a hash naming no screen falls back to the first, and says so', () => {
  // Not a blank page: a stale bookmark is a thing that happens, and the
  // reader has to be told why they are looking at something else.
  location.hash = '#/gone';
  const ctx = harness();
  ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
  expect(ctx.layout.current()?.id).toBe('a');
  expect(ctx.connection.diagnostics.map((d) => d.message)).toEqual([
    expect.stringContaining('gone'),
  ]);
});

it('the browser back button changes the current screen', () => {
  const ctx = harness();
  ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
  ctx.layout.screen({ id: 'b', title: 'B' }, Dummy);
  ctx.layout.go('b');
  const seen: (string | undefined)[] = [];
  ctx.layout.subscribe(() => seen.push(ctx.layout.current()?.id));
  location.hash = '#/a';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(seen).toEqual(['a']);
});

it('registering a screen notifies subscribers', () => {
  const ctx = harness();
  let calls = 0;
  ctx.layout.subscribe(() => calls++);
  ctx.layout.screen({ id: 'a', title: 'A' }, Dummy);
  expect(calls).toBe(1);
});

it('stops listening to the address once disposed', async () => {
  // The hashchange listener is on `window`; a torn-down context that keeps
  // reacting is a leak that survives every later test in the file.
  const ctx = harness();
  let calls = 0;
  ctx.layout.subscribe(() => calls++);
  await ctx.scope.dispose();
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(calls).toBe(0);
});
```

`harness()` builds a client context with `connection` and `layout` on it —
copy the one `slots.test.tsx` already uses and add `layout`. Reset
`location.hash = ''` in a `beforeEach`, or the deep-link tests leak into
their neighbours.

- [ ] **Шаг 2: Прогнать, убедиться, что падают**

Run: `npm test --workspace @energy8engine/ide-client -- layout`
Expected: FAIL — `ctx.layout` is undefined.

- [ ] **Шаг 3: Написать сервис**

Build the collection with `createRegistry<ScreenEntry>({ policy: 'last-wins' })`, exactly as `slots` does, and render the collision sentence here — the registry holds the policy and the disposer-identity guard, each adopter still words its own message and delivers it its own way. Deliver leniently through `ctx.reflect.get('connection', false)`, as `slots` does, so `layout` keeps working when composed without `connection`.

Keep the hash as the single source of truth for which screen is current: `go(id)` writes it, a `hashchange` listener reads it, and `current()` derives from it. Storing a second copy in component state is how the address and the screen drift apart.

- [ ] **Шаг 4: Прогнать, убедиться, что проходят**

Run: `npm test --workspace @energy8engine/ide-client`

- [ ] **Шаг 5: Мутации**

Confirm the RIGHT test fails for each. Delete the ordering tiebreak (registration order) → the ordering test goes red, not the others. Make `current()` read stored state instead of the hash → the back-button test goes red. Drop the `hashchange` listener's removal on dispose → the disposal test goes red. Drop the unknown-hash diagnostic → that test goes red and the fallback test stays green, proving they cover different halves.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client engine/apps/web
git commit -m "A screen can be declared, and the address says which one you are on"
```

---

## Task 2: `<Layout/>` — навигация, граница, пустой случай

**Files:**
- Create: `engine/ide/client/src/screens/Layout.tsx`
- Modify: `engine/ide/client/src/index.ts`, `engine/ide/client/tests/layout.test.tsx`

**Interfaces:**
```ts
export function Layout({ ctx }: { ctx: Context }): JSX.Element;
```

**Interfaces consumed:** `useLayout(ctx)` from Task 1.

- [ ] **Шаг 1: Падающие тесты**

```tsx
it('draws the current screen and a tab per registered screen', () => {
  const ctx = harness();
  ctx.layout.screen({ id: 'a', title: 'Alpha' }, () => <div>ALPHA BODY</div>);
  ctx.layout.screen({ id: 'b', title: 'Beta' }, () => <div>BETA BODY</div>);
  render(<Layout ctx={ctx} />);
  expect(screen.getByText('ALPHA BODY')).toBeTruthy();
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Alpha', 'Beta']);
});

it('clicking a tab shows that screen', async () => {
  const ctx = harness();
  ctx.layout.screen({ id: 'a', title: 'Alpha' }, () => <div>ALPHA BODY</div>);
  ctx.layout.screen({ id: 'b', title: 'Beta' }, () => <div>BETA BODY</div>);
  render(<Layout ctx={ctx} />);
  await userEvent.click(screen.getByRole('tab', { name: 'Beta' }));
  expect(screen.getByText('BETA BODY')).toBeTruthy();
  expect(screen.queryByText('ALPHA BODY')).toBeNull();
});

it('a screen registered after mount appears without a reload', () => {
  // The whole point of screens being contributions: a plugin's client half
  // lands whenever its import resolves, which is after this renders.
  const ctx = harness();
  render(<Layout ctx={ctx} />);
  act(() => { ctx.layout.screen({ id: 'late', title: 'Late' }, () => <div>LATE</div>); });
  expect(screen.getByRole('tab', { name: 'Late' })).toBeTruthy();
});

it('with no screens at all it explains itself instead of painting nothing', () => {
  const ctx = harness();
  render(<Layout ctx={ctx} />);
  expect(screen.getByTestId('layout-empty').textContent).toMatch(/no screens/i);
});

it('a screen that throws does not take the rest of the IDE with it', () => {
  const ctx = harness();
  const Bad = () => { throw new Error('screen exploded'); };
  ctx.layout.screen({ id: 'bad', title: 'Bad' }, Bad);
  ctx.layout.screen({ id: 'ok', title: 'OK' }, () => <div>OK BODY</div>);
  render(<Layout ctx={ctx} />);
  expect(screen.getByRole('tab', { name: 'OK' })).toBeTruthy();
  expect(screen.getByTestId('screen-error').textContent).toContain('screen exploded');
});

it('reports the crashed screen, so it reaches the one list', () => {
  const ctx = harness();
  ctx.layout.screen({ id: 'bad', title: 'Bad' }, () => { throw new Error('screen exploded'); });
  render(<Layout ctx={ctx} />);
  expect(ctx.connection.diagnostics.map((d) => d.plugin)).toContain('bad');
});

it('a crashed screen still lets you navigate away from it', async () => {
  // A boundary that swallows the crash but keeps the tabs unreachable
  // leaves the IDE just as stuck as no boundary at all.
  const ctx = harness();
  ctx.layout.screen({ id: 'bad', title: 'Bad' }, () => { throw new Error('boom'); });
  ctx.layout.screen({ id: 'ok', title: 'OK' }, () => <div>OK BODY</div>);
  render(<Layout ctx={ctx} />);
  await userEvent.click(screen.getByRole('tab', { name: 'OK' }));
  expect(screen.getByText('OK BODY')).toBeTruthy();
});
```

- [ ] **Шаг 2: Прогнать, убедиться, что падают**

Run: `npm test --workspace @energy8engine/ide-client -- layout`

- [ ] **Шаг 3: Написать компонент**

Read `CompositionScreen.tsx`'s `CardBoundary` first — a screen boundary is the same shape, and the two should read as siblings, not as two independent inventions. The boundary must key on the current screen's id, or React reuses the errored boundary instance when you navigate away and the next screen renders as broken too.

- [ ] **Шаг 4: Прогнать, убедиться, что проходят**

- [ ] **Шаг 5: Мутации**

Drop the boundary's key → the navigate-away test goes red. Drop the empty-state branch → that test goes red. Drop the `subscribe` in `useLayout` → the register-after-mount test goes red.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client
git commit -m "The IDE draws whichever screens it was given, and survives a bad one"
```

---

## Task 3: Экран состава становится вкладом, превью уезжает

**Files:**
- Modify: `engine/apps/web/src/App.tsx`, `engine/ide/client/src/screens/CompositionScreen.tsx`, `engine/ide/client/src/index.ts`
- Create: `engine/ide/client/src/screens/PreviewWall.tsx` (stub in this task — the wall itself is Task 6)
- Modify: `engine/ide/client/tests/composition-screen.test.tsx`, `engine/ide/client/tests/preview.test.tsx`, `engine/apps/web` if it holds tests

**Interfaces:**
```ts
// moves out of CompositionScreen.tsx, unchanged in shape
export function computePreviewUrl(): string;
export interface PreviewProps { ctx: Context; url: string }
export function Preview(props: PreviewProps): JSX.Element;
```

- [ ] **Шаг 1: Падающие тесты**

```tsx
it('App registers the composition screen rather than rendering it', () => {
  const ctx = harness();
  render(<App ctx={ctx} />);
  expect(ctx.layout.screens().map((s) => s.id)).toContain('composition');
});

it('App draws Layout’s chrome, not a screen on its own', () => {
  // The guard against the old shape coming back. App used to render
  // CompositionScreen directly; if it still did, the composition body
  // would be on screen even though nothing put a tab there.
  const ctx = harness();
  render(<App ctx={ctx} />);
  expect(screen.getByRole('tab', { name: /composition/i })).toBeTruthy();
});

it('Preview keeps working from its new home', () => {
  // The existing preview.test.tsx suite must pass UNCHANGED except for the
  // import path — this task moves code, it does not change behaviour.
});
```

- [ ] **Шаг 2: Прогнать, убедиться, что падают**

- [ ] **Шаг 3: Переместить и подключить**

Move `computePreviewUrl`, `PreviewProps` and `Preview` out of `CompositionScreen.tsx` into `PreviewWall.tsx`, keeping the barrel's exports byte-identical so no consumer's import breaks. `useEditorDiagnostics` stays where it is — it is about diagnostics, not about either screen.

In `App.tsx`, replace the direct render with two registrations and `<Layout/>`. The `composition.card` registration for the diagnostics panel stays exactly as it is: cards are a different mechanism from screens and this task does not touch them.

- [ ] **Шаг 4: Прогнать все три сюиты**

Run: `npm test --workspace @energy8engine/ide-client`
The existing `composition-screen.test.tsx` and `preview.test.tsx` assertions must pass **unchanged** apart from import paths. Editing an assertion here means behaviour moved when it should not have — stop and say so.

- [ ] **Шаг 5: Мутации**

Make `App` render `<CompositionScreen/>` directly again → the "renders Layout" test goes red.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client engine/apps/web
git commit -m "The composition screen arrives the same way every other screen will"
```

---

## Task 4: Кадр диагностик называет игру

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts`, `engine/core/contracts/tests/protocol.test.ts`
- Modify: `engine/game/ide-bridge/src/index.ts`, `engine/game/ide-bridge/tests/index.test.ts`

**Interfaces:**
```ts
export interface GameDiagnosticsMessage {
  type: 'game-diagnostics';
  diagnostics: Diagnostic[];
  dropped: number;
  source?: GameDiagnosticsSource;
  /**
   * Which running game this list belongs to. Absent on a host frame — the
   * host is one speaker, not one of several games. Present on every game
   * frame, because the preview wall runs several at once and one game's
   * whole-list frame must not be read as another's.
   */
  game?: string;
}
```

**Interfaces produced:** the `game` field. Task 5 keys on it; Task 6's wall is why it exists.

- [ ] **Шаг 1: Падающий тест, который сначала воспроизводит дефект**

Before adding anything, write the test that shows the loss, so the fix is measured rather than assumed:

```ts
it('two games reporting do not overwrite each other in what the host retains', async () => {
  const host = await startHost();
  const gameA = await connect(host);
  const gameB = await connect(host);
  gameA.send(gameFrame({ game: 'a', diagnostics: [d('A said this')] }));
  gameB.send(gameFrame({ game: 'b', diagnostics: [d('B said this')] }));
  const late = await connect(host);
  const retained = await framesFor(late, 'game-diagnostics');
  expect(retained.flatMap((f) => f.diagnostics.map((x) => x.message)).sort())
    .toEqual(['A said this', 'B said this']);
});
```

Run it against today's code and confirm it fails with only one of the two messages — that failure is the defect, and the report must quote it.

Then the bridge's own half:

```ts
it('the bridge stamps its game onto every frame it sends', () => {
  const log = createDiagnostics();
  const socket = fakeSocket();
  attachDiagnosticsForwarding(socket, log, { game: 'tile-3' });
  log.report(d('something'));
  expect(JSON.parse(socket.sent[0]).game).toBe('tile-3');
});

it('a game with no identity configured still sends, and says nothing false', () => {
  // A single-game setup existed before this field and must keep working;
  // absent is a legal value meaning "the only game", not a broken frame.
  const log = createDiagnostics();
  const socket = fakeSocket();
  attachDiagnosticsForwarding(socket, log);
  log.report(d('something'));
  expect(JSON.parse(socket.sent[0]).game).toBeUndefined();
});

it('still seeds a host frame, which carries no game of its own', () => {
  // Task 6 of the previous slice: `source === 'host'` only, `seed` not
  // `report`. Adding a field must not widen that filter.
  const log = createDiagnostics();
  const socket = fakeSocket();
  attachDiagnosticsForwarding(socket, log);
  socket.deliver({ type: 'game-diagnostics', source: 'host', dropped: 0, diagnostics: [d('spin failed')] });
  expect(log.own()).toEqual([]);
  expect(log.list().map((x) => x.message)).toEqual(['spin failed']);
});

it('still ignores another game’s frame, identity or no identity', () => {
  const log = createDiagnostics();
  const socket = fakeSocket();
  attachDiagnosticsForwarding(socket, log, { game: 'tile-1' });
  socket.deliver({ type: 'game-diagnostics', source: 'game', game: 'tile-2', dropped: 0, diagnostics: [d('not mine')] });
  expect(log.list()).toEqual([]);
});
```

Where the bridge's identity comes from is the implementer's call, but it must be visible to whoever opened the game — a URL parameter is the obvious source, since the wall opens each tile at its own address. Say in the row's config doc where it comes from.

- [ ] **Шаг 2: Прогнать, убедиться, что падают, и записать текст падения**

- [ ] **Шаг 3: Реализовать**

- [ ] **Шаг 4: Прогнать**

Run: `npm test --workspace @energy8engine/contracts` and `--workspace @energy8engine/ide-bridge`

- [ ] **Шаг 5: Мутации**

Drop the stamp → the stamping test goes red and the absent-identity test stays green. Widen the inbound filter to accept `source: 'game'` → the ignore-another-game test goes red. Confirm the previous slice's two tests (seed-not-report; host-only) are still the ones guarding those properties.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/core/contracts engine/game/ide-bridge
git commit -m "A game says which game it is, because soon there are several"
```

---

## Task 5: Хост и панель перестают сливать игры в одну

**Files:**
- Modify: `engine/ide/host/src/plugins/rpc.ts`, `engine/ide/host/tests/rpc.test.ts`
- Modify: `engine/ide/client/src/plugins/diagnostics.tsx`, `engine/ide/client/src/screens/DiagnosticsPanel.tsx`, and their tests

**Interfaces consumed:** `GameDiagnosticsMessage.game` from Task 4.

**Interfaces produced:**
```ts
/** One running game's whole list, kept apart from every other game's. */
export interface GameDiagnosticsGroup {
  /** Which game. `undefined` when only one game ever spoke — the common case. */
  game: string | undefined;
  diagnostics: readonly Diagnostic[];
  dropped: number;
}

// diagnostics.tsx — was `{ diagnostics, dropped }`
export function useGameDiagnostics(ctx: Context): {
  groups: readonly GameDiagnosticsGroup[] | null;   // null until any game speaks
  dropped: number;                                   // summed across games
};

// DiagnosticsPanel.tsx — `game` was `readonly Diagnostic[] | null`
export interface DiagnosticsPanelProps {
  project: readonly Diagnostic[];
  game: readonly GameDiagnosticsGroup[] | null;
  editor: readonly Diagnostic[];
  droppedFromGame?: number;
}
```

`App.tsx`'s `DiagnosticsPanelCard` passes the new shape through; it is the only non-test caller.

- [ ] **Шаг 1: Падающие тесты**

```ts
it('retains one frame per game, not one for all of them', async () => {
  // The host half of the defect Task 4's test showed.
  const host = await startHost();
  const a = await connect(host);
  const b = await connect(host);
  a.send(gameFrame({ game: 'a', diagnostics: [d('A said this')] }));
  b.send(gameFrame({ game: 'b', diagnostics: [d('B said this')] }));
  await settle(host);
  expect(retainedMessages(host).sort()).toEqual(['A said this', 'B said this']);
});

it('a late-connecting client is told about every game that has spoken', async () => {
  // The existing "retains one frame PER SOURCE" test is the model; this is
  // the same promise one level finer.
  const host = await startHost();
  const a = await connect(host);
  const b = await connect(host);
  a.send(gameFrame({ game: 'a', diagnostics: [d('A said this')] }));
  b.send(gameFrame({ game: 'b', diagnostics: [d('B said this')] }));
  const late = await connect(host);
  const frames = await framesFor(late, 'game-diagnostics');
  expect(frames.map((f) => f.game).sort()).toEqual(['a', 'b']);
});

it('a host frame is still retained once, under no game', async () => {
  // The host is one speaker. Adding a per-game key must not accidentally
  // give the host a game identity it does not have.
  const host = await startHost();
  host.ctx.ideRpc.reportGameDiagnostics([d('spin failed')]);
  const late = await connect(host);
  const frames = await framesFor(late, 'game-diagnostics');
  const hostFrames = frames.filter((f) => f.source === 'host');
  expect(hostFrames).toHaveLength(1);
  expect(hostFrames[0].game).toBeUndefined();
});

it('a game that disconnects stops being retained, so a closed tile does not haunt the panel', async () => {
  // Otherwise the wall accumulates the ghosts of every tile ever opened.
  const host = await startHost();
  const a = await connect(host);
  a.send(gameFrame({ game: 'a', diagnostics: [d('A said this')] }));
  await settle(host);
  await a.close();
  const late = await connect(host);
  const frames = await framesFor(late, 'game-diagnostics');
  expect(frames.filter((f) => f.game === 'a')).toEqual([]);
});
```

```tsx
it('the panel attributes a game row to its game', () => {
  render(<DiagnosticsPanel project={[]} editor={[]}
    game={[{ game: 'tile-3', diagnostics: [d('mobile broke')] },
           { game: 'tile-1', diagnostics: [d('desktop broke')] }]} />);
  expect(screen.getByTestId('diag-0')).toHaveTextContent('tile-3');
  expect(screen.getByTestId('diag-1')).toHaveTextContent('tile-1');
});

it('one game is shown exactly as before, with no game label to read', () => {
  // The single-game case is the common one and must not grow ceremony.
  render(<DiagnosticsPanel project={[]} editor={[]}
    game={[{ game: undefined, diagnostics: [d('it broke')] }]} />);
  expect(screen.getByTestId('diag-0')).toHaveTextContent('it broke');
  expect(screen.getByTestId('diag-0').textContent).not.toMatch(/tile|game "/i);
});
```

The panel's three-namespace ordering (`project → game → editor`) does not change: which GAME a row came from is a finer grain inside the `game` namespace, not a fourth namespace. That distinction is a standing rule on this branch — `GAME_DIAGNOSTIC_SOURCES = ['game','host']` is which SPEAKER, the panel's order is which NAMESPACE, and neither may absorb the other or this new one.

- [ ] **Шаг 2–4: Прогнать, реализовать, прогнать**

- [ ] **Шаг 5: Мутации**

Key the host's map by source alone again → the per-game retention test goes red. Drop the disconnect cleanup → the ghost test goes red. Render the game label unconditionally → the single-game test goes red.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/host engine/ide/client
git commit -m "Two games no longer speak over each other"
```

---

## Task 6: Стена превью

**Files:**
- Modify: `engine/ide/client/src/screens/PreviewWall.tsx`, `engine/ide/client/tests/preview.test.tsx`
- Modify: `engine/ide/client/package.json` (dependency on `@energy8platform/harness`)
- Modify: `engine/apps/web/src/App.tsx` (register the screen)

**Interfaces consumed:** `SCREEN_PRESETS` (`{ name, w, h }[]`, seven entries) and the language list from `@energy8platform/harness`; `Preview` and `computePreviewUrl` from Task 3; `ctx.layout.screen` from Task 1.

**Interfaces produced:**
```ts
export interface PreviewWallProps {
  ctx: Context;
  /**
   * Preset names to show. Omitted, the wall picks its own small default —
   * every tile is a whole game booting Pixi and opening a socket, so the
   * default is a few, not all seven. Present, it is what the tests pass to
   * pin a case, including a name the harness does not know.
   */
  chosen?: readonly string[];
}
export function PreviewWall(props: PreviewWallProps): JSX.Element;
```

Each tile's address carries its own game identity (Task 4's field) and the chosen language, so the panel can tell tiles apart and so a tile renders in the language being checked.

- [ ] **Шаг 1: Падающие тесты**

```tsx
it('draws one frame per chosen preset, at that preset’s size', () => {
  render(<PreviewWall ctx={harness()} />);
  const tiles = screen.getAllByTestId(/^tile-/);
  expect(tiles.length).toBeGreaterThan(1);          // a wall, not one frame
  expect(tiles[0].getAttribute('width')).toBe('1200');
});

it('starts with a few tiles, not all seven', () => {
  // Every tile is a whole game booting Pixi and opening a socket. The wall
  // is worth having because you can see several at once, not because it
  // opens every size anyone ever defined.
  render(<PreviewWall ctx={harness()} />);
  expect(screen.getAllByTestId(/^tile-/).length).toBeLessThanOrEqual(3);
});

it('turning a preset on adds its tile, turning it off removes it', async () => {
  render(<PreviewWall ctx={harness()} />);
  const before = screen.getAllByTestId(/^tile-/).length;
  await userEvent.click(screen.getByRole('checkbox', { name: 'Mobile S' }));
  expect(screen.getAllByTestId(/^tile-/)).toHaveLength(before + 1);
  await userEvent.click(screen.getByRole('checkbox', { name: 'Mobile S' }));
  expect(screen.getAllByTestId(/^tile-/)).toHaveLength(before);
});

it('each tile carries its own game identity, so the panel can tell them apart', () => {
  render(<PreviewWall ctx={harness()} />);
  const urls = screen.getAllByTestId(/^tile-/).map((t) => t.getAttribute('src'));
  expect(new Set(urls).size).toBe(urls.length);
});

it('rotating a tile swaps its width and height', async () => {
  render(<PreviewWall ctx={harness()} />);
  const tile = screen.getAllByTestId(/^tile-/)[0];
  const [w, h] = [tile.getAttribute('width'), tile.getAttribute('height')];
  await userEvent.click(screen.getByRole('button', { name: /rotate/i }));
  const rotated = screen.getAllByTestId(/^tile-/)[0];
  expect([rotated.getAttribute('width'), rotated.getAttribute('height')]).toEqual([h, w]);
});

it('a language choice reaches the tile’s address', async () => {
  render(<PreviewWall ctx={harness()} />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /lang/i }), 'de');
  for (const tile of screen.getAllByTestId(/^tile-/)) {
    expect(new URL(tile.getAttribute('src')!, 'http://x').searchParams.get('lang')).toBe('de');
  }
});

it('the wall survives a preset the harness does not know', () => {
  // Failures are data: an unknown preset name is a diagnostic and a
  // skipped tile, not a crashed screen.
  const ctx = harness();
  render(<PreviewWall ctx={ctx} chosen={['Desktop', 'Hologram']} />);
  expect(screen.getAllByTestId(/^tile-/)).toHaveLength(1);
  expect(ctx.connection.diagnostics.map((x) => x.message)).toEqual([
    expect.stringContaining('Hologram'),
  ]);
});
```

- [ ] **Шаг 2–4: Прогнать, реализовать, прогнать**

- [ ] **Шаг 5: Мутации**

Give every tile the same identity → the distinct-identity test goes red. Ignore the orientation flag → the rotation test goes red. Default to all seven presets → the "starts with a few" test goes red.

- [ ] **Шаг 6: Коммит**

```bash
git add engine/ide/client engine/apps/web
git commit -m "The preview screen is a wall, not one frame with a zoom"
```

---

## Task 7: Чужой экран, и нужды страницы выводятся из чтений

Two halves, one task: the first proves the layer is open, the second pays the recorded debt. They share no files, but both are small and both are about a declaration replacing a convention.

**Files:**
- Create: `engine/examples/first-slot/plugins/screen-demo/{package.json,src/client.js}`
- Modify: `engine/examples/first-slot/e8.patch.yml`
- Modify: `engine/examples/first-slot/src/main.ts`, and the example's tests

- [ ] **Шаг 1: Чужой экран**

Write a plugin whose client half registers a screen, using ONLY the surfaces this slice published — `ctx.layout.screen` and the React on `globalThis.__E8_IDE__`. Do not read `Layout.tsx` or `layout.tsx` while writing it; if the published surface is not enough, that is a finding about the surface, and it goes in the report rather than being worked around.

```js
// engine/examples/first-slot/plugins/screen-demo/src/client.js
export const name = 'screen-demo';
export function apply(ctx) {
  const { React } = globalThis.__E8_IDE__;
  ctx.layout.screen({ id: 'demo', title: 'Demo', order: 50 }, () =>
    React.createElement('div', { 'data-testid': 'demo-screen' }, 'a screen from a project plugin'),
  );
}
```

- [ ] **Шаг 2: Нужды из чтений**

Replace `PAGE_NEEDS` with a mechanism where the list cannot drift from the reads, because the reads ARE the list. One shape that works: a `need(name, what)` helper that records the name, reads `ctx.reflect.get(name, false)`, and returns a handle every later use goes through; the boot check then reports whatever `need` recorded as absent. A third unguarded read cannot then be added without going through `need`, because there is no other way to get the service.

This also settles `ctx.board`, which today is guarded only by inference — `playloop1` happens to declare it and `play` happens to be evaluated first in the same expression. Make it its own read.

```ts
it('a service the page reads but never declared is impossible to add', () => {
  // The type-level half: reading ctx.<service> directly in main.ts should
  // not typecheck. If that cannot be expressed, say so and assert the
  // runtime half instead — and say in the report which one you got.
});

it('board absent is reported by name, not inferred from play', async () => {
  const game = await bootPage({ without: ['board'] });
  expect(failureText(game)).toContain('board');
});

it('a page need that is met stays silent', async () => {
  const game = await bootPage({});
  expect(game.diagnostics.filter((x) => x.where === 'page')).toEqual([]);
});
```

- [ ] **Шаг 3–5: Прогнать, мутации, коммит**

Confirm the demo screen appears in the IDE, and that removing `layout` from the client makes the plugin's `apply` fail as data rather than throw. For the page's needs: drop one recorded need → the test naming that service goes red.

```bash
git add engine/examples/first-slot
git commit -m "A project plugin brings its own screen, and the page states its needs once"
```

---

## Task 8: Приёмка

**Files:**
- Create: `engine/apps/web/tests/e2e/screens.spec.ts`
- Modify: `engine/apps/web/tests/e2e/project-fixture.ts` if the fixture needs a new option — extend it there rather than writing YAML by hand in a spec, as the previous slice ruled.

Acceptance earns its place by exercising the promise end to end through a live host and a real browser. **It may not exclude a class of cases on the grounds that it already works** — the previous slice nearly shipped a guard that stayed green only because its fixture had grown a row that excluded the failing case, and the slice before that lost a whole half that way. Say in the report which cases were considered and why each is in or out.

- [ ] **Шаг 1: Тесты**

```ts
test('the IDE opens on a screen, and a second screen is one click away', async ({ page }) => {
  const host = await startDevHost(projectCopy());
  try {
    await page.goto('http://127.0.0.1:5680/');
    await expect(page.getByRole('tab', { name: /composition/i })).toBeVisible();
    await page.getByRole('tab', { name: /preview/i }).click();
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible();
  } finally { await host.stop(); }
});

test('a deep link opens the screen it names', async ({ page }) => {
  const host = await startDevHost(projectCopy());
  try {
    await page.goto('http://127.0.0.1:5680/#/preview');
    await expect(page.getByTestId(/^tile-/).first()).toBeVisible();
  } finally { await host.stop(); }
});

test('a project plugin’s screen appears in the navigation', async ({ page }) => {
  // The openness proof, through the real pipeline: the plugin's client half
  // is imported by `modules`, applies against the real `ctx.layout`, and
  // its tab is there.
});

test('the preview wall shows several tiles at once', async ({ page }) => {
  const host = await startDevHost(projectCopy());
  try {
    await page.goto('http://127.0.0.1:5680/#/preview');
    await expect(page.getByTestId(/^tile-/)).toHaveCount(2, { timeout: 30_000 });
  } finally { await host.stop(); }
});

test('two tiles reporting trouble both appear, attributed to their tiles', async ({ page }) => {
  // The defect Tasks 4 and 5 fixed, proved where it actually lives.
});

test('a screen that throws leaves the rest of the IDE usable', async ({ page }) => {
  // The fixture's demo plugin takes a flag that makes its screen throw.
  const host = await startDevHost(projectCopy({ crashingScreen: true }));
  try {
    await page.goto('http://127.0.0.1:5680/#/demo');
    await expect(page.getByTestId('screen-error')).toBeVisible();
    await page.getByRole('tab', { name: /composition/i }).click();
    await expect(page.getByTestId('composition')).toBeVisible();
  } finally { await host.stop(); }
});
```

- [ ] **Шаг 2: Прогнать в одиночку**

Run: the Playwright suite alone, `workers: 1`, port 5679. Then LIST processes to check for orphans, and confirm no `engine/examples/e8-compose-*` remain.

- [ ] **Шаг 3: Подтвердить, что каждый тест упал бы без среза**

Revert the relevant production change for each and confirm that test goes red. A green acceptance test that would also be green without the slice proves nothing.

- [ ] **Шаг 4: Коммит**

```bash
git add engine/apps/web
git commit -m "Acceptance: screens arrive as contributions, and the wall tells its tiles apart"
```
