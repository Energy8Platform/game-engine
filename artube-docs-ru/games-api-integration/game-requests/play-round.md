<!-- Source: https://docs.artube-888.live/ru/games-api-integration/game-requests/play-round/ -->

# PlayRound

## Обзор

Запрос `PlayRound` используется для выполнения полного игрового раунда в одной операции. Подходит для простых игр без интерактивного взаимодействия, где весь результат раунда известен заранее.

> Совет
>
> Используйте PlayRound для слотов, рулетки, лотерей и других игр без пользовательского интерактива. Для сложных игр используйте [последовательность OpenRound → UpdateRoundState → CloseRound](../../integration-process/games-api/complex-round.md).

## Запрос (Request)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `PlayRoundRequest`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`    Operation Sequence 3
#### Payload

```
{
  "session_id": "12345678-1234-5678-9abc-123456789012",
  "price_multiplier": 2,
  "bet_index": 3,
  "win_multiplier": 5.5,
  "free_round_campaign_id": "uuid-string",
  "features": [
    {
      "type": "PlayedGamble",
      "description": "Gamble feature activated"
    }
  ],
  "previous_round_id": "12345678-1234-5678-9abc-123456789013",
  "round_state_version": "1.1",
  "round_state": "{\"step\": 2, \"result\": \"win\", \"symbols\": [[1,2,3],[4,5,6],[7,8,9]]}"
}
```

### Поля запроса

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `session_id` | string | обязательное | Идентификатор сессии (GUID формат) |
| `price_multiplier` | decimal | обязательное | Размер множителя ставки (>= 0) |
| `bet_index` | int | обязательное | Индекс ставки (>= 0) |
| `win_multiplier` | decimal | обязательное | Множитель выигрыша относительно ставки (>= 0) |
| `free_round_campaign_id` | string | опциональное | ID Кампании (GUID) |
| `features` | array | опциональное | Активированные игровые функции |
| `previous_round_id` | string | опциональное | ID предыдущего раунда для связи в цепочке (GUID) |
| `round_state_version` | string | обязательное | Версия формата состояния |
| `round_state` | string | обязательное | JSON строка с состоянием игры |

#### Валидация PlayRoundRequest

**Проверки обязательных полей:**

- `session_id`: Не пустой GUID
- `price_multiplier`: >= 0
- `bet_index`: >= 0
- `win_multiplier`: >= 0
- `features`: Если указан, каждый элемент должен иметь непустой `type`, типы должны быть уникальными
- `previous_round_id`: Если указан, должен быть валидным GUID
- `round_state_version`: Не пустой
- `round_state`: Не пустой

#### Feature Object

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `type` | string | обязательное | Тип функции (“PlayedGamble”, “BonusGame”, “Purchase”) |
| `description` | string | опциональное | Описание функции для отладки |

### Детальное описание полей

#### price_multiplier (множитель ставки)

- **Обычные раунды:** = 1 (базовая ставка, без доплаты)
- **Buy Feature / доплата:** > 1 (например, `3`, когда игрок платит ×3)
- **Бесплатные раунды:** = 0
- **Бонусные кампании:** = 0

Бекенд игры не считает деньги — он присылает только `bet_index` и `price_multiplier`, а сумму BET вычисляет gamesapi. Каноническая формула описана в **[Транзакционной модели](../../integration-process/games-api/transaction-model.md#%D1%80%D0%B0%D1%81%D1%87%D1%91%D1%82-%D1%81%D1%83%D0%BC%D0%BC%D1%8B-%D1%81%D1%82%D0%B0%D0%B2%D0%BA%D0%B8)**.

#### bet_index

Индекс из массива `allowed_bets` полученного в [`SessionInfo`](session-info.md):

- 0 - минимальная ставка
- 1 - вторая по размеру ставка
- и т.д.

Игра передаёт **индекс**, а не само значение ставки. Сумма ставки равна `price_multiplier * allowed_bets[bet_index]`.

**Пример** при `allowed_bets: [0.1, 0.5, 1, 2, 5]`:

- `bet_index: 2` → базовая ставка `1`; при `price_multiplier: 1` сумма BET равна `1`.
- `bet_index: 2` + `price_multiplier: 3` (Buy Feature) → сумма BET равна `3`.

#### win_multiplier

- **Проигрыш:** 0
- **Выигрыш:** множитель > 0
- **Джекпот:** большой множитель выигрыша

#### round_state

JSON строка с деталями игры:

```json
{
  "step": 2,
  "result": "win",
  "symbols": [[1,2,3],[4,5,6],[7,8,9]],
  "winning_lines": [1, 5, 9],
  "multiplier": 2.5,
  "bonus_triggered": false
}
```

## Ответ (Response)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `PlayRoundResponse`   Timestamp 1/1/2023, 12:00:01 AM        Message ID `response-play-round`   Correlation ID `01234567-89ab-cdef-0123-456789abcdef`   Operation Sequence 3
#### Payload

```
{
  "round_id": "87654321-4321-8765-dcba-210987654321",
  "balance": 153.75,
  "win": 15,
  "free_round_campaign": {
    "rounds_left": 5,
    "total_win": 10,
    "is_complete": false
  },
  "is_platform_max_win_reached": false
}
```

### Поля ответа

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `round_id` | string | обязательное | Уникальный ID раунда (GUID) |
| `balance` | decimal | обязательное | Новый баланс после операции |
| `win` | decimal | обязательное | Сумма выигрыша |
| `free_round_campaign_id` | string | опциональное | ID Кампании (GUID) |
| `is_platform_max_win_reached` | bool | обязательное | Достигнут ли платформенный максимальный выигрыш |

### Поля FreeRoundCampaign (free_round_campaign)

| Поле | Тип | Описание |
| --- | --- | --- |
| `rounds_left` | int | Кол-во оставшихся раундов |
| `total_win` | decimal | рамзмер выигрыша |
| `is_complete` | bool | флаг завершенностиФри Раунд Кампании |

> Осторожно
>
> Всегда валидируйте результаты игры на сервере перед отправкой PlayRound. Никогда не доверяйте данным с клиента.

## Связанные разделы

- **[Простой раунд](../../integration-process/games-api/simple-round.md)** - концепция и примеры использования
- **[SessionInfo](session-info.md)** - получение настроек для bet_index
- **[Транзакционная модель](../../integration-process/games-api/transaction-model.md)** - принципы работы с деньгами
- **[FRC](../../features/free-rounds-campaign.md)** - обзор Free Round Campaign (FRC)
- **[Цепочка раундов](../examples/round-chain-examples.md)** - обзор цепочки раундов
- **[Максимальный выигрыш](../../features/max-win.md)** - обзор максимального выигрыша платформы
