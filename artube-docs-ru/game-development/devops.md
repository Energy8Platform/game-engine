<!-- Source: https://docs.artube-888.live/ru/game-development/devops/ -->

# DevOps и деплой бэкенда

Эта страница собирает в одном месте требования к деплою игрового бэкенда в инфраструктуру Artube. Всё ниже описано как **внешний интеграционный контракт**: что должен предоставить ваш репозиторий игры, чтобы платформа смогла собрать, запустить и обслуживать ваш сервис.

> Заметка
>
> Описывается только то, что нужно для интеграции и деплоя. Внутренняя реализация платформы Artube Games API здесь не раскрывается.

## Контейнеризация

### Dockerfile в корне репозитория

Игровой сервер можно писать на любом языке (см. [Общая информация](../overview/general-information.md)), но он **обязан быть обёрнут в `Dockerfile`**, и этот `Dockerfile` должен:

- располагаться **в корне репозитория** игры;
- успешно собираться (`docker build .` из корня).

Эталонный пример (сервис платформы `GamesApi`, .NET 8, multi-stage сборка):

```dockerfile
# базовый рантайм-образ
FROM mcr.microsoft.com/dotnet/aspnet:8.0-alpine AS base
WORKDIR /app
EXPOSE 8080
EXPOSE 80

# ... стадии build / publish ...

FROM base AS final
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:80;http://+:8080
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "GamesApi.dll"]
```

### Экспонируемый порт

Контейнер должен слушать и **экспонировать порт `80`** (HTTP). Это основной порт, через который инфраструктура обращается к сервису.

```dockerfile
EXPOSE 80
```

> Совет
>
> В эталонном сервисе платформы дополнительно экспонируется порт `8080` (`ASPNETCORE_URLS=http://+:80;http://+:8080`), но обязательным для вашего сервиса является именно `80`.

## HTTP-эндпоинты и префикс `/api`

Все HTTP-эндпоинты во взаимодействии front ↔ back должны находиться под префиксом **`/api`**.

```text
GET /api/sessions
GET /api/replay-history/{roundId}
```

Это обеспечивает единообразную маршрутизацию запросов в инфраструктуре платформы.

> Заметка
>
> WebSocket-подключение игрового бэкенда к Artube Games API использует отдельный путь `/v1/ws`, а не префикс `/api`.

### Как это работает: маршрутизация frontend/backend под общим доменом

Frontend (статика из [хостинга](hosting.md)) и backend вашей игры раздаются под **одним и тем же публичным доменом игры** (`baseUrl`). Reverse proxy платформы разделяет входящий трафик по пути запроса:

```text
baseUrl + /api/**   →  ваш backend-сервис (порт 80 контейнера)
baseUrl + всё остальное  →  статические файлы frontend (dist/) из CDN
```

**Пример:** если игра доступна по адресу `https://example-game.artube-888.live/`, то:

| Запрос | Куда направляется |
| --- | --- |
| `GET https://example-game.artube-888.live/` | frontend `index.html` |
| `GET https://example-game.artube-888.live/assets/main.abc123.js` | frontend статика |
| `GET https://example-game.artube-888.live/api/sessions` | backend, эндпоинт `/api/sessions` |
| `GET https://example-game.artube-888.live/api/replay-history/{roundId}` | backend |

> Практическое следствие для frontend-кода
>
> Поскольку backend доступен **под тем же доменом**, что и frontend, обращения к API из клиентского кода следует делать **относительными путями** (`fetch('/api/sessions')`), а не абсолютным URL с отдельным доменом backend. Это исключает проблемы с CORS — запросы остаются same-origin.

#### Troubleshooting

- **`404 Not Found` на `/api/...` эндпоинте, хотя backend отвечает локально** — проверьте,
   что backend-сервис реально запущен и проходит health-пробы `/livez`/`/healthz` (см.
   раздел «Health-пробы» ниже); reverse proxy маршрутизирует `/api/**` только на живые поды.
- **Frontend получает `index.html` вместо ожидаемого JSON на `/api/...` запросе** — эндпоинт
   backend не находится под префиксом `/api`; проверьте маршруты вашего сервиса.
- **CORS-ошибки в консоли браузера при запросах к API** — вероятно, frontend обращается к
   API по абсолютному URL с другим доменом/портом вместо относительного пути под тем же
   `baseUrl`; исправьте на относительный путь (`/api/...`).

## Переменные окружения

При деплое сервис конфигурируется через переменные окружения. Переменные делятся на **секретные** (выдаются DevOps, хранятся в Vault) и **несекретные** (передаются через `values-<env>.yaml` в формате `configs: { var: value }`).

> Осторожно
>
> Реальные значения секретов в документации не приводятся — используйте только имена переменных.

### Переменные фронтенда

| Переменная | Назначение | Обязательна |
| --- | --- | --- |
| `R2_GAME_ID` | Идентификатор игры — совпадает с именем выданного спейса (группы репозиториев) в GitLab | ✅ Да |

