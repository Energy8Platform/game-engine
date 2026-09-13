# Оболочка по ModernUI VS Code 1.137.0 — дизайн

Дата: 2026-09-13. Ветка `feat/slot-webide-cordis`, от `0b74e2f`.
Родительская спека: `2026-09-11-vscode-shell-design.md` (§3 анатомия, §7
токены). Этот срез меняет только §7 и внешний вид §3; сервис `shell`, пять
слотов, Explorer и документы не трогаются.

## 1. Зачем

Срез 7 взял анатомию VS Code и «плоскую палитру без притязаний на версию».
Версия теперь названа: 1.137.0, `workbench.experimental.modernUI: true` —
это то, как VS Code выглядит сегодня по умолчанию в Insiders и на что
смотрит человек, открывающий нашу IDE рядом с ним. Разница не в цветах, а в
форме: ModernUI — это **карточки**. Sidebar, группа редакторов и панель
плавают на фоне окна с зазором 4px, скруглением 8px и линией в 1px; ничего
не касается краёв. Наша оболочка сейчас — четыре плоскости, разделённые
линиями, как классический VS Code. Это надо привести.

## 2. Источник истины — измерено, не описано

Всё ниже снято с тега `1.137.0` репозитория `microsoft/vscode`:

| Что | Откуда | Значение |
|---|---|---|
| Зазор между карточками | `layoutService.ts` `FLOATING_PANEL_MARGIN` | 4px (`spacing.size40`) |
| Зазор карточка–край окна | `getFloatingPanelOuterMargin` | 4px |
| Скругление карточки | `floatingPanels.css` `cornerRadius-large` | 8px |
| Скругление элемента (вкладка, кнопка activity, статус-элемент, заголовок вида) | `cornerRadius-small` | 4px |
| Линия карточки | `1px solid surface.border` | dark: fg 10% на surface = `#2A2A2A`; light: `#E5E5E5` |
| Фон окна (за карточками) | `--modern-ui-shell-background` → `titleBar.activeBackground` | dark `#181818`, light `#F8F8F8` |
| Фон sidebar / activity bar (карточка) | `surface.background` | dark `#181818` (= sideBar.background), light `#FFFFFF` (= editor.background) |
| Фон панели | `panel.background` | dark `#181818`, light `#F8F8F8` |
| Фон редактора | `editor.background` | dark `#1F1F1F`, light `#FFFFFF` |
| Activity bar | `floatingPanels.css` `.part.activitybar` | ширина 48 + 8 (`--modern-ui-activitybar-lane`) = **56px**; левая карточка, скруглена только слева (`8 0 0 8`); sidebar продолжает её без своего левого скругления и без левой линии (шов прозрачный) |
| Activity bar без sidebar | `.nosidebar .part.activitybar` | скругление 8px со всех сторон |
| Кнопка activity | `activityBar.css` | индикатор 32×32 (`action-height 36 − 4`), радиус 4px; активная — фон `modernActivityBarItem.activeBackground` (dark `#FFFFFF22`, light `#E4E6F1`), hover `#FFFFFF11` / `#F2F2F2`; **нет** левой акцентной полосы; цвет иконки: активная = `foreground`, неактивная = `activityBar.inactiveForeground` (`#868686` / `#616161`) |
| Вкладки | `tabs.css` | высота вкладки 24px + 4px прозрачной рамки сверху и снизу = ряд 32px; фон ряда прозрачный (= фон редактора); **нет** линии под рядом (`--modern-ui-editor-tabs-border: transparent`); вкладка: радиус 4px, отступы `0 8px 0 6px` (8px слева без иконки), заливка `inset 0 2px`; активная = `list.inactiveSelectionBackground` (`#37373D` / `#E4E6F1`), hover = `list.hoverBackground` (`#2A2D2E` / `#F0F0F0`), неактивная прозрачная; **нет** правой границы и **нет** акцентной линии снизу; ряд имеет `padding-left: 2px` |
| Граница редактора | `editorBorder.css` | 1px `editor.border` (→ `surface.border`), радиус 8px, `overflow: hidden` |
| Заголовок вида (Explorer, панель) | `padding.css`, `fontRamp.css` | строка 32px, `padding 0 4px`, метка `padding-left 8px`; шрифт `fontSize.label1` 12px, `fontWeight.semiBold` 600, `text-transform: capitalize` (uppercase — только по отдельной настройке, по умолчанию выключена) |
| Заголовок секции (pane header) | `paneHeaders.css`, `MODERN_UI_PANE_HEADER_SIZE` | 28px, радиус 4px, hover `list.hoverBackground` |
| Статус-бар | `floatingPanels.css` `.part.statusbar` | **не карточка**, лежит на фоне окна; 22px; `padding 2px 6px`; элементы радиус 4px, крайние элементы `padding 0 6px`; hover `statusBarItem.hoverBackground` (`#F1F1F133` / `#1F1F1F11`) |
| Разделитель-ручка | `sashHandles.css` | три точки 2px по центру, fg 30%; на hover/drag — исчезают |
| Тени | `shadows.css` | все `none` |
| Фокус | `keyboardFocusOnly.css` | кольцо только на `:focus-visible` |
| Шрифты | `baseSizes.ts` | body1 13px, label1 12px, label2 11px, label3 10px (бейдж); вес 400 / 600; workbench целиком на body1 |
| Скроллбар | `MODERN_UI_SCROLLBAR_SIZE` | 8px |
| Акцент | `focusBorder`, `button.background` | dark `#0078D4`, light `#005FB8` |
| Текст | `foreground`, `descriptionForeground` | dark `#CCCCCC` / `#9D9D9D`; light `#3B3B3B` / `#616161` |
| Плотность | `window.density.layout` | `default` (зазоры 4px). `compact` (зазоры 0, одна общая рамка) — есть, **не берём** |
| Title bar / command center | `titlebar.css` | у VS Code есть; у нас — нет и в этом срезе не появляется; верх ведёт себя как `top-window-edge`: 4px до края |

