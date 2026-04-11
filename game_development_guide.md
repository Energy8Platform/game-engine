# Руководство по разработке игр

Данный документ описывает всё, что необходимо для создания собственной игры на платформе Casino Platform. Он рассчитан на сторонних разработчиков и не требует знания внутренней архитектуры платформы.

---

## Содержание

1. [Обзор платформы](#1-обзор-платформы)
2. [Структура конфигурации игры (JSON)](#2-структура-конфигурации-игры-json)
3. [Max Win Cap](#3-max-win-cap)
4. [Buy Bonus и Ante Bet](#4-buy-bonus-и-ante-bet)
5. [Actions — определение действий](#5-actions--определение-действий)
6. [GameState: состояние спина](#6-gamestate-состояние-спина)
7. [Lua-скрипт: игровая логика](#7-lua-скрипт-игровая-логика)
8. [Lua API Reference](#8-lua-api-reference)
9. [Валидация входа и выхода (JSON Schema)](#9-валидация-входа-и-выхода-json-schema)
10. [Клиентская интеграция (SDK)](#10-клиентская-интеграция-sdk)
11. [Деплой игры](#11-деплой-игры)
12. [Симуляция и проверка RTP](#12-симуляция-и-проверка-rtp)
13. [Соглашения и лучшие практики](#13-соглашения-и-лучшие-практики)
14. [Миграция конфигов и скриптов (v3 → v4)](#14-миграция-конфигов-и-скриптов-v3--v4)
15. [Настольные игры (Table Games)](#15-настольные-игры-table-games)
    - 15.1. [Модель сессии для настольных игр](#151-модель-сессии-для-настольных-игр)
    - 15.2. [Персистентное состояние (`_persist_` конвенция)](#152-персистентное-состояние-_persist_-конвенция)
    - 15.3. [Пример: Blackjack](#153-пример-blackjack)
16. [Cross-Spin Persistent State (метры и накопители)](#16-cross-spin-persistent-state-метры-и-накопители)

---

## 1. Обзор платформы

Игровой движок платформы работает на серверной стороне. Каждая игра состоит из двух частей:

1. **JSON-конфигурация** (`GameDefinition`) — минимальный набор платформенных полей: идентификатор, тип, ставки, лимиты, actions (переходы), buy bonus / ante bet.
2. **Lua-скрипт** — вся игровая логика: символы, барабаны/сетка, пэйлайны, выплаты, каскады, фриспины, множители и любая другая математика.

Бэкенд оперирует **только математикой** — вся графика, анимация и звуки остаются на стороне клиента.

### Архитектура: Lua-only

Все игры используют **единый Lua-движок**. JSON-конфигурация не содержит игровой логики — только платформенные метаданные и правила переходов (actions/transitions). Lua-скрипт экспортирует единую функцию `execute(state)`, которая получает `state.action` и `state.stage` и реализует всю математику игры.

> **Примечание**: JSON Flow Executor (поле `engine_mode: "json"`, блоки `logic`/`steps`, встроенные действия `spin_reels`, `evaluate_lines` и т.д.) **удалён**. Поле `engine_mode` больше не используется.

### Два типа игр

| Тип | Поле `type` | Описание |
|-----|-------------|----------|
| **SLOT** | `"SLOT"` | Слоты — классические и видео. Сетка символов, барабаны, пэйлайны, каскады, фриспины. Вся логика в Lua-скрипте. |
| **TABLE** | `"TABLE"` | Настольные игры — блэкджек, рулетка, баккара и др. Мультишаговые раунды с произвольной логикой решений. → см. §15 |

### Модель безопасности

Игра загружается в iframe. Клиентский SDK взаимодействует с хостом через `postMessage`. JWT-токен **никогда не передаётся** в iframe — все API-вызовы проксируются через хост-страницу.

---

## 2. Структура конфигурации игры (JSON)

Конфигурация — это JSON-файл, содержащий **только платформенные поля**. Вся игровая логика (символы, барабаны, пэйлайны, выплаты, каскады и т.д.) определяется в Lua-скрипте.

```
GameDefinition
├── id                          string        (обязательно) Уникальный идентификатор игры
├── type                        string        (обязательно) Категория: "SLOT" | "TABLE"
├── script_path                 string        (обязательно) S3-ключ Lua-скрипта (напр. "games/my-game/script.lua")
│
├── actions                     map           (обязательно) → см. §5 (ActionDefinition)
│
├── bet_levels                  BetLevelsConfig  Доступные ставки
│   │   — массив: [0.20, 0.50, 1.00]            → только список levels
│   │   — объект: {"min": 0.20, "max": 100}       → диапазон
│   │   — объект: {"levels": [...], "max": 100}  → список + лимит
│   ├── levels                  float64[]     Конкретный список допустимых ставок
│   ├── min                     float64?      Минимальная ставка (опционально)
│   └── max                     float64?      Максимальная ставка (опционально)
│
├── max_win                     object        → см. §3 (Max Win Cap)
│   ├── multiplier              float64       Макс. выигрыш как множитель ставки (напр. 10000)
│   └── fixed                   float64       Абсолютный лимит в валюте (напр. 500000)
│
├── session_ttl                 string        TTL сессии (напр. "30m", "1h"). По умолчанию определяется платформой.
│
├── buy_bonus                   object        → см. §4
│   └── modes                   map           Режимы покупки бонуса
│       └── [mode_name]         object        Один режим (напр. "default", "super")
│           ├── cost_multiplier float64       Множитель стоимости от ставки
│           └── scatter_distribution map      Распределение скаттеров
├── ante_bet                    object        → см. §4
│   └── cost_multiplier         float64       Множитель стоимости спина (1.25 = +25%)
│
├── persistent_state            object        → см. §16 (Cross-Spin Persistent State)
│   ├── vars                    string[]      Имена числовых переменных, сохраняемых между спинами
│   └── exposed_vars            string[]      Имена переменных, отдаваемых клиенту в data.persistent_state
│
├── input_schema                object        → см. §9
└── output_schema               object        → см. §9
```

> **Удалено из JSON-конфигурации (v4)**: `version`, `rtp`, `viewport`, `symbols`, `reel_strips`, `symbol_weights`, `paylines`, `stages`, `logic`, `engine_mode`, `evaluation_mode`, `min_match_count`, `anywhere_payouts`, `scatter_payouts`, `free_spins_trigger`, `free_spins_retrigger`, `free_spins_config`, `round_type_weights`, `symbol_chances`, `multiplier_value_weights`, `ante_bet.scatter_chance_multiplier`. Все эти параметры теперь определяются непосредственно в Lua-скрипте.

### Минимальный пример конфигурации

```json
{
  "id": "my_slot",
  "type": "SLOT",
  "script_path": "games/my-slot/script.lua",
  "bet_levels": [0.20, 0.50, 1.00, 2.00, 5.00],
  "max_win": { "multiplier": 10000 },
  "actions": {
    "spin": {
      "stage": "base_game",
      "debit": "bet",
      "credit": "win",
      "transitions": [
        { "condition": "always", "next_actions": ["spin"] }
      ]
    }
  }
}
```

---

## 3. Max Win Cap

Поле `max_win` ограничивает максимальный выигрыш одного раунда (base game + все фриспины).

```json
"max_win": {
  "multiplier": 10000,
  "fixed": 500000
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `multiplier` | float64 | Max win как множитель от ставки. `10000` = максимум 10 000× bet. |
| `fixed` | float64 | Абсолютный лимит в валюте. `500000` = максимум 500 000. |

Если оба указаны, используется меньшее: `min(bet × multiplier, fixed)`.

При достижении лимита:
1. `TotalWin` обрезается до эффективного капа.
2. Переменная `max_win_reached` устанавливается в `1`.
3. Клиенту возвращается `"max_win_reached": true` в `data`.
4. Если идёт бонус-раунд (фриспины), сессия завершается досрочно.

---

## 4. Buy Bonus и Ante Bet

### Buy Bonus

Позволяет игроку купить вход в бонусный раунд напрямую. Стоимость — фиксированный множитель от ставки. При покупке платформа разыгрывает количество скаттеров из `scatter_distribution` и передаёт его Lua-скрипту через `state.params.forced_scatter_count`.

```json
"buy_bonus": {
  "modes": {
    "default": {
      "cost_multiplier": 100,
      "scatter_distribution": { "4": 60, "5": 30, "6": 10 }
    },
    "super": {
      "cost_multiplier": 200,
      "scatter_distribution": { "5": 70, "6": 30 }
    }
  }
}
```

| Поле | Описание |
|------|----------|
| `cost_multiplier` | Стоимость как множитель от ставки. При ставке 1.00 и множителе 100 → списывается 100.00. |
| `scatter_distribution` | Взвешенное распределение количества скаттеров. Ключ — количество, значение — вес. |

Для каждого режима создаётся отдельный action с `debit: "buy_bonus_cost"` и `buy_bonus_mode`:

```json
"buy_bonus": {
  "stage": "base_game",
  "debit": "buy_bonus_cost",
  "buy_bonus_mode": "default",
  "transitions": [
    {
      "condition": "always",
      "creates_session": true,
      "credit_override": "defer",
      "next_actions": ["free_spin"],
      "session_config": {
        "total_spins_var": "free_spins_awarded",
        "persistent_vars": ["global_multiplier"]
      }
    }
  ]
}
```

**Что получает Lua-скрипт при buy bonus:**
- `state.params.buy_bonus = true`
- `state.params.buy_bonus_mode = "default"` (или `"super"`)
- `state.params.forced_scatter_count = 5` (разыгранное платформой количество)

Скрипт должен использовать `forced_scatter_count` для размещения скаттеров на сетке.

### Ante Bet

Увеличенная ставка. В JSON-конфиге хранится только `cost_multiplier`:

```json
"ante_bet": {
  "cost_multiplier": 1.25
}
```

При `ante_bet: true` в params клиента, платформа списывает `bet × 1.25`. Повышение шанса скаттера реализуется в Lua-скрипте (скрипт читает `state.params.ante_bet`).

---

## 5. Actions — определение действий

Единый эндпоинт `POST /api/games/{id}/play` маршрутизирует запросы через поле `actions` в конфиге.

### ActionDefinition

```json
{
  "spin": {
    "stage": "base_game",
    "debit": "bet",
    "credit": "win",
    "transitions": [
      {
        "condition": "free_spins_awarded > 0",
        "creates_session": true,
        "credit_override": "defer",
        "next_actions": ["free_spin"],
        "session_config": {
          "total_spins_var": "free_spins_awarded",
          "persistent_vars": ["global_multiplier"]
        }
      },
      { "condition": "always", "next_actions": ["spin"] }
    ]
  }
}
```

| Поле | Описание |
|------|----------|
| `stage` | Имя стейджа, передаваемое в `state.stage` при вызове `execute(state)` |
| `debit` | Тип списания: `"bet"`, `"buy_bonus_cost"`, `"ante_bet_cost"`, `"none"` |
| `credit` | Когда зачислять выигрыш: `"win"` (сразу), `"none"`, `"defer"` |
| `requires_session` | Требует активной сессии (round_id) |
| `buy_bonus_mode` | Ключ режима в `buy_bonus.modes` |
| `transitions` | Условные переходы после исполнения стейджа |
| `input_schema` | Per-action JSON Schema для валидации params |

### Transitions

После выполнения стейджа transitions оцениваются по порядку — первый совпавший определяет поведение:

| Поле | Описание |
|------|----------|
| `condition` | govaluate-выражение против `state.Variables` или `"always"` |
| `creates_session` | Создать сессию (фриспины, пик-бонус) |
| `complete_session` | Завершить сессию, зачислить суммарный выигрыш |
| `credit_override` | `"defer"` — отложить зачисление |
| `next_actions` | Доступные клиенту действия |
| `session_config.total_spins_var` | Переменная → `session.SpinsRemaining` |
| `session_config.persistent_vars` | Переменные, сохраняемые в Redis между спинами |
| `add_spins_var` | Ретриггер: добавить спины из переменной |

### Жизненный цикл сессии

```
spin (base_game) → free_spins_awarded > 0 → creates_session, credit_override: "defer"
  → free_spin (free_spins) × N → complete_session → зачисление суммарного выигрыша
```

Персистентные переменные (например `global_multiplier`) сохраняются в Redis между спинами.

---

## 6. GameState: состояние спина

```go
type GameState struct {
    Variables map[string]float64 // "multiplier", "free_spins_awarded", "max_win_reached"
    TotalWin  float64
    Params    map[string]any     // Валидированные параметры клиента
    Data      map[string]any     // Выходные данные из Lua-скрипта
}
```

Lua-скрипт получает `state.variables` и `state.params`, возвращает таблицу которая попадает в `Data`. Ключ `total_win` в возвращаемой таблице устанавливает `TotalWin`, ключ `variables` мержится в `Variables`.

Стандартные переменные движка:

| Переменная | Описание |
|-----------|----------|
| `bet` | Размер ставки |
| `multiplier` | Каскадный множитель (по умолчанию 1) |
| `global_multiplier` | Множитель, накапливаемый через сессию |
| `free_spins_awarded` | Количество триггернутых фриспинов |
| `free_spins_remaining` | Оставшиеся фриспины |
| `max_win_reached` | 1 если достигнут лимит выигрыша |

---

## 7. Lua-скрипт: игровая логика

### Точка входа

Скрипт экспортирует функцию `execute(state)`:

```lua
function execute(state)
    if state.stage == "base_game" then
        return do_base_game(state)
    elseif state.stage == "free_spins" then
        return do_free_spins(state)
    end
end
```

### Структура state

| Поле | Тип | Описание |
|------|-----|----------|
| `state.stage` | string | Имя стейджа из ActionDefinition |
| `state.params` | table | Параметры клиента + buy_bonus, forced_scatter_count |
| `state.variables` | table | Переменные движка (bet, multiplier, free_spins_remaining) |

### Возвращаемая таблица

```lua
return {
    total_win = 15.5,           -- обязательно: выигрыш как множитель ставки
    variables = {               -- опционально: обновить переменные
        free_spins_awarded = 10,
        global_multiplier = 3,
    },
    -- остальное → state.Data (отправляется клиенту)
    matrix = {{1,2,3},{4,5,6}},
    win_lines = {...},
    scatter_count = 3,
}
```

### Что определяется внутри скрипта

Вся игровая логика описывается в Lua-скрипте:

- **Символы**: таблица ID, флаги wild/scatter/multiplier
- **Размер сетки** (viewport): `local COLS = 6; local ROWS = 5`
- **Барабаны / веса символов**: reel strips или weight tables
- **Пэйлайны / Anywhere Pays**: линии и таблицы выплат
- **Скаттеры и фриспины**: правила триггера и ретриггера
- **Каскады / Tumble**: удаление, сдвиг, заполнение
- **Множители**: логика сбора и применения
- **Buy bonus**: размещение forced scatters на сетке

### Песочница (Sandbox)

- Безопасные библиотеки: `base`, `table`, `string`, `math`
- Нет доступа к `os`, `io`, `debug`, `loadfile`, `dofile`
- Таймаут: 5 секунд
- Пул VM (`sync.Pool`) для конкурентной обработки

---

## 8. Lua API Reference

Модуль `engine` доступен глобально:

| Функция | Описание |
|---------|----------|
| `engine.random(min, max)` | Криптографически безопасное случайное целое [min, max] |
| `engine.random_float()` | Случайное число [0.0, 1.0) |
| `engine.random_weighted(weights)` | 1-based индекс по таблице весов `{w1, w2, ...}` |
| `engine.shuffle(arr)` | Перемешивание (Fisher-Yates, crypto RNG), возвращает копию |
| `engine.log(level, msg)` | Серверный лог: `"debug"`, `"info"`, `"warn"`, `"error"` |
| `engine.get_config()` | Таблица: `{id, type, bet_levels}` из JSON-конфига |

> `engine.get_symbol()` удалён. Символы определяются непосредственно в Lua-скрипте.

### Пример использования

```lua
-- Взвешенный выбор символа
local SYMBOL_WEIGHTS = {5, 7, 9, 11, 14, 17, 20, 23, 26}
local idx = engine.random_weighted(SYMBOL_WEIGHTS)  -- 1-based index

-- Случайная позиция
local pos = engine.random(1, 30)

-- Перемешивание колоды
local deck = engine.shuffle({1, 2, 3, ..., 52})
```

---


## 9. Валидация входа и выхода (JSON Schema)

Конфигурация поддерживает опциональные JSON Schema (draft 2020-12) для валидации параметров спина и описания выходных данных.

### input_schema

Валидирует `PlayRequest.Params` — параметры, которые клиент передаёт при игровом действии:

```json
"input_schema": {
  "type": "object",
  "properties": {
    "lines": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20
    },
    "ante_bet": {
      "type": "boolean"
    },
    "buy_bonus": {
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

Если параметры не проходят валидацию — спин отклоняется с ошибкой.

### output_schema

Описывает структуру `PlayResult.data` (информационный, не валидационный):

```json
"output_schema": {
  "type": "object",
  "properties": {
    "matrix": {
      "type": "array",
      "items": { "type": "array", "items": { "type": "integer" } }
    },
    "win_lines": {
      "type": "array"
    },
    "multiplier": {
      "type": "number"
    }
  }
}
```

---

## 10. Клиентская интеграция (SDK)

Для клиентской части используется `@energy8platform/game-sdk`. Полная документация — в [game_sdk_reference.md](game_sdk_reference.md).

### Краткий обзор

```typescript
import { CasinoGameSDK } from '@energy8platform/game-sdk';

const sdk = new CasinoGameSDK();

// 1. Инициализация — получение конфига и баланса
const initData = await sdk.ready();
// initData.config   — конфигурация игры (GameDefinition)
// initData.balance  — текущий баланс
// initData.currency — валюта
// initData.assetsUrl — базовый URL для ассетов

// 2. Спин (универсальный метод play)
const result = await sdk.play({ action: 'spin', bet: 1.00, params: { lines: 20 } });
// result.roundId      — ID раунда
// result.action       — выполненное действие ("spin")
// result.totalWin     — выигрыш
// result.balanceAfter — баланс после спина
// result.data         — payload из GameState.Data (матрица, линии, множители...)
// result.nextActions  — доступные действия далее (["spin"], ["free_spin"], ["pick"])
// result.session      — состояние сессии (если фриспины триггернулись)
// result.creditPending — true если зачисление отложено

// 3. Фриспин (если nextActions содержит "free_spin")
if (result.nextActions.includes('free_spin')) {
    const fs = await sdk.play({ action: 'free_spin', bet: 0, roundId: result.roundId });
    // fs.session.spinsRemaining — оставшиеся фриспины
    // fs.session.completed      — true когда бонус завершён
    // fs.session.maxWinReached  — true если достигнут max win cap
}

// 4. Баланс
const balance = await sdk.getBalance();

// 5. Очистка
sdk.destroy();
```

### Что возвращается в `result.data`

Содержимое `result.data` — это `GameState.Data`, собранный движком:

- Для JSON-движка: автоматически маппится из `Matrix`, `WinLines`, `AnywhereWins` и т.д. через `MapState()`.
- Для Lua-движка: всё, что скрипт вернул в return-таблице (кроме специальных ключей `total_win`, `free_spins`, `variables`).

Используйте `output_schema` в конфиге для документирования структуры `data` вашей игры.

---

## 11. Деплой игры

### Шаг 1: Создание записи игры

```bash
POST /api/v1/admin/games
Content-Type: application/json

{
  "id": "my_new_slot",
  "title": "My New Slot",
  "type": "SLOT",
  "version": "1.0.0",
  "engine_mode": "json",
  "rtp": "96.5",
  "description": "Описание игры"
}
```

Игра создаётся в неактивном состоянии (`is_active = false`). Путь к конфигу по умолчанию: `games/{id}/config.json`.

### Шаг 2: Загрузка конфигурации в S3

Получите presigned URL:

```bash
POST /api/v1/admin/games/upload-url?game_id=my_new_slot&asset_type=config
```

Загрузите конфиг по полученному URL:

```bash
PUT {presigned_url}
Content-Type: application/json

< my_new_slot_config.json
```

### Шаг 3: Загрузка ассетов

Аналогично — получите URL для каждого типа ассета (`ICON`, `BACKGROUND`, `SOUND_BUNDLE`) и загрузите файлы.

### Шаг 4: Lua-скрипт (если `engine_mode: "lua"` или гибридный)

Lua-скрипты хранятся в S3 рядом с конфигурацией. Получите presigned URL с `type="script"`:

```bash
POST /api/v1/admin/games/{id}/upload-url
Content-Type: application/json

{
  "type": "script",
  "filename": "script.lua"
}
```

Загрузите `.lua` файл по полученному URL:

```bash
PUT {presigned_url}
Content-Type: application/octet-stream

< my_game_script.lua
```

Скрипт будет сохранён в S3 по пути `games/{gameID}/script.lua`. В конфигурации укажите `script_path` соответствующий S3-ключу:

```json
{
  "engine_mode": "lua",
  "script_path": "games/my-game/script.lua"
}
```

> **Примечание**: если `script_path` это просто имя файла (например `"script.lua"`), платформа автоматически резолвит его в `games/{gameID}/script.lua`. В dev-режиме (файловый конфиг-репозиторий) скрипты по-прежнему читаются из локальной директории `scripts/`.

### Шаг 5: Активация

Обновите статус игры для отображения в клиентском лобби.

---

## 12. Симуляция и проверка RTP

Перед деплоем используйте CLI-инструмент симуляции для проверки математической модели.

### Запуск

```bash
go run cmd/simulation/main.go
```

> По умолчанию в `cmd/simulation/main.go` указаны `configPath` и `iterations`. Измените их под вашу игру.

### Пример вывода

```
Starting simulation for piggy_gates (1000000 iterations)...

--- Simulation Results ---
Game: piggy_gates
Iterations: 1000000
Duration: 12.5s
Total RTP: 96.48%
Base Game RTP: 72.31%
Free Spins RTP: 24.17%
Hit Frequency: 28.45%
Max Win: 5234.50x
Max Win Hits: 3 (rounds capped by max_win)
Free Spins Triggered: 4521 (1 in 221 spins)
Free Spins Played: 52847
```

### Метрики

| Метрика | Описание |
|---------|----------|
| `Total RTP` | Общий Return to Player (должен соответствовать целевому `rtp` в конфиге). |
| `Base Game RTP` | Доля RTP от основной игры. |
| `Free Spins RTP` | Доля RTP от бонусных раундов. |
| `Hit Frequency` | Процент спинов с выигрышем. |
| `Max Win` | Максимальный разовый выигрыш (в множителях от ставки). |
| `Max Win Hits` | Количество раундов, где выигрыш был ограничен лимитом `max_win`. |

Рекомендуется запускать не менее **1 000 000** итераций для стабильных результатов.

---

## 13. Соглашения и лучшие практики

1. **Symbol ID — целые числа**. Строковые имена (ключи в `symbols`) служат только для читаемости конфига. Внутри движка и в `reel_strips`, `paylines`, `anywhere_payouts` — только `id`.

2. **Все выплаты — множители от ставки**. `TotalWin = 50` при ставке 2.00 = реальный выигрыш 100.00. Не используйте абсолютные суммы.

3. **Используйте `symbol_weights` вместо `reel_strips`** для новых игр. Формат `name→weight` проще для понимания, настройки RTP и поддержки per-reel конфигурации. `reel_strips` поддерживается для обратной совместимости.

4. **Формат ключей выплат**: `"symbolID:count"` для paylines (e.g., `"1:3"`), строковые пороги для anywhere (`"8"`, `"10"`), строковые количества для scatter (`"3"`, `"4"`).

5. **Используйте `input_schema`** для валидации клиентских параметров (`PlayRequest.Params`) — это защита от невалидных запросов.

6. **Именование стейджей и actions**: стейджи именуются произвольно (`"base_game"`, `"free_spins"`, `"bonus_pick"` и др.). В Lua-режиме скрипт экспортирует единую функцию `execute(state)` и сам диспатчит по `state.stage`. Блок `actions` в конфиге — **обязательный** (см. §10.1).

7. **Глобальный множитель (`global_multiplier`)** сохраняется между фриспинами в Redis-сессии. Используйте его для накопительного эффекта.

8. **Каскады реализуются через `loop`**: условие `"last_win_amount > 0"`, тело — `remove_winning_symbols` → `shift_and_fill` → оценка → `payout`.

9. **Не полагайтесь на глобальные Lua-переменные** между вызовами — VM переиспользуются из пула.

10. **Тестируйте через симуляцию** до деплоя. Целевой RTP должен совпадать с заявленным в конфиге ±0.5%.

11. **Всегда задавайте `max_win`** для production-игр. Без лимита теоретически возможны аномально большие выигрыши в каскадных играх. Стандартный диапазон: 5 000×–20 000× ставки.

12. **`free_spins_config.persistent_state`** — перечислите все переменные, которые должны накапливаться между фриспинами. Если не указан, по умолчанию сохраняется только `global_multiplier`.

13. **Для настольных игр (TABLE) используйте `_persist_` конвенцию** — храните сложные структуры (колоду карт, руки игроков) в `state.Data` с ключами `_persist_<name>`. Платформа автоматически сохраняет их в Redis между действиями (→ §21.2).

14. **Настольные игры — только Lua-режим**. JSON-движок ориентирован на слоты; логика карточных/настольных игр значительно сложнее и требует полного контроля через `execute(state)`.

---

## 14. Миграция конфигов и скриптов (v3 → v4)


В v4 удалён JSON Flow Executor. Все игры теперь используют Lua-скрипты.

| Было (v3) | Стало (v4) |
|-----------|-----------|
| `engine_mode: "json"` + блок `logic` | Удалено. Все игры = Lua. |
| `symbols`, `viewport`, `reel_strips`, `paylines` в JSON | Удалено из JSON. Определяется в Lua-скрипте. |
| `anywhere_payouts`, `scatter_payouts`, `free_spins_trigger` в JSON | Удалено из JSON. Определяется в Lua-скрипте. |
| `symbol_weights`, `symbol_chances`, `round_type_weights` в JSON | Удалено из JSON. Определяется в Lua-скрипте. |
| `ante_bet.scatter_chance_multiplier` в JSON | Удалено. Реализуется в Lua (скрипт читает `state.params.ante_bet`). |
| `engine.get_symbol(id)` в Lua | Удалено. Символы определяются в скрипте. |
| `engine.get_config().viewport` | Удалено. Viewport определяется в скрипте. |
| `state.Matrix`, `state.WinLines`, `state.AnywhereWins` в Go | Удалено. Всё через `state.Data`. |

**Шаги миграции:**
1. Перенесите `symbols`, `viewport`, `reel_strips`/`symbol_weights`, `paylines`/`anywhere_payouts`, `scatter_payouts`, `free_spins_trigger` из JSON в Lua-скрипт
2. Удалите эти поля из JSON-конфига
3. Замените `engine.get_symbol(id)` на локальную таблицу символов
4. Замените `engine.get_config().viewport` на локальные константы
5. Убедитесь что `script_path` указан в JSON-конфиге

---

## 15. Настольные игры (Table Games)

Платформа поддерживает **настольные игры** — блэкджек, рулетку, баккару и другие. Настольные игры используют `type: "TABLE"` и Lua-скрипт для всей логики.

### Ключевые отличия от слотов

| Аспект | Слоты (`SLOT`) | Настольные игры (`TABLE`) |
|--------|---------------|---------------------------|
| Режим движка | JSON или Lua | Только Lua |
| Модель раунда | 1 action = 1 раунд (или фиксированное кол-во в бонусе) | Мультишаговый раунд: deal → hit/stand/double → resolve |
| Сессия | Счётчик `SpinsRemaining` | Unlimited (`SpinsRemaining = -1`), завершается по `complete_session` |
| Persistent state | `map[string]float64` (числовые переменные) | `map[string]any` (произвольные структуры: массивы карт, руки, колода) |
| Viewport | Сетка символов `width × height` | Не используется (`0 × 0`) |
| Symbols / Paylines | Определяют математику | Пустые (вся логика в Lua) |

### 15.1. Модель сессии для настольных игр

Для настольных игр сессия создаётся при `deal` и завершается при `complete_session: true`. Между действиями (hit, stand, double, split) количество шагов неопределено.

#### Unlimited sessions

В `session_config.total_spins_var` указывается имя переменной (например, `"_table_unlimited"`), а Lua-скрипт устанавливает её в `-1`:

```lua
variables._table_unlimited = -1
```

Это даёт `SpinsRemaining = -1`, что означает:
- Сессия не завершается по счётчику (нет декремента)
- Сессия проходит валидацию (`SpinsRemaining < 0` считается "unlimited")
- Завершение **только** через `complete_session: true` в transition

#### Завершение раунда

Lua-скрипт сигнализирует о завершении раунда через переменную:

```lua
variables.round_complete = 1
```

Это активирует transition:

```json
{
  "condition": "round_complete == 1",
  "complete_session": true,
  "next_actions": ["deal"]
}
```

### 15.2. Персистентное состояние (`_persist_` конвенция)

Настольные игры хранят между действиями сложное состояние: колоду карт, руки игрока/дилера, фазу раунда и т.д. Поскольку `state.Variables` поддерживает только `float64`, используется конвенция `_persist_`:

#### Сохранение (Lua → Redis)

Lua-скрипт кладёт данные в `state.Data` с prefix `_persist_`:

```lua
-- Сохранить колоду, руки и фазу раунда
data._persist_shoe = gs.shoe              -- массив из 312 карт
data._persist_shoe_pos = gs.shoe_pos      -- число
data._persist_player_hands = gs.player_hands  -- массив объектов
data._persist_dealer_cards = gs.dealer_cards  -- массив
data._persist_phase = gs.phase            -- строка
```

Платформа автоматически:
1. Извлекает все ключи с префиксом `_persist_` из `state.Data`
2. Сохраняет их в `session.PersistentState` (без префикса): `shoe`, `shoe_pos`, `player_hands`, ...
3. Данные сериализуются в JSON и хранятся в Redis

#### Восстановление (Redis → Lua)

При следующем action данные доступны в `state.params` с prefix `_ps_`:

```lua
local gs = {}
gs.shoe         = state.params._ps_shoe           -- массив карт
gs.shoe_pos     = state.params._ps_shoe_pos        -- число (может быть float → floor)
gs.player_hands = state.params._ps_player_hands    -- массив объектов
gs.dealer_cards = state.params._ps_dealer_cards    -- массив
gs.phase        = state.params._ps_phase           -- строка
```

> **Важно**: числовые значения могут вернуться как `float64` после JSON round-trip (Redis → Go → Lua). Используйте `math.floor()` для целых значений:
> ```lua
> gs.shoe_pos = math.floor(state.params._ps_shoe_pos or 1)
> ```

#### Обратная совместимость

Для слотов `PersistentState` по-прежнему хранит `float64` значения в `session_config.persistent_vars`. Конвенция `_persist_` — дополнительный механизм, они не конфликтуют.

### 15.3. Пример: Blackjack

Полный пример реализации блэкджека с крупье (6-deck shoe, dealer stands on soft 17).

#### Конфигурация

```json
{
  "id": "blackjack",
  "type": "TABLE",
  "engine_mode": "lua",
  "script_path": "games/blackjack/script.lua",
  "stages": ["deal", "player_action"],
  "bet_levels": [1, 2, 5, 10, 25, 50, 100],
  "rtp": "99.5",
  "viewport": { "width": 0, "height": 0 },
  "symbols": {},
  "reel_strips": {},
  "paylines": [],
  "logic": {},
  "actions": {
    "deal": {
      "stage": "deal",
      "debit": "bet",
      "credit": "none",
      "transitions": [
        { "condition": "round_complete == 1", "complete_session": true, "next_actions": ["deal"] },
        {
          "condition": "always",
          "creates_session": true,
          "credit_override": "defer",
          "next_actions": ["hit", "stand", "double"],
          "session_config": { "total_spins_var": "_table_unlimited" }
        }
      ]
    },
    "hit":    { "stage": "player_action", "debit": "none", "requires_session": true, "transitions": [...] },
    "stand":  { "stage": "player_action", "debit": "none", "requires_session": true, "transitions": [...] },
    "double": { "stage": "player_action", "debit": "bet",  "requires_session": true, "transitions": [...] },
    "split":  { "stage": "player_action", "debit": "bet",  "requires_session": true, "transitions": [...] }
  }
}
```

#### Lua-скрипт (структура)

```lua
-- Единая точка входа
function execute(state)
    if state.stage == "deal" then
        return do_deal(state)
    elseif state.stage == "player_action" then
        return do_player_action(state)
    end
end

function do_deal(state)
    -- 1. Создать и перемешать shoe (6 колод = 312 карт)
    local shoe = engine.shuffle(create_deck())

    -- 2. Раздать: player, dealer, player, dealer
    local p1, p2 = shoe[1], shoe[3]
    local d1, d2 = shoe[2], shoe[4]

    -- 3. Проверить натуральный блэкджек → round_complete = 1
    -- 4. Иначе → сохранить состояние, вернуть частичную руку дилера

    -- Сохранить persistent state
    data._persist_shoe = shoe
    data._persist_shoe_pos = 5
    data._persist_player_hands = { {cards = {p1, p2}, bet_mult = 1} }
    data._persist_dealer_cards = {d1, d2}

    return {
        total_win = 0,
        variables = { round_complete = 0, _table_unlimited = -1 },
        player_hands = {...},      -- видимые руки
        dealer_hand = {...},       -- только первая карта
        phase = "player_turn",
    }
end

function do_player_action(state)
    -- Восстановить состояние из persistent
    local gs = {
        shoe = state.params._ps_shoe,
        player_hands = state.params._ps_player_hands,
        dealer_cards = state.params._ps_dealer_cards,
    }

    -- Определить действие из имени action
    local action = state.params._action  -- "hit", "stand", "double", "split"

    if action == "hit" then
        -- Добавить карту, проверить bust
    elseif action == "stand" then
        -- Отметить руку как стоящую
    elseif action == "double" then
        -- Удвоить ставку, взять одну карту, stand
    elseif action == "split" then
        -- Разделить на две руки
    end

    -- Проверить: все руки done? → dealer draws → resolve
    if all_hands_done then
        play_dealer(gs)  -- Dealer hits until 17+
        local results, total_payout = resolve_hands(gs)

        return {
            total_win = total_payout - 1,  -- profit multiplier
            variables = { round_complete = 1 },
            player_hands = format_hands(gs.player_hands, results),
            dealer_hand = format_dealer(gs.dealer_cards, false),
            phase = "resolved",
        }
    end

    -- Ещё есть ходы → сохранить и вернуть
    save_game_state(gs, data)
    return {
        total_win = 0,
        variables = { round_complete = 0 },
        player_hands = format_hands(gs.player_hands),
        dealer_hand = format_dealer(gs.dealer_cards, true),  -- hole card hidden
        phase = "player_turn",
        available_actions = get_available_actions(gs),
    }
end
```

#### Игровой цикл (client ↔ server)

```
Client                             Server
  │                                  │
  │ POST /play {action:"deal"}       │
  │ ──────────────────────────────▶  │ 1. Debit bet
  │                                  │ 2. Shuffle & deal
  │                                  │ 3. Create session (unlimited)
  │ ◀──────────────────────────────  │ 4. Return player_hands, dealer_hand (hole hidden)
  │ {next_actions: [hit,stand,dbl]}  │
  │                                  │
  │ POST /play {action:"hit"}        │
  │ ──────────────────────────────▶  │ 5. Restore state from Redis
  │                                  │ 6. Deal card to player
  │ ◀──────────────────────────────  │ 7. Save state, return updated hand
  │ {next_actions: [hit,stand]}      │
  │                                  │
  │ POST /play {action:"stand"}      │
  │ ──────────────────────────────▶  │ 8. Restore state
  │                                  │ 9. Dealer draws (S17)
  │                                  │ 10. Resolve & compare hands
  │                                  │ 11. Complete session, credit win
  │ ◀──────────────────────────────  │ 12. Return results, payouts
  │ {next_actions: [deal]}           │
```

#### Правила выплат

| Результат | Множитель | Выплата при ставке 10 |
|-----------|-----------|----------------------|
| Blackjack (натуральный 21) | 2.5× | 25 (profit: 15) |
| Win | 2.0× | 20 (profit: 10) |
| Push | 1.0× | 10 (profit: 0) |
| Lose | 0.0× | 0 (loss: 10) |
| Insurance win (dealer BJ) | 1.5× от половины ставки | +7.50 |

> **TotalWin** — это **profit multiplier** (выплата минус ставка). Например, blackjack = `1.5` (получил 2.5× bet, минус 1× bet = 1.5× profit). Платформа вычисляет: `profit × bet = реальный выигрыш`.

### Чеклист для новой настольной игры

- [ ] `type: "TABLE"` в конфиге
- [ ] `engine_mode: "lua"`
- [ ] `viewport: { width: 0, height: 0 }` (сетка не нужна)
- [ ] `symbols`, `reel_strips`, `paylines`, `logic` — пустые
- [ ] Каждое действие игрока — отдельный action с `requires_session: true`
- [ ] Первый action (`deal`) — `debit: "bet"`, `creates_session: true`
- [ ] `session_config.total_spins_var` указывает на переменную с `-1`
- [ ] Lua-скрипт использует `_persist_` конвенцию для сложного persistent state
- [ ] Lua-скрипт устанавливает `round_complete = 1` для завершения раунда
- [ ] `complete_session: true` в transition по условию `round_complete == 1`
- [ ] Действия с доплатой (`double`, `split`) имеют `debit: "bet"`
- [ ] `state.params._action` используется для определения типа действия в Lua

---

## 16. Cross-Spin Persistent State (метры и накопители)

Некоторые механики требуют сохранения состояния **между базовыми спинами** — например, накопление зарядов, прогрессивные множители или счётчики до бонуса. В отличие от сессионного `_persist_` (§15.2), который работает только внутри бонусного раунда, Cross-Spin Persistent State живёт **независимо от сессий** и не имеет TTL.

### Как это работает

1. В JSON-конфиге игры объявляется блок `persistent_state`
2. Перед каждым спином платформа загружает сохранённые значения из Redis в `state.variables`
3. После спина платформа извлекает объявленные переменные из `state.variables` и сохраняет обратно
4. Клиент получает текущие значения в `data.persistent_state`

### Конфигурация

```json
{
  "id": "charge_slot",
  "type": "SLOT",
  "script_path": "games/charge-slot/script.lua",
  "persistent_state": {
    "vars": ["charge_meter", "bonus_level"],
    "exposed_vars": ["charge_meter", "bonus_level"]
  },
  "bet_levels": [0.20, 1.00, 5.00],
  "actions": {
    "spin": {
      "stage": "base_game",
      "debit": "bet",
      "credit": "win",
      "transitions": [
        { "condition": "always", "next_actions": ["spin"] }
      ]
    }
  }
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `vars` | `string[]` | Имена числовых переменных (`state.variables.*`), сохраняемых между спинами. |
| `exposed_vars` | `string[]` | Подмножество `vars`, которое отдаётся клиенту в `data.persistent_state`. |

### Lua-скрипт

Скрипт работает с persistent state через стандартные `state.variables` — никаких специальных API:

```lua
function execute(state)
    -- Заряды загружены платформой из Redis → state.variables
    local charges = state.variables.charge_meter or 0
    local bonus_level = state.variables.bonus_level or 0

    -- ... основная логика спина ...
    -- Допустим, каждый спецсимвол на барабанах добавляет заряд
    charges = charges + special_symbol_count

    local bonus_triggered = false
    if charges >= 50 then
        bonus_triggered = true
        charges = 0        -- сброс после триггера
        bonus_level = bonus_level + 1
    end

    return {
        total_win = win,
        variables = {
            charge_meter = charges,       -- платформа сохранит обратно в Redis
            bonus_level = bonus_level,
        },
        -- клиентские данные
        matrix = matrix,
        charge_meter_triggered = bonus_triggered,
    }
end
```

### Что получает клиент

В `result.data` появляется поле `persistent_state` с текущими значениями объявленных `exposed_vars`:

```json
{
  "data": {
    "matrix": [[1,2,3],[4,5,6],[7,8,9]],
    "charge_meter_triggered": false,
    "persistent_state": {
      "charge_meter": 23,
      "bonus_level": 1
    }
  }
}
```

### Сложные данные (`_persist_game_` конвенция)

Для нечисловых данных (массивы, таблицы) используйте префикс `_persist_game_` в return-таблице Lua. Это аналог `_persist_` для сессий (§15.2), но сохраняется между спинами:

```lua
return {
    total_win = win,
    variables = { charge_meter = charges },
    _persist_game_collected_symbols = collected_symbols_array,
}
```

На следующем спине данные будут доступны через `state.params._ps_collected_symbols`.

> **Важно**: `_persist_game_*` ключи автоматически исключаются из истории и не попадают к клиенту.

### Порядок загрузки

1. Сначала загружается cross-spin persistent state → `state.variables`
2. Затем загружается сессионный state (если есть активная сессия) → **перезаписывает** совпадающие ключи

Это значит, что во время фриспинов сессионные переменные имеют приоритет, но накопительные метры базовой игры всё равно доступны (если не перезаписаны сессией).

### Сброс состояния

Администратор может сбросить persistent state через API:

```
DELETE /api/v1/admin/users/{userId}/games/{gameId}/persistent-state
```

Lua-скрипт также может сбросить значения самостоятельно (например, обнулить `charge_meter` после триггера бонуса).

### Отличия от сессионного `_persist_`

| | Сессионный `_persist_` (§15.2) | Cross-Spin `persistent_state` (§16) |
|---|---|---|
| Область жизни | Внутри одной сессии (фриспины, настольный раунд) | Между всеми базовыми спинами пользователя |
| TTL | Наследует TTL сессии | Без TTL (живёт вечно) |
| Хранение | В объекте `GameSession` | Отдельный ключ в Redis |
| Конфигурация | `session_config.persistent_vars` в transition | `persistent_state.vars` в корне конфига |
| Lua-префикс (сложные данные) | `_persist_*` | `_persist_game_*` |
| Восстановление в Lua | `state.params._ps_*` | `state.variables.*` (числа) / `state.params._ps_*` (сложные) |

---

## Связанная документация

- [game_engine_design.md](game_engine_design.md) — дизайн движка (техническая архитектура)
- [game_sdk_reference.md](game_sdk_reference.md) — полная документация клиентского SDK
- [game_bridge_protocol.md](game_bridge_protocol.md) — протокол postMessage
- [api_protocol.md](api_protocol.md) — REST API эндпоинты
- [architecture.md](architecture.md) — архитектура платформы
