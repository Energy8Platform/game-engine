<!-- Source: https://docs.artube-888.live/ru/integration-process/games-api/complex-round/game-scenarios/ -->

# Игровые сценарии - Сложный раунд

## Сценарий 1: Слот с Gamble функцией (согласие)

Интерактивный слот, где после выигрыша игрок соглашается на gamble и удваивает выигрыш.

### Схема Gamble с согласием

```mermaid
sequenceDiagram
    participant FE as Game FE
    participant BE as Game BE
    participant API as Artube Games API

    Note over FE, API: Gamble и согласие
    FE->>BE: Нажатие на кнопку спина
    BE->>BE: Проигрывание базовой игры
    BE->>API: OpenRoundRequest
    API->>API: Внутренняя магия
    API->>BE: OpenRoundResponse
    BE->>FE: Отправка результата базовой игры и запроса на gamble
    FE->>BE: Получение согласия на gamble
    BE->>BE: Проигрывание логики gamble
    BE->>API: CloseRoundRequest
    API->>API: Внутренняя магия
    API->>BE: CloseRoundResponse
    BE->>FE: Отправка результата раунда
```

### Пошаговая реализация

1. **OpenRound** - Проигрывание базовой игры и генерация результата основного спина, открытие раунда с нужным стейтом
2. **UpdateRoundState** - Отправка результата базовой игры и запроса на gamble игроку
3. **UpdateRoundState** - Получение согласия на gamble и проигрывание логики удвоения
4. **CloseRound** - Закрытие раунда с финальным выигрышем (удвоенным или потерянным)

→ [Полная реализация кода](examples/gamble-accept.md)

## Sценарий 2: Слот с Gamble функцией (отказ)

Интерактивный слот, где после выигрыша игрок отказывается от gamble и забирает выигрыш.

### Схема Gamble с отказом

```mermaid
sequenceDiagram
    participant FE as Game FE
    participant BE as Game BE
    participant API as Artube Games API

    Note over FE, API: Gamble и отказ
    FE->>BE: Нажатие на кнопку спина
    BE->>BE: Проигрывание базовой игры
    BE->>API: OpenRoundRequest
    API->>API: Внутренняя магия
    API->>BE: OpenRoundResponse
    BE->>FE: Отправка результата базовой игрыи запроса на gamble
    FE->>BE: Получение отказа от gamble
    BE->>API: CloseRoundRequest
    API->>API: Внутренняя магия
    API->>BE: CloseRoundResponse
    BE->>FE: Отправка результата раунда
```

### Пошаговая реализация

1. **OpenRound** - Проигрывание базовой игры с выигрышем, открытие раунда с начальной ставкой
2. **CloseRound** — Предложение gamble и получение отказа от игрока, закрытие раунда с базовым выигрышем (без удвоения)

→ [Полная реализация кода](examples/gamble-decline.md)

## Сценарий 3: Слот с выбором бонуса

Интерактивный слот, где игрок выбирает тип бонусной игры с разными характеристиками.

### Схема выбора бонуса

```mermaid
sequenceDiagram
    participant FE as Game FE
    participant BE as Game BE
    participant API as Artube Games API

    Note over FE, API: Бонуска + gamble и согласие
    FE->>BE: Нажатие на кнопку спина
    BE->>BE: Проигрывание базовой игры
    BE->>API: OpenRoundRequest
    API->>API: Внутренняя магия
    API->>BE: OpenRoundResponse
    BE->>FE: Отправка результата базовой игры и запроса в рамках бонуски
    FE->>BE: Получение выбора варианта бонуски от игрока
    BE->>BE: Проигрывание логики бонусной игры
    BE->>API: UpdateRoundStateRequest
    API->>API: Внутренняя магия
    API->>BE: UpdateRoundStateResponse
    FE->>BE: Получение согласия на gamble
    BE->>FE: Отправка результата базовой игры и запроса на gamble
    BE->>BE: Проигрывание логики gamble
    BE->>API: CloseRoundRequest
    API->>API: Внутренняя магия
    API->>BE: CloseRoundResponse
    BE->>FE: Отправка результата раунда
```

### Пошаговая реализация