Что у нас сейчас и расходится (измерено по `styles.css` и `DESIGN.md`):

| Наше | ModernUI |
|---|---|
| Четыре уровня фона `--e8-bg-0..3` лестницей (`#1e1e1e … #333333`), activity bar самый светлый | Один фон окна, один фон карточки, один фон редактора; hover и selected — отдельные цвета, не ступени |
| Регионы стык в стык, линии между ними | Карточки с зазором 4px и скруглением 8px |
| `--e8-radius: 3px` на всём | 8px карточка, 4px элемент |
| Activity bar 48px, активная кнопка цветом акцента `#007acc` | 56px, активная кнопка серой заливкой, иконка цветом текста |
| Вкладка 32px с правой линией и акцентной чертой снизу, ряд на `--e8-bg-2` с линией под ним | Вкладка-«пилюля» 24px радиус 4px внутри ряда 32px, ряд прозрачный, без линий |
| Заголовки Explorer/панели 11px uppercase letter-spacing, 35px | 12px 600 capitalize, 32px |
| Статус-бар на `--e8-bg-2` с линией сверху | На фоне окна, без линии |
| Ручка-разделитель 5px, на hover заливается акцентом | Три точки, на hover исчезают |
| Акцент `#007acc` | `#0078D4` |

## 3. Принятые решения

| Вопрос | Решение | Почему |
|---|---|---|
| Плотность | `default` (зазоры 4px) | Это вид по умолчанию; compact — отдельный набор швов и градиентных уголков, YAGNI |
| Title bar | Нет | У нас нет команд-центра и меню; место для имени проекта появится в срезе управления проектами и будет решено там |
| Компоновка карточек | CSS-only, DOM `Shell.tsx` не меняется | Grid уже есть; зазоры — `padding` оболочки и `margin` регионов; activity + sidebar сшиваются радиусами и прозрачным швом, как у VS Code |
| Иконки activity bar | Как есть (SVG-контуры и буквы) | Codicons — отдельный шрифт и отдельный срез |
| Monaco | Тема `e8-dark`/`e8-light` на базе `vs-dark`/`vs` с `editor.background` = `--e8-editor-bg` | Иначе шов 1px между `#1e1e1e` Monaco и карточкой `#1F1F1F` |
| Скроллбар | `scrollbar-width: thin` на прокручиваемых регионах | 8px WebKit-стилизация — больше кода, чем пользы |
| Явный uppercase заголовков | Нет | Выключено по умолчанию в 1.137 |
| Что вне | Codicons, compact, split-view, command center, анимации | Не про вид карточек |

## 4. Токены

