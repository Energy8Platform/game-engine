<!-- Source: https://docs.artube-888.live/ru/games-api-integration/examples/complex-round-examples/ -->

# Примеры сложных раундов

## Обзор

Детальные примеры реализации сложных игровых раундов с пользовательским интерактивом, использующих последовательность [`OpenRound`](../game-requests/open-round.md) → [`UpdateRoundState`](../game-requests/update-round-state.md) → [`CloseRound`](../game-requests/close-round.md) или [`OpenRound`](../game-requests/open-round.md) → [`CloseRound`](../game-requests/close-round.md).

## Сценарий 1: Слот с функцией Gamble

Интерактивный слот, где после выигрыша игрок может выбрать - забрать выигрыш или попытаться его удвоить в gamble-игре.

### Схема слота с gamble

```mermaid
sequenceDiagram
    participant Player as Игрок
    participant Game as Игра
    participant API as Artube Games API

    Note over Player, API: Основное вращение
    Player->>Game: Ставка 10.00 USD
    Game->>Game: Вращение барабанов
    Game->>API: OpenRound (price_multiplier: 1.00)
    API->>Game: RoundID + баланс
    Game->>Player: Выигрыш 50.00! Играть gamble?

    Note over Player, API: Gamble выбор
    Player->>Game: Да, играть gamble
    Game->>API: UpdateRoundState (gamble chosen)
    API->>Game: State updated
    Game->>Player: Выбери цвет карты

    Player->>Game: Красная
    Game->>Game: Открыть карту (красная 8)
    Game->>API: CloseRound (win_multiplier: 10.00)
    API->>Game: Final balance: 240.00
    Game->>Player: Победа! Выигрыш удвоен: 100.00
```

## Сценарий 2: Слот с выбором бонуса

Интерактивный слот, где при активации бонуса игрок может выбрать между двумя режимами с разными характеристиками RTP и волатильности.

### Схема выбора бонуса

```mermaid
sequenceDiagram
    participant Player as Игрок
    participant Game as Игра
    participant API as Artube Games API

    Note over Player, API: Триггер бонуса
    Player->>Game: Ставка 20.00 USD
    Game->>Game: Вращение (3 BONUS символа)
    Game->>API: OpenRound (price_multiplier: 1.00)
    API->>Game: RoundID + баланс
    Game->>Player: БОНУС! Выбери режим

    Note over Player, API: Выбор типа бонуса
    Game->>Player: "Wild Storm" (RTP 96.8%, High Vol) vs "Steady Wins" (RTP 96.5%, Med Vol)
    Player->>Game: Выбор "Wild Storm"
    Game->>API: UpdateRoundState (bonus selected)
    API->>Game: State updated

    Note over Player, API: Игра бонуса
    loop 10 фриспинов
        Game->>Game: Вращение с wild мультипликаторами
        Game->>API: UpdateRoundState (freespin result)
        API->>Game: State updated
        Game->>Player: Фриспин с множественными wild
    end

    Note over Player, API: Завершение
    Game->>API: CloseRound (total bonus win_multiplier: 25.00)
    API->>Game: Final balance: 670.00
    Game->>Player: Бонус завершен! +500.00
```

## Сценарий 3: Интерактивный бонус слота

Бонусная игра слота с выбором призов игроком.

### Схема бонусной игры

```mermaid
sequenceDiagram
    participant Player as Игрок
    participant Game as Игра
    participant API as Artube Games API

    Note over Player, API: Запуск бонуса
    Player->>Game: Triggered by base game
    Game->>API: OpenRound (bonus round)
    API->>Game: RoundID
    Game->>Player: Показать сетку призов

    Note over Player, API: Выборы игрока
    loop Пока есть выборы
        Player->>Game: Выбрать приз [позиция 3]
        Game->>API: UpdateRoundState (prize picked)
        API->>Game: State updated
        Game->>Player: Открыть приз [50 монет]
    end

    Note over Player, API: Завершение бонуса
    Game->>API: CloseRound (total bonus win)
    API->>Game: Final balance
    Game->>Player: Показать общий выигрыш
```

## Сценарий 5: Пошаговая RPG битва

Пошаговая боевая система с выбором действий.

### Схема RPG битвы

```mermaid
sequenceDiagram
    participant Player as Игрок
    participant Game as Игра
    participant API as Artube Games API

    Note over Player, API: Начало битвы
    Player->>Game: Войти в битву
    Game->>API: OpenRound (battle start)
    API->>Game: RoundID
    Game->>Player: Показать врага [HP: 100/100]

    Note over Player, API: Пошаговые действия
    loop Пока битва идет
        Player->>Game: Выбрать действие [Attack]
        Game->>API: UpdateRoundState (player action)
        API->>Game: State updated
        Game->>Player: Урон врагу [30 dmg, HP: 70/100]

        Game->>Game: Ход врага
        Game->>API: UpdateRoundState (enemy action)
        API->>Game: State updated
        Game->>Player: Урон игроку [15 dmg, HP: 85/100]
    end

    Note over Player, API: Завершение битвы
    Game->>API: CloseRound (battle won)
    API->>Game: Final balance + rewards
    Game->>Player: Победа! Получено: 500 монет
```

> Совет
>
> Сложные раунды позволяют создавать богатый игровой опыт с множественными взаимодействиями. Тщательно планируйте состояния и переходы между ними.

## Связанные разделы

- **[Сложный раунд](../../integration-process/games-api/complex-round.md)** - концепция сложных раундов
- **[OpenRound](../game-requests/open-round.md)** - начало интерактивного раунда
- **[UpdateRoundState](../game-requests/update-round-state.md)** - обновление состояния
- **[CloseRound](../game-requests/close-round.md)** - завершение раунда
- **[Простые раунды](simple-round-examples.md)** - для сравнения
