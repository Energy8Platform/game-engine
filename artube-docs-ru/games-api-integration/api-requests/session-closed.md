<!-- Source: https://docs.artube-888.live/ru/games-api-integration/api-requests/session-closed/ -->

# SessionClosedEvent

## Обзор

Событие `SessionClosedEvent` отправляется сервером клиенту для уведомления о закрытии игровой сессии.

## Событие от сервера

     Protocol `1`   Schema `1`   Channel `events`   Type `SessionClosedEvent`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`    Operation Sequence 101
#### Payload

```
{
  "session_id": "12345678-1234-5678-9abc-123456789012",
  "reason": "timeout"
}
```

### Поля события

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `session_id` | string | обязательное | ID сессии (GUID) |
| `reason` | string | обязательное | Причина закрытия (“timeout”, “logout”, “error”, “maintenance”) |

## Возможные причины закрытия

| Причина | Описание |
| --- | --- |
| `timeout` | Таймаут сессии |
| `logout` | Выход пользователя |
| `error` | Ошибка системы |
| `maintenance` | Техническое обслуживание |

## Пример обработки

**Обработка закрытия сессии:**

- Извлечение ID сессии и причины закрытия
- Логирование события закрытия сессии с указанием причины
- Перенаправление в лобби или на главную страницу
- Очистка локального состояния сессии
