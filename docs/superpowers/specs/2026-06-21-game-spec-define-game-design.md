# Design: `defineGame()` + game-spec — единый источник правды для слотов

Дата: 2026-06-21
Статус: согласован, готов к плану реализации
Контекст: первый срез из плана в [docs/slots-analysis-and-bootstrapper.md](../../slots-analysis-and-bootstrapper.md)

## Проблема

Анализ 6 слотов (kitsune-wrath, hot-ross, moon-spice-shop, magnum-opus, magnus-alchemy-slot,
Stone-Rush) показал: главная боль — нарушение single-source-of-truth. Символы, paytable,
стоимости бай-бонусов и mode-map дублируются в 3–5 местах (Lua, GameDefinition, TS-константы,
shell gameInfo, math `modes.ts`, stake `adapter`/`modeMap`). Правка математики молча
рассинхронизирует UI и Stake. Игры форкаются копипастом и тащат чужие идентификаторы
(Stone-Rush несёт имена бонус-режимов от Ember Rush).

## Цель первого среза

Ввести `defineGame(spec)` — единственный авторский источник структуры игры, из которого
детерминированно выводятся все остальные представления. Доказать работоспособность новым
гринфилд-example. НЕ мигрировать боевые игры на этом шаге.

## Решения (зафиксированы в брейншторме)

- **Механизм:** гибрид. Рантайм-вывод (0 файлов) для dev/фронта/симулятора; детерминированный
  export физических файлов на build — для деплоя на платформу Energy8 и в Stake.
- **Граница spec:** spec владеет *структурой* (символы, paytable, bet-levels, actions+стоимости,
  grid, список режимов). Reel-веса/профили (RTP-ручки) остаются в Lua рядом с алгоритмом.
- **Размещение:** под-пакет `@energy8platform/platform-core/game-spec` (renderer-agnostic),
  ре-экспортится из game-engine — pixi-игры получают автоматически.
- **Валидация:** новый гринфилд example в `examples/spec-slot/` + renderer-free unit/интеграционные
  тесты в platform-core.
- **Авторские файлы:** ровно два — `game.spec.ts` (данные) и `script.logic.lua` (алгоритм + веса).
  Всё остальное — производные, руками не правятся.

## Архитектура

```
packages/platform-core/src/game-spec/
  types.ts          GameSpec, SymbolSpec, ActionSpec — что пишет автор
  validate.ts       validateSpec(spec) — бросает на рассинхроне
  derive.ts         чистые деривёры: spec → каждый артефакт
  defineGame.ts     defineGame(spec): validate + собрать GameModel
  export.ts         exportGame(spec, { logicLua }) → деплой-артефакты
  index.ts          публичный API
```

Ре-экспорт: `packages/game-engine/src/...` добавляет под-путь, дублирующий game-spec
(как уже сделано для `/lua`, `/debug`, `/vite`).

### Единицы и их границы

1. **types.ts** — типы spec. Без логики. Зависимостей нет.
2. **validate.ts** — `validateSpec(spec): void` (бросает `GameSpecError`). Ловит: дубль symbol-id,
   `cost <= 0`, дыры/неконсистентность в paytable, несортированные/пустые bet-levels, ссылки
   actions на несуществующие stage. Зависит от types.
3. **derive.ts** — набор чистых функций, каждая независимо тестируема:
   - `toGameDefinition(spec)` → объект GameDefinition для DevBridge/LuaEngine/SDK
   - `toLuaPrelude(spec)` → строка Lua-констант (symbol ids, paytable)
   - `toModeMap(spec)` → `{ [action]: MODE }` для stake-моста
   - `toMathModes(spec)` → `ModeSpec[]` для math-CLI
   - `toPaytableView(spec)` → данные для shell gameInfo
   Зависит от types (+ существующие типы GameDefinition/ModeSpec из platform-core).
4. **defineGame.ts** — `defineGame(spec): GameModel`. Вызывает validateSpec, затем деривёры,
   возвращает `GameModel = { spec, gameDefinition, luaPrelude, modeMap, mathModes, paytable, symbols }`.
5. **export.ts** — `exportGame(spec, { logicLua }): { 'gameDefinition.json': string; 'script.lua': string }`.
   Чистая функция (IO делает вызыватель/тонкий CLI). Использует то же правило склейки, что и рантайм.

## Поток данных

```
game.spec.ts ──defineGame()──► GameModel (в памяти)
        ├─ dev.config.ts:  gameDefinition + luaScript(склейка)
        ├─ фронт/UI:        symbols / paytable
        ├─ shell:           gameInfo (paytable)
        ├─ stake-мост:      modeMap
        └─ math-CLI:        mathModes

build / e8 export ──exportGame()──► dist/game/gameDefinition.json
                                    dist/game/script.lua
```

