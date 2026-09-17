# Сцены и слои — дизайн

Дата: 2026-09-17. Ветка `feat/slot-webide-cordis`, от `d346015`.
Родительская спека: `2026-08-27-slot-webide-cordis-design.md` — §4 «stage:
сцена, viewport, resize», §2 горячий форк, §7 «всё — плагин».
Пользовательская история 4 из списка 2026-09-16: «управлять сценами игры
(слоями), их переходами». Пользователь выбрал объём «модель + формы +
экран Scenes» одним срезом.

## 1. Зачем (измерено)

- `engine/game/stage`: один `Container` под design-разрешение; `reels`
  монтирует `board.view` прямо в `stage.container` через
  `ctx.inject(['stage'], …)`. Слоёв нет, сцен нет, переходов нет.
  `stage1` — `hot: false`, `design.*` — `applies: 'restart'`.
- «Сцена» в игре — стадия спина: `result.stage` (`enum SpinData tag
  stage` в `.spin`) выбирает механику в `presentStage(result.stage, data)`
  (`main.ts`, шаблон и `first-slot` побайтно равны). Смена стадии никого
  не оповещает; `first-slot` знает одну — `base_game`.
- cordis (срез 13): при re-provide сервиса `ctx.inject`-колбэк соседа
  срабатывает снова — `reels` перемонтируется в новый `stage` сам.
- Хост читает имена стадий из `.spin` (`checkActionStages` в
  `schema.ts`); композиция игры отдаёт строки со схемами; `PUT
  /api/composition/rows/:id` пишет `e8.patch.yml`; кадр
  `game-composition` доходит до игры через `/ide` и `ide-bridge`.
- `SchemaForm` умеет object/dict(string)/number/string/boolean/union;
  массивов и dict объектов — нет.
- `ide-rpc`: `broadcastGameComposition` — единственный кадр хост→игра
  кроме диагностик; `ServerMessage` перечислим.

## 2. Решения

| Вопрос | Решение | Почему |
|---|---|---|
| Слои | `stage1.config.layers: [{ id, z }]` (`z` — целое, порядок детей по возрастанию; равные — по порядку в массиве); `Stage.layer(id): Container \| undefined`; `Stage.layers(): readonly { id, z, container }[]` | Слой — контейнер под корнем; всё, что рисует, объявляет свой слой |
| Сцены | `stage1.config.scenes: dict(sceneId → { layers: string[]; transition?: string })`; `Stage.enter(sceneId): Promise<void>`; `Stage.current(): string \| null`; слой вне списка сцены — `visible = false`; сцена не объявлена → `enter` делает все слои видимыми и пишет диагностику `warning` один раз на id | Сцена — множество видимых слоёв; неизвестная сцена не ломает игру |
| Переходы | Сервис `ctx.transitions` (рантайм-половина `stage`): `register({ id, run(t: { from: Container[]; to: Container[]; ticker: Ticker; ms: number }): Promise<void> }) → retract`; коллизия id — инкумбент держит, `error`-диагностика (правило `mechanics`); встроенные `cut` (мгновенно) и `fade` (alpha 1→0 у `from`, 0→1 у `to`, `ms` из `stage1.config.transitionMs`, по умолчанию 300); выбор: `scenes.<id>.transition` иначе `stage1.config.transition` (по умолчанию `cut`); неизвестный id → `cut` + диагностика | Реестр — шов для плагинов; два встроенных ради двух функций |
| Кто входит в сцену | `presentStage` в `engine/templates/slot-basic/src/main.ts` и `first-slot/src/main.ts` (побайтно): `await (ctx.reflect.get('stage', false) as Stage \| undefined)?.enter(stage)` перед `mechanics.present`; повторный вход в текущую сцену — no-op | Единственное место, знающее `result.stage`; без сцен всё как сейчас |
| Горячесть | `stage` объявляет `hot: true`; `design.width/height` остаются `applies: 'restart'` → правка `layers`/`scenes`/`transition*` переприменяет строку, правка `design` перезагружает превью | Машинерия среза 13 (`restartKeys` верхнего уровня) уже такая |
| Перемонтаж | При re-apply `stage` старый корень уничтожается (как сейчас), новый провайдится; `reels`' inject-колбэк срабатывает снова и кладёт `board.view` в `stage.layer(config.layer)`; `reels1.config.layer: string` (по умолчанию `'reels'`); слоя нет → корень `stage.container` + `warning` | Тот же путь, что уже работает при горячем `reels`; спайк первой задачей |
| Что не трогаем | `renderer-pixi`, `play-loop`, `mechanics` | Сцена — про видимость и порядок, не про механику |
| Сверка на хосте | `project-scope`: `checkScenes(stageRow, spinSchema)` → композиционные диагностики speaker `scenes`: сцена без стадии в `.spin` — `warning`; стадия без сцены — `warning`; сцена ссылается на слой, которого нет в `layers` — `error`; дубли id слоёв — `error`. Пересчёт при `PUT` и при перечитывании `.spin` | Отказ — данные; см. `checkActionStages` |
| Формы | `SchemaForm`: поле `array` для `Schema.array(object)` — список карточек с `add`/`remove`/`↑`/`↓`; `dict` объектов — как `dict(string)`, но значение — вложенная форма; `commit: 'blur'` сохраняется | Нужно для `layers` и `scenes`; общий рендерер форм |
| Экран Scenes | Кнопка активности `Scenes` (иконка слоёв), документ `scenes`: слева список сцен из `stage1.config.scenes` (+ «add scene» с id из стадий `.spin`, которых ещё нет, или свой); справа слои (`layers` по `z`) с чекбоксом «в этой сцене», `↑`/`↓` по `z`, выбор `transition` из реестра (встроенные + зарегистрированные — список приходит из игры кадром, см. провод); кнопка «Show in preview» → `POST /api/scenes/preview { scene }`; все правки — `PUT /api/composition/rows/stage1` c полным `config` (как Composition) | Второй редактор той же строки; ни одного нового пути записи |
| Превью сцены | Хост: `POST /api/scenes/preview { scene }` (root only, Origin allowlist) → `ideRpc.broadcastScenePreview({ scene })` → кадр `{ type: 'scene-preview', scene }` всем `/ide`-сокетам превью; `ide-bridge` зовёт `stage.enter(scene)`; ответ 200 `{ diagnostics }` (400 если тело без `scene`) | Существующий канал |
| Список переходов в IDE | `ide-bridge` при подключении и при изменении реестра шлёт `{ type: 'game-transitions', ids: string[] }` (ClientMessage игры → превью `/ide` принимает его наряду с `game-diagnostics`); хост запоминает последний и отдаёт в `GET /api/composition` как `transitions: string[]` | Реестр живёт в игре; хост — зеркало |
| Вне | Контент слоёв кроме барабана; анимация z/масштаба; механика на сцену; загрузка ассетов по сцене; удаление/переименование слоя с перепривязкой строк; Undo | Следующие срезы |

