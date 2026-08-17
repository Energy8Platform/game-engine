<!-- Source: https://docs.artube-888.live/ru/games-api-integration/game-requests/autoclose-round/ -->

# AutocloseRoundRequest

## Обзор

Запрос `AutocloseRoundRequest` используется для автозакрытия активного игрового раунда и финализации всех результатов. Этот запрос должен быть инициирован сервером игры в ответ на событие `AutocloseRequestEvent`, отправляемое Games API. Цель запроса — обеспечить корректное завершение раунда, обновление баланса игрока. Запрос содержит информацию о финальном состоянии раунда, включая итоговый множитель выигрыша, статус раунда и любые активированные функции. Ответ на запрос включает обновленный баланс игрока и, при необходимости, детали о кампании бесплатных раундов.

## Запрос (Request)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `AutocloseRoundRequest`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`    Operation Sequence 6
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
> **Персистирование `features` в Autoclose:** значение из `AutocloseRoundRequest` **мержится** поверх `features`, ранее переданных в `OpenRoundRequest`. Итоговый набор ключей = `open ∪ close`; при конфликте одного и того же `type` итоговое значение берётся из autoclose. Если передан `null`/`[]` — это означает «без изменений», ранее сохранённые open-фичи остаются как есть. Рекомендация для игры: возвращать полный набор `open` + `close` для наиболее явного контракта.

## Ответ (Response)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `CloseRoundResponse`   Timestamp 1/1/2023, 12:00:01 AM        Message ID `response-close-round`   Correlation ID `01234567-89ab-cdef-0123-456789abcdef`   Operation Sequence 6
#### Payload

```
{
  "balance": 163.75
}
```

### Поля ответа

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `balance` | decimal | обязательное | Финальный баланс после закрытия раунда |

## Связанные разделы

- **[Aoutoclose](../../features/autoclose.md)** - Autoclose
- **[AutocloseRequestEvent](../api-requests/autoclose-request-event.md)** - Событие запроса на автозакрытие раунда
