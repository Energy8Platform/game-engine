# Проводник взрослеет — дизайн

Дата: 2026-09-16. Ветка `feat/slot-webide-cordis`, от `0d4be90`.
Родительская спека: `2026-08-27-slot-webide-cordis-design.md` — §5 экран
«Файлы», §7 «всё — плагин». Пользовательские истории 2 и 3 из списка
2026-09-16: «в проводнике просматривать медиа (картинки, gif, видео, звук)»
и «добавлять/удалять папки и файлы, перетаскивать файлы из папки в папку».
Пользователь выбрал DnD «оба»: перемещение внутри проводника и бросок из
Finder на папку.

## 1. Зачем (измерено)

- Хост (`engine/ide/host/src/plugins/files.ts`): `tree/read/write/remove`;
  `GET /api/files/*` отдаёт байты с mime (картинки, `mp3/wav/ogg`; видео
  нет); `DELETE` отказывает папке (`is-directory`); `mkdir`, `rename`,
  `move` — нет. `describeRefusal` защищает только `.git`; `node_modules`
  пропускается в `tree`, но записать/удалить в нём можно.
- Клиент: `Explorer.tsx` — плоский список с фолдом папок, upload только в
  корень, удаление файла с confirm-рядом; `openPath` жёстко выбирает
  `EditorDocument` по `EDITABLE_EXTENSIONS`, иначе `ViewerDocument`
  (картинка → `<img src={files.urlFor}>`, текст, `binary`). Аудио/видео
  показываются как `binary`. Контрибуции для документов нет.
- `files/written` слушает `dev-game.ts` — `.spin` перезапускает
  `e8-server`.

## 2. Решения

| Вопрос | Решение | Почему |
|---|---|---|
| Новые глаголы хоста | `FilesService += mkdir(path)`, `create(path)` (пустой файл), `move(from, to)`; `remove(path)` удаляет папку рекурсивно | Четыре операции проводника; `rename` = `move` в ту же папку |
| Провод | `POST /api/files/*splat` `{ kind: 'dir' \| 'file' }` → `mkdir`/`create`; `PATCH /api/files/*splat` `{ to }` → `move`; `DELETE` без изменений (папка теперь разрешена) | REST по существующему префиксу; тело JSON как у `PUT` |
| Правила `move` | Оба пути через `describeRefusal`; `to` существует → `exists`; `to` внутри `from` (папка) → `into-self`; лист-симлинк → `is-symlink` (как сейчас); `renameSync` (один том — проект одна папка, симлинки отвергнуты); после успеха `ctx.emit('files/removed', { path: from })`, `ctx.emit('files/written', { path: to })` | Перенос `.spin` перезапускает `e8-server` тем же слушателем |
| Правила `mkdir`/`create` | Родитель должен существовать (`not-found`), путь занят → `exists`; `create` пишет 0 байт через тот же `O_NOFOLLOW`-путь, что `writeOne` | Без `recursive`: проводник создаёт по одному уровню |
| Защита | `PROTECTED_DIRS = {.git, node_modules, .e8}` — для write/move/remove/mkdir/create; чтение `tree` пропускает как раньше | Дыра группы C закрывается тем же множеством |
| Mime | `+ .mp4 video/mp4`, `.webm video/webm`, `.m4a audio/mp4`, `.ogv video/ogg` | Что реально кладут в слоты |
| Коды отказа | `FileFailure += 'exists' \| 'into-self'`; статус: `not-found` → 404, остальное 400 | `statusFor` уже по коду |
| Клиент `ctx.files` | `+= mkdir(path)`, `create(path)`, `move(from, to)` — те же `DiagnosticsResponse` | Тонкие обёртки как `write`/`remove` |
| Контрибуция `viewers` | Новый клиентский плагин `plugins/viewers.ts`: `register({ id, match(path, entry?) → boolean, component: ComponentType<{ ctx; path; entry? }> }) → retract`; `pick(path, entry?)` — последний зарегистрированный подошедший; `list/subscribe`; повтор `id` — замена с warning (как `slots`) | «Всё — плагин»: проектный плагин добавляет свой viewer (spine и т.п.) |
| Выбор документа | `openPath`: `viewers.pick` → его компонент; иначе `EDITABLE_EXTENSIONS` → `EditorDocument`; иначе `ViewerDocument` (текст/binary) | Viewer'ы впереди редактора: `.svg` — картинка, не текст (как сейчас) |
| Viewer'ы ядра | Плагин `plugins/viewers-media.ts`: `image` (`IMAGE_EXTENSIONS`, переносится из `ViewerDocument`), `audio` (`.mp3 .wav .ogg .m4a` → `<audio controls src={urlFor}>`), `video` (`.mp4 .webm .ogv` → `<video controls>`); `ViewerDocument` остаётся текст/binary | Нативные элементы, ноль зависимостей |
| Explorer: создание | Кнопки заголовка «new file», «new folder»; целевая папка — выбранная строка (папка или папка файла), иначе корень; inline-инпут в дереве, Enter — вызов, Escape — отмена, пустое/`/`/`..` — отказ на клиенте с той же формулировкой, что у хоста | Как VS Code |
| Explorer: меню | Правый клик по строке → меню (`role="menu"`): папка — New file, New folder, Upload here, Rename, Delete; файл — Rename, Delete; Escape/клик вне — закрыть | Глаголы там, где объект |
| Rename | Inline-инпут с текущим именем; Enter → `move(path, dir/newName)`; открытая вкладка старого пути закрывается (`force`) и открывается по новому | Ключ вкладки — путь; перевесить ключ шелл не умеет |
| Delete папки | Confirm-ряд: `delete folder "x" and N entries?` (N из `entries`) | Необратимо — как у файла |
| DnD внутри | Строки `draggable`; `dragstart` кладёт `text/x-e8-path`; папки и корневая область — drop-цели с классом `e8-drop-target` на `dragover`; drop → `move(from, dir/basename)`; drop на себя/в своё поддерево — ничего (хост всё равно откажет `into-self`) | HTML5 DnD, без библиотек |
| DnD из ОС | `dataTransfer.files` на папку/корень → существующий `upload(dir/name, bytes)` с overwrite-confirm | Тот же путь загрузки |
| После действия | Дерево перечитывается `tree()` только по ответу хоста без диагностик; отказ — в action-ряд, дерево не меняется | Правило «показываем, что подтвердил хост» |
| Вне | Мультивыбор, copy/paste, undo, ленивое дерево, «open with», spine-viewer, копирование (Alt-drag) | Следующие срезы |

