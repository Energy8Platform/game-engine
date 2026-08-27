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
│                  turboFactor, intensity:'full'|'reduced'|'minimal', slamStop,
│                  cellStagger, reelStaggerFactor, dropFallFactor,  ← темп 'cascade-drop'
│                  dropOrder:'top-down'|'bottom-up',                ← направление заполнения
│                  dropSequence:'parallel'|'chained'|'chained-when-anticipated' }
├── anticipation:{ enabled, triggerSymbols[], threshold(N-1), reels:'trailing'|number[],
│                  slowdownFactor, holdMs, zoom?:{scale,ms}, sfxHook?, vfxHook?,
│                  decide?(targetGrid)  ← предикат игры вместо счёта символов,
│                  progressiveSlowdown, progressiveHoldMs  ← рампа по барабанам }
├── cascade:     { enabled, gravity(survivors slide), timings{reveal,highlight,remove,drop,refill,wait},
│                  perStepDecel, easings{...}, dimNonWinners?, multiplier?:{start,step,mode,cap,persistFS} }
├── win:         { highlightScale, dimAlpha, glow?, frameShake?:{amp,ms,onlyOn[]} }
└── features:    { wild?, sticky?, expanding?, walking?, mystery?, transform?, giant?, holdAndSpin?, ... }
                   (каждая — опциональный конфиг + hook; фаза 1 = ядро + каркас хуков)
