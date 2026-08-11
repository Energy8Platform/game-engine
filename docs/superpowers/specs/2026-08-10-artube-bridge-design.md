# Artube integration: `artube-server` + `artube-bridge`

**Дата:** 2026-08-10
**Статус:** дизайн утверждён, план имплементации не написан
**Источник требований:** [`artube-docs-ru/`](../../../artube-docs-ru/) (62 страницы, выгрузка docs.artube-888.live)

## Задача

Дать играм на `@energy8platform/game-sdk` возможность работать на платформе Artube —
так же, как `@energy8platform/stake-bridge` даёт им работать на Stake Engine. Код игры
при этом не меняется: он по-прежнему говорит только с `CasinoGameSDK`.

## Почему это не копия stake-bridge

| | Stake Engine | Artube |
|---|---|---|
| Кто ходит в платформенное API | браузер (`stake-bridge` целиком во фронте) | **только бэкенд игры**; фронту доступ запрещён |
| Транспорт | HTTPS REST (`/wallet/*`) | WSS, конверт-протокол, `op_seq` / `corr_id` |
| Где живёт результат раунда | «книга» приходит целиком в браузер | считает бэкенд игры, платформа хранит `round_state` |
| Кто считает деньги | RGS | Games API; бэкенд шлёт только `bet_index` + `price_multiplier` + `win_multiplier` |
| Per-game артефакт | `BookAdapter` во фронте | нет — нарезку знает бэкенд |

Отсюда два пакета вместо одного: сервис и тонкий фронтовый мост.

## Принятые решения

1. **Оба пакета живут в этом монорепо** рядом со `stake-bridge`.
2. **Математика — SpinML**: `.spin`-скрипт исполняет нативный `e8-server` по gRPC
   (`StartRound` / `Step` / `GetRound`), тот же бинарь, что уже качает
   `platform-core/scripts/install-e8.mjs` и спавнит `spinPlugin`.
3. **Бэкенд stateless.** Состояние раунда живёт исключительно в `round_state` на
   стороне Artube. Redis не используется.
4. **Маппинг раундов автоматический**: один сегмент → `PlayRound`; несколько →
   `OpenRound` → `UpdateRoundState`* → `CloseRound`.
5. **Версионирование `.spin` посреди раунда — зона ответственности Artube.** Мы не
   правим `e8-server` ради пиннинга версии; при расхождении `script_sha256`
   закрываем раунд накопленным `total_win_x`.

## Scope v1

Входит: подключение и реконнект, `SessionInfo`, простой и сложный раунд, resume
незакрытого раунда, обработка ошибок, все четыре события API, FRC, max-win, демо-режим.

Не входит: плагин к `@energy8platform/harness` (полноценная dev-петля `npm run dev`),
интеграция в `create-slot`, гемификация, `@artube/loader`.

## Архитектура

```
Браузер (один домен игры — фронт и бэк за одним reverse proxy)
 │   ArtubeBridge ←── MemoryChannel ──→ CasinoGameSDK ← код игры не меняется
 │        │  WS  /api/ws?sessionId=…  (same-origin, без CORS)
 ▼        ▼
artube-server — без памяти между запросами, любой под обслуживает любой запрос
 ├─ games-api client  — WSS к Artube Games API (X-Api-Key / X-Game-ID)
 └─ engine client     — gRPC к e8-server (дочерний процесс, --sessions memory)
```

### Где живёт состояние

В Games API, в `round_state`, и это не дамп движка, а рецепт его воспроизведения:

```json
{ "v": 1, "seed": {"server":"…","client":"…","nonce":42},
  "eid": "e-9f3c…", "script": "sha256:…", "cursor": 3, "total_win_x": 12.5,
  "actions": [{"a":"free_spin"},{"a":"gamble","p":{"choice":"red"}}] }
```

Движок provably-fair детерминирован — тройка `(server_seed, client_seed, nonce)`
воспроизводит раунд бит-в-бит (этим же свойством `NativeSimulationRunner`
восстанавливает продакшн-раунды). Поэтому `round_state` — десятки байт и всегда
влезает в лимит конверта 128 KB. `eid` — идентификатор раунда в движке, `actions` —
полный лог действий игрока, включая интерактивные.

### Один сегмент — один шаг движка

