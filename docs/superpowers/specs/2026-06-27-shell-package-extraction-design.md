# Дизайн: пакет `@energy8platform/shell` — единое ядро + контракт рендерера

- **Дата:** 2026-06-27
- **Статус:** утверждён дизайн, ожидается ревью спеки
- **Автор:** Maksim Melnikov (+ Claude)

## 1. Контекст

Сейчас shell существует в двух независимых реализациях («1:1 порт» друг друга):

- **HTML / DOM-shell** — внутри `platform-core`: [`packages/platform-core/src/shell/`](../../../packages/platform-core/src/shell/) (~3 900 строк). Экспорт: `@energy8platform/platform-core/shell` → `createGameShell`, `GameShell`. Потребители: [`examples/shell-demo`](../../../examples/shell-demo/src/main.ts), реэкспорт из `packages/game-engine/src/shell/index.ts`.
- **Pixi-shell** — отдельный пакет: [`packages/pixi-shell/`](../../../packages/pixi-shell/) (~7 000 строк). Экспорт: `@energy8platform/pixi-shell` → `createPixiShell`, `PixiGameShell`. Потребители: [`examples/pixi-shell-demo`](../../../examples/pixi-shell-demo/src/main.ts), `packages/game-engine/src/host/createSlotGame.ts`.

### Замеренное дублирование

Сравнение файлов логики между двумя реализациями:

| Файл | Статус | Строк |
|------|--------|-------|
| `locales.ts` | **идентичны** | 864 |
| `keyboard.ts` | **идентичны** | 229 |
| `i18n.ts` | **идентичны** | 96 |
| `format.ts` | **идентичны** | 39 |
| `state.ts` | **идентичны** | 31 |
| `colors.ts` | **идентичны** | 32 |
| `fonts.ts` | **идентичны** | 13 |
| `types.ts` | общий контракт + хвост по рендереру | 262 / 280 |
| `theme.ts` | общая палитра, разный «эмит» (CSS-var vs объект токенов) | 54 / 72 |
| `motion.ts` | общий `prefersReducedMotion`, разный count-up | 43 / 68 |
| `version.ts` | только значение версии | 3 |
| `EventEmitter.ts` | различие только в комментариях | — |

Итого ~**1 300 строк побайтово идентичны**, ещё несколько файлов разделяют данные и расходятся только в привязке к рендереру:
- mount-цель: `mount: HTMLElement` (DOM) vs `app: Application` (Pixi);
- узлы расширения: `HTMLElement` vs `Container` (`BonusOption.custom`, `GameInfoSection.custom.node`);
- эмиссия темы: CSS custom properties (`buildThemeVars`) vs объект `ShellTokens` (`resolveTheme`);
- count-up: `requestAnimationFrame` + `textContent` vs Pixi `Ticker` + `setText`.

### Уже существующий задел (важно)

Pixi-сторона **уже** построена на контракте: [`packages/pixi-shell/src/context.ts`](../../../packages/pixi-shell/src/context.ts) определяет:
- `ShellHost` — интерфейс, от которого зависят все pixi-компоненты (а не от класса `PixiGameShell`);
- `ShellLayer` / `LayerHandle` — контракт оверлея (`resize`/`fit`/`onRemove`/`onKey`).

`PixiGameShell implements ShellHost`. DOM-сторона менее абстрагирована: компоненты получают сам `GameShell` (`renderBottomBar(this)`, `openSettingsModal(this)`). Этот задел снижает риск: паттерн «host-контракт + компоненты» уже доказан на Pixi.

## 2. Цели и не-цели

### Цели
1. Создать новый пакет `@energy8platform/shell` с **единым ядром логики** и двумя рендерерами под `ui/html` и `ui/pixi`.
2. Вынести всю логику (состояние, события, клавиатура, i18n, формат, тема-токены, шаг ставки/турбо, поток оверлеев, цены buy-bonus, роутинг клавиш) в renderer-agnostic ядро.
3. Зафиксировать **контракт рендерера** так, что новое «отображение» (`custom`) физически не может сломать логику ставки/состояния — оно только рисует и репортит ввод.
4. Подключить пакет к двум примерам: `shell-demo` → `/html`, `pixi-shell-demo` → `/pixi`, с поведением 1:1.
5. Перенести оба набора тестов в новый пакет.

