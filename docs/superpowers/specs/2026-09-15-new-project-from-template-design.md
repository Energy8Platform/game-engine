# Новый проект из шаблона — дизайн

Дата: 2026-09-15. Ветка `feat/slot-webide-cordis`, от `18a78a3`.
Родительская спека: `2026-08-27-slot-webide-cordis-design.md` §3 (проект:
профиль, бандлы, патчи; «шаблон игры становится бандлом»), §5 («Воркспейс —
первое, что видишь: твои игры. Новый проект из бандла-шаблона здесь же»),
§6 (проект адресуется id). Срез 9: `2026-09-13-one-process-n-projects-design.md`
(сервис `workspace`, Проекты в sidebar).

## 1. Зачем

Воркспейс показывает проекты и открывает их; создать новый можно только
руками — скопировать `engine/examples/first-slot` и переименовать. Это
именно то, что §5 обещал делать в IDE. Срез добавляет одно действие:
**«New project» из шаблона** — и ничего больше.

## 2. Что такое шаблон (измерено)

Проект, который можно открыть и сыграть, — это каталог из девяти файлов:
`e8.yml` (IDE-плагины), `e8.profile.yml` (бандлы), `e8.patch.yml`
(дельта), `game/spec.json`, `game/script.spin`, `index.html`, `src/main.ts`
(страница игры — 726 строк, композиция через `createGame`), `package.json`,
`tsconfig.json`. §3 родительской спеки делает шаблоном **бандл** — и это
верно для состава, но страница игры (`index.html`, `main.ts`) бандлом не
описывается. Поэтому шаблон в этом срезе — **каталог**, а бандл `e8-base`
— то, что его профиль стакает. Когда страница игры станет строкой состава,
шаблон схлопнется до профиля; каталог этому не мешает.

Зависимости: внутри `engine/examples/*` (`workspaces: engine/*/*`) пакеты
`@energy8engine/*` резолвятся из корневого `node_modules` без `npm install`
— так живёт e2e-фикстура `projectCopy()`. Вне монорепы `npm install` нужен
— это следующий срез (или облачный образ с предустановленным деревом).

## 3. Принятые решения

| Вопрос | Решение | Почему |
|---|---|---|
| Где шаблоны | `engine/templates/<id>/` с манифестом `e8.template.yml { name, description }`; переопределение `E8_TEMPLATES=<dir>` | Один каталог на локали и в образе; манифест — чтобы список был данными |
| Первый шаблон | `slot-basic` = `first-slot` без `plugins/` и без строк `screendemo1`/`reel-step`; плейсхолдер `{{id}}` в `package.json`.`name`, `game/spec.json`.`id`/`name`, `index.html` `<title>` | Единственный проверенный скелет; `first-slot` остаётся эталоном с плагинами |
| Кто копирует | Хост: `workspace.create({ template, id })` → `cpSync` без `node_modules`, подстановка `{{id}}` в трёх файлах, `rescan()`, `open(id)` | Браузер не трогает ФС (§6.1) |
| Id проекта | `^[a-z0-9][a-z0-9-]{0,63}$`, не существует в корне | Это имя каталога и `game_id` |
| Когда нельзя | Корень сам проект (`e8 dev`) → `templates: []`, форма не рисуется; неизвестный шаблон / плохой id / существует → 400 с диагностикой; копирование упало → 500, частичный каталог удаляется | Отказ — данные |
| Что после | Созданный проект открыт, Explorer показывает его дерево, превью спинит | «Здесь же» — значит сразу в работе |
| Вне | Удаление, переименование, `npm install` вне монорепы, шаблон из npm-пакета, выбор бандлов в форме | Следующие срезы |

## 4. Хост

```ts
interface Template { id: string; name: string; description: string }
interface WorkspaceState { …; templates: Template[] }      // [] когда создавать нельзя
interface WorkspaceService { …; create(input: { template: string; id: string }): Promise<Diagnostic[]> }
```

Плагин `workspace` получает `templatesDir` (по умолчанию
`resolve(repo, 'engine/templates')` от `import.meta.url`, как `REPO_BUNDLES_DIR`
в `project.ts`; `E8_TEMPLATES` переопределяет). Сканирование: подкаталоги с
файлом `e8.template.yml`; манифест без `name` → диагностика `workspace`, шаблон
не в списке. `create`: сериализован той же цепочкой, что `open`; проверка id,
существования, шаблона; `cpSync(template, join(root, id), { filter: !node_modules })`;
подстановка `{{id}}` в `package.json`, `game/spec.json`, `index.html`
(только эти три — список в коде и в манифесте не нужен); `rescan()`;
`open(id)`; при ошибке копирования — `rmSync(join(root,id))` и диагностика.
Роут `POST /api/workspace/create` → `WorkspaceState` | `DiagnosticsResponse`
(400 / 500 как у `open`). `rootIsProject` → `templates: []` и `create` отвечает
диагностикой «this folder is a single project; run e8 in a folder of projects».

## 5. Клиент

`Projects` sidebar: под списком — секция «New project»: `<select>` шаблонов
(`name`, `description` подписью), `<input>` id (плейсхолдер `my-slot`),
кнопка `Create` (disabled, пока id не по маске); submit → `workspace.create`
(POST); успех — состояние приходит кадром, проект активен, форма очищена;
отказ — диагностики под формой и в панели (через `connection.report`, как у
`open`). Секция не рисуется, когда `templates.length === 0`. Клавиатура:
Enter в поле = Create.

## 6. Отказ — это данные

- Плохой id → 400, форма подсвечивает поле, панель получает строку.
- Существующий id → 400 «project "x" already exists».
- Шаблон без манифеста или без `name` → не в списке + диагностика в `state`.
- Копирование упало посреди → каталог удалён, 500, ничего не открыто.
- `create` во время `open` → ждёт своей очереди.

## 7. Проверка

Юниты (хост): список шаблонов (валидный / без манифеста / без `name` /
`E8_TEMPLATES`); `create`: id по маске, существующий, неизвестный шаблон,
успех → каталог, подстановка в трёх файлах (`{{id}}` нигде не остался),
`node_modules` не скопирован, `state.projects` содержит id, `active === id`;
ошибка копирования (шаблон с нечитаемым файлом) → каталога нет, диагностика;
`rootIsProject` → `templates: []`, `create` отказ; сериализация с `open`.
Роут: 200/400/500. Клиент: форма рисуется/не рисуется, кнопка по маске,
submit → POST с телом, отказ → строки под формой + `report`.

Playwright (`new-project.spec.ts`): `startHost` на двух проектах → форма
видна, выбрать `slot-basic`, ввести `third-slot`, Create → `project-third-slot`
активен, `explorer-game/script.spin` виден, превью спинит (`#status`);
`e8 dev` (одиночный проект) → формы нет; плохой id → кнопка disabled; id
существующего → строка «already exists». Полная сюита 82 + новые.

## 8. Риски

| Риск | Что делаем |
|---|---|
| `first-slot/src/main.ts` меняется, шаблон отстаёт | Тест сравнивает `slot-basic/src/main.ts` с `first-slot/src/main.ts` байт-в-байт (шаблон — копия; расходятся только `plugins/` и три файла с `{{id}}`) |
| Новый проект в `engine/examples/` попадает в git | `.gitignore`: `engine/examples/*` кроме `first-slot`, `probe-plugin`, `workspace` — измерить, что есть сейчас (`e8-compose-*` уже игнорируется?) |
| Vite-кэш `first-slot`'а мешает соседу | У каждого проекта свой `root`; `optimizeDeps` per root — уже так у `e8-compose-*` |
