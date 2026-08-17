<!-- Source: https://docs.artube-888.live/ru/games-api-integration/examples/how-to-connect/ -->

# Как подключиться

## Обзор подключения

Подключение к Artube Games API осуществляется через WebSocket с использованием `json` саб-протокола. Это руководство покажет полный процесс от установления соединения до выполнения игровых операций.

## Начальное рукопожатие

Процесс установления соединения с Games API включает обмен контрактами для согласования версии протокола:

### Control контракты

- **[Hello](../control-requests/hello.md)** - согласование версии на стороне Api
- **[Welcome](../control-requests/welcome.md)** - согласование версии на стороне клиента
- **[GoAway](../control-requests/goaway.md)** - корректное завершение соединения

### Протокол и структура

- **[Envelope](../protocol/envelope.md)** - структура сообщений и обязательные поля
- **[Версионирование](../protocol/versioning.md)** - управление версиями протокола
- **[Процесс подключения](../../integration-process/games-api/general-flow/connection.md)** - детальный алгоритм подключения

### Обработка ошибок

- **[Обработка ошибок](../protocol/error-handling.md)** - стратегии обработки ошибок
- **[Типы ошибок](../protocol/error-responses.md)** - справочник кодов ошибок

## Полный жизненный цикл игрового раунда

### Шаг 1: Получение информации о сессии

Перед началом игры получите актуальную информацию о сессии:

- **[SessionInfo](../game-requests/session-info.md)** - детальное описание запроса и ответа
- **[Сессии](../../integration-process/games-api/general-flow/sessions.md)** - управление жизненным циклом сессий
- **[Общий поток](../../integration-process/games-api/general-flow.md)** - контекст использования SessionInfo

### Шаг 2: Выполнение игрового раунда

После успешного подключения можно выполнять игровые операции:

#### Простые раунды

Для игр с мгновенным результатом (слоты, рулетка):

- **[Примеры простых раундов](simple-round-examples.md)** - диаграммы и JSON примеры
- **[Процесс простых раундов](../../integration-process/games-api/simple-round.md)** - детальное описание
- **[Примеры игр](../../integration-process/games-api/simple-round/game-examples.md)** - конкретные игровые сценарии

#### Сложные раунды

Для игр с множественными этапами (блэкджек, покер, бонусы):

- **[Примеры сложных раундов](complex-round-examples.md)** - диаграммы и JSON примеры
- **[Процесс сложных раундов](../../integration-process/games-api/complex-round.md)** - детальное описание
- **[Пример слот-бонуса](../../integration-process/games-api/complex-round/examples/slot-bonus.md)** - конкретный сценарий

## Связанные разделы

- **[Простой раунд](../../integration-process/games-api/simple-round.md)** - детали реализации простых игр
- **[Сложный раунд](../../integration-process/games-api/complex-round.md)** - интерактивные игры
- **[Обработка ошибок](../protocol/error-handling.md)** - работа с ошибками
