# Game Shell — единый брендовый UI-хром для игр

**Дата:** 2026-06-15
**Статус:** design (одобрен к написанию плана)

## Проблема

Каждая игра (например `kitsune-wrath`) переизобретает ~5000 строк UI-обвязки:
`TopBar`, `BottomControls`, `BetControls`, `SpinButton`, `SettingsModal`,
`Paytable`, `AutoplayPanel`, `BuyBonusPanel` и т.д. Это отвлекает от разработки
собственно геймплея и приводит к расхождению внешнего вида между играми.

Цель — **единый платформенный брендовый шелл** (control panel / menu, game info,
settings, bet/balance/win HUD), которым владеет платформа. Игра отдаёт данные и
минимальную тему, а сама занимается только геймплеем (барабаны, win-анимации,
исполнение спинов).

## Ключевые решения

| Решение | Выбор | Почему |
|---|---|---|
| Степень единообразия | **Единый брендовый шелл** во владении платформы; игра только кормит данные + узкая тема | Бренд-консистентность между играми |
| Слой рендеринга | **DOM/HTML оверлей над канвасом** | Renderer-agnostic; единый вид гарантирован; работает с любым рендерером |
| Тех-стек | **Vanilla DOM / Web Components, ноль зависимостей** | Один-в-один философия `createCSSPreloader` |
| Размещение | **`@energy8platform/platform-core/shell`** (сабпас) | «Старший брат» CSS-прелоадера; нулевой оверхед; уже принятая архитектура |
| Источник состояния | **Игра — единственный источник правды** (конфиг + императивные сеттеры) | Детерминизм для replay и restore mid-spin; шелл не знает про SDK/session |

## Размещение

```
packages/platform-core/src/shell/
├── index.ts            ← createGameShell(), removeGameShell(), типы
├── GameShell.ts        ← корневой контроллер (state-machine, как DevBridge/preloader)
├── state.ts            ← ShellState + reducer
├── format.ts           ← форматтер валюты
├── components/         ← vanilla-DOM «вью» (одна папка = одна поверхность)
│   ├── BottomBar.ts    ← 3 режима: base | freeSpins | replay
│   ├── Menu.ts
│   ├── Settings.ts
│   ├── GameInfo.ts     ← структура от платформы, слоты под контент игры
│   ├── BuyBonus.ts     ← оверлей выбора бонусов
│   └── primitives/     ← Button, Modal, Slider, Toggle (DOM-аналоги Pixi-UI)
├── theme.ts            ← brand-токены (CSS custom properties) + точки кастомизации
└── shell.css           ← стили, инжектятся как <style> (как в createCSSPreloader)
```

- game-engine ре-экспортит как `@energy8platform/game-engine/shell`
  (как уже сделано для `/lua`, `/debug`, `/loading`).
- `GameApplication` опционально поднимает шелл в boot-секвенции после
  `createPlatformSession` (флаг в `GameApplicationConfig`); модуль от Pixi не зависит.

## Контракт (data flow)

Игра — единственный источник правды. Шелл **ничего сам не подписывает** из
session/SDK. Это критично для:
- **Replay** — значения приходят из записанной книги, а не из живой сессии.
- **Restore mid-spin** — при реконнекте игра поднимает шелл с актуальным
  состоянием и сразу `setBusy(true)`, без мигания доступными кнопками.

### Инициализация

```ts
const shell = createGameShell({
  mount,                       // контейнер оверлея
  theme,                       // { accent?, buyBonusColor? } — узкий whitelist
  gameInfo,                    // контент paytable/rules/RTP/features от игры
  language,                    // код локали (напр. 'en', 'ru') — задел под локализацию

  // валюта/формат — числа отдаёт игра, форматирует шелл
  currency: {
    symbol: string;            // '€', '$', 'kr'
    position: 'left' | 'right';// €500 ←→ 500 kr
    decimals?: number;         // по умолч. 2
    separator?: { thousands?: string; decimal?: string }; // дефолт '.'/','
  },

  // экономическое состояние — единый источник правды = игра
  availableBets: number[],
  defaultBet: number,
  currentBet: number | null,   // null = взять defaultBet; задан для восстановления mid-session
  balance: number,
  win: number,

  mode: 'base' | 'freeSpins' | 'replay',

  // объявление возможностей: рендерится только объявленное
  features: {
    turbo: 0 | 1 | 2 | 3,      // кол-во уровней; 0 = кнопки нет
    autoplay: boolean,
    buyBonus: BonusOption[] | false,
  },
});

type BonusOption = {
  id: string;
  name: string;
  description: string;
  priceMultiplier: number;     // цена = priceMultiplier × currentBet
  volatility?: 1 | 2 | 3 | 4 | 5;  // 5 уровней
  accentColor?: string;        // акцент карточки бонуса
};
```

### Игра → шелл (императивные сеттеры)

```ts
shell.setBalance(n)
shell.setWin(n)
shell.setBet(n)                          // после восстановления/смены
shell.setMode('base' | 'freeSpins' | 'replay')
shell.setBusy(true)                      // активный спин: дизейбл spin/bet/buyBonus
shell.setAutoplay({ active, remaining })
shell.setTurbo(level)                    // 0..features.turbo, для восстановления
shell.setBuyBonusEnabled(bool)           // дизейбл во время спина / нехватки баланса
shell.setFreeSpins({ current, total, totalWin, lastWin })
```