`DESIGN.md` §4 переписывается. Лестница `--e8-bg-0..3` уходит: в ModernUI
нет «ступеней хрома», есть **поверхности с именами** и два цвета состояния.
Имена меняются — старые имена с новым смыслом сбили бы каждого, кто читал
Срез 7.

```css
:root {
  /* поверхности */
  --e8-shell-bg: #181818;    /* фон окна, за карточками; статус-бар лежит на нём */
  --e8-surface: #181818;     /* карточка: activity bar, sidebar, panel */
  --e8-editor-bg: #1f1f1f;   /* карточка редактора и тело документа */
  --e8-border: #2a2a2a;      /* одна линия: рамка карточек, hairline в списках */
  /* состояния */
  --e8-hover: #2a2d2e;       /* list.hoverBackground: строка, вкладка, заголовок секции */
  --e8-selected: #37373d;    /* list.inactiveSelectionBackground: активная вкладка */
  --e8-activity-hover: #ffffff11;
  --e8-activity-active: #ffffff22;
  --e8-status-hover: #f1f1f133;
  /* текст и акцент */
  --e8-fg: #cccccc;
  --e8-fg-muted: #9d9d9d;
  --e8-fg-inactive: #868686; /* неактивная иконка activity bar */
  --e8-accent: #0078d4;
  --e8-on-accent: #ffffff;
  --e8-error: #f85149;
  --e8-warning: #cca700;
  --e8-info: #3794ff;
  --e8-success: #89d185;

  /* форма */
  --e8-gap: 4px;             /* зазор карточка–карточка и карточка–край */
  --e8-radius-lg: 8px;       /* карточка */
  --e8-radius-sm: 4px;       /* вкладка, кнопка, заголовок, статус-элемент */
  --e8-activity-w: 56px;
  --e8-sidebar-w: 260px;
  --e8-panel-h: 200px;
  --e8-status-h: 22px;
  --e8-title-h: 32px;        /* заголовок вида и ряд вкладок */
  --e8-tab-h: 24px;
  --e8-header-h: 28px;       /* заголовок секции внутри вида/панели */

  --e8-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --e8-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  --e8-size: 13px;           /* body1 */
  --e8-size-label: 12px;     /* label1: заголовки видов, статус-бар */
  --e8-size-small: 11px;     /* label2 */
  --e8-size-badge: 10px;     /* label3 */
}

[data-theme='light'] {
  --e8-shell-bg: #f8f8f8;
  --e8-surface: #ffffff;
  --e8-editor-bg: #ffffff;
  --e8-border: #e5e5e5;
  --e8-hover: #f0f0f0;
  --e8-selected: #e4e6f1;
  --e8-activity-hover: #f2f2f2;
  --e8-activity-active: #e4e6f1;
  --e8-status-hover: #1f1f1f11;
  --e8-fg: #3b3b3b;
  --e8-fg-muted: #616161;
  --e8-fg-inactive: #616161;
  --e8-accent: #005fb8;
  --e8-on-accent: #ffffff;
  --e8-error: #f85149;
  --e8-warning: #b58900;
  --e8-info: #1a85ff;
  --e8-success: #388a34;
}
```

Панель в светлой теме у VS Code — `panel.background #F8F8F8`, не белая; мы
**не** повторяем это: панель красится `--e8-surface`, как sidebar. Одна
поверхность на все карточки хрома — меньше токенов, и в тёмной теме это
одно и то же значение.

## 5. Компоновка карточек (CSS, `Shell.tsx` без изменений)

```
┌ shell-bg, padding 4px ─────────────────────────────────────┐
│ ┌AB┬─sidebar──┐ 4px ┌─editors (tabs + doc)───────────────┐ │
│ │  │          │     │                                    │ │
│ │  │          │     └────────────────────────────────────┘ │
│ │  │          │ 4px ┌─panel──────────────────────────────┐ │
│ └──┴──────────┘     └────────────────────────────────────┘ │
│ status bar (без рамки, на shell-bg)                        │
└────────────────────────────────────────────────────────────┘
```

- `.e8-shell`: `background: --e8-shell-bg`, `padding: --e8-gap --e8-gap 0`;
  колонки `--e8-activity-w --e8-sidebar-w minmax(0,1fr)`; ряды как были.