1. **OpenRound** - Открытие раунда и триггер бонусной игры
2. **UpdateRoundState** - Отправка вариантов бонуса и получение выбора игрока
3. **UpdateRoundState** - Проигрывание выбранного бонуса и расчет выигрыша
4. **UpdateRoundState** - Предложение финального gamble после бонуса
5. **CloseRound** - Закрытие раунда с итоговым результатом (бонус + gamble)

→ [Полная реализация кода](examples/bonus-selection.md)

## Сценарий 4: Фриспины с простыми бонусами

Последовательность фриспинов с различными бонусными механиками.

### Схема фриспинов

```mermaid
sequenceDiagram
    participant FE as Game FE
    participant BE as Game BE
    participant API as Artube Games API

    Note over FE, API: Фриспины и простые бонуски
    FE->>BE: Нажатие на кнопку спина
    BE->>BE: Проигрывание основного спина
    BE->>BE: Проигрывание первого фриспина
    BE->>BE: Проигрывание второго фриспина
    BE->>BE: Проигрывание бонуски второго фриспина
    BE->>BE: Проигрывание третьего фриспина
    BE->>BE: Проигрывание бонуски третьего фриспина
    BE->>API: PlayRoundRequest
    API->>API: Внутренняя магия
    API->>BE: PlayRoundResponse
    BE->>FE: Отправка результатов раунда
```

### Пошаговая реализация

1. **Внутренняя обработка** - Проигрывание всех фриспинов и бонусов на backend
2. **PlayRound** - Закрытие раунда с общим результатом всех фриспинов

## Сценарий 5: Мультибет (простой)

Обработка нескольких ставок в одном раунде с финальным расчетом.

### Схема мультибета

```mermaid
sequenceDiagram
    participant FE as Game FE
    participant BE as Game BE
    participant API as Artube Games API

    Note over FE, API: Мультибет
    FE->>FE: Получение первой ставки
    FE->>FE: Получение второй ставки
    FE->>BE: Запуск раунда
    BE->>BE: Проигрывание полного раунда и расчёт выигрышей по каждой ставке
    BE->>API: PlayRoundRequest
    API->>API: Внутренняя магия
    API->>BE: PlayRoundResponse
    BE->>FE: Отправка результатов раунда
```

### Пошаговая реализация

1. **Сбор ставок** - Получение нескольких ставок от игрока через UI
2. **Обработка ставок** - Расчет результатов для каждой ставки отдельно
3. **PlayRound** - Отправка одного запроса с общим результатом всех ставок

## Сценарий 6: Простой слот (без интерактива)

Классический простой слот без пользовательского интерактива.

### Схема простого слота

```mermaid
sequenceDiagram
    participant FE as Game FE
    participant BE as Game BE
    participant API as Artube Games API

    Note over FE, API: Нет пользовательского интерактива
    FE->>BE: Нажатие на кнопку спина
    BE->>BE: Проигрывание полного раунда
    BE->>API: PlayRoundRequest
    API->>API: Внутренняя магия
    API->>BE: PlayRoundResponse
    BE->>FE: Отправка результатов раунда
```

### Пошаговая реализация

1. **Генерация результата** - Создание результата спина на backend
2. **PlayRound** - Отправка одного запроса с готовым результатом

## Сценарий 7: Интерактивный бонус

Слот с пользовательским интерактивом в бонусной игре.

### Схема интерактивного бонуса

```mermaid
sequenceDiagram
    participant FE as Game FE
    participant BE as Game BE
    participant API as Artube Games API

    Note over FE, API: Есть пользовательский интерактив
    FE->>BE: Нажатие на кнопку спина
    BE->>BE: Проигрывание базовой игры
    BE->>API: OpenRoundRequest
    API->>API: Внутренняя магия
    API->>BE: OpenRoundResponse
    BE->>FE: Отправка результата базовой игры и запроса к игроку

    Note over FE, BE: player interaction
    FE->>BE: Получение ответа от игрока
    BE->>BE: Обработка пользовательского ввода
    BE->>API: UpdateRoundStateRequest
    API->>API: Внутренняя магия
    API->>BE: UpdateRoundStateResponse

    BE->>API: CloseRoundRequest
    API->>API: Внутренняя магия
    API->>BE: CloseRoundResponse
    BE->>FE: Отправка результата раунда
```