### Не-цели (явно вне рамок)
- **Не трогаем** `packages/platform-core/src/shell`, `packages/pixi-shell`, `packages/game-engine`. Новый пакет аддитивный; старые продолжают работать как есть.
- Не унифицируем вёрстку компонентов между DOM и Pixi (это потребовало бы общий сцен-граф примитивов — отдельный большой проект).
- Не мигрируем `game-engine` на новый пакет (он остаётся на `@energy8platform/pixi-shell`).
- Не вводим строковую фабрику `createShell('pixi'|'html', …)` в ядро (потянула бы оба рендерера в бандл, убила tree-shaking).

## 3. Архитектура

Слоистая модель **controller (мозг) → host (мост) → renderer (вид)**.

```
            игра вызывает публичный API           рендерер репортит ввод
  game ──────────────────────────────▶ ShellController ◀───────────────────── renderer controls
                                          │  владеет: state, события, клавиатура,
                                          │  i18n, формат, тема-токены, поток оверлеев,
                                          │  цены buy-bonus, роутинг клавиш
                                          │
                                          ├── реализует ShellHost (мост: данные+логика+actions)
                                          │
                                          ▼  драйвит вид
                                     ShellRenderer  (mount/renderBar/setLayout/applyTheme/
                                          │          animateMoney/openOverlay/closeOverlay/destroy)
                              ┌───────────┴───────────┐
                        HtmlRenderer              PixiRenderer
                        (DOM-узлы, CSS)           (Pixi Container'ы)
```

### 3.1 `ShellController` (ядро, `core/`)
Владеет всей логикой и публичным API, который вызывает игра — поверхность 1:1 с текущими `GameShell`/`PixiGameShell`:

`setBalance · setWin · setBet · setMode · setBusy · setAutoplay · setTurbo · setFreeSpins · setBuyBonusEnabled · setTheme · setLanguage · setSocial · setSound · activateFeature · deactivateFeature · formatWin · openMenu · openSettings · openInfo · openBuyBonus · openBetPicker · openAutoplayPicker · openReplay · openModal · closeModal · destroy`

Дополнительно владеет: `state: ShellState`, `KeyboardController` (уже renderer-agnostic), i18n (`t`), `formatCurrency`, `resolveTheme → ShellTokens`, `stepBet`/`nextTurbo`, состоянием стека оверлеев и роутингом клавиш в открытый оверлей. **Не создаёт узлов** — делегирует рендереру.

### 3.2 Контракт рендерера (ядро, `core/renderer.ts`)

```ts
export interface ShellRenderer {
  /** Привязка к мозгу. Цель монтирования (DOM-элемент / Pixi app) рендерер держит в себе. */
  mount(host: ShellHost): void;
  /** (Пере)нарисовать нижний бар из host.state. */
  renderBar(): void;
  /** Сменить раскладку бара. Мозг решает wide|mobile из размера, переданного через host.notifyResize. */
  setLayout(layout: ShellLayoutMode): void;
  /** Применить цветовые токены (CSS-vars в DOM / перекраска в Pixi). */
  applyTheme(tokens: ShellTokens): void;
  /** Анимировать денежный показатель from→to (DOM rAF / Pixi Ticker — деталь рендерера). */
  animateMoney(field: 'balance' | 'win', from: number, to: number): void;
  /** Построить и показать оверлей по модели от мозга; вернуть ручку для роутинга клавиш и закрытия. */
  openOverlay(req: OverlayRequest): OverlayHandle;
  /** Закрыть текущий оверлей, если открыт. */
  closeOverlay(): void;
  /** Фейд-аут + снос узлов; резолвится по завершении. */
  destroy(): Promise<void> | void;
}

export type ShellLayoutMode = 'wide' | 'mobile';

export interface OverlayHandle {
  /** Клавиши, специфичные для оверлея (стрелки в пикере). true = поглотить. */
  onKey?(e: KeyboardEvent): boolean;
  /** Программно закрыть этот оверлей. */
  close(): void;
}

export type OverlayRequest =
  | { kind: 'settings' }
  | { kind: 'gameInfo' }
  | { kind: 'buyBonus' }
  | { kind: 'betPicker' }
  | { kind: 'autoplayPicker' }
  | { kind: 'replay'; opts: ReplayModalOptions }
  | { kind: 'modal'; opts: ModalOptions };
```