- `.e8-activity`: `border: 1px solid --e8-border`, `border-radius: 8 0 0 8`,
  `border-right: 0`. Кнопка 48×36 с индикатором 32×32 радиус 4px;
  `aria-pressed` → `--e8-activity-active` и `--e8-fg`; hover →
  `--e8-activity-hover`; неактивная иконка `--e8-fg-inactive`.
- `.e8-sidebar`: `border: 1px solid --e8-border`, `border-radius: 0 8 8 0`,
  `margin-right: --e8-gap`, `margin-bottom: --e8-gap`. Между activity и
  sidebar — одна линия (правая граница activity убрана, левая sidebar
  остаётся), как шов у VS Code.
- `.e8-sidebar-collapsed .e8-activity`: `border-radius: 8px`, правая
  граница возвращается, `margin-right: --e8-gap`.
- `.e8-editors`: `border: 1px solid --e8-border`, `border-radius: 8px`,
  `overflow: hidden`, `margin-bottom: --e8-gap`, `background: --e8-editor-bg`.
- `.e8-editors-tabs`: прозрачный, без `border-bottom`, высота `--e8-title-h`,
  `padding-left: 2px`, `align-items: center`.
- `.e8-doc-tab`: высота `--e8-tab-h`, `margin: 0 2px`, `padding: 0 8px`,
  `border: 0`, `border-radius: --e8-radius-sm`; `[aria-selected=true]` →
  `--e8-selected` + `--e8-fg`, без `border-bottom`; hover (не активная) →
  `--e8-hover`.
- `.e8-panel`: `border: 1px solid --e8-border`, `border-radius: 8px`,
  `background: --e8-surface`, `margin-bottom: --e8-gap`, без `border-top`.
- `.e8-status`: `background: --e8-shell-bg`, без `border-top`, `padding: 0 6px`,
  `font-size: --e8-size-label`; `.e8-status-item` `padding: 0 4px`,
  `border-radius: --e8-radius-sm`, hover `--e8-status-hover`.
- `.e8-explorer-header`, `.e8-panel-header`, `.e8-diagnostics-panel-header`,
  `.e8-panel-title`, `.e8-diagnostics-panel h2`: высота `--e8-title-h` (или
  `--e8-header-h` для секций), `font: 600 --e8-size-label`,
  `text-transform: none`, без `letter-spacing`, `padding-left: 12px`.
- `.e8-explorer-entry:hover`, `.e8-diagnostic-row:hover` → `--e8-hover`;
  строки списка с `margin: 0 4px` и радиусом 4px (ModernUI сдвигает
  `monaco-list-row` на 4px с обеих сторон).
- `.e8-resize`: без заливки; `::after` — три точки по центру
  (`box-shadow: 0 -5px, 0 5px` / `-5px 0, 5px 0`), цвет fg 30%
  (`color-mix(in srgb, var(--e8-fg) 30%, transparent)`); на hover/active —
  `opacity: 0`.
- `.e8-shell-confirm`, `.e8-row`, `.e8-preview*`, `.e8-assets-text`,
  `.e8-viewer-image`, `button`, `input`, `.e8-badge`: `--e8-radius` →
  `--e8-radius-sm`, `--e8-bg-1` → `--e8-surface`, `--e8-bg-2` → `--e8-hover`,
  `--e8-bg-0` → `--e8-editor-bg`; ничего с `--e8-bg-3` не остаётся.
- `box-shadow` в файле — только `none`.
- Monaco: `monacoSlice.ts` регистрирует темы `e8-dark` (`base: 'vs-dark'`)
  и `e8-light` (`base: 'vs'`) с `colors: { 'editor.background': <значение
  --e8-editor-bg> }`, прочитанным из `getComputedStyle(document.documentElement)`
  при создании; `EditorDocument` выбирает тему по `data-theme`, как сейчас
  выбирает `vs-dark`/`vs`.

## 6. `DESIGN.md`

Переписывается целиком под §2–§5: шапка называет версию (1.137.0, ModernUI,
плотность default) и перечисляет файлы-источники; §2 анатомия получает
рисунок с карточками; §3 принципы: «карточки, не плоскости», «две формы:
8 и 4», «hover и selected — не ступени фона», «тени — none», «заголовки
capitalize 12/600»; §4 токены как в §4 выше; §5 темы без изменений; §6 —
что заменено (лестница `--e8-bg-*`, `--e8-radius`).

