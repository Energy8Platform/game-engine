# Срез долгов: видимые мелочи, отзыв диагностик, косметика и язык — дизайн

Дата: 2026-09-14. Ветка `feat/slot-webide-cordis`, от `df64042`. Источник —
записки `notes/2026-09-1{0,1,3,4}-slice-{5,6,7,8,9}-carried-forward.md`.
Пользователь выбрал группы A, B, D и политику языка «весь английский».

## 1. Зачем

Девять срезов оставили список того, что «записано, не решено». Часть
видна каждому запуску (`e8-server ●` после смерти процесса; «не удалось
перезапустить» висит после починки; `Cmd+S` открывает диалог браузера на
вкладке «Состав»), часть — несогласованность, за которую платит каждый
следующий срез (смешанный язык интерфейса, 16 файлов без prettier).
Срез гасит их одним проходом, без новых способностей.

## 2. Решения

| # | Долг | Решение | Почему так |
|---|---|---|---|
| B1 | У общего списка нет отзыва: хост копит, клиент только заменяет | **Хост:** `reportGameDiagnostics(speaker, list)` — список хоста группируется по говорящему; вызов **заменяет** группу `speaker` (пустой список — снимает); провод не меняется, кадр `source:'host'` несёт весь список. **Клиент:** `connection.report(d)` возвращает `() => void` — отзыв по идентичности записи | Ни `Diagnostic`, ни `ServerMessage` не меняются; «отзыв» — свойство говорящего, а не строки |
| B2 | Проверка редактора не идёт в панель (§8 спеки) | `EditorDocument` держит отзывы прошлой проверки, отзывает, докладывает новую; отказ сохранения отзывается следующим удачным сохранением | Следствие B1; §8 восстанавливается |
| A1 | `SessionStatus` не возвращается к ○ после смерти `e8-server` | `E8Handle.onExit(cb)`; `session-dev` при неожиданном выходе текущего процесса: `handle = null`, `startupDiagnostic` = «the math engine exited (exit code=…)» с `code: 'exited'`, `ctx.emit('session/exited', diag)`; `dev-game` слушает и `reportGameDiagnostics('session', [diag])`; удачный перезапуск — `reportGameDiagnostics('session', [])`. `SessionStatus`: `code === 'exited'` → `e8-server ○ exited`; `restarting` → как сейчас; иначе ● | Смерть — факт хоста; статус читает код, не прозу |
| A2 | `Cmd/Ctrl+S` на не-редакторе открывает диалог; Safari `beforeunload` | Один `keydown` в `Shell.tsx`: `Cmd/Ctrl+S` → `preventDefault` всегда; редактор сохраняет, как сейчас. `beforeunload`: `event.returnValue = ''` рядом с `preventDefault` | Диалог «сохранить страницу» в IDE не нужен никогда |
| A3 | Отозванный вклад `shell.document` оставляет незакрываемую вкладку | `shell` помнит ключи открытых **вкладов**; в `onSlotsChange`: вклад исчез → `close(key, { force: true })` и `warning shell <key> "document withdrawn by its plugin"` | Класс «пустая область»; первым решением срез 8 обещал |
| A4 | Без активного проекта открывается «Состав» с «подключение…»; счётчик в подтверждении | `App`: композиция по умолчанию открывается, только когда `workspace.state().active !== null` (решение по первому состоянию, как у sidebar); текст `doc-none`: «no document is open — open a project from Projects, or a file from the Explorer». Подтверждение: «unsaved changes in N document(s) will be lost — switch?» | Пустая группа честнее ложного «подключение…» |
| A5 | Нет клавиатуры в списках | `Enter`/`Space` = клик в строках Проекты и Проводник (общий `onActivate`) | Минимум доступности |
| A6a | `runtimeUrl` без превью | `runtime-assets`: `runtimeUrl = devGameRoot ? '/plugin-runtime/<id>' : null` (реактивный `inject` уже есть) | Loader трактует `null` как «нечего грузить» |
| A6b | На preview-сервере нет `URIError → 400` | Граница выносится в `installErrorBoundary(server)`; вызывается для корня и для `preview` | Одно тело, два сервера |
| A6c | Клиентская половинка с тем же id из другого проекта — из кэша браузера | `composition` получает `clientNonce` (случайный на каждый `project-scope`), `clientUrl` = `/plugin-client/<id>?v=<nonce>` | Кэш модулей ключуется URL |
| A6d | `IDE_ORIGINS` нигде не описан | Строка в `usage` CLI и в README хоста | — |
| A6e | `globalSetup` пересобирает `dist` всегда | Пропуск, если `dist/index.html` новее всех файлов `src/` ide-web и ide-client | 3 с на каждый `-g` |
| A6f | Таймаут Playwright 30 с флапает | `timeout: 60_000` в `playwright.config.ts`; `runtime.spec.ts` свой 60 с убирает | Один бюджет |
| D1 | Ручка-разделитель — одна точка | `radial-gradient(circle, currentColor 1px, transparent 1px) 0 0 / 2px 5px repeat-y` на `2×12` `::after` — три точки без `box-shadow` | Guard теней держится |
| D2 | Цветовой guard пропускает `[data-theme='light'] .x` | Regex `^\[data-theme='light'\]\s*{[^}]*}` с флагом `m` | — |
| D3 | 16 файлов без prettier | `prettier --write` отдельным коммитом; `npm run format` в корне охватывает `engine/**` | Чтобы больше не копилось |
| D4 | Смешанный язык | **Весь интерфейс — английский.** Таблица §3. Тесты, e2e и `screen-demo` следуют. `DESIGN.md`/правило копирайта: «English throughout; localisation — a dictionary later» | Решение пользователя |

