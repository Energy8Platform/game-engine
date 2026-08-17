<!-- Source: https://docs.artube-888.live/ru/games-api-integration/protocol/serialization/ -->

# Сериализация

## Обзор сериализации

Artube Games API использует стандартизированные форматы сериализации для обеспечения совместимости и надежности передачи данных между игрой и платформой.

## Поддерживаемые форматы

### JSON (основной формат)

**Формат:** snake_case **Кодировка:** UTF-8 **Content-Type:** `application/json`

```json
{
  "proto": 1,
  "schema": 1,
  "chan": "rpc",
  "type": "SessionInfoRequest",
  "id": "01234567-89ab-cdef-0123-456789abcdef",
  "op_seq": 12345,
  "timestamp": "2023-10-28T12:00:00.000Z",
  "payload": {
    "session_id": "12345678-1234-5678-9abc-123456789012",
    "player_connection_info": {
      "ip_address": "192.168.1.100",
      "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  }
}
```

### Правила именования полей

#### snake_case для всех полей

```json
// ✅ Правильно
{
  "session_id": "...",
  "player_id": "...",
  "round_state": "...",
  "op_seq": 123
}

// ❌ Неправильно
{
  "sessionId": "...",
  "playerId": "...",
  "roundState": "...",
  "opSeq": 123
}
```

#### Специальные типы данных

**Денежные суммы:**

```json
{
  "price_multiplier": 10.50,        // Десятичное число
  "balance": 157.25,     // Всегда с точностью до 2 знаков
  "win_multiplier": 0.00           // Ноль как 0.00, не 0
}
```

**Временные метки:**

```json
{
  "timestamp": "2023-10-28T12:00:00.000Z"  // ISO 8601 UTC
}
```

**JSON в строках:**

```json
{
  "round_state": "{\"step\": 1, \"cards\": [\"AS\", \"KH\"]}"  // Экранированный JSON
}
```

> Совет
>
> Используйте snake_case для всех полей JSON и всегда валидируйте входящие сообщения перед обработкой.

## Связанные разделы

- **[Конверт](envelope.md)** - структура сообщений
- **[Версионирование](versioning.md)** - управление версиями
- **[Обработка ошибок](error-handling.md)** - работа с ошибками сериализации
