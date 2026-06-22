# Design: CLI scaffolder (`@energy8platform/create-slot`) + host shell integration

Дата: 2026-06-22
Статус: согласован, готов к плану реализации
Контекст: пятый (финальный) срез дорожной карты [docs/slots-analysis-and-bootstrapper.md](../../slots-analysis-and-bootstrapper.md) (§5.5 шаг 5). Опирается на все 4 предыдущих среза (game-spec, host/createSlotGame, stake-kit, slot-primitives).

## Проблема

Новая игра, даже поверх 4 готовых пакетов, требует ручной сборки тонкой оболочки (game.spec.ts,
vite-app, GameScene со spin-циклом, shell-обвязки, stake-адаптера, dev/lua-скелета). Это
воспроизводит ту самую копипасту, от которой ушли. Нужен `npm create @energy8platform/slot`, который
генерит играбельный каркас, а автор занимается только графикой/математикой/механикой.

Дополнительно: shell-обвязка (control-bar, sync состояния, роутинг событий, Stake-replay-петля) — это
сантехника, которую по принципу проекта надо держать в пакете (host), а не генерить в каждую игру.

## Цель среза (две фазы)

- **Фаза A — host shell-integration:** `createSlotGame` сам поднимает shell (`createGameShell`),
  синкает balance/bet/win, роутит события в сцену, и обслуживает Stake-replay-петлю. Обвязка
  versioned в пакете; игра только подаёт shell-конфиг + реализует тонкий контракт сцены.
- **Фаза B — CLI-скаффолдер:** `@energy8platform/create-slot` генерит тонкую оболочку (game.spec.ts +
  vite-app + GameScene + stake + dev/lua-скелет) поверх 4 пакетов.

## Решения (зафиксированы в брейншторме)

- **Генерация:** template-dir (FIXED-файлы с `${VAR}`-подстановкой) + программный кодоген
  (GENERATED-из-ответов файлы). Анти-дрейф — CI-смок, который скаффолдит во временную папку и
  тайпчекает/смокает против локальных пакетов.
- **shell в host** (не генерится в игру): расширяем `createSlotGame`. Хост владеет жизненным циклом
  shell + sync + роутинг + replay; сцена владеет спин-презентацией (она игро-специфична).
- **Минимальный набор вопросов CLI** (YAGNI): id, title, mechanic (cascade|lines|ways), grid,
  stake?. Остальное (полные символы/paytable/bet-ladder/maxWin/режимы) — дефолты в сгенерённом
  `game.spec.ts`, автор редактирует. Все вопросы дублируются флагами (non-interactive/CI).
- **gameDefinition — Option A:** экспортится из spec (`exportGame`), не пишется руками.
- **Stake-replay — на shell** (слайс 3): `shell.openReplay`; cost/лейбл из `bonusId`→`features.buyBonus`;
  мост фетчит книгу + отдаёт `payoutMultiplier`.

## Фаза A — host shell-integration (правка пакета game-engine/host)

### API
```ts
import type { ShellConfig, CurrencyConfig, BonusOption, GameInfoContent, GameShell } from '@energy8platform/platform-core/shell';
import type { WinTier } from '@energy8platform/game-engine/slot';

export interface SlotShellOptions {
  currency: CurrencyConfig;
  gameInfo: GameInfoContent;
  buyBonus?: BonusOption[];          // карточки бай-бонуса (скаффолд строит из spec.actions role:'buy')
  tiers?: WinTier[];                 // прокидываются сцене для big-win (опц.)
  features?: Partial<ShellFeatures>; // turbo/autoplay/spacebar (дефолты)
}

/** Thin contract the game scene implements; the host calls it on shell events. */
export interface SlotSceneController {
  spin(bet: number): Promise<void>;          // session.play + анимация (сцена владеет презентацией)
  setBet(bet: number): void;
  buyBonus?(actionId: string, bet: number): Promise<void>;
}

// CreateSlotGameOptions gains:
//   shell?: SlotShellOptions;
// SlotGameHandle gains:
//   shell: GameShell | null;
```
Сцена опционально реализует `SlotSceneController` (duck-typed: хост проверяет наличие методов).

