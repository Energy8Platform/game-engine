# Reels: анализ игр, индустрии и дизайн конфигурируемой системы

> Артефакт шагов 1–2 задачи «прокачать барабаны game-engine». Источник для шагов 3–4.

## 1. Что есть сейчас в `@energy8platform/game-engine` (`src/slot/`)

| Модуль                                     | Что делает                                                                                             | Ограничения                                                                              |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `grid/ReelGrid`                            | Фиксированная сетка `cols×rows` из `SymbolCell`, один `cellSize`, один `gap`, маска, decoration-sprite | Нет per-reel rows (нет Megaways), нет per-reel смещения, нет динамической высоты         |
| `anim/ReelSpinController`                  | «texture-swap» спин: быстро циклит символы и приземляет; per-reel stop stagger; settle-bounce          | Нет strip-scroll, нет motion blur, нет anticipation, нет sync/random stop, нет slam-stop |
| `anim/CascadeController`                   | highlight → remove → drop новых ячеек                                                                  | Не анимирует «съезжание» выживших символов (gravity), фикс. easing на фазу               |
| `grid/SymbolCell`                          | рамка (4 состояния) + symbol view + бейджи mult/bonus + sticky-данные                                  | Бейджи минимальны, sticky не визуализируется в анимации                                  |
| `grid/AnimatedSymbol`                      | base/idle/win spritesheet                                                                              | —                                                                                        |
| `overlay/*`, `multiplier/*`, `freeSpins/*` | big-win, count-up, множители, free-spins сессия                                                        | —                                                                                        |

**Вывод:** движок умеет «сетка + простой спин + простой каскад». Конфигурируемость низкая, спец-механик нет.

## 2. Что делают наши игры (срез по барабанам)

| Игра                | Grid            | Тип движения                                        | Заметные приёмы                                                                                                                                                                                                                                       |
| ------------------- | --------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **kitsune-wrath**   | 7×7 (бонус 8×8) | tumble/cascade (drop-in)                            | position-множители ×2…×128, sticky wild (3 спина, розовый ring), wild size-bonus `+N`, kitsunebi-орбы, scatter anticipation (banner), per-фазные тайминги/turbo                                                                                       |
| **moon-spice-shop** | 5×4             | classic spin + cascade refill                       | strip из 16 спрайтов, overshoot 0.18 cell + settle outQuad, frame-shake только на Wild/Scatter/Jar, premium win-анимации (16 кадров), wild neighbour-glow, jar collect, INTENSITY_SCALE (full/reduced/minimal)                                        |
| **Stone-Rush**      | 7×7             | cascade (weighty gravity)                           | squash/stretch при ударе (1.3/0.7→0.9/1.13→1.0), cascade-замедление (`1+idx*0.08`, cap 1.5), wild ignition (молот), multiplier-орбы с полётом к tally, sequential resolve общего wild в нескольких кластерах                                          |
| **hot-ross**        | 5×5             | classic spin (реальный strip 34–54 filler)          | **motion blur/streaks** (alpha 0.82 + полосы), scatter **tease** (2-фазное замедление reels 3–4, ramp), slam-bounce ±7px/240ms, sticky reels (tier 2/3 FS, «ACTIVE»), expanding wilds (easeOutBack + multiplier fly-in/beam), normal/turbo/uk-профили |
| **magnus-alchemy**  | 5×4             | cascade (gravity, distance-based fall)              | squash-on-impact, wild→book морф, cascade running-multiplier (плашка сверху), VFX 4×4 на символ                                                                                                                                                       |
| **magnum-opus**     | 6×6             | cascade (Lua-choreography: per-symbol drop-векторы) | **scatter anticipation + reel zoom 1.3×** (2 фазы, beat 170ms), idle-дыхание/вращение по тиру, transmute low→high (dissolve/form-in sheets), skip/turbo fast-forward                                                                                  |

**Повторяющиеся паттерны (то, что просится в движок):**

- 3 базовых типа движения: **classic-spin (strip)**, **swap** (есть), **cascade-drop**.
- **Каскад с гравитацией** выживших + рефилл сверху, с per-step замедлением.
- **Squash/stretch landing** и **settle-bounce** как настраиваемые «физика приземления».
- **Anticipation** по scatter (порог N−1, замедление трейлинг-reels, hold 300–500ms, опц. zoom).
- **Motion blur / streaks** во время спина.
- **Per-фазные тайминги + turbo/intensity-масштаб**.
- Спец-символы: sticky wild, expanding wild, multiplier-символы/reels, mystery, transform/upgrade, giant, орбы-коллекторы.
- **Frame-shake** на «значимых» остановках.

## 3. Таксономия индустрии (что вообще конфигурируют)

### 3.1 Движение барабана

- Стили: **classic spin-stop** (strip), **swap-in-place**, **cascade/tumble (avalanche)**, rolling vs strip.
- Тайминги (дефолты из ресёрча): inter-reel stop gap **~120ms**, accel ramp **0–100ms**, settle/bounce, reveal micro-pause **250–500ms**.
- **Stop mode:** `sequential | sync | random`, `stopOrder` L→R / R→L.
- **Slam/quick stop:** ускоряет только анимацию, исход не меняет (можно гейтить по юрисдикции).
- Motion blur — чисто презентация.