Раунд **не** проигрывается целиком заранее. На entry-действии движок делает ровно один
шаг и говорит `round_complete` — этого достаточно, чтобы выбрать простой или сложный
раунд. Дальше каждый запрос фронта — один `Step`:

**Горячий путь** (обычный случай): `GetRound(eid)` находит открытый раунд → `Step` →
один вызов движка на фриспин. O(1) на сегмент.

**Холодный путь** (под перезапустился, запрос сел на другой под): `GetRound` отвечает
`found: false` → воспроизводим раунд из сидов и лога действий до `cursor`, дальше
продолжаем как обычно. O(N) ровно один раз на разрыв.

Разница принципиальна: открытый раунд в движке — это **кэш, а не состояние**. Его
потеря ничего не стоит, потому что правда лежит в `round_state` у Artube, и любой под
восстановит её без чужой помощи. Поэтому `--sessions memory` и короткий TTL: Redis не
нужен, требование stateless выполняется буквально.

Из того же свойства следует **гэмбл и любой другой интерактив**: выбор игрока приезжает
в `params` до того, как движок сделает следующий шаг, и математика ветвится на нём
по-настоящему. Предварительное проигрывание раунда такую игру сломало бы — решения
игрока подставились бы дефолтами ещё до того, как он их принял.

Единственное состояние в процессе — WS-коннект к Games API: один на под, мультиплексирует
все сессии (`op_seq` монотонный в рамках коннекта, `corr_id` парит ответы). После
реконнекта каждая сессия переинициализируется через `SessionInfoRequest`, как требует
дока. `NewConnectionEvent` игнорируем — дока прямо разрешает это stateless-играм.

### Жизненный цикл раунда

Entry-экшен — один шаг движка. Флаг `round_complete` в его ответе решает, каким раундом
это будет для Artube. Итог всей фичи заранее не считается: он складывается по мере того,
как игрок её доигрывает.

**Один сегмент** (обычный спин без фичи): `PlayRound` с `bet_index`,
`price_multiplier = 1`, `win_multiplier = win_x` → ответ даёт `round_id` и `balance` →
один `PLAY_RESULT` с финальным балансом. Одна RPC на спин.

**Несколько сегментов** (фриспины, gamble, выбор бонуса): `OpenRound` списывает ставку →
первый `PLAY_RESULT` с `creditPending: true` → на каждый следующий сегмент
`UpdateRoundState` (везём `round_version`, который считает Games API) → на последнем
`CloseRound` с `win_multiplier = total_win_x` → финальный `PLAY_RESULT` с настоящим
`balanceAfter`. Тот же жизненный цикл `creditPending`, что в `stake-bridge`, только
зеркальный.

Деньги не считаем нигде: наружу уходят только `bet_index`, `price_multiplier`
(1 обычный / >1 buy-bonus / 0 фри-раунд) и `win_multiplier`. Баланс всегда берём из
ответа Games API.

## Пакеты

### `@energy8platform/artube-server`

| Entry | Что даёт | Зависит от |
|---|---|---|
| `.` | `createArtubeServer(config)` + bin `artube-server` | всё ниже |
| `/games-api` | `GamesApiClient` — конверт, `op_seq`/`corr_id`, Hello/Welcome/GoAway, реконнект, типы 6 запросов и 4 событий | только `ws` |
| `/engine` | `EngineClient` (gRPC) + `replayRound(roundState)` → сегменты | только `@grpc/*` |

```ts
class GamesApiClient {
  connect(): Promise<void>;                       // Hello → Welcome, анонс всех контрактов
  sessionInfo(sessionId, conn): Promise<SessionInfoResponse>;
  playRound(p: PlayRoundRequest): Promise<PlayRoundResponse>;
  openRound(p): Promise<OpenRoundResponse>;
  updateRoundState(p): Promise<UpdateRoundStateResponse>;
  closeRound(p): Promise<CloseRoundResponse>;
  autocloseRound(p): Promise<void>;
  on('balanceChanged' | 'sessionClosed' | 'newConnection' | 'autocloseRequest'
     | 'goAway' | 'connection', cb): void;
}
```

При установке соединения `Hello.payload.supports.contracts` обязан перечислить **все**
типы, которые Games API может прислать обратно — не только Request-типы, но и
Response-типы, `Error` и все Event-типы. Неанонсированные контракты сервер исключает из
согласованного набора и не доставляет.