## 7. Отказ — это данные

Дизайн-срез ничего не добавляет к списку диагностик и ничего из него не
убирает. Единственное новое поведение с отказом: если `getComputedStyle`
не дал `--e8-editor-bg` (тест без стилей), Monaco-тема регистрируется без
`colors` — редактор на своём `#1e1e1e`, шов есть, падения нет.

## 8. Проверка

- **Guard в `tests/styles.test.ts`** расширяется тремя утверждениями:
  1. ни одного `--e8-bg-` и `--e8-radius:` (старые имена) во всём файле;
  2. каждый `box-shadow` — `none`;
  3. каждый `border-radius` — `var(--e8-radius-sm)`, `var(--e8-radius-lg)`,
     `0` или их комбинация в короткой записи (`8px 0 0 8px` пишется через
     `var()`); литеральный `px` в `border-radius` — красный.
  Каждое с мутацией: вписать `--e8-bg-1`, `box-shadow: 0 1px 2px`,
  `border-radius: 3px` — тест обязан упасть.
- **Playwright `modern-ui.spec.ts`**, живой хост, настоящий браузер,
  `getComputedStyle` и `boundingBox`:
  1. `sidebar` и `doc-tabs`' родитель `.e8-editors` разнесены ровно на 4px
     по x; `.e8-editors` и `panel` — на 4px по y; `.e8-editors` имеет
     `border-top-left-radius: 8px`; `activity-bar` — `8px 0 0 8px`
     (левые углы 8, правые 0);
  2. после клика по активной кнопке activity (sidebar свёрнут)
     `activity-bar` имеет все четыре угла 8px и правую границу 1px;
  3. активная `doc-*` вкладка: `border-bottom-width: 0px`, `border-radius:
     4px`, фон = `--e8-selected` (значение снято с `:root` в том же тесте);
     `doc-tabs`: `border-bottom-width: 0px`;
  4. `activity-bar` ширина 56px; активная кнопка activity: фон ≠
     `transparent`, цвет ≠ `--e8-accent`;
  5. `status-bar`: `border-top-width: 0px`, фон = `--e8-shell-bg`;
  6. переключение темы через `status-theme`: `--e8-shell-bg` на `:root`
     меняется с `#181818` на `#f8f8f8`, а фон `.e8-editors` — на `#ffffff`;
  7. ни один элемент оболочки (`shell`, `sidebar`, `.e8-editors`, `panel`,
     `status-bar`, активная вкладка) не имеет `box-shadow` ≠ `none`;
  8. Monaco внутри `.e8-editors` имеет `.monaco-editor` с фоном =
     `--e8-editor-bg` (в обеих темах).
  Каждое — с мутацией в `styles.css` (или `monacoSlice.ts` для 8), которая
  его роняет, и с подтверждённым до/после счётчиком на оригинале.
- **Все существующие Playwright-тесты (63) проходят** без изменения
  testid; юнит-тесты `Shell`, Explorer, документов — без изменений, кроме
  снапшотов классов, если такие есть (сейчас — нет).
- **Приёмка**: два скриншота (тёмная, светлая) на `#/doc/composition` с
  открытым `.spin` и панелью — показываются пользователю рядом со снимком
  VS Code 1.137 ModernUI; это единственная проверка, которую делает глаз,
  и она не заменяет пункты выше.

## 9. Риски

| Риск | Вес | Что делаем |
|---|---|---|
| Переименование токенов пропустит место, где старое имя читается из JS | средний | `grep -r 'e8-bg-\|e8-radius\b'` по `engine/` в guard-тесте — не только по `styles.css`; `Shell.tsx` читает только `--e8-sidebar-w`/`--e8-panel-h` |
| `overflow: hidden` на `.e8-editors` обрежет всплывающее у Monaco (подсказки) | средний | Monaco рисует overlay внутри своего контейнера при `fixedOverflowWidgets: false` (по умолчанию); проверяется приёмкой — открыть автодополнение у нижней строки |
| Зазоры 4px сломают `useResize` (клампы по ширине) | низкий | `useResize` читает `--e8-sidebar-w`, не геометрию соседей; тест 1 в §8 ловит расхождение |
| «Как в VS Code» превратится в переделку иконок и шрифтов | средний | §3: Codicons вне; иконки как есть |
