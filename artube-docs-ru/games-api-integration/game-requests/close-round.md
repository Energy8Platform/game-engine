<!-- Source: https://docs.artube-888.live/ru/games-api-integration/game-requests/close-round/ -->

# CloseRound

## Обзор

Запрос `CloseRound` используется для завершения активного игрового раунда и финализации всех результатов. Это последний шаг в последовательности OpenRound → UpdateRoundState → CloseRound или OpenRound → CloseRound.

## Запрос (Request)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `CloseRoundRequest`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`    Operation Sequence 6
#### Payload

```
{
  "session_id": "12345678-1234-5678-9abc-123456789012",
  "round_id": "87654321-4321-8765-dcba-210987654321",
  "win_multiplier": 4,
  "status": "completed",
  "features": [
    {
      "type": "PlayedGamble"
    }
  ],
  "round_version": 1,
  "round_state_version": "1.3",
  "round_state": "{\"step\": 4, \"final_result\": \"completed\", \"total_win_multiplier\": 4.00}"
}
```

### Поля запроса

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `session_id` | string | обязательное | ID сессии (GUID) |
| `round_id` | string | обязательное | ID раунда (GUID) |
| `win_multiplier` | decimal | обязательное | Финальный множитель выигрыша (>= 0) |
| `status` | string | обязательное | Статус (“completed”, “cancelled”) |
| `features` | array | опциональное | Активированные игровые функции |
| `round_version` | int | обязательное | Номер версии раунда для изменения (присылается на основе предыдущего ответа сервера) |
| `round_state_version` | string | обязательное | Версия формата состояния |
| `round_state` | string | обязательное | JSON строка с финальным состоянием |

#### Валидация CloseRoundRequest

**Проверки обязательных полей:**

- `session_id`: Не пустой GUID
- `round_id`: Не пустой GUID
- `win_multiplier`: >= 0
- `status`: Не пустой
- `features`: Если указан, каждый элемент должен иметь непустой `type`, типы должны быть уникальными
- `round_version`: Присылается на основе предыдущего ответа сервера в UpdateRoundStateResponse
- `round_state_version`: Не пустой
- `round_state`: Не пустой

> Заметка
>
> **Персистирование `features` в CloseRound:** значение из `CloseRoundRequest` **мержится** поверх `features`, ранее переданных в `OpenRoundRequest`. Итоговый набор ключей = `open ∪ close`; при конфликте одного и того же `type` итоговое значение берётся из close. Если в `CloseRoundRequest` передан `null`/`[]` — это означает «без изменений», и ранее сохранённые open-фичи остаются как есть (полная очистка через `null`/`[]` больше не поддерживается — чтобы удалить/переопределить фичу, пришлите её явно с новым значением). Рекомендация для игры: на close возвращать полный набор `open` + `close` для наиболее явного контракта, хотя это не обязательно для целостности данных (merge выполняется на сервере).

## Ответ (Response)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `CloseRoundResponse`   Timestamp 1/1/2023, 12:00:01 AM        Message ID `response-close-round`   Correlation ID `01234567-89ab-cdef-0123-456789abcdef`   Operation Sequence 6
#### Payload

```
{
  "balance": 163.75,
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
| `balance` | decimal | обязательное | Финальный баланс после закрытия раунда |
| `win` | decimal | обязательное | Сумма выигрыша |
| `free_round_campaign_id` | string | опциональное | ID Кампании (GUID) |
| `is_platform_max_win_reached` | bool | обязательное | Достигнут ли платформенный максимальный выигрыш |

### Поля FreeRoundCampaign (free_round_campaign)

| Поле | Тип | Описание |
| --- | --- | --- |
| `rounds_left` | int | Кол-во оставшихся раундов |
| `total_win` | decimal | размер выигрыша |
| `is_complete` | bool | Флаг завершения Free Round Campaign |

## Связанные разделы

- **[OpenRound](open-round.md)** - начало раунда
- **[UpdateRoundState](update-round-state.md)** - промежуточные обновления
- **[FRC](../../features/free-rounds-campaign.md)** - обзор Free Round Campaign (FRC)
- **[Максимальный выигрыш](../../features/max-win.md)** - обзор максимального выигрыша платформы