Вне среза: группа C (жёсткая ссылка, `node_modules`, multipart, потолок
дерева), компоненты с корневым `ctx`, три сокета на вкладку, `at` без
колонки, `EditContext` в приёмке.

## 3. Словарь D4

| Было | Стало |
|---|---|
| Проводник | Explorer |
| Проекты | Projects |
| Состав | Composition |
| Превью | Preview |
| Диагностика | Diagnostics |
| загрузить файл | upload file |
| удалить | delete |
| нет проектов в этой папке | no projects in this folder |
| подключение… | connecting… |
| состав пуст | the composition is empty |
| горячий | hot |
| перезапуск | restart |
| ждёт / грузится / активен / сбой / выгружен / выгружается | pending / loading / active / failed / disposed / disposing |
| превью игры (title) | game preview |
| `screen-demo`: заголовок/текст вклада | как в плагине, английский |

## 4. Отказ — это данные

- Смерть `e8-server` — диагностика `session` с `code: 'exited'`; следующее
  сохранение `.spin` перезапускает и снимает её; спин до перезапуска
  отвечает той же диагностикой (как сегодня `startupDiagnostic`).
- Отозванный документ — `warning`, не ошибка; вкладка закрыта силой;
  грязный редактор в отозванном вкладе невозможен (вклады не редакторы).
- `report()` отзыв дважды — no-op.
- Нет `workspace`-состояния при загрузке — композиция не открывается до
  первого состояния; глубокая ссылка — как сейчас (`pending`).

## 5. Проверка

Юниты: `rpc` — замена группы по говорящему, пустой список снимает группу,
чужие группы не тронуты; `connection.report` — отзыв по идентичности, дважды
no-op, снимок хоста не трогает клиентские; `EditorDocument` — вторая проверка
отзывает первую, удачное сохранение отзывает отказ; `session-dev` — выход
процесса → `exited`-диагностика, событие, `play()` отвечает ею, `restart()`
снимает; `dev-game` — событие доходит до `reportGameDiagnostics('session', …)`;
`SessionStatus` — ○ по `exited`; `shell` — отзыв вклада закрывает вкладку с
предупреждением; `Shell` — `Cmd+S` `preventDefault` на любой вкладке,
`returnValue`; `App` — композиция не открывается без активного проекта;
`Projects`/`Explorer` — `Enter`/`Space`; `runtime-assets` — `runtimeUrl: null`
без `devGameRoot`; `composition` — `clientUrl` с nonce; `styles.test` — новый
regex ловит `[data-theme='light'] .x { color: #fff }`; guard теней и радиусов
зелёные при трёх точках.

Playwright (живой хост): (1) убить `e8-server` (`process.kill(pid)`) → статус
`e8-server ○ exited`, сохранить `.spin` → ●, и строка `exited` ушла из
панели; (2) сломать `.spin`, сохранить → «не удалось перезапустить» в панели,
починить, сохранить → строка ушла; (3) ошибка проверки в редакторе видна в
панели и уходит после исправления; (4) `e8` в папке проектов без клика —
группа документов пуста с текстом про Projects; (5) все 77 тестов после
словаря; (6) `Cmd+S` на вкладке Composition — `beforeunload` не вызван,
диалога нет (проверяется через `page.on('dialog')` и отсутствие `pageerror`).

Каждое утверждение — с мутацией и счётчиком до/после.

## 6. Риски

| Риск | Что делаем |
|---|---|
| Словарь сломает e2e по тексту | Тесты по testid; текстовые утверждения меняются в одном коммите со словарём; список файлов измерен (17) |
| `onExit` после `stop()` примут за смерть | Флаг `stopping` в `session-dev`; `onExit` учитывается только у текущего `handle` вне `stop` |
| Группировка по говорящему сломает спин-путь (`/api/spin` докладывает от `session`) | Спин докладывает `reportGameDiagnostics('spin', …)` — свой говорящий; тест на два говорящих |
| Prettier-коммит зашумит `git blame` | Отдельный коммит, только форматирование, без правок |
