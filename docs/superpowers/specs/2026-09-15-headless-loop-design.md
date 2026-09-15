# Headless-петля: `e8 check`, `e8 spin`, `e8 shot`, бюджет загрузки — дизайн

Дата: 2026-09-15. Ветка `feat/slot-webide-cordis`, от `d73deed`.
Родительская спека: `2026-08-27-slot-webide-cordis-design.md` — §5 (`compute`:
`e8 check`, `e8 simulate`, `e8-server`), §6 (шов `compute`: локально дочерние
процессы, в облаке очередь), §9 (headless-петля: игра грузится, спин
крутится, каскад доигрывает, время загрузки в бюджете; канвас — через RPC),
§10 п.6 (петля проходит целиком). Пользователь выбрал «агентский CLI + бюджет».

## 1. Зачем

Агент (deepseek-harness поверх IDE) должен уметь проверить математику,
прогнать спины и посмотреть на игру **без браузера в руках**: три команды,
JSON на stdout, диагностики тем же типом, что в панели. Сегодня проверка
есть только как `POST /api/check`, прогона спинов нет, скриншота нет,
бюджет загрузки не измеряется. Часть §9 уже закрыта e2e-сюитой (84 теста:
спин, каскад, RPC в канвас через `window.__e8`).

## 2. Что есть (измерено)

- `parseSpinSchema(source)` (`engine/core/spin-parser`) — чистая функция
  → `{ schema, diagnostics }`; `/api/check` — обёртка над ней.
- `@energy8engine/session-dev`: `session.apply(ctx, { gamesDir, gameId?, port, binPath?, serverSeed? })`,
  `ctx.session.play({ gameId, action, betLevel }) → SpinResult { win, totalWin, bet, stage, data, roundComplete, … }`
  (`win` — множитель ставки); `startupDiagnostic`; дочерний `e8-server`.
- CLI `engine/apps/cli` (`e8 [ide|dev]`), `tsx`-загрузчик, зависит от `ide-host`.
- Playwright Chromium установлен для `engine/apps/web`; в CLI зависимостей
  на браузер нет.
- e2e `runtime.spec.ts` ждёт `#status` игры, время не меряет.

## 3. Решения

| Вопрос | Решение | Почему |
|---|---|---|
| Где живёт логика | `engine/ide/host/src/compute/{check,spin,shot}.ts` — чистые функции `(input) → Promise<Result>`; CLI печатает JSON | Тот же код позже встанет за `POST /api/compute/*` и кнопку в IDE; §6 шов — функция, а не процесс |
| `e8 check [file]` | `readFile` → `parseSpinSchema` → `{ diagnostics, schema? }`; `exit 1` при `error` | Без хоста, без сервера |
| `e8 spin` | `--n 100 --bet <первый betLevel> --seed <hex> --action spin`; `session.apply` на голом `Context`; N × `play`; отчёт `{ spins, bet, rtp, hitRate, maxWin, avgWin, stages: {…}, wins: {p50,p90,p99}, seed, scriptSha256, diagnostics }`; при `startupDiagnostic` — отчёт только с диагностикой, `exit 1` | Ровно то, что смотрит человек в панели математики; детерминизм через `serverSeed` |
| `e8 shot` | `--out <png>` (по умолчанию `.e8/shots/<ISO>.png`), `--viewport 480x288`, `--spin` (нажать `#spin`, дождаться смены `#status`), `--ide` (снять оболочку IDE, а не игру — нужен `dist`); поднимает хост как `e8 dev` (`root = cwd`), берёт `previewUrl`, `chromium.launch()` из `playwright`, ждёт `#status` непустой (это готовность игры — §9), снимает, гасит хост; stdout `{ path, width, height, loadMs, diagnostics }` | Один процесс, тот же хост, тот же превью-origin |
| Браузер | `playwright` — зависимость CLI-пакета; в `ide-host` — `import('playwright')` динамически, отсутствие → диагностика `compute` с fix `npx playwright install chromium` | `ide-host` не тянет Chromium ради IDE |
| Бюджет загрузки | e2e: от `page.goto(gameUrl)` до `#status` непустого ≤ **`LOAD_BUDGET_MS`** — измерить на трёх прогонах, взять 3× медианы, записать число и измерение в тест; `e8 shot` печатает `loadMs` тем же способом | «Время в бюджете» §9; число — из измерения, не из головы |
| Вывод | stdout — один JSON-документ; stderr — прогресс и человеческий текст; `exit 0/1`; `--quiet` гасит stderr | Агент парсит stdout, человек читает stderr |
| Вне | `e8 simulate` как полная RTP-симуляция с распределениями (есть `platform-core/bin/simulate` для Lua — другой мир), очередь/контейнер (§6 облако), кнопка в IDE, сравнение скриншотов с эталоном | Следующие срезы |

## 4. Отказ — это данные

- `.spin` не читается / не парсится → `diagnostics` в JSON, `exit 1`.
- `e8-server` не стартовал → `startupDiagnostic` в JSON, `exit 1`; процесс
  не остаётся (dispose как у `e8 dev`).
- Спин упал посреди N → отчёт по сыгранным + диагностика, `exit 1`.
- `playwright` не установлен / браузера нет → диагностика, `exit 1`, хост
  погашен.
- `#status` не появился за бюджет → скриншот всё равно снимается
  (что-то же на экране есть), `loadMs: null`, диагностика `warning`.
- `--ide` без `dist` → диагностика с подсказкой сборки.

## 5. Проверка

Юниты (`ide-host`): `check` — валидный/битый файл/отсутствующий; `spin` —
на реальном `e8-server` с фикстурой `first-slot`: `n=20`, `seed` фикс. →
`rtp` число, `hitRate ∈ [0,1]`, `maxWin ≥` каждого `win`, `stages` суммой N,
второй прогон с тем же seed даёт тот же `totalWin`; без бинаря → диагностика,
`exit`-семантика; `shot` — с фейковым `playwright` (инъекция `launch`):
путь, размеры, `loadMs`, `--spin` кликает; без `playwright` → диагностика.
CLI (`cli-smoke`): `e8 check` на `first-slot` → JSON без ошибок, на битом
→ `exit 1`; `e8 spin --n 5` → JSON с `spins: 5`; `e8 shot --out` → файл
PNG (сигнатура `89 50 4E 47`), `loadMs` число (реальный Chromium).

Playwright: `runtime.spec.ts` получает бюджет; `headless.spec.ts`:
`e8 shot --spin` против живого проекта даёт PNG и `loadMs ≤ LOAD_BUDGET_MS`;
`e8 spin --n 50` из того же проекта, `rtp` в разумных пределах (0.2–3).

## 6. Риски

| Риск | Что делаем |
|---|---|
| `playwright` в CLI тянет 300 МБ браузера при `npm install` | `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` не трогаем; в README CLI: `npx playwright install chromium` один раз; отсутствие — диагностика |
| Бюджет флапает под нагрузкой | Число — 3× медианы; тест печатает измеренное; провал говорит «medianа была X» |
| `e8 spin` на 1000 спинов через gRPC — секунды | Прогресс на stderr каждые 10%; `--n` по умолчанию 100 |
