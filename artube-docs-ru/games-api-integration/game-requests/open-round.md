<!-- Source: https://docs.artube-888.live/ru/games-api-integration/game-requests/open-round/ -->

# OpenRound

## Обзор

Запрос `OpenRound` используется для начала нового игрового раунда в интерактивных играх. Это первый шаг в последовательности OpenRound → UpdateRoundState → CloseRound для игр, требующих пользовательского взаимодействия.

> Совет
>
> Используйте OpenRound для покера, блэкджека, интерактивных слотов и других игр с пользовательским выбором. Для простых игр используйте [PlayRound](play-round.md).

## Запрос (Request)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `OpenRoundRequest`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`    Operation Sequence 4
#### Payload

```
{
  "session_id": "12345678-1234-5678-9abc-123456789012",
  "price_multiplier": 1.5,
  "bet_index": 2,
  "free_round_campaign_id": "uuid-string",
  "previous_round_id": "12345678-1234-5678-9abc-123456789013",
  "round_state_version": "1.0",
  "round_state": "{\"step\": 1, \"reels\": [1,2,3,4,5], \"bet_level\": 2}"
}
```

### Поля запроса

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `session_id` | string | обязательное | Идентификатор сессии (GUID формат) |
| `price_multiplier` | decimal | обязательное | Множитель размера ставки (> 0) |
| `bet_index` | int | обязательное | Индекс ставки из allowed_bets (>= 0) |
| `free_round_campaign_id` | string | опциональное | ID кампании (GUID) |
| `previous_round_id` | string | опциональное | ID предыдущего раунда для связи в цепочке (GUID) |
| `round_state_version` | string | обязательное | Версия формата состояния |
| `round_state` | string | обязательное | JSON строка с игровым состоянием |

#### Валидация OpenRoundRequest

**Проверки обязательных полей:**

- `session_id`: Не пустой GUID
- `price_multiplier`: > 0
- `bet_index`: >= 0
- `round_state_version`: Не пустой
- `previous_round_id`: Если указан, должен быть валидным GUID
- `round_state`: Не пустой

### Особенности полей для OpenRound

#### price_multiplier (множитель ставки)

- Списывается с баланса игрока при открытии раунда
- Для обычного раунда = 1; > 1 только при доплате (например, Buy Feature); для бесплатных раундов = 0
- Игра присылает `bet_index` + `price_multiplier`, **а не** значение ставки — сумму BET вычисляет gamesapi

Сложный раунд использует ту же модель ставок, что и простой. Сумма ставки равна `price_multiplier * allowed_bets[bet_index]`; каноническая формула и примеры описаны в **[Транзакционной модели](../../integration-process/games-api/transaction-model.md#%D1%80%D0%B0%D1%81%D1%87%D1%91%D1%82-%D1%81%D1%83%D0%BC%D0%BC%D1%8B-%D1%81%D1%82%D0%B0%D0%B2%D0%BA%D0%B8)** (`allowed_bets` описан в **[SessionInfo](session-info.md)**).

#### round_state (начальное состояние)

Содержит информацию о начальном состоянии игры:

```json
{
  "step": 1,
  "game_phase": "initial_deal",
  "bet_amount": 1.50,
  "player_actions_available": ["deal"],
  "cards_dealt": false
}
```

## Ответ (Response)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `OpenRoundResponse`   Timestamp 1/1/2023, 12:00:01 AM        Message ID `response-open-round`   Correlation ID `01234567-89ab-cdef-0123-456789abcdef`   Operation Sequence 4
#### Payload

```
{
  "round_version": 0,
  "round_id": "87654321-4321-8765-dcba-210987654321",
  "balance": 148.25
}
```

### Поля ответа

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `round_version` | int | обязательное | Номер версии раунда |
| `round_id` | string | обязательное | ID созданного раунда (GUID) |
| `balance` | decimal | обязательное | Новый баланс после списания ставки |

## Примеры использования

> Осторожно
>
> После успешного выполнения OpenRound обязательно сохраните `round_id` для последующих операций UpdateRoundState и CloseRound.

## Связанные разделы

- **[UpdateRoundState](update-round-state.md)** - обновление состояния раунда
- **[CloseRound](close-round.md)** - завершение раунда
- **[Сложный раунд](../../integration-process/games-api/complex-round.md)** - концепция и примеры
- **[FRC](../../features/free-rounds-campaign.md)** - обзор Free Round Campaign (FRC)
- **[Цепочка раундов](../examples/round-chain-examples.md)** - обзор цепочки раундов