Узлы (`HTMLElement`/`Container`) **не утекают в ядро** — `OverlayHandle` отдаёт только `{ onKey?, close }`. Внутренние понятия (pixi `ShellLayer`) остаются деталью рендерера.

### 3.3 `ShellHost` — мост (ядро, `core/renderer.ts`)
Срез контроллера, который видит рендерер и его компоненты (обобщение существующего pixi `ShellHost`, очищенное от рендеро-специфики):

```ts
export interface ShellHost {
  readonly state: ShellState;
  readonly config: ResolvedShellConfig;
  readonly tokens: ShellTokens;
  readonly layout: ShellLayoutMode;
  t(text: string): string;
  formatCurrency(n: number, win?: boolean): string;
  emit: EventEmitter<ShellEvents>['emit'];
  /** Рендерер сообщает свой размер → мозг пересчитывает layout и зовёт setLayout/renderBar. */
  notifyResize(w: number, h: number): void;
  /** Логиконесущие действия, которые дёргают контролы рендерера. */
  actions: ShellActions;
}

export interface ShellActions {
  spin(): void;
  stepBet(dir: 1 | -1): void;
  setBet(n: number): void;
  cycleTurbo(): void;
  toggleAutoplay(): void;
  startAutoplay(remaining: number): void;
  stopAutoplay(): void;
  openMenu(): void; openSettings(): void; openInfo(): void; openBuyBonus(): void;
  openBetPicker(): void; openAutoplayPicker(): void;
  selectBuyBonus(id: string): void;
  activateFeature(b: BonusOption): void; deactivateFeature(): void;
  setSound(on: boolean): void;
  closeOverlay(): void;
}
```

`ResolvedShellConfig` — это входной `ShellConfig` после применения дефолтов (`version='1.0.0'`, `isSocial=false`, `replay = mode==='replay'` и т.п.), без mount-цели (её держит рендерер). Контроллер строит его один раз в конструкторе.

**Renderer-локальный контекст компонентов.** Pixi-компонентам нужны `ticker`, `canvas`, `screenW/H`, `pushLayer`, `fitModals` и пр. — это рендеро-внутреннее. Каждый рендерер строит свой контекст компонентов, расширяющий ядровый `ShellHost` своими помощниками (например, `PixiComponentContext extends ShellHost { ticker; canvas; screenW; screenH; … }`). Ядро остаётся минимальным и агностичным.

### 3.4 Поток (примеры)
- **Спин:** контрол рендерера → `host.actions.spin()` → контроллер `emit('spin')`.
- **Ставка:** `host.actions.stepBet(+1)` → контроллер `stepBet(state) → emit('betChange') → renderer.renderBar()`.
- **Открыть Settings:** `host.actions.openSettings()` → контроллер `emit('settingsOpen'); const h = renderer.openOverlay({kind:'settings'})` → запоминает `h.onKey` для роутинга клавиш.
- **Resize:** рендерер ловит свой размер (ResizeObserver / `app.renderer 'resize'`) → `host.notifyResize(w,h)` → контроллер вычисляет `wide|mobile` → `renderer.setLayout()` + `renderer.renderBar()`.
- **Деньги:** контроллер при изменении `balance/win` зовёт `renderer.animateMoney('balance', prev, next)`.

## 4. Раскладка пакета

