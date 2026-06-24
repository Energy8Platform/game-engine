# Анализ 6 слотов → улучшения game-engine → бутстраппер

Дата: 2026-06-21. Разобраны репозитории: `kitsune-wrath`, `hot-ross` (Ember Rush),
`moon-spice-shop`, `magnum-opus`, `magnus-alchemy-slot`, `Stone-Rush`.
Цель: найти общее и переиспользуемое, предложить улучшения `@energy8platform/game-engine` +
`@energy8platform/platform-core`, и спроектировать каркас/бутстраппер так, чтобы новая игра
занималась только **графикой, математикой и механикой**, а не обвязкой.

---

## TL;DR (если читать только это)

1. **Все 6 игр — это одна и та же обвязка вокруг разной математики и арта.** ~65–88% кода каждой
   игры (по разным оценкам агентов) — это идентичная или почти идентичная сантехника: bootstrap,
   Stake-мост, dev/sim-конфиги, math-пайплайн, shell-интеграция, resume/replay, нормализация
   Lua-ответа, asset-манифест, аудио-шина, responsive-лейаут.

2. **Дымящийся пистолет:** `hot-ross` и `Stone-Rush` имеют одинаковые имена бонус-режимов
   (`buy_spark_hunt`, `buy_flare_rush`, `buy_inferno_drop`, `buy_ember_rise`, `buy_blaze_trail`,
   `buy_inferno_rush`) — при том что Stone-Rush про камни/лаву, а не про искры. Игры **форкаются
   копипастом** и тащат чужие идентификаторы. Версии пакетов разъехались
   (`platform-core` 0.20.0 → 0.24.4, `game-engine` 0.17.0). Раскладка папок у всех разная
   (`game/` vs `server/` vs `src/game/`; `config.json` vs `gameDefinition.json` vs `gameDefinition.ts`).

3. **Главная боль во ВСЕХ шести отчётах — нарушение single-source-of-truth.** Символы, paytable,
   стоимости бай-бонусов, mode-map дублируются в 3–5 местах (Lua, GameDefinition, TS-константы,
   shell gameInfo, math `modes.ts`, stake `modeMap`, stake `adapter`). Любая правка математики
   молча рассинхронизирует UI и Stake.

4. **Стратегический вывод:** скаффолдер, который копирует 2000 строк обвязки, проблему НЕ решает —
   эта обвязка гниёт ровно так, как сейчас (Stone-Rush несёт имена от Ember Rush). Правильно —
   **затащить обвязку внутрь пакетов** (versioned, обновляемо через `npm update`), а скаффолдить
   только тонкую игро-специфичную оболочку + **один spec-файл**, из которого кодогенерится всё
   остальное. Бутстраппер = «толстые пакеты + тонкий шаблон + кодоген из spec».

---

## 1. Что общего: анатомия слота на платформе Energy8

Каждая игра, независимо от механики, состоит из одних и тех же слоёв:

| Слой | Где лежит (варьируется) | Что делает |
|------|------------------------|-----------|
| **Math (Lua)** | `game/script.lua`, `server/script.lua`, `src/game/script.lua` | Серверная логика спина: сетка, выигрыши, каскады, фичи, сессия |
| **GameDefinition** | `game/config.json`, `src/config/gameDefinition.json`, `src/game/gameDefinition.ts` | Actions (spin/free_spin/buy_*), переходы, bet-levels, max_win, session-vars |
| **Dev/Sim config** | `dev.config.ts` + `sim.config.ts` | DevBridge (браузер, `?raw` Lua) и CLI-симулятор (Node, `readFileSync`) — **почти дубль** |
| **Bootstrap** | `src/main.ts` (200–587 строк) | Pixi/GameApplication init, Stake-детект, манифест, session, shell, resume, resize |
| **Stake-мост** | `src/stake/{adapter,book-schema,runtime,replay}.ts` | Dual-build под Stake RGS: книги→сегменты, social-словарь, replay |
| **Math-пайплайн** | `src/math/*` или `scripts/*` | Go-симулятор → pool → curate/optimize → lookup-таблицы + index.json |
| **Shell-интеграция** | `src/shell/*` или `src/ui/*` | `createGameShell()` из platform-core + gameInfo + bonusOptions + currency |
| **Error-классификатор** | `src/runtime/playErrors.ts` | SDK-ошибка → понятное юзеру модальное окно |
| **Scene/Components** | `src/scenes/*`, `src/components/*`, `src/view/*` | Игро-специфичный рендер (это и есть «настоящая игра») |
| **Audio** | `src/audio.ts` / `src/util/audio.ts` / `src/game/audio.ts` | Обёртка над `@pixi/sound`: BGM-кроссфейд, SFX, mute |
| **Build-конфиги** | `vite.config.ts`, `tsconfig.json`, `index.html`, `package.json` | Почти идентичны; dual-output dist/dist-stake по `BUILD_TARGET` |

