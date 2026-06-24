# Design: `createSlotGame()` host — collapse the per-game bootstrap

Дата: 2026-06-21
Статус: согласован, готов к плану реализации
Контекст: второй срез из дорожной карты [docs/slots-analysis-and-bootstrapper.md](../../slots-analysis-and-bootstrapper.md) (§5.5 шаг 2). Опирается на первый срез — [game-spec/defineGame](2026-06-21-game-spec-define-game-design.md).

## Проблема

Каждая игра поверх `GameApplication` всё ещё несёт ~100–250 строк одинакового `main.ts`:
детект запуска в Stake (`hasStakeParams`), подъём `StakeBridge` с fallback-ошибкой, preload
шрифтов, Pixi texture-дефолты, сборку `GameApplicationConfig`, регистрацию сцены, `start()`,
top-level error-modal, защиту от двойного boot. Детект Stake и опции моста (`modeMap`, `gameId`)
копипастятся; `modeMap`/`gameId` теперь выводимы из `GameModel`.

## Цель среза

`createSlotGame(opts)` — тонкий хост в game-engine, оборачивающий `GameApplication` и
поглощающий всю эту обвязку. `main.ts` игры ужимается до ~20–30 строк: `defineGame` →
`createSlotGame({ model, scene, manifest, ... })`. Детект Stake переезжает в `stake-bridge`
(там, где ему место), хост его потребляет.

## Решения (зафиксированы в брейншторме)

- **Размещение хоста:** game-engine, под-путь `@energy8platform/game-engine/host` (оборачивает
  `GameApplication`/Pixi). Renderer-agnostic part (defineGame) уже в platform-core; хост —
  pixi-специфичен, поэтому в game-engine.
- **Детект Stake живёт в stake-bridge**, не в хосте. Новый leaf-модуль `src/detect.ts` →
  `isStakeLaunch(input): boolean` (non-throwing), + лёгкий sub-path `@energy8platform/stake-bridge/detect`
  (без кода моста), + re-export из главного index. Причина: `parseStakeUrl` бросает на не-Stake URL
  и тянет тяжёлый `RGSClient`, поэтому как булев детектор не годится; `StakeBridge` в конструкторе
  сразу авторизуется, значит вне Stake его конструировать нельзя — нужен дешёвый non-throwing guard.
- **Stake-склейка — инлайн в оркестраторе хоста** (без отдельного модуля): ~5 строк, которые
  подставляют `model.modeMap`/`model.spec.id`/адаптер игры и ждут `ready()`. Дубля логики моста нет.
- **`adapter` приходит извне** (BookAdapter игры); `modeMap`/`gameId` — из `model`. Генерация
  адаптера — следующий срез (stake-kit).
- **Тестируемость при headless-Pixi hang:** вся проверяемая логика — чистые функции
  (`buildAppConfig`, `loadFonts`, `bootGuard`, `showFatalError`, `isStakeLaunch`); оркестратор тонкий
  и не юнит-тестится (Pixi `init()` зависает в headless — известный факт репо).
- **Без нового example.** Всё в существующем `examples/spec-slot/`: добавить `main.ts` +
  тривиальную `GameScene.ts`, проверять `tsc --noEmit` + сборкой; node-smoke остаётся.

## Архитектура

### stake-bridge (in-repo workspace `packages/stake-bridge`)

> Уточнение по факту: `packages/stake-bridge` — workspace ВНУТРИ этого монорепо (`workspaces: ["packages/*","examples/*"]`), `node_modules/@energy8platform/stake-bridge` симлинкается на него. Кросс-репной координации НЕТ: правка идёт в `packages/stake-bridge`, game-engine линкуется нативно, типы `/detect` доступны после сборки stake-bridge. (Копия в соседнем `energy8-platform-game-sdk` — вне scope, при необходимости синкается отдельно.)

```
packages/stake-bridge/
  src/detect.ts        export function isStakeLaunch(input: string | URL | Location): boolean
  src/index.ts         + re-export { isStakeLaunch }
  rollup.config.ts     + второй вход 'src/detect.ts' → dist/detect.{esm,umd}.js + d.ts
  package.json         + exports './detect'
  tests/detect.test.ts
```

`isStakeLaunch` — чистая, ничего не бросает, без зависимости от `RGSClient`/`StakeBridge`:
`true`, если в URL есть `rgs_url` И (`sessionID` присутствует ИЛИ `replay === 'true'`); иначе `false`.
Невалидный URL → `false` (try/catch вокруг `new URL`).

