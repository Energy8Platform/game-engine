<!-- Source: https://docs.artube-888.live/ru/games-api-integration/protocol/error-handling/ -->

# Обработка ошибок

## Обзор обработки ошибок

Artube Games API использует структурированный подход к обработке ошибок, обеспечивая надежную и предсказуемую работу игр. Все ошибки классифицируются по типам и содержат достаточную информацию для диагностики и восстановления.

## Структура ошибки

### Формат сообщения об ошибке

```json
{
  "proto": 1,
  "schema": 1,
  "chan": "rpc",
  "type": "Error",
  "id": "error-response-id",
  "corr_id": "original-request-id",
  "op_seq": 123,
  "timestamp": "2023-10-28T12:00:00.000Z",
  "payload": {
    "code": "SessionInvalid",
    "message": "The session is invalid or cannot be retrieved",
    "details": {}
  }
}
```

### Поля ошибки

| Поле | Тип | Описание |
| --- | --- | --- |
| `code` | string | Код ошибки для программной обработки |
| `message` | string | Человекочитаемое описание ошибки |
| `details` | object | Дополнительная информация об ошибке |
| `details.retry_after_ms` | number | Задержка перед повторной попыткой в миллисекундах |

## Классификация ошибок

### 🔴 Критические ошибки (не подлежащие восстановлению)

#### RegionNotSupported

```json
{
  "code": "RegionNotSupported",
  "message": "You may not have access in your country",
  "details": {}
}
```

### 🟡 Временные ошибки (восстанавливаемые)

#### BackPressureRejected

```json
{
  "code": "BackPressureRejected",
  "message": "Concurrency limit acquisition failed.",
  "details": {
    "retry_after_ms": 5000
  }
}
```

#### SessionInvalid

```json
{
  "code": "SessionInvalid",
  "message": "The session is invalid or cannot be retrieved",
  "details": {}
}
```

#### SessionIsNotInitialized

```json
{
  "code": "SessionIsNotInitialized",
  "message": "Call SessionInfoRequest first.",
  "details": {}
}
```

### 🔵 Системные ошибки

#### InternalServerError

```json
{
  "code": "InternalServerError",
  "message": "Failed to process the request.",
  "details": {}
}
```

### 🟣 Ошибки бизнес-логики

#### BadRequest

```json
{
  "code": "BadRequest",
  "message": "invalid json",
  "details": {}
}
```

#### TransactionFailed

```json
{
  "code": "TransactionFailed",
  "message": "Unable to process the transaction for the round.",
  "details": {}
}
```

#### InsufficientFunds

```json
{
  "code": "InsufficientFunds",
  "message": "Unable to process the transaction for the round.",
  "details": {}
}
```

#### InvalidRoundOperation

```json
{
  "code": "InvalidRoundOperation",
  "message": "Round is already opened.",
  "details": {}
}
```

```json
{
  "code": "InvalidRoundOperation",
  "message": "Invalid round version to update.",
  "details": {}
}
```

```json
{
  "code": "InvalidRoundOperation",
  "message": "Invalid specified round.",
  "details": {}
}
```

```json
{
  "code": "InvalidRoundOperation",
  "message": "Specified round is not active.",
  "details": {}
}
```

```json
{
  "code": "InvalidRoundOperation",
  "message": "Round version is invalid.",
  "details": {}
}
```

#### InvalidOperationSequence

```json
{
  "code": "InvalidOperationSequence",
  "message": "Expected operation sequence 145, got 234.",
  "details": {}
}
```

#### FrcNotFound

```json
{
  "code": "FrcNotFound",
  "message": "No such campaign available for this session.",
  "details": {}
}
```

#### FrcAlreadyCompleted

```json
{
  "code": "FrcAlreadyCompleted",
  "message": "Campaign was already completed.",
  "details": {}
}
```

#### OperationNotAllowed

```json
{
  "code": "OperationNotAllowed",
  "message": "Operation {NameOfOperation} is not allowed for a demo user.",
  "details": {}
}
```

> Осторожно
>
> Не все ошибки допускают повторный запрос. Для ошибки `BackPressureRejected` используйте значение `details.retry_after_ms` как задержку перед повторной попыткой. Для остальных ошибок повторный запрос не поможет — требуется диагностика причины.

## Связанные разделы

- **[Конверт](envelope.md)** - структура сообщений об ошибках
- **[Сериализация](serialization.md)** - форматы данных ошибок
- **[Как подключиться](../examples/how-to-connect.md)** - практические примеры обработки ошибок