## 3. Провод

```ts
// engine/game/stage — schema.ts (только schemastery)
Config = {
  design: { width, height }                                // restart, как сейчас
  layers: array({ id: string, z: number.default(0) }).default([{ id: 'reels', z: 0 }])
  scenes: dict({ layers: array(string), transition: string.optional })   // default {}
  transition: string.default('cut'), transitionMs: natural.default(300)
}
// engine/game/reels — schema.ts
Config += { layer: string.default('reels') }

// engine/game/stage — index.ts
interface Stage { container; layer(id): Container | undefined; layers(): readonly LayerView[]; enter(scene): Promise<void>; current(): string | null; resize; destroy }
interface TransitionsService { register(t: Transition): () => void; get(id): Transition | undefined; ids(): string[] }
declare module 'cordis' { interface Context { stage: Stage; transitions: TransitionsService } }

// contracts protocol.ts
ServerMessage += { type: 'scene-preview'; scene: string }
ClientMessage += { type: 'game-transitions'; ids: string[] }
CompositionResponse += { transitions: string[] }
// host
POST /api/scenes/preview { scene } → 200 { diagnostics: [] } | 400 { diagnostics }
IdeRpcService += broadcastScenePreview({ scene }); rememberTransitions(ids)
```

## 4. Отказ — это данные

- Неизвестная сцена в `enter` → все слои видимы, `warning` (один раз на id).
- Неизвестный переход → `cut` + `warning`; `run` бросил → `cut`
  доигрывает (видимость выставлена), `error`.
- Слой `reels1.config.layer` отсутствует → монтаж в корень + `warning`.
- `checkScenes` — три правила выше; экран рисует их рядом со сценой.
- `POST /api/scenes/preview` без превью (проект не открыт) → 200 с
  `warning` «no preview is running».
- `SchemaForm` массив: удаление последнего слоя разрешено (пустой массив
  → монтаж в корень с диагностикой) — форма не блокирует.

## 5. Проверка

Юниты: `stage` — слои по `z`, `layer(id)`, `enter` прячет/показывает,
`current`, повторный вход no-op, `cut`, `fade` по фейковому тикеру,
неизвестная сцена/переход → диагностика; `transitions` — регистрация,
коллизия, retract; `reels` — монтаж в слой и в корень при отсутствии;
re-apply `stage` под живым `reels` (спайк → тест): вид барабана в новом
слое, старый корень уничтожен; `ide-bridge` — `scene-preview` → `enter`,
`game-transitions` при подключении и после `register`; хост —
`checkScenes` три правила, `POST /api/scenes/preview`, `transitions` в
`GET /api/composition`; контракты; клиент — `SchemaForm` массив
(add/remove/↑/↓, blur-commit, внешний кадр не сбивает фокус), dict
объектов; экран Scenes — список, чекбоксы → `PUT` с полным `config`,
`Show in preview` → `POST`.

Playwright (`scenes.spec.ts`): (1) Scenes открывается, показывает
`base_game` и слой `reels`; (2) снять чекбокс `reels` в `base_game` →
превью **не перезагружено** (счётчик спинов/лог), барабан невидим
(`__e8` отдаёт `stage.layer('reels').visible`), `e8.patch.yml` содержит
`scenes.base_game.layers: []`; вернуть — виден; (3) добавить слой `ui`
с `z: 20` → форма/экран показывают порядок; (4) «Show in preview» на
сцене `free_spins` (добавленной с переходом `fade`) → `current()` в игре
= `free_spins`, слой `reels` виден/невиден по сцене; (5) правка
`design.width` по-прежнему перезагружает превью. Полная сюита.

## 6. Риски

| Риск | Что делаем |
|---|---|
| Re-apply `stage` уничтожает `board.view` вместе со старым корнем (`destroy({ children: true })`) | Спайк первой задачей: `stage.destroy` снимает детей слоёв без уничтожения (`removeChildren`) — контейнер чужой строки не наш; тест |
| `fade` на тикере под jsdom | Тикер — параметр `run`; в тестах фейковый; в игре `ctx.renderer.app.ticker` |
| Экран и Composition правят одну строку одновременно | Оба идут через `PUT` с полным `config` и оба слушают кадр `game-composition` — последний записавший побеждает, как у двух вкладок сегодня |
| `SchemaForm` массив ломает существующие формы | Массив — новый тип узла; существующие схемы без `array` не меняются; snapshot-тесты форм |
