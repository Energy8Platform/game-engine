<!-- Source: https://docs.artube-888.live/ru/games-api-integration/control-requests/hello/ -->

# Hello

## Обзор

Сообщение `Hello` - это первое сообщение, отправляемое клиентом (игрой) серверу (Artube Games API) для согласования параметров протокола.

     Protocol `1`   Schema `1`   Channel `control`   Type `Hello`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`    Operation Sequence 1
#### Payload

```
{
  "supports": {
    "max_schema": 1
  }
}
```

## Структура запроса

### Поля запроса

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `supports` | object | обязательное | Поддерживаемые версии протокола |

#### Объект supports (Schema V1)

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `max_schema` | int | обязательное | Максимальная версия схемы |

## Schema V2 — версионирование контрактов

При использовании Schema V2 клиент дополнительно объявляет поддерживаемые диапазоны версий для каждого типа контракта:

     Protocol `1`   Schema `2`   Channel `control`   Type `Hello`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`    Operation Sequence 1
#### Payload

```
{
  "supports": {
    "max_schema": 2,
    "contracts": {
      "PlayRoundRequest": {
        "min": 1,
        "max": 1
      },
      "PlayRoundResponse": {
        "min": 1,
        "max": 1
      },
      "OpenRoundRequest": {
        "min": 1,
        "max": 1
      },
      "OpenRoundResponse": {
        "min": 1,
        "max": 1
      },
      "CloseRoundRequest": {
        "min": 1,
        "max": 1
      },
      "CloseRoundResponse": {
        "min": 1,
        "max": 1
      },
      "SessionInfoRequest": {
        "min": 1,
        "max": 1
      },
      "SessionInfoResponse": {
        "min": 1,
        "max": 1
      }
    },
    "features": []
  }
}
```

### Дополнительные поля supports (Schema V2)

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `contracts` | object | опциональное | Диапазоны поддерживаемых версий контрактов (только при `max_schema` ≥ 2) |
| `features` | array | опциональное | Поддерживаемые функции |

#### Элемент contracts

| Поле | Тип | Описание |
| --- | --- | --- |
| `min` | int | Минимальная поддерживаемая версия контракта |
| `max` | int | Максимальная поддерживаемая версия контракта |

> Осторожно
>
>   Запрос отправляется бэкендом игры. Games API отводит 5 секунд на получение и валидацию `Hello`, после чего соединение принимается в пул соединений (отдельный ответ не отправляется). Если к этому моменту не будет Hello, тогда Games API посчитает, что игра будет использовать актуальную `max_schema`

## Связанные разделы

- **[Welcome](welcome.md)** - ответ сервера на Hello
- **[GoAway](goaway.md)** - корректное отключение
- **[Как подключиться](../examples/how-to-connect.md)** - полное руководство по подключению
