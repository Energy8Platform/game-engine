<!-- Source: https://docs.artube-888.live/ru/games-api-integration/protocol/envelope/ -->

# Конверт

## Обзор

Базовый конверт для всех сообщений в Artube Games API. Конверт обеспечивает стандартизированную структуру для всех типов сообщений между игрой и платформой, включая метаданные для трейсинга, аутентификации и управления версиями.

     Protocol `1`   Schema `1`   Channel `rpc`   Type `SessionInfoRequest`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`   Correlation ID `01234567-89ab-cdef-0123-456789abcdef`   Operation Sequence 12345
#### Payload

```
{
  "session_id": "12345678-1234-5678-9abc-123456789012",
  "player_connection_info": {
    "ip_address": "192.168.1.100",
    "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
  }
}
```

#### Trace Information

```
{
  "traceparent": "00-12345678901234567890123456789012-1234567890123456-01",
  "tracestate": "key1=value1,key2=value2",
  "baggage": "userId=123,sessionId=abc"
}
```

## Структура конверта

### Основные поля

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `proto` | int | обязательное | Версия протокола (major version) - всегда 1 |
| `schema` | int | обязательное | Версия схемы для данного типа сообщения - всегда 1 |
| `chan` | enum | обязательное | Канал сообщения: `rpc` \| `events` \| `control` |
| `type` | string | обязательное | Имя типа сообщения |
| `id` | string | обязательное | Уникальный идентификатор сообщения (GUID v7) |
| `corr_id` | string | опциональное | Correlation ID для пар request-response |
| `op_seq` | long | обязательное | Порядковый номер операции в контексте соединения |
| `timestamp` | string | обязательное | Временная метка сообщения в формате ISO 8601 |
| `trace` | object | опциональное | Trace context для отладки |
| `payload` | object | обязательное | Полезная нагрузка, специфичная для сообщения |

### Подробное описание полей

#### Версионирование

- **`proto`** - мажорная версия протокола. Изменяется при несовместимых изменениях.
- **`schema`** - версия схемы конкретного типа сообщения. Позволяет эволюцию отдельных контрактов

#### Каналы сообщений

- **`rpc`** - сообщения типа запрос–ответ (игровые операции)
- **`events`** - односторонние уведомления от API
- **`control`** - управляющие сообщения (соединение, отключение)

#### Идентификация

- **`id`** - уникальный ID сообщения, используется для дедупликации
- **`corr_id`** - связывает ответ с исходным запросом
- **`op_seq`** - порядковый номер для обеспечения корректного порядка обработки

#### Трейсинг

```json
{
  "trace": {
    "traceparent": "00-12345678901234567890123456789012-1234567890123456-01",
    "tracestate": "key1=value1,key2=value2",
    "baggage": "userId=123,sessionId=abc"
  }
}
```

## Типы сообщений по каналам

### RPC канал

Используется для игровых операций типа запрос-ответ:

```json
{
  "chan": "rpc",
  "type": "SessionInfoRequest",
  "payload": {
    "session_id": "12345678-1234-5678-9abc-123456789012",
    "player_connection_info": {
      "ip_address": "192.168.1.100",
      "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  }
}
```

**Примеры типов:**

- `SessionInfoRequest` / `SessionInfoResponse`
- `PlayRoundRequest` / `PlayRoundResponse`
- `OpenRoundRequest` / `OpenRoundResponse`
- `UpdateRoundStateRequest` / `UpdateRoundStateResponse`
- `CloseRoundRequest` / `CloseRoundResponse`

### Events канал

Односторонние уведомления от API к игре:

```json
{
  "chan": "events",
  "type": "BalanceChangedEvent",
  "payload": {
    "session_id": "12345678-1234-5678-9abc-123456789012",
    "balance": 150.00,
    "reason": "Win"
  }
}
```

**Примеры типов:**

- `SessionClosedEvent`
- `BalanceChangedEvent`

### Control канал

Управление соединением:

```json
{
  "chan": "control",
  "type": "Hello",
  "payload": {
    "supports": {
      "max_schema": 1
    }
  }
}
```

**Примеры типов:**

- `Hello`
- `Welcome`
- `GoAway`

## Правила валидации

### Обязательные проверки

1. **Версии протокола** - должны соответствовать поддерживаемым версиям
2. **Формат GUID** - все ID должны соответствовать стандарту RFC 4122
3. **Временные метки** - формат ISO 8601 с UTC timezone
4. **Порядковые номера** - op_seq должен увеличиваться монотонно
5. **Correlation ID** - для response сообщений должен совпадать с request

## Обработка ошибок

### Структура ошибки в конверте

```json
{
  "proto": 1,
  "schema": 1,
  "chan": "rpc",
  "type": "Error",
  "id": "error-guid",
  "corr_id": "original-request-id",
  "op_seq": 12346,
  "timestamp": "2023-01-01T00:00:01.000Z",
  "payload": {
    "error_code": "BadRequest",
    "error_message": "Invalid request format",
    "error_details": {}
  }
}
```

## Технические требования

### Форматы данных

- **Временные метки:** ISO 8601 с часовым поясом UTC
- **GUID поля:** стандартный формат GUID (8-4-4-4-12 символов)
- **Денежные суммы:** десятичные числа с фиксированной точностью
- **JSON данные:** корректно экранированные JSON строки

### WebSocket требования

- **Subprotocol:** для всех сообщений должен использоваться `json`
- **Кодировка:** UTF-8
- **Максимальный размер сообщения:** 128KB

### Безопасность

- Все сообщения должны быть валидированы перед обработкой
- Ответы с ошибками должны включать correlation ID
- Trace данные не должны содержать чувствительную информацию

## Связанные разделы

- **[Версионирование](versioning.md)** - управление версиями протокола
- **[Сериализация](serialization.md)** - форматы данных
- **[Обработка ошибок](error-handling.md)** - работа с ошибками