```
packages/shell/
├── package.json              # @energy8platform/shell; exports: ".", "./html", "./pixi"; peer: pixi.js (опц.)
├── rollup.config.mjs         # 3 бандла: core(index), html, pixi (по образцу platform-core)
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── src/
│   ├── core/
│   │   ├── ShellController.ts     # мозг + публичный API + реализация ShellHost
│   │   ├── renderer.ts            # ShellRenderer, ShellHost, ShellActions, OverlayRequest, OverlayHandle
│   │   ├── state.ts               # createInitialState, stepBet, nextTurbo            (из идентичных)
│   │   ├── keyboard.ts            # KeyboardController, KeyboardHost                   (из идентичных)
│   │   ├── i18n.ts                # createI18n, socialize, normalizeLang              (из идентичных)
│   │   ├── locales.ts             # таблицы переводов                                 (из идентичных)
│   │   ├── format.ts              # formatCurrency                                    (из идентичных)
│   │   ├── theme.ts               # SCHEMES, DEFAULT_ACCENT, resolveTheme → ShellTokens (данные)
│   │   ├── motion.ts              # prefersReducedMotion + общие easings/тайминг
│   │   ├── colors.ts              # палитры                                           (из идентичных)
│   │   ├── fonts.ts               # семейство/метаданные шрифта Inter                 (из идентичных)
│   │   ├── version.ts             # PACKAGE_VERSION (авто-генерация, как в platform-core)
│   │   ├── EventEmitter.ts        # типизированный эмиттер
│   │   ├── types.ts               # ОБЩИЙ контракт: ShellState, ShellEvents, ShellMode,
│   │   │                          #   ShellFeatures, BonusOption, CurrencyConfig, ThemeConfig,
│   │   │                          #   GameInfoContent, AutoplayOptions, FreeSpinsState,
│   │   │                          #   ModalOptions, ReplayModalOptions, ResolvedShellConfig
│   │   └── index.ts               # createShell({ renderer, ...config }) + реэкспорт контракта и типов
│   ├── ui/
│   │   ├── html/
│   │   │   ├── HtmlRenderer.ts        # implements ShellRenderer (держит mount: HTMLElement)
│   │   │   ├── components/            # BottomBar, Settings, GameInfo, BuyBonus, pickers, Modal, ReplayModal
│   │   │   ├── primitives.ts          # DOM-примитивы
│   │   │   ├── icons.ts               # SVG-иконки
│   │   │   ├── shell.css.ts           # CSS (включая @font-face Inter)
│   │   │   ├── theme-css.ts           # buildThemeVars: ShellTokens → CSS custom properties
│   │   │   ├── motion-dom.ts          # countUp (rAF + textContent)
│   │   │   └── index.ts               # createGameShell(config), HtmlRenderer
│   │   └── pixi/
│   │       ├── PixiRenderer.ts        # implements ShellRenderer (держит app: Application)
│   │       ├── context.ts             # PixiComponentContext extends ShellHost (ticker/canvas/screen/layer-хелперы), ShellLayer
│   │       ├── components/            # BottomBar, Settings, GameInfo, BuyBonus, pickers, Modal, ReplayModal
│   │       ├── primitives/            # card, controls, flex, overlay, scroll, widgets
│   │       ├── text.ts                # установка шрифта (FontFace), setText
│   │       ├── pixi-icon.ts, icons.ts # иконки
│   │       ├── motion-pixi.ts         # tween, countUpText (Ticker)
│   │       └── index.ts               # createPixiShell(config), PixiRenderer
│   └── index.ts                       # реэкспорт core (для удобства)
└── tests/
    ├── html/   # перенос из platform-core/tests/shell/**
    └── pixi/   # перенос из pixi-shell/tests/**
```

### Маппинг существующих файлов → новое место