**Механики (5 из 6 — каскадные!):**
- `kitsune-wrath` — 7×7 cluster pays, каскады, kitsunebi-множители, 9 хвостов, hold&spin
- `moon-spice-shop` — 5×4 1024 ways, каскады, sticky-множитель «рецепт»
- `magnum-opus` — 6×6 «созвездия» (геом. фигуры), каскады, трансмутация, 4 стадии
- `magnus-alchemy-slot` — 5×4 anywhere-pays, каскады/tumble, орб-множители
- `Stone-Rush` — 7×7 cluster pays, каскады, лава-орбы, recipe-множитель
- `hot-ross` (Ember Rush) — 5×5, 19 линий, расширяющиеся wild + множители (единственный line-game,
  и единственный на **ванильном canvas**, не Pixi)

То есть **каскад + множитель-сборщик + free-spins с переносом множителя + бай-бонусы** — это
де-факто стандартный шаблон механики. Его стоит поддержать примитивами движка напрямую.

---

## 2. Что реально переиспользуется (кандидаты на вынос в пакеты)

Отсортировано по уверенности «это одинаково у всех» (→ тем выше приоритет вынести из шаблона в пакет):

### Уровень A — идентично или параметризуемо тривиально
- **`vite.config.ts`** — defineGameConfig + devBridge/lua плагины + dual dist/dist-stake. Отличие: 1–2 строки.
- **`tsconfig.json`** — почти байт-в-байт.
- **`index.html`** — отличие: `<title>` и шрифты.
- **`src/runtime/playErrors.ts`** — SDK error-коды стабильны, классификатор переносим.
- **`src/ui/format.ts` / currency** — формат денег полностью переносим.
- **`src/stake/runtime.ts` (social-словарь)** — gambling↔sweepstakes своп одинаковый у всех.
- **Stake-детект + `bootstrapStakeBridge()`** — валидация RGS-хоста, lazy-import моста, `bridge.ready()`.
- **package.json scripts** — `dev/build/build:stake/preview/typecheck/postbuild(zip)` одинаковы;
  отличаются только `math:*` и `simulate:*` (а они выводимы из списка режимов).

### Уровень B — единый паттерн, разная начинка (вынести как helper + конфиг)
- **Bootstrap-последовательность** (`main.ts`): preloader → шрифты → session → assets → prefs →
  shell → resize → resume. Меняются только манифест, дерево сцены и конфиг shell.
- **Asset-манифест + preloader** — паттерн `Assets.add/load + progress` одинаков; меняются алиасы/пути
  (и это надо генерировать из конвенции, а не писать руками — у всех 50–71 алиас вручную).
- **Audio-шина** — load/play/stop/BGM-кроссфейд/mute идентичны; меняется список треков.
- **Shell-контроллер** (`GameShellController`/`ShellBridge`/`createShell`) — конструктор, sync-петля,
  роутинг событий (`onSpin/onBetChange/onBuyBonus/onAutoplay/...`) одинаковы; меняются handlers и карточки.
- **Stake `adapter.ts` / `book-schema.ts`** — `BookAdapter.splitRound` + коэрсия пустых Lua-таблиц
  одинаковы на ~80–90%; меняются имена режимов и список полей-массивов.
- **Math-пайплайн** (`generate-pool` → `optimize/curate` → `go-sim`) — оркестрация, потоковая запись
  jsonl, коэрсия `{}`→`[]`, lookup-CSV одинаковы; меняется таблица режимов.
- **Resume/replay** — `getState()`-восстановление, drain «висящей» сессии, replay-петля shell.
- **Responsive-лейаут** — MIN_W/MIN_H пол, bar-inset reserve, портрет/ландшафт брейкпоинты —
  паттерн один, числа захардкожены у каждого.
- **Каскадная оркестрация** — петля «highlight → remove → tumble → refill → collect множители →
  показать выигрыш», free-spins-петля до `session.completed`/`max_win_reached`, BigWin-тиры.
  Реализована заново в 5 играх.

### Уровень C — игро-специфично (остаётся в игре)
- `game/script.lua` (математика), `game/config.json` (правила), символы/палитра/тайминги,
  сами Pixi-компоненты (ReelGrid, символы, VFX, оверлеи фич), арт и аудио-ассеты.

---

