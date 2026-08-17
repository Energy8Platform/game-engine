<!-- Source: https://docs.artube-888.live/ru/games-api-integration/protocol/versioning/ -->

# Версионирование

## Обзор системы версионирования

Artube Games API использует трёхуровневую систему версионирования для обеспечения обратной совместимости и плавного обновления интерфейсов. Это позволяет развивать API без нарушения работы существующих игр.

## Анализ текущего состояния

### Текущий протокол:

- URL: `/v1/ws` с `envelope.proto=1`
- Envelope с фиксированными полями: `proto=1, schema=1`

## Трехуровневая модель версионирования

```mermaid
flowchart TD
    A[URL /v1/ws + envelope.proto=1] --> B[Proto Level A]
    B --> C[Fundamental invariants, Branch lifecycle, Rarely changes]
    B --> D[Schema Level B]
    E[envelope.schema + Hello/Welcome negotiation] --> D
    D --> F[Envelope rules, Control-plane format, Medium frequency changes]
    D --> G[Contract Level C]
    H[per-type payload versions] --> G
    G --> I[JSON payload of specific type, Business contracts, Frequently changes]
```

| Уровень | Как обозначается | Что меняется | Примечания |
| --- | --- | --- | --- |
| **A. Proto (major взаимодействия)** | URL `/v1/ws` + `envelope.proto=1` | фундаментальные инварианты взаимодействия и жизненный цикл ветки | редко меняется |
| **B. Schema (каркас протокола)** | `envelope.schema` + выбор через `Hello/Welcome supports/use.max_schema` | правила envelope + control-plane (формат Hello/Welcome/GoAway и т.п.) | меняется редко/средне |
| **C. Версии бизнес-контрактов (по каждому type)** | только через **Hello/Welcome**: `supports.contracts → use.contracts` (новое в schema≥2) | строгое JSON-представление `payload` конкретного `type` | меняется часто |

**Ключевая идея:** type остаётся единым и стабильным на годы, а версия payload для этого type выбирается на соединение через Welcome.use.contracts[type].

## Эволюция схемы (общий принцип schema n → schema n+1)

### Принцип обратной совместимости

- Сервер всегда поддерживает несколько версий schema одновременно
- Клиент объявляет максимальную поддерживаемую версию в Hello
- Сервер выбирает минимум из своего максимума и максимума клиента
- Новые поля добавляются опционально, старые не удаляются в рамках одной schema

```mermaid
sequenceDiagram
    participant Game as Игра (Backend)
    participant API as Artube Games API

    Note over Game, API: Schema Negotiation
    Game->>API: Hello schema=n

    Note over Game: supports.max_schema=n, supports.contracts (if n>=2)

    API->>Game: Welcome schema=min(n, server_max)

    Note over API: use.max_schema=selected, use.contracts (if selected>=2)

    Note over Game, API: All subsequent messages use, envelope.schema=selected and negotiated contracts
```

### Negotiation Algorithm

```mermaid
flowchart TD
    A[Client sends Hello] --> B{schema in Hello}
    B -->|schema>=2| C[Server analyzes supports.contracts]
    C --> D[For each type: Select max version from intersection]
    D --> E[Form use.contracts]
    E --> F[Send Welcome with selected schema and use.contracts]
    F --> G[Connection works with selected contract versions]
    B -->|schema=1| H[Server responds Welcome schema=1 Legacy mode without contracts]
    H --> I[Connection works in legacy mode]
```

## Механизм работы с версиями

### Принцип работы бизнес-логики

```mermaid
flowchart TD
subgraph Incoming Requests
    A[Connection Version Request] --> B[Migrate UP to Latest]
    B --> C[Latest Contract Models]
end
    D[Business Logic] --> C

subgraph Outgoing Events
    C --> E[Filter by Connection Support]
    E --> F[Migrate DOWN to Connection Version]
    F --> G[Connection Version Event]
end

subgraph Outgoing Responses
    C --> H[Migrate DOWN to Connection Version]
    H --> I[Connection Version Response]
end
```

### Ключевые принципы

- Вся бизнес-логика работает только с Latest версиями контрактов
- **Запросы (Requests)**: Connection Version → Migrate UP → Latest → обработка
- **Ответы (Responses)**: Latest → Migrate DOWN → Connection Version → отправка
- **События (Events)**: Latest → фильтрация по поддержке → Migrate DOWN → отправка

## Связанные разделы

- **[Конверт](envelope.md)** - структура сообщений с версионированием
- **[Сериализация](serialization.md)** - форматы данных
- **[Обработка ошибок](error-handling.md)** - ошибки версионирования