Пока коннекта к Games API нет — любой вызов немедленно падает `InternalServerError`
(так предписывает дока), а не копится в очереди.

Ядро оркестратора — одна чистая функция:

```ts
async function playSegment(ctx: RoundContext, req: PlayRequest): Promise<PlayResult>
```

Ни одного поля, переживающего запрос.

### `@energy8platform/artube-bridge`

| Entry | Что даёт |
|---|---|
| `.` | `new ArtubeBridge({ devMode: true, apiBase?, url? })` |
| `/detect` | `isArtubeLaunch(url)` — крошечный чанк для `main.ts` |

Единственная правка в коде игры — точка входа становится трёхплатформенной:

```ts
const isArtube = isArtubeLaunch(location.href);   // ?sessionId=…
if (isArtube) {
  const { ArtubeBridge } = await import('@energy8platform/artube-bridge');
  new ArtubeBridge({ devMode: true });            // WS на /api/ws, same-origin
}
const sdk = new CasinoGameSDK({ devMode: isArtube || isStake });
```

Per-game адаптера нет: нарезку на сегменты знает бэкенд.

### Репозиторий игры на Artube

Artube выдаёт спейс в GitLab с репами `client` и `server`. Серверный — ~15 строк:

```ts
import { createArtubeServer } from '@energy8platform/artube-server';
await createArtubeServer({
  gameId: process.env.GameId!,                    // = publicGameId
  gamesApiUrl: process.env.GamesApiUrl!,
  apiKey: process.env.GamesApiKey!,
  spinPath: './game.spin',
}).listen(80);
```

Плюс Dockerfile (шаблон отдаёт пакет). Деплой-контракт Artube выполняется из коробки:
Dockerfile в корне, `EXPOSE 80`, весь HTTP под префиксом `/api`, `/livez` и `/healthz`,
структурированные JSON-логи одной строкой на запись, stateless под HPA.

## Контракт фронт↔бэк

`WS /api/ws?sessionId=…`, почти 1:1 с `game-sdk`, чтобы мост оставался переводчиком,
а не второй бизнес-логикой.

| Фронт → бэк | Бэк → фронт |
|---|---|
| `play {id, action, betIndex, params?}` | `init {currency, balance, config, session?, resume?, frc?, maxWin?, lang, device}` |
| `ack {roundId, cursor}` | `result {id, roundId, action, data, winThisSegment, totalWin, balanceAfter, nextActions, session, creditPending, maxWinReached, frc?}` |
| | `balance {balance, reason}` · `session_closed {reason}` · `error {id?, code, message}` |

`allowed_bets` из `SessionInfo` едет во фронт как `config.betLevels`, поэтому игра
продолжает выбирать ставку суммой, а мост переводит сумму в `betIndex` перед отправкой.
Сама сумма наружу не уходит никогда.

`ack` не косметика: `UpdateRoundState` уходит после того, как игрок реально увидел
сегмент. Поэтому реконнект посреди фичи возвращает неподтверждённый сегмент, а не
съедает его. Мост берёт `ack` из штатного `PLAY_RESULT_ACK` игры — код игры не трогаем.

### Resume

На каждом коннекте — `SessionInfoRequest`. Если `last_round.finished_at == null`, раунд
не закрыт: воспроизводим его из `round_state`, кладём текущий сегмент в `init.resume`,
мост отдаёт его как `INIT` плюс синтетический `PLAY_RESULT`, игра доигрывает фичу с того
же места. Если `script_sha256` разошёлся — `CloseRound` с накопленным `total_win_x`,
игроку показываем итог.

### Ошибки

Коды Artube отображаются в `game-sdk`, а не текут наружу как есть:

| Код | Действие |
|---|---|
| `BackPressureRejected` | ретрай через `details.retry_after_ms`, фронт не видит |
| `SessionIsNotInitialized` | `SessionInfoRequest` и повтор один раз |
| `InsufficientFunds` | `error` во фронт → игра предлагает пополнить |
| `SessionInvalid` / `RegionNotSupported` | `session_closed`, игра блокирует поле |
| `InvalidRoundOperation` | перечитываем `SessionInfo`, чиним `round_version` / `cursor` |
| нет коннекта к Games API | немедленный `InternalServerError` |