## 3. Провод

```
POST   /api/files/*splat   { kind: 'dir' | 'file' }  → 200 { diagnostics: [] } | 400/404 { diagnostics }
PATCH  /api/files/*splat   { to: string }            → 200 { diagnostics: [] } | 400/404 { diagnostics }
DELETE /api/files/*splat                              → как сейчас; папка — рекурсивно
Events: files/removed { path }   (новое, при move и remove)
        files/written { path }   (как сейчас; move эмитит для `to`)
FileFailure += 'exists' | 'into-self'
```

```ts
// client
interface FilesService { …; mkdir(path): Promise<DiagnosticsResponse>; create(path): …; move(from, to): … }
interface ViewerDef { id: string; match(path: string, entry?: FileEntry): boolean; component: ComponentType<{ ctx: Context; path: string; entry?: FileEntry }> }
interface ViewersService { register(def): () => void; pick(path, entry?): ViewerDef | undefined; list(): readonly ViewerDef[]; subscribe(fn): () => void }
```

## 4. Отказ — это данные

- Все отказы хоста — `fileDiagnostic` с кодом; тело `POST`/`PATCH` не JSON
  или без `kind`/`to` → `malformed-request` 400.
- `move` на существующий путь никогда не перезаписывает; `into-self`
  проверяется до `renameSync`; частично выполненных операций нет
  (`renameSync` атомарен; `rmSync` папки — если упал посередине, `io-error`
  и `tree()` покажет, что осталось).
- Клиент: имя с `/`, пустое, `.`/`..` — отказ до запроса, диагностика
  `files`/`malformed-request` в action-ряд.
- `viewers.pick` не нашёл — не отказ, обычный путь (`Editor`/`ViewerDocument`).

## 5. Проверка

Хост (`files.test.ts`): `mkdir` создаёт/`exists`/родитель отсутствует;
`create` 0 байт/`exists`/через симлинк отказ; `move` файл, папка, rename в
той же папке, `exists`, `into-self`, `.spin` → `files/written` с новым
путём и `files/removed` со старым; `remove` папки рекурсивно, `.git`/
`node_modules`/`.e8` — `protected-path` для всех глаголов; `.mp4` mime.
Клиент: `files` обёртки (метод, URL, тело); `viewers` (register/replace/
retract/pick — последний побеждает); `openPath` выбирает viewer, потом
Editor, потом ViewerDocument; `viewers-media` — `<audio>`/`<video>` с
`src` от `urlFor`; Explorer — new file/folder через inline-инпут (Enter/
Escape), меню по правому клику, rename закрывает и открывает вкладку,
delete папки с N, DnD (`fireEvent.dragStart/dragOver/drop` с
`dataTransfer` — внутренний и с `files`), отказ хоста не меняет дерево.
Playwright (`explorer.spec.ts`): new folder `assets` → new file в ней →
rename → `dragTo` файла `game/spec.json` в `assets` — на диске переехал
→ drop из ОС (`DataTransfer` с `File`, `page.evaluate`)
→ `.mp3` открывается `<audio>` → delete папки с confirm → перенос
`game/script.spin` в другую папку даёт `e8-server restarting` в статус-баре.
Полная сюита.

## 6. Риски

| Риск | Что делаем |
|---|---|
| Перенос `game/script.spin` ломает `e8.yml`/спецификацию проекта | e2e проверяет только событие; спека не запрещает — это ошибка пользователя, диагностика `session` покажет |
| HTML5 DnD в Playwright (`dragTo`) не даёт `dataTransfer.files` | OS-drop в e2e через сконструированный `DataTransfer` в `page.evaluate`; в юнитах — `fireEvent.drop` |
| `renameSync` через тома (проект на другом томе относительно…) | Оба пути внутри одной папки проекта; симлинки отвергнуты — EXDEV невозможен; при `io-error` — диагностика |
| `IMAGE_EXTENSIONS` в двух местах (`ViewerDocument`, `viewers-media`) | Переезжает в `viewers-media`, `ViewerDocument` больше не знает о картинках |