### Поведение хоста (когда `opts.shell` задан)
```
shellMode = (stakeBridge && stakeBridge.isReplay) ? 'replay' : 'base'
shell = createGameShell(buildShellConfig(opts, model, balance, shellMode))
handle.shell = shell

// state sync
session.on('balanceUpdate', (b) => shell.setBalance(b))
shell.setBalance(session.balance); shell.setBet(defaultBet)

if shellMode === 'base':
   shell.on('spin',     () => scene.spin?.(currentBet))            // EventEmitter<ShellEvents>
   shell.on('betChange',(bet) => { currentBet = bet; scene.setBet?.(bet) })
   shell.on('buyBonus', (id) => scene.buyBonus?.(id, currentBet))
else  // replay
   const { bonusId, bet, payoutMultiplier } = resolveReplay(model, stakeBridge)
   const openLoop = () => shell.openReplay({ bonusId, bet, payoutMultiplier,
                                             onReplay: async () => { await scene.spin?.(bet); openLoop() } })
   openLoop()
```
- `buildShellConfig(opts, model, balance, mode)` — **чистая**: собирает `ShellConfig` (mount, currency,
  availableBets=model.spec.betLevels, defaultBet, balance, win:0, mode, gameInfo, features, buyBonus).
- `resolveReplayBonusId(model, mode)` — **чистая**: реверс `model.modeMap` (Stake mode → action key) →
  `bonusId` (карточка для лейбла/cost); fallback на базовый лейбл для `spin`.
- `scene.spin?.()` — duck-typed; если сцена не реализует контракт, событие — no-op (shell всё равно
  поднимается для отображения).

Хост НЕ владеет спин-циклом (session.play/free-spins-петля) — это сцена. Хост подаёт события + синкает
видимое состояние + ведёт replay-петлю.

## Фаза B — `@energy8platform/create-slot`

### Структура пакета
```
packages/create-slot/
  package.json        name @energy8platform/create-slot; bin: { "create-slot": "dist/cli.js" }
  src/
    cli.ts            entry: парсит флаги / запускает prompts → answers → generate()
    prompts.ts        interactive (id/title/mechanic/grid/stake) + флаги (--id/--mechanic/--grid/--no-stake/--yes)
    answers.ts        type Answers; defaults; validate (id kebab, grid positive, mechanic enum)
    generate.ts       orchestrator: mkdir → copy template/ (${VAR} subst) → write codegen files
    codegen/
      gameSpec.ts     answers → game.spec.ts (grid, default symbols per mechanic, actions)
      packageJson.ts  answers → package.json (name, published deps, simulate:* per buy action)
      gameScene.ts    answers.mechanic → GameScene.ts (SlotSceneController; Cascade vs ReelSpin)
      luaLogic.ts     answers.mechanic → script.logic.lua skeleton (cascade vs lines/ways)
      stakeAdapter.ts answers → stake/adapter.ts (modeMap from actions) + stake/schema.ts (per mechanic)
      mainTs.ts       answers → main.ts (createSlotGame with shell config)
    template/         FIXED files copied with ${title}/${id} substitution
      vite.config.ts index.html tsconfig.json .gitignore dev.config.ts
      README.md src/theme.ts src/slot/symbols.ts
      public/assets/{symbols,bg,audio,vfx}/NAMING.md
  test/
    codegen.test.ts   unit per codegen (valid spec, simulate scripts, mechanic→controller, modeMap)
    scaffold.test.ts  smoke: generate() → temp dir → swap deps to local → tsc --noEmit + node smoke
```

### Минимальный набор вопросов
| Вопрос | Драйвит | Дефолт |
|---|---|---|
| id (kebab) | spec.id, dir, package name | — (обязателен) |
| title | index.html, README, theme | Title-case от id |
| mechanic: cascade\|lines\|ways | GameScene controller + script.logic.lua + stake schema | cascade |
| grid cols×rows | spec.grid, theme.DESIGN_* | 6×6 (cascade) / 5×3 (lines) |
| stake? | генерить src/stake/ + dual-build | yes |

Не спрашиваются (дефолты в game.spec.ts): полные символы, paytable, bet-levels, maxWin, currency,
бонус-режимы. Скаффолд кладёт дефолтный набор под механику (4 high + 4 low + wild + scatter; actions
`spin` + `free_spin` + `buy_bonus`) с комментариями «отредактируй под свою игру».