### 3.2 Модель оценки (влияет на форму сетки)

- `lines` (фикс. paylines, `direction: ltr|both`), `ways` (243/1024/4096 = произведение высот), `anywhere` (scatter/pay-anywhere — символ платит где угодно), `cluster` (орто-флуд-филл, min 5–8, без диагоналей), `megaways` (per-spin высота 2–7, ways = ∏ высот, опц. top-reel), `infinity` (append reel вправо на вин), `expanding grid` (растёт число рядов/размер).
- **Ways/megaways:** ключевой вывод — `rowsPerReel: number[]` (а не один `rows`).

### 3.3 Anticipation / teasing

- Триггер N−1 (обычно 2 из 3 scatter), только **трейлинг ещё не остановленные reels**, прогрессивная оценка по мере остановки.
- Замедление (slowdownFactor / длинный ease-out) + аудио + опц. zoom; hold 300–500ms перед последним.
- Юр. ограничение: anticipation — **только реакция на уже зафиксированный RNG-исход**, без «вторичного решения».

### 3.4 Спец-механики (14 штук, каждая → набор параметров)

expanding wild · sticky/locked · walking/marching wild · multiplier (additive/multiplicative, perSymbol/perReel/global) · mystery (один общий RNG-розыгрыш на все) · transform · upgrade · nudge/respin (xNudge) · giant/colossal (2×2…5×5) · split (xSplit) · stacked · random reel modifiers (pre-spin) · hold-and-spin (respin-reset, jackpot tiers) · random wild injection.

Порядок резолва (важен как параметр): pre-spin (modifiers, colossal) → reels stop → post-spin transforms (mystery reveal, expand, upgrade) → win eval → cascade transforms → multiplier apply.

### 3.5 Конфиг-паттерны провайдеров / Stake-SDK

- Stake math-sdk: reelstrips = CSV (символ на стоп), доска = равномерный random-stop + wraparound; RTP = веса **целых reelstrip'ов** (`reel_weights` по gametype), не per-symbol.
- Pragmatic Tumble: множитель ×2 за каскад (1→1024 cap), reset за спин; multiplier-символы 2x–500x.
- NetEnt Avalanche: +1 за лавину (cap 5x база / 15x FS); Cluster: орто-смежность, min-cluster по тиру.
- Nolimit xWays/xNudge/xSplit/xBomb — символы-модификаторы reel-height.

## 4. Дизайн конфигурируемой системы для game-engine

Принцип: **один большой типизированный `ReelSystemConfig`**, дефолты «как сейчас», всё опционально и древовидно. Презентация отделена от исхода (движок только рисует переданную доску).

```
ReelSystemConfig
├── grid:        { cols, rowsPerReel:number[] | rows, cellSize, gap, mask, decoration, layout? }
├── motion:      { style:'swap'|'strip'|'cascade-drop',
│                  spinUp, hold, stopStagger, stopMode:'sequential'|'sync'|'random', stopOrder,
│                  settle:{amp,ms,easing}, squash?:{x,y,ms}, blur?:{enabled,alpha,streaks},
│                  turboFactor, intensity:'full'|'reduced'|'minimal', slamStop }
├── anticipation:{ enabled, triggerSymbols[], threshold(N-1), reels:'trailing'|number[],
│                  slowdownFactor, holdMs, zoom?:{scale,ms}, sfxHook?, vfxHook? }
├── cascade:     { enabled, gravity(survivors slide), timings{reveal,highlight,remove,drop,refill,wait},
│                  perStepDecel, easings{...}, dimNonWinners?, multiplier?:{start,step,mode,cap,persistFS} }
├── win:         { highlightScale, dimAlpha, glow?, frameShake?:{amp,ms,onlyOn[]} }
└── features:    { wild?, sticky?, expanding?, walking?, mystery?, transform?, giant?, holdAndSpin?, ... }
                   (каждая — опциональный конфиг + hook; фаза 1 = ядро + каркас хуков)
```

API: `createReelSystem(config) → { grid, spin(data,opts), cascade(step,opts), applyFeatures(...), resize(), skip() }`. Обратная совместимость: старые `ReelGrid/ReelSpinController/CascadeController` остаются, новая система — слой поверх.

## 5. Playground (`examples/reel-lab`)

Цель: визуально крутить **все** настройки и видеть результат + **копировать конфиг**.

- Vite + Pixi + game-engine, как другие examples.
- Слева/сверху — DOM-панель контролов (select/slider/checkbox) по секциям конфига; справа — живой канвас с барабанами.
- Кнопки: **Spin**, **Force scatter (anticipation)**, **Trigger cascade**, **Copy config (JSON/TS)**, пресеты (kitsune/moon-spice/stone-rush/hot-ross/magnus как готовые конфиги).
- «Copy» кладёт в буфер готовый `ReelSystemConfig` для вставки в игру.