Ретраим только идемпотентное: `SessionInfo`, `UpdateRoundState`. `PlayRound`,
`OpenRound`, `CloseRound` — никогда, это деньги. Та же дисциплина, что в `stake-bridge`
с `/wallet/play`.

### События Games API

| Событие | Что делаем |
|---|---|
| `BalanceChangedEvent` | → `balance` → `BALANCE_UPDATE` |
| `SessionClosedEvent` | → `session_closed` |
| `NewConnectionEvent` | игнор (дока разрешает stateless-играм) |
| `AutocloseRequestEvent` | воспроизводим раунд из `round_state`, доигрываем до конца, шлём `AutocloseRoundRequest` со `status: "completed"` и `win_multiplier = total_win_x` |

Autoclose v2 даёт игроку честный математический итог вместо отката по v1.

### Фичи

**FRC.** `SessionInfo.free_round_campaign` едет в `init.frc`. Пока кампания активна, шлём
`price_multiplier: 0` и `free_round_campaign_id`; `rounds_left` / `total_win` /
`is_complete` из ответов кладём в `result.frc`.

**Max-win.** `is_platform_max_win_reached` → `session.maxWinReached`; баланс берём из
ответа Games API (выигрыш там уже обрезан). Игра доигрывает анонсеры на сырой выигрыш и
показывает блокирующую модалку с фактически зачисленной суммой. `platform_max_win` из
`SessionInfo` едет в `config` для экрана правил.

**Демо.** Признак демо — `currency === null`; Games API отвечает `OperationNotAllowed` на
любые раундовые RPC демо-пользователя. Значит в демо мы вообще не ходим в Games API:
движок крутится, а виртуальный баланс ведёт мост на клиенте от стартового значения. Это
единственный способ не заводить кэш с TTL и не ломать stateless; демо-деньги ничего не
стоят, риска нет.

## Тестирование

| Уровень | Чем проверяем | Что ловим |
|---|---|---|
| `games-api` | фейковый WS-сервер в тесте | валидация конверта, монотонность `op_seq`, парность `corr_id`, 5-секундный дедлайн `Hello`, `Welcome` без `Hello`, `GoAway`, реконнект с экспонентой, политика ретраев |
| `engine` / replay | фикстура `.spin` + реальный `e8-server` | детерминизм (один `round_state` → тот же список сегментов дважды), продвижение `cursor`, фолбэк при расхождении `sha` |
| `orchestrator` | стабы обоих клиентов | simple vs complex, жизненный цикл `creditPending`, `ack` → `UpdateRoundState`, resume с середины фичи, autoclose, `price_multiplier: 0` в FRC, флаг max-win, демо без единой RPC |
| `artube-bridge` | стаб бэкенда | resume-round, settle-timing, детект запуска |
| e2e | публичный sandbox `wss://gamesapi-sandbox.artube-888.live/v1/ws` | opt-in по `ARTUBE_SANDBOX_SESSION`, не в CI |

Критерий готовности: полный круг на sandbox — обычный спин, спин с фриспинами, реконнект
посреди фичи, autoclose, FRC-раунд — против реального `GamesAPI` (в песочнице стоит тот
же сервис и тот же код, что на dev и prod). Данные песочницы живут ~24 часа и требуют
ручного «Generate Data → Create Session», поэтому e2e не в CI.

Для прогона e2e бин получает режим `artube-server --spin ./game.spin --sandbox` и голый
пример в `examples/`. Полноценный harness-плагин — за рамками v1.

## Открытые риски

1. **Деплой посреди незакрытого раунда** ломает детерминированное воспроизведение
   (`script_sha256` не совпадёт). Решено фолбэком: закрываем раунд накопленным
   `total_win_x`. Игрок получает деньги, но не досматривает фичу. Пиннинг версии —
   зона Artube.
2. **Мультиплексирование сессий на одном WS-коннекте** дока прямо не запрещает
   (`op_seq` задан «в контексте соединения»), но и не подтверждает. Если на интеграции
   выяснится, что Games API ждёт коннект на сессию, `GamesApiClient` уже спроектирован
   как «один класс = один коннект» — меняется только пул над ним.
3. **Стоимость холодного пути** — воспроизведение раунда платится только при разрыве
   (рестарт пода, запрос на другом поде): один прогон до курсора. В обычной работе
   сегмент стоит один `Step`. Стоит померить на игре с длинной фичей, если разрывы
   окажутся частыми.
