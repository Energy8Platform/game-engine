<!-- Source: https://docs.artube-888.live/ru/games-api-integration/game-requests/update-round-state/ -->

# UpdateRoundState

## Обзор

Запрос `UpdateRoundState` используется для обновления состояния активного раунда во время интерактивной игры. Позволяет передавать промежуточные изменения состояния без завершения раунда.

## Запрос (Request)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `UpdateRoundStateRequest`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`    Operation Sequence 5
#### Payload

```
{
  "session_id": "12345678-1234-5678-9abc-123456789012",
  "round_id": "87654321-4321-8765-dcba-210987654321",
  "round_version": 0,
  "round_state_version": "1.2",
  "round_state": "{\"step\": 3, \"freespins_remaining\": 2, \"current_spin\": 8}"
}
```

### Поля запроса

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `session_id` | string | обязательное | ID сессии (GUID) |
| `round_id` | string | обязательное | ID раунда (GUID) |
| `round_version` | int | обязательное | Номер версии раунда для изменения (присылается на основе предыдущего ответа сервера) |
| `round_state_version` | string | обязательное | Версия формата состояния |
| `round_state` | string | обязательное | JSON строка с обновленным состоянием |

#### Валидация UpdateRoundStateRequest

**Проверки обязательных полей:**

- `session_id`: Не пустой GUID
- `round_id`: Не пустой GUID
- `round_state_version`: Не пустой
- `round_state`: Не пустой

## Ответ (Response)

     Protocol `1`   Schema `1`   Channel `rpc`   Type `UpdateRoundStateResponse`   Timestamp 1/1/2023, 12:00:01 AM        Message ID `response-update-state`   Correlation ID `01234567-89ab-cdef-0123-456789abcdef`   Operation Sequence 5
#### Payload

```
{
  "round_version": 1
}
```

### Поля ответа

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `round_version` | int | обязательное | Последовательный номер операции с раундом |

## Связанные разделы

- **[OpenRound](open-round.md)** - начало раунда
- **[CloseRound](close-round.md)** - завершение раунда