### Генерируемое дерево
```
my-game/
  game.spec.ts            [GEN]
  package.json            [GEN]
  vite.config.ts          [TPL] index.html [TPL+${title}] tsconfig.json/.gitignore [FIXED]
  dev.config.ts           [TPL] README.md [TPL+${title}]
  src/
    main.ts               [GEN] createSlotGame({ model, scene, manifest, design, dev, shell })
    theme.ts              [GEN] DESIGN_* из grid + accent
    GameScene.ts          [GEN by mechanic] ReelGrid + controller + BigWinOverlay + SlotSceneController.spin
    game/script.logic.lua [GEN by mechanic]
    slot/symbols.ts       [TPL] resolveSymbol → AnimatedSymbol placeholder textures
    stake/                [if stake] adapter.ts/schema.ts [GEN] + social.ts/adapter.test.ts [TPL]
  public/assets/{symbols,bg,audio,vfx}/NAMING.md [FIXED]
```

### Механика драйвит GameScene + Lua
- **cascade:** `GameScene` использует `CascadeController`; `execute()` возвращает `{ total_win, cascades:[…] }`;
  stake schema c `cascades`; `spin()` гоняет `cascade.run(step)` по шагам, затем `bigWin.show()`.
- **lines/ways:** `GameScene` использует `ReelSpinController`; `execute()` → `{ total_win, matrix, wins:[…] }`;
  schema c `matrix/wins`; `spin()` → `reelSpin.run()` → подсветка выигрышей → `bigWin.show()`.

`GameScene.spin(bet)` (общий скелет): `const r = await session.play({ action:'spin', bet }); const data = r.data; await controller.run(...); if (win>0) await bigWin.show(win, bet);` — рабочий, не заглушка. Сессию сцена берёт из `GameApplication.session`.

## Тестирование

- **Фаза A (host, node):** `buildShellConfig` (чистая — собирает ShellConfig из opts+model+balance+mode);
  `resolveReplayBonusId` (реверс modeMap; fallback). `createGameShell`(DOM)/boot не юнит-тестим —
  typecheck + spec-slot.
- **Фаза B codegen (node):** unit на каждый кодоген — `gameSpec(answers)` парсится `defineGame` без
  ошибок; `packageJson` имеет `simulate:*` по buy-actions; `gameScene('cascade')` импортирует
  CascadeController, `gameScene('lines')` — ReelSpinController; `stakeAdapter` modeMap == ключи
  non-free actions.
- **Анти-дрейф смок (главное):** `scaffold.test.ts` — `generate(answers)` во временную папку; подменить
  4 `@energy8platform/*` деп на локальные (`file:` пути к built dist) в сгенерённом package.json;
  `tsc --noEmit` сгенерённой игры + её node-smoke (spec→export). Падает при разъезде шаблон↔пакеты.

## Валидация — spec-slot под shell

`examples/spec-slot/main.ts` получает `shell`-конфиг (currency, gameInfo, минимальный buyBonus); его
`GameScene` реализует `SlotSceneController` (`spin`/`setBet`). Доказывает, что Фаза A (host-shell)
тайпчекается на реальной композиции. Существующие smoke/stake/slot тесты остаются зелёными.

## Scope

**В scope:**
- Фаза A: `createSlotGame` × shell + Stake-replay (правка game-engine/host) + чистые хелперы
  (`buildShellConfig`, `resolveReplayBonusId`) + тесты + spec-slot обновление.
- Фаза B: пакет `@energy8platform/create-slot` (cli/prompts/answers/generate/codegen/template) + тесты
  (codegen-юниты + scaffold-to-temp смок).

**Вне scope:**
- интеграция со skill `slot-game-creator` (отдельно; скилл на выходе даёт answers/spec)
- генерация арта (Ludo.ai), реальные ассеты
- публикация `create-slot` в npm-реестр (только in-repo + локальный смок)
- миграция боевых игр на новый стек
- автоплей/turbo-логика сверх того, что shell уже даёт

## Риски / открытые вопросы

- **Точные имена событий `ShellEvents`** (spin/betChange/buyBonus/…) — сверить с
  `platform-core/src/shell/types.ts` на этапе плана; роутинг в Фазе A зависит от них.
- **Resolve локальных пакетов в смоке:** временная игра вне workspace не линкуется автоматически;
  тест подменяет деп на `file:`-пути к `packages/*/` (built dist должен существовать — смок сначала
  билдит пакеты или полагается на уже собранный dist). План зафиксирует механику.
- **`scene.spin` duck-typing:** если сцена не реализует контракт, shell-события — no-op; для playable
  каркаса скаффолд ВСЕГДА генерит сцену с контрактом, так что в реальных играх это не пустует.
- **Replay bonusId для базового спина:** для `mode → 'spin'` нет buy-карточки; `resolveReplayBonusId`
  возвращает синтетический базовый id, shell лейблит cost=bet×1. Уточнить против shell `openReplay`.
