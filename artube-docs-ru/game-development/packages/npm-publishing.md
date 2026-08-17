<!-- Source: https://docs.artube-888.live/ru/game-development/packages/npm-publishing/ -->

# NPM Publishing

## Обзор

Публикация пакетов в GitLab Package Registry для совместного использования кода между игровыми проектами.

В GitLab группе вашей команды будет находиться *репозиторий пакетов*, используйте его для публикации ваших пакетов, а также, при желании, для размещения их исходного кода.

## Конфигурация

### Настройка `.npmrc`

Добавьте файл `.npmrc` в ваш проект:

```ini
@your-scope:registry=https://gitlab.com/api/v4/projects/<PROJECT_ID>/packages/npm/
//gitlab.com/api/v4/packages/npm/:_authToken="${GITLAB_AUTH_TOKEN}"
//gitlab.com/api/v4/projects/<PROJECT_ID>/packages/npm/:_authToken="${GITLAB_AUTH_TOKEN}"
```

Замените:

- `@your-scope` на ваш scope пакета (например, `@artube`)
- `<PROJECT_ID>` на ID вашего GitLab проекта

### Создание GitLab токена

1. Перейдите на [GitLab Personal Access Tokens](https://gitlab.com/-/user_settings/personal_access_tokens)
2. Создайте новый токен со следующими областями видимости:

   - `api`
   - `read_registry`
   - `write_registry`
3. Скопируйте сгенерированный токен (формат: `glpat-...`)

### Установка переменной окружения

**Windows:**

```powershell
$env:GITLAB_AUTH_TOKEN=<your_token>
```

**Linux/MacOS:**

```bash
# Добавьте в ~/.zshrc или ~/.bashrc
export GITLAB_AUTH_TOKEN=<your_token>
```

## Структура пакета

Стандартный пакет должен содержать:

```plaintext
package-name/
├── src/
│   └── index.ts          # Точка входа для экспортов
├── dist/                 # Собранный bundle
├── tsconfig.json         # Конфигурация TypeScript
├── package.json          # Конфигурация пакета
└── CHANGELOG.md          # История версий
```

### Пример `tsconfig.json`

```json
{
  "extends": "../../tsconfig.json",
  "include": ["src"],
  "compilerOptions": {
    "rootDir": "./src/",
    "outDir": "./dist/"
  }
}
```

## Процесс публикации

1. **Обновите версию** в `package.json`
2. **Обновите CHANGELOG.md** (см. правила версионирования ниже)
3. **Выполните команду публикации:**

   ```bash
   npm publish
   ```

   Это запустит хуки для генерации документации и сборки артефактов
4. **Создайте git тег** по паттерну: `@scope/package-name/v1.0.0`
5. **Сообщите в командном канале**, приложив changelog

## Правила версионирования

Ведите файл `CHANGELOG.md` с такой структурой:

```markdown
# Changelog

## [Unreleased]
### Added
- Ticket [JIRA-123]: Описание новой функции

### Updated
- Ticket [JIRA-124]: Описание обновления

### Fixed
- Ticket [JIRA-125]: Описание исправления бага

## 1.0.0 - 2024-01-15
### Added
- Ticket [JIRA-120]: Начальная функциональность релиза

### Updated
- Ticket [JIRA-121]: Улучшения конфигурации

### Fixed
- Ticket [JIRA-122]: Критическое исправление бага
```

## Связанные разделы

- **[Общая информация](../../overview/general-information.md)** - обзор разработки игр
- **[BE теория](../backend/be-theory.md)** - серверная разработка
