<!-- Source: https://docs.artube-888.live/ru/games-api-integration/protocol/error-responses/ -->

# Error Responses

## Обзор

Все ошибки в Games API возвращаются в стандартном формате через RPC канал с типом `Error`. Ошибки содержат код, сообщение и дополнительные детали для диагностики.

## Структура ошибки

     Protocol `1`   Schema `1`   Channel `rpc`   Type `Error`   Timestamp 1/1/2023, 12:00:01 AM        Message ID `error-response-id`   Correlation ID `01234567-89ab-cdef-0123-456789abcdef`   Operation Sequence 3
#### Payload

```
{
  "code": "SessionInvalid",
  "message": "The session is invalid or cannot be retrieved",
  "details": {}
}
```

### Поля ошибки

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `code` | string | обязательное | Код ошибки |
| `message` | string | обязательное | Человекочитаемое описание ошибки |
| `details` | object | опциональное | Дополнительная информация об ошибке |
| `details.retry_after_ms` | number | Рекомендуемая задержка перед повторной попыткой в миллисекундах |  |

#### Пример с `details.retry_after_ms`

```json
{
  "code": "BackPressureRejected",
  "message": "Concurrency limit acquisition failed.",
  "details": {
    "retry_after_ms": 5000
  }
}
```

## Коды ошибок

### Ошибки сессии

| Код | Описание | Действие |
| --- | --- | --- |
| `SessionInvalid` | Недействительная сессия | Переподключиться |
| `SessionIsNotInitialized` | Сессия не проинициализирована | Вызвать SessionInfoRequest первым RPC запросом |

### Ошибки игры

| Код | Описание | Действие |
| --- | --- | --- |
| `BadRequest` | Невалидный запрос | Проверить правильность запроса |
| `InvalidOperationSequence` | Неверная последовательность сообщений | Исправить запрос |
| `TransactionFailed` | Не удалось произвести транзакцию | Уведомить игрока |
| `InsufficientFunds` | Недостаточно средств | Уведомить игрока |
| `FrcNotFound` | FRC не найдена | Исправить запрос |
| `FrcAlreadyCompleted` | FRC завершена | Исправить запрос |
| `OperationNotAllowed` | Данная операция не разрешена. Подробности в сообщении | Исправить запрос |

### Ошибки валидации

| Код | Описание | Действие |
| --- | --- | --- |
| `InvalidRoundOperation` | Неверная операция над “сложным” раундом | Произвести правильную последовательность запросов Open - Update - Close |

### Системные ошибки

| Код | Описание | Действие |
| --- | --- | --- |
| `InternalServerError` | Внутренняя ошибка | Повторить позже |
| `BackPressureRejected` | Превышен лимит | Снизить частоту |

### Региональные ошибки

| Код | Описание | Действие |
| --- | --- | --- |
| `RegionNotSupported` | Недоступный регион | Изменить регион |

## Примеры ошибок

### Недостаточный баланс

```json
{
  "code": "InsufficientFunds",
  "message": "Unable to process the transaction for the round.",
  "details": {}
}
```

### Ошибка валидации

```json
{
  "code": "BadRequest",
  "message": "invalid json",
  "details": {}
}
```

### Неверная последовательность над раундом

```json
{
  "code": "InvalidRoundOperation",
  "message": "Round is already opened.",
  "details": {}
}
```

## Обработка ошибок

> Осторожно
>
> Всегда проверяйте тип сообщения перед обработкой. Ошибки приходят с типом `Error` вместо ожидаемого ответа.

### Рекомендации по обработке

1. **Логирование**: Всегда логируйте ошибки с полным контекстом
2. **Логика повторных запросов**: Для системных ошибок используйте exponential backoff
3. **Пользовательский интерфейс**: Показывайте понятные сообщения игрокам
4. **Мониторинг**: Отслеживайте частоту различных типов ошибок

### Пример обработки в коде

```typescript
function handleResponse(message: GamesAPIMessage) {
  if (message.type === 'Error') {
    const error = message.payload;

    switch (error.code) {
      case 'SessionInvalid':
        // Переподключиться
        reconnectToAPI();
        break;

      case 'TransactionFailed':
        // Обновить UI
        showBalanceError(error.details.current_balance);
        break;

      case 'InternalServerError':
        // Повторить с задержкой
        retryAfterDelay(message.corr_id);
        break;

      default:
        // Логировать неизвестную ошибку
        console.error('Unknown error:', error);
    }
  }
}
```

## Связанные разделы

- **[Конверт](envelope.md)** - структура сообщений
- **[Обработка ошибок](error-handling.md)** - стратегии обработки
- **[Версионирование](versioning.md)** - совместимость версий