## 3. Сквозные боли (то, что бутстраппер/движок обязаны убить)

Эти пункты повторяются почти в каждом из 6 отчётов:

1. **Single-source-of-truth нарушен повсеместно.** Символы и paytable живут в 3–5 копиях:
   `script.lua` ⇄ `config.json/gameDefinition` ⇄ TS-константы ⇄ shell `gameInfo` (paytable для UI)
   ⇄ math `modes.ts`. Стоимости бай-бонусов — в `config.json` И в `bonusOptions/gameConfig` И в
   `math/modes.ts` И в `main.ts` `modeMap`. Никакой проверки согласованности → «math/spec mismatch»
   и неверные цены на карточках.

2. **Mode-map дублируется ×3–4** (`main.ts modeMap`, `math/modes.ts`, `config.json actions`,
   `stake/adapter`). Это прямая причина копипаст-ошибок при форке (см. Stone-Rush ← Ember Rush).

3. **`dev.config.ts` vs `sim.config.ts`** — один и тот же Lua+GameDefinition грузится дважды
   (браузерный `?raw` vs нодовый `readFileSync`). Должно быть одно описание игры.

4. **Коэрсия пустых Lua-таблиц `{}`→`[]`** написана в каждой игре вручную (списки `ARRAY_FIELDS`,
   `normalizeSpinResult`, defensive `asArray`). Это обязано жить в platform-core на границе SDK.

5. **Asset-манифест руками** — 50–71 алиас инлайном; добавить спрайт = править 2–3 массива.
   Нужна конвенция + glob-генерация + типизированные алиасы.

6. **Resume/replay переизобретается** — `resumeInterruptedBaseRound`, `drainDanglingSession`
   (магический guard на 300 итераций), ручной декремент `fsSpinsRemaining` из-за off-by-one моста,
   двойная проверка `max_win_reached` И `session.completed`. Это всё — обязанность SDK/моста, не игры.

7. **Stake monkey-patch DevBridge** (`hot-ross/dev.config.ts`) — патчат приватные поля DevBridge,
   чтобы засеять `_activeRoundId`. Хрупко, ломается от любого рефактора.

8. **GameScene-монолиты** — Stone-Rush 2541 стр., magnus-alchemy 3043 стр., kitsune GameRoot ~1500 стр.
   Вся механика, HUD, оверлеи, анимации, free-spins — в одном классе. Нет общих примитивов
   (HUD-builder, control-bar factory, CascadeAnimator, FreeSpinsController).

9. **Магические числа лейаута** (размеры ячеек, отступы, брейкпоинты) разбросаны по `layout()`.
   VFX-границы рамки замеряются руками из арта (`FRAME_INNER/CONTENT/MULT`).

10. **Разнобой архитектуры bootstrap'а** — `new GameApplication(...)` (kitsune, magnus-alchemy,
    stone-rush, magnum-opus) vs `createPlatformSession` + собственный Pixi `Application`
    (moon-spice, hot-ross). Нет одного благословлённого пути.

---

## 4. Предложения по улучшению game-engine / platform-core

Идея: **каждая боль из §3 → конкретная фича пакета.** Тогда шаблон становится тонким, а апдейты
прилетают через `npm update`, а не копипастом.

### 4.1. `defineGame()` — единый источник правды (наивысший приоритет)

Один файл `game.spec.ts` (TS, типизированный) описывает игру декларативно:

```ts
export default defineGame({
  id: 'kitsune-wrath',
  grid: { cols: 7, rows: 7 },
  betLevels: [0.1, 0.2, /* ... */ 200],
  maxWin: 20000,
  symbols: [
    { id: 'H1', name: 'Kitsune', kind: 'high', pay: { 5: 1.0, 8: 4, 12: 18 } },
    { id: 'WILD', kind: 'wild' }, { id: 'SCATTER', kind: 'scatter' },
    // ...
  ],
  actions: {
    spin:        { stage: 'base', cost: 1 },
    buy_foxfire: { stage: 'buy', cost: 100, feature: { spins: 10 } },
    // ...
  },
});
```

Из него **кодогенерятся** (build-step или Vite-плагин):
- `gameDefinition` для DevBridge/SDK (actions, transitions, bet_levels, max_win);
- Lua-prelude с константами (символы, paytable, веса) — как уже делает `profilesPrelude.ts` в Stone-Rush,
  только обобщённо;
- TS-константы (`SYMBOL_IDS`, `SYMBOL_ALIASES`, грид) — типобезопасно;
- `gameInfo` paytable для shell (UI больше не хардкодит цифры);
- Stake `modeMap` + `math modes` (action→mode→cost) — из одного места;
- типы `SpinResult`/`CascadeStep` (опционально, из схемы Lua-ответа).

