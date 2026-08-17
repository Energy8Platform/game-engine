<!-- Source: https://docs.artube-888.live/ru/integration-process/games-api/general-flow/error-handling/ -->

# Обработка ошибок в общем потоке

## Типы ошибок в потоке

### Сетевые ошибки

```json
{
  "code": "InternalServerError",
  "message": "The operation has timed out.",
  "details": {}
}
```

### Ошибки валидации

```json
{
  "code": "BadRequest",
  "message": "empty envelope",
  "details": {}
}
```

### Ошибки состояния

```json
{
  "code": "InvalidRoundOperation",
  "message": "No active round to operate.",
  "details": {}
}
```

> Совет
>
> Используйте circuit breaker для предотвращения каскадных отказов при проблемах с API.

## Связанные разделы

- **[Установление соединения](connection.md)** - обработка ошибок подключения
- **[Игровые сессии](sessions.md)** - управление сессиями
- **[Обработка ошибок API](../../../games-api-integration/protocol/error-handling.md)** - детали протокола