| Источник | Назначение | Действие |
|----------|-----------|----------|
| `platform-core/src/shell/{locales,keyboard,i18n,format,state,colors,fonts}.ts` | `src/core/*` | копия (идентичны в обоих) |
| `platform-core/src/EventEmitter.ts` | `src/core/EventEmitter.ts` | копия |
| `platform-core/src/shell/types.ts` + `pixi-shell/src/types.ts` | `src/core/types.ts` | слить общий контракт; mount-специфику убрать в конфиги рендереров |
| `platform-core/src/shell/theme.ts` (`SCHEMES`,`DEFAULT_ACCENT`) + pixi `resolveTheme` | `src/core/theme.ts` | палитра + `resolveTheme → ShellTokens` (данные) |
| pixi `buildThemeVars`-аналог (`platform-core` `theme.ts` эмит) | `src/ui/html/theme-css.ts` | только CSS-эмит |
| `prefersReducedMotion` (оба `motion.ts`) | `src/core/motion.ts` | общий + easings |
| `platform-core` `motion.ts` `countUp` | `src/ui/html/motion-dom.ts` | DOM count-up |
| `pixi-shell` `motion.ts` `tween`/`countUpText` | `src/ui/pixi/motion-pixi.ts` | Pixi count-up |
| `platform-core/src/shell/GameShell.ts` | `src/core/ShellController.ts` (логика) + `src/ui/html/HtmlRenderer.ts` (вид) | расщепить |
| `pixi-shell/src/PixiGameShell.ts` | `src/core/ShellController.ts` (логика, общая) + `src/ui/pixi/PixiRenderer.ts` (вид) | расщепить |
| `pixi-shell/src/context.ts` | `src/core/renderer.ts` (обобщ. `ShellHost`) + `src/ui/pixi/context.ts` (pixi-расширение, `ShellLayer`) | обобщить |
| `platform-core/src/shell/components/*`, `shell.css.ts` | `src/ui/html/**` | копия + перенацелить на `ShellHost` вместо `GameShell` |
| `pixi-shell/src/components/*`, `primitives/*`, `text.ts`, `pixi-icon.ts`, `icons.ts` | `src/ui/pixi/**` | копия + перенацелить на `PixiComponentContext` |
| `platform-core/tests/shell/**`, `tests/shell-*.test.ts` | `tests/html/**` | перенос, импорты на новый пакет |
| `pixi-shell/tests/**` | `tests/pixi/**` | перенос, импорты на новый пакет |

## 5. Публичный API и экспорты

`package.json` exports (по образцу `platform-core`):

```jsonc
{
  "name": "@energy8platform/shell",
  "exports": {
    ".":      { "import": "./dist/index.esm.js", "require": "./dist/index.cjs.js", "types": "./dist/index.d.ts" },
    "./html": { "import": "./dist/html.esm.js",  "require": "./dist/html.cjs.js",  "types": "./dist/html.d.ts" },
    "./pixi": { "import": "./dist/pixi.esm.js",  "require": "./dist/pixi.cjs.js",  "types": "./dist/pixi.d.ts" }
  },
  "peerDependencies": { "pixi.js": "^8.16.0" },     // нужен только для ./pixi
  "peerDependenciesMeta": { "pixi.js": { "optional": true } }
}
```

- `@energy8platform/shell` → `createShell`, контракт `ShellRenderer`/`ShellHost`/`ShellActions`/`OverlayRequest`/`OverlayHandle`, все типы (`ShellState`, `ShellEvents`, `ShellConfig`, `BonusOption`, …), `ShellTokens`.
- `@energy8platform/shell/html` → `createGameShell(config)`, `HtmlRenderer`. (`config.mount: HTMLElement`.)
- `@energy8platform/shell/pixi` → `createPixiShell(config)`, `PixiRenderer`. (`config.app: Application`.)

Фабрики-сахар:

```ts
// ui/html/index.ts
export function createGameShell(config: HtmlShellConfig): ShellController {
  return createShell({ renderer: new HtmlRenderer({ mount: config.mount }), ...config });
}
// ui/pixi/index.ts
export function createPixiShell(config: PixiShellConfig): ShellController {
  return createShell({ renderer: new PixiRenderer({ app: config.app, parent: config.parent }), ...config });
}
// custom:
import { createShell } from '@energy8platform/shell';
createShell({ renderer: myRenderer, /* общий конфиг */ });
```

> Совместимость: возвращаемый тип — `ShellController`. Псевдонимы `GameShell = ShellController` (html) и `PixiGameShell = ShellController` (pixi) экспортируются для drop-in совместимости имён.

## 6. Сборка

`rollup.config.mjs` (по образцу `platform-core`): три бандла через `createBundle(input, name)`:
```
createBundle('src/core/index.ts', 'index')
createBundle('src/ui/html/index.ts', 'html')
createBundle('src/ui/pixi/index.ts', 'pixi')   // external: ['pixi.js']
```
`pixi.js` — external только для pixi-бандла. Скрипты: `build`, `dev`, `lint`, `format`, `typecheck`, `test`, `test:watch` (как в `pixi-shell`). Версия `core/version.ts` авто-генерируется как в `platform-core` (скрипт `gen-version.mjs`, запускается в `prebuild`/`pretest`), чтобы `PACKAGE_VERSION` всегда совпадал с `package.json` (footer game-info).

## 7. Подключение примеров