### Шелл → игра (события)

```ts
shell.on('spin', () => …)
shell.on('betChange', (bet) => …)
shell.on('autoplayStart', (opts) => …)
shell.on('autoplayStop', () => …)
shell.on('turboChange', (level) => …)    // 0..features.turbo
shell.on('buyBonusSelect', ({ id }) => …)// игра исполняет покупку через свою логику/SDK
shell.on('menuOpen' | 'settingsOpen' | 'infoOpen', …)
shell.on('settingChange', ({ key, value }) => …) // громкость, quick spin…
```

## Поверхности

### Слои оверлея (без top-bar — всё управление снизу)

```
overlay (fixed, над <canvas>, pointer-events: none)
├── bottom-bar    → все контролы, 3 режима
└── modal-layer   → Menu / Settings / GameInfo / BuyBonus (по одному за раз)
```

Сами контролы — `pointer-events: auto`; «дырки» над геймплеем кликабельны для игры.
Точный визуал/раскладку прорабатываем на этапе дизайна (mockups) — **не копируем с
kitsune**. Здесь фиксируется состав и поведение.

### Режимы `bottom-bar`

**`base`** — обычная игра:
- balance, win
- bet: `−` / value / `+` (ходят по `availableBets`, дизейбл на границах)
- **SPIN** (главная кнопка)
- autoplay, turbo, buyBonus, menu — каждый только если объявлен в `features`
- `setBusy(true)` → spin/bet/buyBonus disabled; **menu остаётся доступно**
  (можно открыть настройки/инфо во время спина)
- `turbo`: `0` нет кнопки; `1` toggle off/on; `2`–`3` циклическая кнопка уровней

**`freeSpins`** — авто-режим фриспинов:
- balance, bet (read-only), turbo (если есть)
- счётчик + аккумуляторы через `setFreeSpins({ current, total, totalWin, lastWin })`
- нет ручного spin / bet / buyBonus / autoplay

**`replay`** — только способ отображения HUD (read-only, без управления):
- bet (read-only), win, freeSpins-блок если нужен, turbo (если доступен)
- никаких spin / bet-кнопок / buy / autoplay / navigation — чистая read-only
  индикация из книги

### Modal-поверхности (открываются из bottom-bar)

- **Menu** — Settings, Game Info, звук, Fullscreen.
- **Settings** — master/music/sfx слайдеры, quick-spin toggle, (опц.) battery saver
  → эмитит `settingChange`.
- **Game Info** — платформенная структура (Rules / Paytable / RTP / Features) +
  слоты под `gameInfo` от игры (символы, выплаты, описания фич, число RTP).
- **Buy Bonus** — оверлей с карточками из `features.buyBonus`: `name` /
  `description` / `volatility` (1–5) / `accentColor` / живая цена
  `€(priceMultiplier × currentBet)` (пересчитывается на `setBet`).
  Выбор → `buyBonusSelect`; списание/спин — на игре.

## Тема и lifecycle

**Тема (`theme.ts` + CSS custom properties):**
- Брендовые токены инжектятся как `--shell-*` CSS-переменные (цвета, радиусы, шрифт),
  переиспользуем `buildLogoSVG` и палитру из `loading/`.
- Точки кастомизации игрой — узкий whitelist: `theme: { accent?, buyBonusColor? }`.
  Всё остальное — платформенный бренд, игра не трогает.

**Lifecycle (копия паттерна `createCSSPreloader`):**
- `createGameShell(cfg)` — синхронный mount, возвращает handle.
- `removeGameShell()` / `shell.destroy()` — возвращает `Promise`, идемпотентен,
  отменяет pending-анимации и снимает listeners.
- Резайв/ориентация: внутренний `ResizeObserver`; шелл сам перекладывает контролы
  portrait/landscape.

## Тестирование (vitest + jsdom)

platform-core сейчас тестируется в node — для DOM-шелла добавим jsdom-окружение на
`tests/shell/*` (per-file `// @vitest-environment jsdom`).

Покрываем:
- reducer состояния (`state.ts`);
- форматтер валюты (символ слева/справа, decimals, separators);
- **capability-gating**: `features.turbo=0` / `autoplay:false` / `buyBonus:false`
  → соответствующих контролов нет в DOM;
- переключение режимов `base / freeSpins / replay`;
- эмиссию событий (spin, betChange, turboChange, buyBonusSelect, settingChange);
- идемпотентность `destroy()`;
- renderer-agnostic smoke-тест: отсутствие любого pixi-импорта (как у
  `PlatformSession.test.ts`).

## Вне скоупа v1

- `shell.setCurrency()` на лету (валюта — конфиг на инициализации; добавим при нужде).
- Интерактивная навигация по replay-книге (play/pause/step) — replay только read-only.
- Игро-специфичная панель покупки бонуса (шелл владеет только выбором из `BonusOption[]`).
- Сама панель/логика исполнения покупки и спинов — остаётся на игре.
```