### game-engine: хост

```
packages/game-engine/src/host/
  types.ts            CreateSlotGameOptions, SlotGameHandle, StakeIntegration, SceneEntry
  buildConfig.ts      buildAppConfig(opts): GameApplicationConfig                (чистая)
  preboot.ts          loadFonts(specs), applyTextureDefaults(), bootGuard()      (чистые-ish)
  fatalError.ts       showFatalError(container, message): void                   (DOM)
  createSlotGame.ts   createSlotGame(opts): Promise<SlotGameHandle>              (тонкий оркестратор)
  index.ts            публичный API
packages/game-engine/
  package.json        + exports './host'
  rollup.config.mjs   + bundle 'src/host/index.ts' → 'host'
  (optional peer dep: @energy8platform/stake-bridge)
```

### Изолированные единицы

1. **stake-bridge `detect.ts`** — `isStakeLaunch`. Пустая зависимость, свой тест.
2. **`buildConfig.ts`** — `buildAppConfig(opts)`: чистый маппинг `opts → GameApplicationConfig` с
   дефолтами и единственным вычисляемым полем `sdk.devMode = isStakeNow || (opts.dev ?? false)`,
   где `isStakeNow` передаётся в функцию (вычислен оркестратором) — функция остаётся чистой.
3. **`preboot.ts`** — `loadFonts(specs)` (await `document.fonts.load` с try/catch),
   `applyTextureDefaults()` (Pixi `TextureSource.defaultOptions`), `bootGuard(flag)` (идемпотентный
   guard через `window[flag]`).
4. **`fatalError.ts`** — `showFatalError(container, message)`: вставляет DOM-оверлей (тестируется в jsdom).
5. **`createSlotGame.ts`** — оркестратор: преboot → инлайн-stake → `new GameApplication` → register →
   `start` → error. Тонкий, не юнит-тестится (Pixi headless).

## API

```ts
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { BookAdapter, AdapterModule } from '@energy8platform/stake-bridge';
import type { Scene } from '@energy8platform/game-engine/core';

interface StakeIntegration {
  adapter: BookAdapter | AdapterModule;     // только адаптер игры; modeMap+gameId из model
}

interface SceneEntry {
  key: string;
  scene: new (...args: any[]) => Scene;
}

interface CreateSlotGameOptions {
  model: GameModel;                         // из defineGame
  scene: SceneEntry;
  manifest: AssetManifest;
  container?: HTMLElement | string;         // дефолт '#game'
  design?: { width: number; height: number };
  scaleMode?: ScaleMode;
  orientation?: Orientation;
  loading?: LoadingScreenConfig;
  audio?: AudioConfig;
  pixi?: Partial<ApplicationOptions>;
  fonts?: string[];                         // спеки для document.fonts.load
  textureDefaults?: boolean;                // применить mipmap/scaleMode дефолты
  dev?: boolean;                            // игра передаёт import.meta.env.DEV
  stake?: StakeIntegration;                 // если есть И isStakeLaunch → поднять мост
  onFatalError?: (message: string) => void; // переопределить дефолтную модалку
}

interface SlotGameHandle {
  game: GameApplication;
  stakeBridge: unknown | null;              // StakeBridge инстанс или null (тип лениво-импортируемый)
}

function createSlotGame(opts: CreateSlotGameOptions): Promise<SlotGameHandle>;
```

## Поток данных (оркестратор)

```
bootGuard('__e8SlotBooted__')                       // двойной boot → бросить/вернуть рано
if opts.textureDefaults → applyTextureDefaults()
await loadFonts(opts.fonts)

let bridge = null
let isStakeNow = false
if opts.stake:
   const { isStakeLaunch } = await import('@energy8platform/stake-bridge/detect')
   isStakeNow = isStakeLaunch(location.href)
   if isStakeNow:
      try:
        const { StakeBridge } = await import('@energy8platform/stake-bridge')
        bridge = new StakeBridge({ devMode: true, adapter: opts.stake.adapter,
                                   modeMap: model.modeMap, gameId: model.spec.id, url: location.href })
        await bridge.ready()
      catch (err):
        (opts.onFatalError ?? defaultFatal)('Не удалось подключиться к серверу. Перезагрузите страницу.')
        throw err                                            // прекращаем boot; игра ловит .catch()

config = buildAppConfig(opts, isStakeNow)                    // sdk.devMode = isStakeNow || (opts.dev ?? false)
game = new GameApplication(config)
game.scenes.register(opts.scene.key, opts.scene.scene)
try { await game.start(opts.scene.key) }
catch (err) { (opts.onFatalError ?? defaultFatal)('Не удалось запустить игру.'); throw err }
return { game, stakeBridge: bridge }
```