- **`examples/shell-demo`**: `package.json` dep `@energy8platform/platform-core` → `@energy8platform/shell`. В [`src/main.ts`](../../../examples/shell-demo/src/main.ts) импорт `@energy8platform/platform-core/shell` → `@energy8platform/shell/html`. Имена `createGameShell`/`GameShell`/`ShellMode` сохраняются → правок логики демо не требуется.
- **`examples/pixi-shell-demo`**: dep `@energy8platform/pixi-shell` → `@energy8platform/shell` (+ `pixi.js` остаётся). Импорт `@energy8platform/pixi-shell` → `@energy8platform/shell/pixi`. `createPixiShell`/`PixiGameShell`/`ShellMode` сохраняются.

Поведение демо — 1:1 (тот же конфиг, события, оверлеи). Примеры берут билд из `dist` (см. memory: пересобрать пакет перед проверкой примера).

## 8. Перенос тестов

- `platform-core/tests/shell/**` + `tests/shell-*.test.ts` (`shell-mute`, `shell-keyboard-parity`, `shell-modal-keys`, `shell-i18n`, `shell-language`, `keyboard`, `shell-locales`) → `packages/shell/tests/html/**`.
- `pixi-shell/tests/**` (`flex`, `overlay-scroll`, `safeArea`, `hotkeys-section`, `buybonus-keys`, `keyboard`, `layout`, `picker-keys`, `pure`, `i18n` + `setup-canvas.ts`) → `packages/shell/tests/pixi/**`.
- Импорты перенацелить на новый пакет / `@/*` alias. Тесты — главный критерий, что расщепление controller/renderer не изменило поведение.
- Старые пакеты сохраняют свои тесты (не трогаем).

## 9. Риски и митигация

| Риск | Митигация |
|------|-----------|
| Расщепление `GameShell`/`PixiGameShell` на controller+renderer ломает тонкое поведение (fit-scale, фокус-pull, mobile-раскладка, отмена count-up, backdrop-blur) | Переносим тесты ПЕРВЫМИ и гоняем их на каждом шаге; поведенческие куски (`applyFitScale`, `makeBackdrop`, `fitModals`) целиком остаются в рендерере, не дробятся |
| Слияние `types.ts` (расхождение по узлам `HTMLElement` vs `Container`) | Узлы-расширения (`BonusOption.custom`, `GameInfoSection.custom.node`) параметризуются по рендереру в конфиге рендерера, а не в ядровом типе; ядро держит контракт без ссылок на узлы |
| Роутинг клавиш в оверлей (сейчас через `onKey`) | `OverlayHandle.onKey` сохраняет текущую семантику 1:1 |
| Дрейф локалей/клавиатуры от оригиналов | На старте — побайтовая копия идентичных файлов; diff против оригинала в плане |
| Шрифт Inter (base64) | `core/fonts.ts` — общие метаданные; установка раздельная: DOM `@font-face` в `shell.css.ts`, Pixi `FontFace` в `text.ts` |

## 10. Вне рамок / будущее

- Миграция `platform-core/src/shell` и `packages/pixi-shell` на реэкспорт из нового пакета (или их удаление) — отдельная задача после стабилизации.
- Миграция `game-engine` (`createSlotGame`, `host/*`) на `@energy8platform/shell/pixi`.
- Возможный `@energy8platform/shell/switch` с строковой фабрикой `createShell('html'|'pixi', …)` (тянет оба рендерера) — по желанию, в отдельном сабпасе.

## 11. План проверки (Definition of Done)

1. `npm install` линкует новый workspace-пакет.
2. `npm run build --workspace @energy8platform/shell` собирает 3 бандла (`index`, `html`, `pixi`) + `.d.ts`.
3. `npm run typecheck --workspace @energy8platform/shell` чисто.
4. `npm test --workspace @energy8platform/shell` — перенесённые html + pixi наборы зелёные.
5. `examples/shell-demo` и `examples/pixi-shell-demo` запускаются (`vite`), shell рисуется, спин/ставка/оверлеи/тема/язык работают 1:1 (визуальная проверка скриншотом для Pixi — см. memory про puppeteer Chromium).
6. Старые пакеты и `game-engine` не изменены; их тесты остаются зелёными.
