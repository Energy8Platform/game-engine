<!-- Source: https://docs.artube-888.live/ru/games-api-integration/control-requests/welcome/ -->

# Welcome

## Обзор

Сообщение `Welcome` - это уведомление для сервера игры, позволяющее проверить `max_schema` на стороне бэкенда игры. Отправляется максимум в течение 5 секунд после успешной инициализации WS соединения.

     Protocol `1`   Schema `1`   Channel `control`   Type `Welcome`   Timestamp 1/1/2023, 12:00:01 AM        Message ID `welcome-response-id`   Correlation ID `01234567-89ab-cdef-0123-456789abcdef`   Operation Sequence 1
#### Payload

```
{
  "use": {
    "max_schema": 1
  }
}
```

## Структура ответа

### Поля ответа

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `use` | object | обязательное | Согласованные параметры протокола |

#### Объект use (Schema V1)

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `max_schema` | int | обязательное | Версия схемы, которую будет использовать сервер |

## Schema V2 — версионирование контрактов

При использовании Schema V2 сервер возвращает согласованные версии контрактов для данного соединения:

     Protocol `1`   Schema `2`   Channel `control`   Type `Welcome`   Timestamp 1/1/2023, 12:00:01 AM        Message ID `welcome-response-id`   Correlation ID `01234567-89ab-cdef-0123-456789abcdef`   Operation Sequence 1
#### Payload

```
{
  "use": {
    "max_schema": 2,
    "contracts": {
      "PlayRoundRequest": 1,
      "PlayRoundResponse": 1,
      "OpenRoundRequest": 1,
      "OpenRoundResponse": 1,
      "CloseRoundRequest": 1,
      "CloseRoundResponse": 1,
      "SessionInfoRequest": 1,
      "SessionInfoResponse": 1
    },
    "features": []
  }
}
```

### Дополнительные поля use (Schema V2)

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `contracts` | object | опциональное | Выбранные версии контрактов для данного соединения (только при `max_schema` ≥ 2) |
| `features` | array | опциональное | Активированные функции |

#### Объект contracts

Словарь `"ТипКонтракта": версия`, где версия — целое число, выбранное сервером из пересечения диапазонов клиента и сервера.

## Полный пример Welcome

```json
{
  "proto": 1,
  "schema": 1,
  "chan": "control",
  "type": "Welcome",
  "id": "welcome-12345",
  "corr_id": "",
  "op_seq": 1,
  "timestamp": "2023-10-28T12:00:01.000Z",
  "payload": {
    "use": {
      "max_schema": 1
    }
  }
}
```

## Связанные разделы

- **[Hello](hello.md)** - инициация соединения
- **[GoAway](goaway.md)** - корректное отключение
- **[Версионирование](../protocol/versioning.md)** - согласование версий протокола