Это закрывает боли №1, №2, №3. **Самый высокий ROI из всего списка.**

### 4.2. `createSlotGame()` — толстый хост вместо 200–580 строк main.ts

Хелпер в game-engine, поглощающий всю bootstrap-последовательность:

```ts
createSlotGame({
  spec,                       // из defineGame()
  manifest,                   // или авто-glob (см. 4.5)
  scene: () => new GameScene(),
  theme: { accent: '#c79a3b' },
  // всё остальное (Stake-детект, session, shell, resume, resize, аудио-шина,
  // preloader, error-модалки) — внутри хоста
});
```

`main.ts` ужимается до ~20–30 строк. Благословляет **один** путь (внутри — `GameApplication`),
убирает разнобой из §3.10.

### 4.3. platform-core: нормализация Lua-ответа на границе SDK

`normalizeLuaResult(raw, schema?)` — коэрсия `{}`→`[]`, snake↔camel, числовые symbol-id→строки.
Schema-driven декодер, чтобы игры перестали писать `ARRAY_FIELDS`/`normalizeSpinResult`. Боль №4.

### 4.4. `@energy8platform/stake-kit` — Stake-интеграция как конфиг, а не код

Generic `adapter`/`book-schema`/`runtime`/`replay`, управляемые `modeMap` из spec.
`src/stake/` исчезает из игры (остаётся опц. override). Закрывает боли №2, №7 и
дубли book-schema. Resume/replay-стандарт (боль №6) — туда же: generic resume-модалка +
реконструкция сессии в platform-core/stake-kit.

### 4.5. Vite-плагин `assetsFromConvention()`

Глобит `public/assets/{symbols,bg,audio,vfx}/...`, генерит манифест + типизированные алиасы
(`Asset.H1`, `Asset.bgmBase`). Убирает ручные 50–71 алиас и рассинхрон алиас↔файл. Боль №5.

### 4.6. Единый math-CLI в `@energy8platform/stake-math-tools`

`e8-math pool|curate|sanity --mode=...` читает режимы из spec. Сейчас `generate-pool.ts`/`optimize.ts`/
`go-sim.ts` переписаны в каждой игре. Стандартизировать имена (pool/curate, не «curate vs optimize»),
вынести Go-вызов и потоковую запись. Боль math-дублей.

### 4.7. Примитивы каскадных игр в game-engine/ui

5 из 6 игр — каскадные. Дать переиспользуемые классы:
- `ReelGrid` / `SymbolCell` базовые (tumble/refill хореография);
- `CascadeController` — петля highlight→remove→drop→refill→collect, с тайминг-конфигом;
- `FreeSpinsSession` — петля `free_spin` до завершения, корректный счётчик/ретриггеры/max-win
  (закрывает off-by-one и двойную проверку из боли №6);
- `BigWinOverlay` с конфигурируемыми тирами (Nice/Big/Mega/...);
- `MultiplierMeter` — sticky-множитель-сборщик (kitsunebi/recipe/lapis/orbs — это одна абстракция).

Разбивает GameScene-монолиты (боль №8).

### 4.8. Slot-layout-менеджер

Декларативный лейаут: область рила + резерв под shell-бар + якоря HUD + портрет/ландшафт.
Убирает магические числа и захардкоженные брейкпоинты (боль №9).

### 4.9. Гигиена версий

Зафиксировать матрицу совместимых версий (`game-engine` ↔ `platform-core` ↔ `game-sdk` ↔
`stake-bridge`), публиковать как один «meta»-пакет/peer-range. Сейчас разъезд 0.20→0.24.4.

---

## 5. Дизайн бутстраппера

### 5.1. Принцип

**Толстые пакеты + тонкий шаблон + кодоген из spec.** Скаффолдер генерит НЕ обвязку, а:
1. `game.spec.ts` (заполненный ответами на вопросы);
2. тонкий `main.ts` (вызов `createSlotGame`);
3. скелет `GameScene` + один пустой `script.lua` с сигнатурами;
4. конвенциональные папки ассетов с README-нейминг-гайдом;
5. `package.json` со скриптами, выведенными из режимов spec.

Всё остальное (Stake, math-CLI, resume, shell, нормализация) приходит из пакетов.

### 5.2. CLI

```
npm create @energy8platform/slot@latest my-game
# или: npx e8-create-slot
```