### Правило склейки Lua (одно, на два контекста)

```
luaScript = model.luaPrelude + "\n" + <содержимое script.logic.lua>
```

- **Dev/sim:** DevBridge/LuaEngine получает склейку в рантайме (паттерн Stone-Rush
  `profilesPrelude()+rawLua`, но prelude выводится из spec).
- **Export:** та же склейка пишется в `dist/game/script.lua` — самодостаточный файл для сервера платформы.

paytable существует в одном месте (spec) и инжектится в Lua через prelude, а не переписывается.
Reel-веса автор пишет прямо в `script.logic.lua`.

## Типы (черновик, уточняется в плане)

```ts
interface GameSpec {
  id: string;
  type: 'slot';
  grid: { cols: number; rows: number };
  betLevels: number[];
  defaultBet?: number;
  maxWin: number;                 // множитель-кап
  currency?: string;              // дефолт для dev
  symbols: SymbolSpec[];
  actions: Record<string, ActionSpec>;
}

interface SymbolSpec {
  id: string;                     // 'H1', 'WILD', 'SCATTER', ...
  name?: string;
  kind: 'high' | 'low' | 'wild' | 'scatter' | 'multiplier';
  pay?: Record<number, number>;   // размер/oak → множитель; нет у спец-символов
}

interface ActionSpec {
  stage: string;                  // 'base' | 'free' | 'buy' | ...
  cost?: number;                  // cost multiplier, дефолт 1
  mode?: string;                  // Stake/math имя режима; дефолт = UPPER(key)
  feature?: Record<string, unknown>;       // feature_data
  transitions?: TransitionRule[];          // override; иначе дефолты по соглашению
}

interface GameModel {
  spec: GameSpec;
  gameDefinition: GameDefinition;          // существующий тип platform-core
  luaPrelude: string;
  modeMap: Record<string, string>;
  mathModes: ModeSpec[];
  paytable: PaytableView;
  symbols: SymbolSpec[];
}
```

### Transitions по соглашению (YAGNI)

В первом срезе spec не тащит полную мощь transitions. Дефолты:
- если экшен может выдать `free_spins_awarded > 0` → создать сессию с переходом в `free_spin`;
- `max_win_reached` → завершить сессию;
- `retrigger_spins > 0` → добавить спины.
`ActionSpec.transitions` позволяет override для нестандартных случаев.

## Тестирование (renderer-free — из-за известного hang Pixi в headless)

- Unit на каждый деривёр: `toGameDefinition` (snapshot), `toModeMap`, `toLuaPrelude` (содержит
  paytable), `toMathModes`.
- `validateSpec` отклоняет: дубль symbol-id, `cost<=0`, дыры в paytable, несортированные bet-levels,
  битые ссылки stage.
- Интеграция: прогнать `LuaEngine` со склейкой `prelude+logic` на тестовом spec → получить валидный
  спин (через существующий путь LuaEngine/SimulationRunner, без Pixi).
- Детерминизм export: `exportGame` дважды → идентичный вывод.

## Example `examples/spec-slot/`

Гринфилд мини-слот end-to-end:
- `game.spec.ts` — грид 3×3, 4–5 символов, 1 paytable, actions `spin` + один `buy_bonus`.
- `script.logic.lua` — минимальный алгоритм (line/cluster-win, читает paytable из prelude).
- `dev.config.ts` — собран из `model.gameDefinition` + склейки → доказывает рантайм-путь.
- build-шаг зовёт `exportGame` → `dist/game/{gameDefinition.json, script.lua}`.

## Scope

**В scope:** под-пакет game-spec (types, validate, derive, defineGame, export) + ре-экспорт из
game-engine; example `examples/spec-slot/`; тесты.

**Вне scope (следующие срезы, отдельные spec→plan каждый):**
- `createSlotGame()` хост (ужимает main.ts)
- `@energy8platform/stake-kit`
- единый math-CLI
- каскадные примитивы game-engine/ui
- CLI-скаффолдер `npm create @energy8platform/slot`
- миграция боевых игр (Stone-Rush и пр.)

## Риски / открытые вопросы

- **Точная форма `GameDefinition`** должна совпасть с тем, что ест DevBridge/LuaEngine и RGS
  платформы — сверить с `platform-core/src/types.ts` и реальными `config.json` боевых игр на этапе плана.
- **`ModeSpec`** — переиспользовать существующий тип из math-пайплайна, не плодить новый.
- **Имена режимов:** дефолт `UPPER(actionKey)` должен совпадать с конвенцией Stake-моста; проверить.
- **paytable-схема для разных механик** (cluster size vs oak vs ways): в первом срезе поддержать
  достаточно общую форму (`Record<number, number>`), расширять по мере миграций.
