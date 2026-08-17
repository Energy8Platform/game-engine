<!-- Source: https://docs.artube-888.live/ru/integration-process/games-api/simple-round/request-structure/ -->

# Структура запроса PlayRound

## Структура запроса PlayRound

### Формат запроса

```json
{
  "proto": 1,
  "schema": 1,
  "chan": "rpc",
  "type": "PlayRoundRequest",
  "id": "01234567-89ab-cdef-0123-456789abcdef",
  "corr_id": "01234567-89ab-cdef-0123-456789abcdef",
  "op_seq": 12345,
  "timestamp": "2023-01-01T00:00:00.000Z",
  "trace": {
    "traceparent": "00-12345678901234567890123456789012-1234567890123456-01",
    "tracestate": "key1=value1,key2=value2",
    "baggage": "userId=123,sessionId=abc"
  },
  "payload": {
    "session_id": "12345678-1234-5678-9abc-123456789012",
    "price_multiplier": 2.00,
    "bet_index": 3,
    "win_multiplier": 5.50,
    "features": [
      {
        "type": "PlayedGamble"
      }
    ],
    "round_state_version": "1.1",
    "round_state": "{\"step\": 2, \"result\": \"win\", \"symbols\": [[1,2,3],[4,5,6],[7,8,9]]}"
  }
}
```

### Описание полей payload

| Поле | Тип | Обязательное | Описание |
| --- | --- | --- | --- |
| `session_id` | string | ✅ | ID сессии (GUID) |
| `price_multiplier` | decimal | ✅ | Размер множителя ставки (>= 0) |
| `bet_index` | int | ✅ | Индекс ставки (>= 0) |
| `win_multiplier` | decimal | ✅ | Множитель выигрыша относительно ставки (>= 0) |
| `features` | array | ❌ | Активированные игровые функции |
| `round_state_version` | string | ✅ | Версия формата состояния |
| `round_state` | string | ✅ | Строка с состоянием |

### Объект features (элемент)

| Поле | Тип | Обязательное | Описание |
| --- | --- | --- | --- |
| `type` | string | ✅ | Тип игровой функции (“PlayedGamble”, “BonusGame”, “Purchase”) |
| `description` | string | ❌ | Описание функции для отладки |

### Формат ответа

```json
{
  "proto": 1,
  "schema": 1,
  "chan": "rpc",
  "type": "PlayRoundResponse",
  "id": "01234567-89ab-cdef-0123-456789abcdef",
  "corr_id": "01234567-89ab-cdef-0123-456789abcdef",
  "op_seq": 12345,
  "timestamp": "2023-01-01T00:00:00.000Z",
  "trace": {
    "traceparent": "00-12345678901234567890123456789012-1234567890123456-01",
    "tracestate": "key1=value1,key2=value2",
    "baggage": "userId=123,sessionId=abc"
  },
  "payload": {
    "round_id": "87654321-4321-8765-dcba-210987654321",
    "balance": 153.75,
  }
}
```

### Описание полей ответа

| Поле | Тип | Описание |
| --- | --- | --- |
| `round_id` | string | ID раунда (GUID) |
| `balance` | decimal | Новый баланс после начисления выигрыша |

## Валидация запроса

### Обязательная валидация

**Проверки обязательных полей:**

- `session_id`: Не пустой GUID
- `price_multiplier`: >= 0
- `bet_index`: >= 0
- `win_multiplier`: >= 0
- `features`: Если указан, каждый элемент должен иметь непустой `type`, типы должны быть уникальными
- `round_state_version`: Не пустой
- `round_state`: Не пустой

**Логические проверки:**

- `round_state` должен быть валидной JSON строкой
- Все числовые поля должны иметь корректный формат
- `features` типы должны быть из списка: “PlayedGamble”, “BonusGame”, “Purchase”, “FreeSpins”
- Значение `features` может быть произвольным, если оно отсутствует в предопределённом списке

### Бизнес-логика валидации

**Проверки размера множителя:**

- `price_multiplier` должен быть положительным числом
- Множитель должен соответствовать доступным уровням игры
- Проверка консистентности с `bet_index`

**Проверки выигрыша:**

- `win_multiplier` не должен превышать максимальный для игры
- Защита от аномально высоких выплат
- Валидация относительно базовой ставки

**Проверки индекса ставки:**

- `bet_index` должен соответствовать множителю ставки
- Проверка по таблице allowed_bets из game_settings
- Валидация консистентности между полями

## Форматы round_state

### Слоты

```json
{
  "reels": [
    ["7", "7", "7"],
    ["BAR", "BAR", "CHERRY"],
    ["LEMON", "BELL", "7"]
  ],
  "winning_lines": [1, 5, 9],
  "line_wins": [
    {
      "line": 1,
      "symbols": "777",
      "count": 3,
      "multiplier": 5.0,
      "win_multiplier": 25.00
    }
  ],
  "total_win": 25.00,
  "bonus_triggered": false,
  "scatter_count": 0
}
```

### Рулетка

```json
{
  "winning_number": 18,
  "bets": [
    {
      "type": "red",
      "amount": 10.00,
      "won": true,
      "payout": 20.00
    },
    {
      "type": "straight",
      "number": 7,
      "amount": 1.00,
      "won": false,
      "payout": 0
    }
  ],
  "total_bet": 11.00,
  "total_win": 20.00
}
```

### Лотерея

```json
{
  "ticket_numbers": [5, 12, 23, 31, 42, 49],
  "drawn_numbers": [7, 12, 23, 31, 42, 50],
  "matches": {
    "count": 4,
    "numbers": [12, 23, 31, 42]
  },
  "win_tier": "tier_4",
  "jackpot_won": false,
  "payout_multiplier": 50
}
```

> Заметка
>
> **Важно:** Структура `round_state` должна содержать всю информацию, необходимую для воспроизведения и верификации результата раунда.

## Связанные разделы

- **[Примеры игр](game-examples.md)** - конкретные реализации