Интерактивные вопросы (или `--from spec.json` неинтерактивно):
- имя/id игры, тема (палитра → `theme.ts`);
- тип механики: `cluster` | `ways` | `lines` | `anywhere` (+ каскады да/нет);
- грид (cols×rows), bet-ladder, max-win, целевой RTP;
- символы (high/low/wild/scatter/множитель), черновой paytable;
- бонус-режимы и стоимости (генерят actions + modeMap + math-modes разом);
- Stake-таргет нужен ли (dual-build вкл/выкл).

### 5.3. Что на выходе

```
my-game/
  game.spec.ts            ← единственный источник правды (заполнен)
  src/
    main.ts               ← ~25 строк: createSlotGame({ spec, scene, theme })
    GameScene.ts          ← скелет с TODO под каскад/фичи
    theme.ts              ← палитра из ответов
  game/
    script.lua            ← скелет: сигнатуры spin/cascade/freeSpins + TODO-математика
  public/assets/{symbols,bg,audio,vfx}/  ← пустые + NAMING.md
  vite.config.ts tsconfig.json index.html package.json   ← из шаблона, тонкие
  README.md               ← ссылка на skill `slot-game-creator` для фаз math/art/UI
```

`gameDefinition.json`, Lua-prelude, TS-константы, shell `gameInfo`, Stake `modeMap`, `math modes`
— **не файлы в репо, а артефакты кодогена** из `game.spec.ts` (Vite-плагин в dev, build-step в CI).
Тогда форк-копипаст физически не может утащить чужие `spark_hunt` — режимы существуют только в spec.

### 5.4. Связь со skill `slot-game-creator`

В репозитории уже есть skill `slot-game-creator` (5 фаз: механика → математика/Lua/RTP →
арт через Ludo.ai → UI-спека → фронтенд). Бутстраппер — это **технический фундамент под фазы 2 и 5**:
скилл проектирует игру, CLI генерит каркас, разработчик/агент заполняет `script.lua`, рисует сцену
и ассеты. Стоит связать: фаза 1 скилла на выходе даёт заполненный `game.spec.ts` → `npm create` его съедает.

### 5.5. Порядок внедрения (прагматично)

1. **Сначала `defineGame()` + кодоген** (§4.1) — закрывает боль №1/№2/№3, даёт мгновенную ценность
   даже без CLI (можно внедрить в существующие 6 игр по одной).
2. **`createSlotGame()` хост** (§4.2) + нормализация Lua (§4.3) — ужимает main.ts, благословляет один путь.
3. **`stake-kit` + math-CLI** (§4.4, §4.6) — выносит Stake и math из игр.
4. **Каскадные примитивы + layout** (§4.7, §4.8) — разбивает GameScene-монолиты.
5. **CLI-скаффолдер** (§5.2) — поверх готовых пакетов; тонкий, потому что обвязка уже в пакетах.

Делать скаффолдер **до** выноса обвязки в пакеты — ошибка: получим генератор копипасты, т.е.
ровно текущую ситуацию, только автоматизированную.

---

## 6. Приложение: матрица «общее vs специфичное» по играм

| Аспект | kitsune | hot-ross | moon-spice | magnum-opus | magnus-alch | stone-rush |
|--------|---------|----------|-----------|-------------|-------------|-----------|
| Рендер | Pixi+React | ваниль canvas | Pixi | Pixi | Pixi | Pixi |
| Bootstrap | GameApplication | createPlatformSession | createPlatformSession | createPlatformSession | GameApplication | GameApplication |
| Грид | 7×7 | 5×5 | 5×4 | 6×6 | 5×4 | 7×7 |
| Win | cluster | 19 lines | 1024 ways | constellation | anywhere | cluster |
| Каскады | да | нет | да | да | да | да |
| Sticky-мн-ль | kitsunebi | нет | recipe | stage-mult | orbs | recipe |
| Stake dual-build | да | да | да | да | да | да |
| Math: Go-sim | да | fengari+curate | Go | Go | Go | sim-only |
| platform-core | 0.24.4 | 0.24.4 | 0.24.4 | 0.24.4 | 0.24.3 | 0.20.0 |
| game-engine | 0.17.0 | — (нет) | — (нет) | — (нет) | 0.17.0 | 0.17.0 |
| Папка math | `game/` | `server/`-ish | `game/` | `game/` | `server/`+`src/config` | `src/game/` |

Разнобой в последних строках — прямое следствие отсутствия стандарта и есть главная причина
завести `defineGame()` + один благословлённый layout.

---

*Отчёты по каждой игре собраны 6 параллельными агентами; при необходимости могу выгрузить полную
детализацию по любой из них (точные пути/строки, package.json, болевые точки).*