```

API: `createReelSystem(config) → { grid, spin(data,opts), planSpin(data,opts), cascade(step,opts), applyFeatures(...), resize(), skip() }`. Обратная совместимость: старые `ReelGrid/ReelSpinController/CascadeController` остаются, новая система — слой поверх.

### 4.1 Швы для игры (запрос `pantheon-break`)

Движок рисует свою анимацию, но игра должна уметь построить свою **не воюя** с существующей.
Четыре шва, каждый полезен отдельно:

1. **Расписание — публичные данные.** `planSpin(target, opts)` возвращает тот же `ReelStopPlan[]`,
   что выполнит `spin(target, opts)` (то же решение по антипации, те же числа), а `spin`'s `onPlan`
   отдаёт его же на старте. Плюс сигналы посадки: `onReelStop(reel, plan)` — кадр остановки
   барабана, `onCellSeated(reel, row, data)` — кадр прилёта ячейки (в `cascade-drop` — момент
   удара, до squash). Игре больше не надо повторять формулу `plan()` в своём `setTimeout`.
2. **Темп `cascade-drop` — конфиг, не литерал.** `cellStagger` (мс между соседними ячейками
   одного барабана, было `24`), `reelStaggerFactor` (множитель `stopStagger` для сдвига барабана,
   было `0.4`) и `dropFallFactor` (длительность падения как доля `spinUp`, было `0.6`). Раньше
   единственным рычагом был `slowdown`, который растягивал и паузу, и само падение.
3. **Антипацию решает игра.** `SpinRunOpts.anticipateReels/Slowdown/HoldMs` теперь **уважаются**
   (явный список бьёт решение из конфига) — раньше `ReelSystem.spin()` их молча перезатирал.
   `AnticipationConfig.decide(targetGrid)` заменяет счёт символов предикатом игры («раунд ещё жив
   на всех барабанах», «на 3-м символ не выпал → 4 и 5 останавливаем как обычно»).
   `progressiveSlowdown` / `progressiveHoldMs` дают прогрессивную рампу по барабанам; и то и
   другое можно задать по-барабанно массивом (`PerReel<number>`, индекс = номер барабана).
4. **Темп `cascade-drop` — расписание, а не формула на месте.** `plan()` теперь считает для
   drop-стиля `cellStopTimes[row]` (момент посадки каждой ячейки) и `stopTime` (момент, когда
   барабан долетел целиком), а `_runDrop` только исполняет эти числа. Отсюда три вещи, которых
   раньше не было: `dropOrder: 'bottom-up'` (заполнение снизу вверх, как под гравитацией, вместо
   раздачи «карточками» сверху), `dropSequence` (`'chained'` — следующий барабан стартует только
   после посадки последней ячейки предыдущего; `'chained-when-anticipated'` — обычные барабаны
   остаются параллельными, цепочка включается с первого взведённого) и работающий
   `anticipation.holdMs` (в drop-стиле он раньше игнорировался, потому что `_runDrop` не смотрел
   на `stopTime`). Заодно `stopOrder: 'rtl'` теперь разворачивает и падение.
5. **Посадку можно удержать.** `deferReveal: number[]` — барабан крутится по-настоящему, лента
   уничтожается как обычно, но реальные ячейки остаются **скрытыми и незасеянными**: данными и
   видимостью с этого момента владеет игра (slam-stop их тоже не раскроет). Это снимает
   необходимость накрывать вывод движка непрозрачной панелью. Оговорка: стиль `swap` крутит ленту
   *через* реальные ячейки, поэтому для настоящего удержания ему нужен свой `SpinData.strip`;
   у `strip` и `cascade-drop` такой оговорки нет.

## 5. Playground (`examples/reel-lab`)

Цель: визуально крутить **все** настройки и видеть результат + **копировать конфиг**.

- Vite + Pixi + game-engine, как другие examples.
- Слева/сверху — DOM-панель контролов (select/slider/checkbox) по секциям конфига; справа — живой канвас с барабанами.
- Кнопки: **Spin**, **Force scatter (anticipation)**, **Trigger cascade**, **ReelStep** (см. §7), **Copy config (JSON/TS)**, пресеты (kitsune/moon-spice/stone-rush/hot-ross/magnus как готовые конфиги).
- «Copy» кладёт в буфер готовый `ReelSystemConfig` для вставки в игру.

---

## 6. Вариативная геометрия ячейки (прямоугольные / per-strip)

> Артефакт обсуждения на ветке `feat/shell-package`. Расширяет секцию 4 (`grid`): сейчас `cellSize` — один квадратный скаляр, `gap` — один скаляр; надо поддержать прямоугольные ячейки и разные размеры/зазоры по стрипам.

### 6.1 Что есть сейчас

- `GridConfig.cellSize: number` ([`config/ReelSystemConfig.ts:44`](../packages/game-engine/src/slot/config/ReelSystemConfig.ts#L44), дефолт `96`) — ячейка всегда квадратная `cellSize × cellSize`.
- `gap: number` — один зазор и по горизонтали, и по вертикали.
- Вся геометрия выводится из `step = cellSize + gap`; позиции идут через `grid.cellPosition(col,row)`, но много кода читает публичный `grid.cellSize` напрямую (маска, рамка `SymbolCell`, бейджи, и особенно фичи-анимации `extra.ts`/`symbols.ts`/`wilds.ts`/`types.ts`, которые считают центр грида как `cols*cellSize`).
- Вертикальная вариативность **уже есть**: `rowsPerReel?: number[]` (Megaways), стрипы центрируются в конверте `maxRows` ([`reel/ReelGrid.ts:117`](../packages/game-engine/src/slot/reel/ReelGrid.ts#L117)).

### 6.2 Ключевое ограничение

Внутри **одного стрипа высота ячейки обязана быть одинаковой**. Прокрутка ленты в [`reel/SpinEngine.ts:201`](../packages/game-engine/src/slot/reel/SpinEngine.ts#L201) берёт **один** `step` на барабан (`cellPosition(reel,1).y − cellPosition(reel,0).y`) и раскладывает всю ленту с этим шагом. Разная высота ячеек внутри стрипа ⇒ ломается модель движения. Поэтому ось вариативности — **стрип целиком**, не отдельная ячейка. «Per-cell на стрипе» сознательно не поддерживаем (только для статичных не-крутящихся гридов, вне этой задачи).

### 6.3 Принятые решения

- **Гранулярность:** per-strip — у каждого барабана свои `{ width, height }`.
- **Зазоры:** тоже per-strip — зазор **между** стрипами может отличаться (не один общий `gap`).
- **Вертикальное выравнивание** при разной высоте стрипов: **центр** (как сейчас у `rowsPerReel`).
- **Маскирование:** маска **на каждый стрип** по его собственным размерам (чисто обрезает прокрутку на разновысоких стрипах).

### 6.4 Конфиг (обратно совместимо)

Скаляры остаются шорткатами, сверху — опциональные оверрайды; старшее переопределяет младшее:

```ts
interface GridConfig {
  cols: number; rows: number; rowsPerReel?: number[];

  // размер ячейки
  cellSize: number;                                  // квадрат, все стрипы (шорткат)
  cellWidth?: number; cellHeight?: number;           // прямоугольник, все стрипы
  cellSizePerReel?: Array<number | { width: number; height: number }>;