`R2_GAME_ID` задаётся в файле `.gitlab-ci.yml` клиентского репозитория (см. раздел [CI/CD](#cicd) ниже).

### Переменные бэкенда

Следующие переменные выдаются DevOps и хранятся в Vault:

| Переменная | Назначение |
| --- | --- |
| `GamesApiUrl` | Полный WSS-URL подключения к Artube Games API (с query-параметром `game`) |
| `GamesApiBaseUrl` | Базовый WSS-URL без query-параметра |
| `GamesApiKey` | Секретный ключ для аутентификации на Artube Games API |
| `GameId` | Идентификатор игры (= имя спейса/репозитория, publicGameId) |

> Заметка
>
> Переменные `GamesApiUrl` и `GamesApiKey` доступны по умолчанию.

При сборке Docker-образа в пайплайне автоматически передаётся build-arg `CI_COMMIT_REF_NAME` (имя ветки или тега). Студии могут использовать его в `Dockerfile` для условной логики сборки.

## Формат логов

Сервис должен писать логи в **структурированном JSON-формате, одной строкой на запись**. В эталонном сервисе платформы включается переменной:

```yaml
CommonSettings__LoggingFormat: json
```

Согласованная структура записи лога:

```json
{ "timestamp": "2025-11-26T10:30:45.123Z", "level": "error", "message": "Database connection timeout", "service": "game-api", "trace_id": "abc123", "error": { "type": "TimeoutError", "stack": "..." }, "context": { "db_host": "prod-db-01", "timeout_ms": 5000 } }
```

| Поле | Назначение |
| --- | --- |
| `timestamp` | время события (ISO 8601, UTC) |
| `level` | уровень (`info` / `warn` / `error` / …) |
| `message` | человекочитаемое сообщение |
| `service` | имя сервиса |
| `trace_id` | идентификатор трассировки запроса |
| `error.type` | тип ошибки (для записей уровня error) |
| `error.stack` | стек вызовов |
| `context` | произвольный контекст (то, что добавил middleware/хендлер) |

> Заметка
>
> JSON показан в развёрнутом виде для читаемости — в реальных логах каждая запись сериализуется **в одну строку**.

## Health-пробы (Kubernetes)

Сервис должен предоставлять два эндпоинта для проб Kubernetes:

| Проба | Endpoint | Семантика | Ответы |
| --- | --- | --- | --- |
| `livenessProbe` | `/livez` | процесс жив (иначе под перезапускается) | `200 OK` / `503 Service Unavailable` |
| `readinessProbe` | `/healthz` | сервис готов принимать трафик | `200 OK` / `503 Service Unavailable` |

Пример фрагмента манифеста:

```yaml
livenessProbe:
  httpGet:
    path: /livez
    port: 80
readinessProbe:
  httpGet:
    path: /healthz
    port: 80
```

## Масштабирование (HPA)

Платформа Artube автоматически управляет масштабированием сервисов через **Horizontal Pod Autoscaler (HPA)** Kubernetes. При росте нагрузки количество подов вашего сервиса увеличивается автоматически — вам не нужно настраивать масштабирование самостоятельно.

> Совет
>
> Ваш сервис должен быть **stateless** (см. [Архитектура игры](architecture.md)), чтобы горизонтальное масштабирование работало корректно: любой под должен уметь обработать любой запрос без зависимости от локального состояния.

## CI/CD

Партнёру выдаётся доступ к **спейсу (группе репозиториев) в GitLab**, имя спейса равно **publicGameId** игры. Внутри спейса создаются два репозитория: **`client`** (фронтенд) и **`server`** (бэкенд). В каждый репозиторий необходимо добавить файл **`.gitlab-ci.yml`**.

> Осторожно
>
> `docker-compose` **не поддерживается**. Деплой выполняется только через GitLab CI → Docker images → ArgoCD.

### Git flow

| Ветка | Окружение |
| --- | --- |
| `develop` | dev (тестовое) |
| `prod` | prod (продакшн) |

### `.gitlab-ci.yml` для клиентского репозитория (фронтенд)

```yaml
include:
  - project: 'artube-888-group/devops/ci-template'
    ref: main
    file: '/frontend/profiles/frontend-static.yml'

variables:
  R2_GAME_ID: "<publicGameId>"  # имя выданного спейса в GitLab; ОБЯЗАТЕЛЬНО
```

Замените `<publicGameId>` на имя вашего спейса (группы репозиториев) в GitLab.

### `.gitlab-ci.yml` для серверного репозитория (бэкенд)

```yaml
variables:
  GAME_ID: "<publicGameId>"           # имя выданного спейса в GitLab
  GIT_HASH: "$CI_COMMIT_SHORT_SHA"    # пробрасывается в docker build → /api/version

stages:
  - build-images
  - argocd-image-update

docker-dev:
  extends: .build-images-base
  only:
    - develop

docker-official:
  extends: .build-images-base
  only:
    - prod

argocd-image-update:
  extends: .argocd-image-update

argocd-image-update-prod:
  extends: .argocd-image-update-prod
```

> Заметка
>
> `GIT_HASH` пробрасывается в Docker build как build-arg и позволяет эндпоинту `/api/version` вернуть текущий коммит. Если общий CI-шаблон не форвардит build-args автоматически, обратитесь к DevOps с просьбой добавить `--build-arg GIT_HASH=$CI_COMMIT_SHORT_SHA`.

## Связанные разделы

- **[Хостинг и развертывание](hosting.md)** — общий процесс хостинга backend и frontend
- **[Инфраструктура как сервис](infrastructure.md)** — обзор платформенных сервисов
- **[Руководство по подключению API](backend/api-connection-guide.md)** — коннекты/реконнекты к Artube Games API
- **[Общая информация](../overview/general-information.md)** — требования к backend-стеку
