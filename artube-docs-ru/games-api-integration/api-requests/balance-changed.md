<!-- Source: https://docs.artube-888.live/ru/games-api-integration/api-requests/balance-changed/ -->

# BalanceChangedEvent

## Обзор

Событие `BalanceChangedEvent` отправляется сервером клиенту для уведомления об изменении баланса игрока извне (например, депозит, вывод средств, бонус).

## Событие от сервера

     Protocol `1`   Schema `1`   Channel `events`   Type `BalanceChangedEvent`   Timestamp 1/1/2023, 12:00:00 AM        Message ID `01234567-89ab-cdef-0123-456789abcdef`    Operation Sequence 102
#### Payload

```
{
  "session_id": "12345678-1234-5678-9abc-123456789012",
  "balance": 163.75,
  "reason": "round_win"
}
```

### Поля события

| Поле | Тип | Обязательность | Описание |
| --- | --- | --- | --- |
| `session_id` | string | обязательное | ID сессии (GUID) |
| `balance` | decimal | обязательное | Новый баланс |
| `reason` | string | обязательное | Причина изменения (“round_win”, “round_bet”, “bonus”, “correction”) |

## Возможные причины изменения

| Причина | Описание |
| --- | --- |
| `round_win` | Выигрыш в раунде |
| `round_bet` | Списание ставки |
| `bonus` | Бонусное начисление |
| `correction` | Корректировка баланса |

## Пример обработки

**Обработка события изменения баланса:**

- Извлечение нового баланса и причины из payload
- Обновление отображаемого баланса игрока в UI
- Показ соответствующего уведомления в зависимости от причины изменения