  // зазоры
  gap: number;                                       // единый h+v зазор (шорткат)
  colGap?: number | number[];                        // между стрипами, length = cols-1
  rowGap?: number | number[];                        // между рядами, скаляр или per-reel
}
```

### 6.5 Резолвер геометрии — единый источник

По образцу существующего `effectiveRowsPerReel` — один `resolveGeometry(grid)`, считающий всё один раз:

```ts
interface ResolvedGeometry {
  cellW: number[];    // per reel
  cellH: number[];    // per reel
  rowGap: number[];   // per reel (верт. шаг внутри стрипа = cellH[r] + rowGap[r])
  colX:  number[];    // центр X каждого стрипа, накопленный
  yOff:  number[];    // верт. смещение стрипа (центрирование)
  gridW: number; gridH: number;
}
```

Формулы:

```
// горизонталь: накопление ширин + межстриповых зазоров
colX[0] = cellW[0]/2
colX[i] = colX[i-1] + cellW[i-1]/2 + colGap[i-1] + cellW[i]/2

// вертикаль: высота стрипа и центрирование в общем конверте
reelH[r] = rows[r]*cellH[r] + (rows[r]-1)*rowGap[r]
gridH    = max(reelH)
yOff[r]  = (gridH - reelH[r]) / 2

// позиция центра ячейки
cellPosition(col,row) = {
  x: colX[col],
  y: yOff[col] + row*(cellH[col]+rowGap[col]) + cellH[col]/2
}
```

### 6.6 Рефактор — свести геометрию к двум API грида

Это ~80% работы и то, что «включает» обе фичи без правок в потребителях:

1. `grid.cellPosition(col,row)` — остаётся, но читает из `ResolvedGeometry`.
2. `grid.cellSize(col): { width; height }` — **новый** аксессор вместо публичного скаляра; все прямые чтения `grid.cellSize` заменяются на него.

Потребители на перевод:

| Файл | Что меняется |
| --- | --- |
| [`grid/geometry.ts`](../packages/game-engine/src/slot/grid/geometry.ts) | **новый** — `resolveGeometry()` + `cellPositionOf()`, чистый резолвер (см. 6.5) |
| [`grid/ReelGrid.ts`](../packages/game-engine/src/slot/grid/ReelGrid.ts) | width/height/step из резолвера; `cellSize(col)` аксессор; `center()`; маска строится **per-strip** по `cellW[col]×reelH[col]` со своим `yOff` |
| [`grid/SymbolCell.ts`](../packages/game-engine/src/slot/grid/SymbolCell.ts) | рамка `roundRect(-w/2,-h/2,w,h)` вместо квадрата; бейджи от `w/2,h/2`; `size: number \| {width,height}` |
| [`grid/AnimatedSymbol.ts`](../packages/game-engine/src/slot/grid/AnimatedSymbol.ts) | `resize(number \| {width,height})` (по умолчанию fill; `contain` — см. 6.7) |
| [`motion/SpinEngine.ts`](../packages/game-engine/src/slot/motion/SpinEngine.ts) | tape-ячейки через `cellSize(reel)`; `step` per-reel из `cellPosition` |
| [`cascade/TumbleController.ts`](../packages/game-engine/src/slot/cascade/TumbleController.ts) | `rowStep` per-column вместо общего |
| фичи `types.ts`/`symbols.ts`/`wilds.ts`/`extra.ts` | `glowRing`/бейджи через `cellSize(col)`; `rowStepOf(grid,col)`/`colStepOf`; центр из `grid.center()` |
| [`system/ReelSystem.ts`](../packages/game-engine/src/slot/system/ReelSystem.ts) | пробрасывает новые поля в `ReelGrid`; `geometryChanged()` учитывает их |

Порядок: сначала prod-код (резолвер + аксессор + ReelGrid/SymbolCell/SpinEngine), фичи-анимации последними.

> **Статус:** реализовано на ветке `feat/shell-package`. Тесты: `tests/slot/geometry.test.ts` (математика резолвера) + `tests/slot/reelGrid.test.ts` (per-strip аксессор). Все 263 теста game-engine зелёные, typecheck чистый.

### 6.7 Открытый под-вопрос (решить при правке `SymbolCell`/`AnimatedSymbol`)

Спрайт в прямоугольной ячейке: **растягивать под `w×h`** или **вписывать с сохранением пропорций** (`contain`, по меньшей стороне). Сейчас `AnimatedSymbol` ставит `width=height=size` ⇒ растяжение неизбежно. Предложение: `contain` по умолчанию + флаг `stretch` в стиле ячейки.

### 6.8 Обратная совместимость

Старые конфиги (`cellSize` + `gap`, без оверрайдов) резолвятся в равномерную квадратную сетку с тем же поведением — регрессий нет.

---

## 7. ReelStep™ — фирменная механика сдвига барабанов

> Отдельная механика цепочечного пересчёта для **классических линейных слотов** (5×3, 5×4, 5×5 и т.п. с фиксированными линиями — не ways/cluster). Реализована в барабанном движке; math (Lua) считает исход, движок его рисует.

### 7.1 Механика

Флоу после остановки барабанов:

```
барабаны остановились → оплатили выигрышные линии → каждый барабан сдвинулся вниз на N
→ экран пересчитали → если есть выигрыши, снова оплатили и сдвинули → … пока выигрышей нет
```

- **Сдвиг per-reel и независимый.** Барабан, на котором в этом шаге не сыграла ни одна линия, стоит на месте (`N = 0`). Барабан, где сыграло, прокручивается вниз на `N` = число **уникальных** выигрышных символов, участвовавших в выигрышных линиях на этом барабане.
- **Максимум** сдвига одного барабана — число видимых позиций на нём (клэмп к высоте окна), может быть дополнительно ограничен правилами игры.
- **Символы не удаляются** (в отличие от каскада/тумбла): существующие символы едут вниз, сверху заезжают `N` новых, нижние `N` уходят за окно.

### 7.2 Что отличает от каскада

Каскад/тумбл = `убрать выигрышные → гравитация выживших → долив сверху`. ReelStep = `оплатить (символы остаются) → частичный скролл ленты на N`. Поэтому механика движения — это strip-scroll с остановкой на **произвольном per-reel N**, а не удаление-и-долив и не полный ре-спин. Инфраструктура цепочки шагов, показ линий и накопление множителя переиспользуются как есть.

### 7.3 Реализация в движке (презентация)

| Элемент | Файл |
| --- | --- |
| **`ReelStepController`** — оплата линий + per-reel скролл на N (лента с `N` новыми символами сверху, overshoot + settle), бегущий множитель, `skip()` со снапом | [`cascade/ReelStepController.ts`](../packages/game-engine/src/slot/cascade/ReelStepController.ts) |
| **`buildReelStepTape()`** — чистая функция раскладки ленты (покрыта юнит-тестами) | там же |
| **`ReelSystem.reelStep(steps, opts)`** — гоняет цепочку, как `cascade()`; множитель переносится через free-spins с `cascade.multiplier.persistInFreeSpins` | [`system/ReelSystem.ts`](../packages/game-engine/src/slot/system/ReelSystem.ts) |
| **`SymbolCell.data`** — геттер текущих данных ячейки (нужен для построения ленты) | [`grid/SymbolCell.ts`](../packages/game-engine/src/slot/grid/SymbolCell.ts) |

Контракт шага:

```ts
interface ReelStepData {
  winningCells: { col: number; row: number }[]; // подсветить/оплатить ПЕРЕД сдвигом
  shifts: number[];                              // на сколько двинуть каждый барабан (0 = стоит)
  settledGrid: CellData[][];                     // доска после сдвига
}
```

Тайминги/easing/множитель берутся из секции `cascade` конфига (ReelStep — механика того же семейства); при `cascade.enabled = false` контроллер просто ставит `settledGrid` без анимации.

### 7.4 Граница math ↔ презентация

Движок только рисует. Вектор `shifts[]` и `settledGrid` считает **math (Lua)**: оценка фиксированных линий, число уникальных выигрышных символов на барабан, продвижение ленты. Движок это не генерирует (и не должен) — контракт под это готов.

### 7.5 Playground

Кнопка **ReelStep** в `examples/reel-lab` (тулбар). Синтезирует честную демо-цепочку: `buildReelStepSteps()` в [`board.ts`](../examples/reel-lab/src/board.ts) оценивает прямые фиксированные линии (каждый ряд — пейлайн, `wild` подставляется), считает `N` на барабан и строит сдвинутую доску; повторяет, пока линии играют. Нужно включить Cascade/Tumble в панели (ReelStep переиспользует его тайминги/множитель). В логе видно вектор сдвигов на каждый шаг.

> **Статус:** реализовано. Тесты: `tests/slot/reelStepController.test.ts` (раскладка ленты + множитель). Все тесты game-engine зелёные, typecheck чистый.