Замечания:
- Весь stake-код (включая `/detect`) грузится **лениво внутри `if (opts.stake)`** — игры без Stake
  не тянут ни строки.
- `betLevels`/`currency` НЕ входят в `GameApplicationConfig` — идут в SDK/DevBridge через dev.config
  (из `model`, как в первом срезе). Хост их не дублирует.
- При stake-ошибке оркестратор показывает модалку и **бросает** (симметрично провалу `start()`);
  `GameApplication` ещё не создан, half-собранного handle нет. Игра оборачивает `createSlotGame(...)`
  в `.catch()`. `SlotGameHandle.game` всегда присутствует на успешном пути.

## Тестирование (renderer-free; Pixi headless hang)

- **stake-bridge `isStakeLaunch`** — unit: Stake-wallet URL → true; replay URL → true; нет `rgs_url`
  → false; есть `rgs_url` без `sessionID`/`replay` → false; мусорный URL → false.
- **`buildAppConfig(opts, isStakeNow)`** — снапшот/ассерты: дефолты (container `#game`, design 1920×1080),
  passthrough (loading/audio/pixi/manifest), `sdk.devMode === isStakeNow || (opts.dev ?? false)` во всех
  четырёх комбинациях.
- **`loadFonts`** — мок `document.fonts.load`: резолвится; при reject CDN не бросает (try/catch).
- **`bootGuard`** — первый вызов проходит, второй сигналит двойной boot (через `window[flag]`).
- **`showFatalError`** — jsdom: вставляет оверлей с текстом в контейнер.
- **Оркестратор `createSlotGame`** — НЕ юнит-тест (Pixi). Покрытие: чистые юниты + `tsc --noEmit` +
  сборка + smoke-import хост-модуля (импорт без инстанса Pixi).

## Валидация — расширение `examples/spec-slot/`

Без нового примера. В существующий `examples/spec-slot/` добавить:
- `GameScene.ts` — тривиальная сцена (extends `Scene` из `@energy8platform/game-engine/core`),
  пустой `onEnter`.
- `main.ts` — `import { model } from './game.spec'` + `createSlotGame({ model, scene: { key:'game', scene: GameScene }, manifest, design, dev: ... })`.
- минимальный `manifest` (пустой/лого) и зависимость `@energy8platform/game-engine` + `pixi.js` в
  package.json (devDeps достаточно для typecheck).
Проверка: `tsc --noEmit` примера проходит (доказывает, что host API сходится с `model`); существующий
node-smoke (`smoke.ts`: LuaEngine + exportGame) не трогаем — он остаётся зелёным. Headless-прогон
Pixi не делаем.

## Scope

**В scope:**
- stake-bridge: `isStakeLaunch` + sub-path `/detect` + re-export + тесты (кросс-репно).
- game-engine host: `types/buildConfig/preboot/fatalError/createSlotGame/index` + sub-path `/host` +
  тесты + optional peer dep на stake-bridge.
- `examples/spec-slot/` расширен `main.ts` + `GameScene.ts` (compile-verified).

**Вне scope (отдельные срезы):**
- shell-интеграция внутри хоста (shell пока в сцене игры)
- нормализация Lua-ответа
- генерация BookAdapter (stake-kit)
- миграция боевых игр

## Риски / открытые вопросы

- **Build-order:** хост лениво импортит `/detect`, но `tsc` хосту нужны типы `@energy8platform/stake-bridge`
  и `/detect`. stake-bridge — in-repo workspace, поэтому достаточно собрать его ДО typecheck game-engine
  (`npm run build` по workspaces). game-engine добавляет stake-bridge в optional peer + devDependency `*`
  + rollup `external`.
- **Точная сигнатура `Scene`-конструктора** — сверить с `SceneManager.register` в game-engine на этапе
  плана (как именно регистрируются классы сцен).
- **rollup multi-entry в stake-bridge** — текущий конфиг собирает один вход; добавление `/detect`
  требует второго входа в `rollup.config.ts` + типов; объём мал, но это правка чужого пакета.
