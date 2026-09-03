# Design: `@energy8platform/stake-kit` — reusable Stake integration

Дата: 2026-06-22
Статус: согласован, готов к плану реализации
Контекст: третий срез дорожной карты [docs/slots-analysis-and-bootstrapper.md](../../slots-analysis-and-bootstrapper.md) (§5.5 шаг 3). Опирается на [game-spec/defineGame](2026-06-21-game-spec-define-game-design.md) (slice 1) и stake-bridge.

## Проблема

Каждая игра вручную пишет `src/stake/` (adapter/book-schema/runtime): ~400 строк, из них ~80% —
копипаста с разными константами. Болевые точки: ручной `ARRAY_FIELDS` список для коэрсии пустых Lua
`{}`→`[]` (хрупкий, ломается молча при новом поле); дублирование modeMap/nextRoundActions/стоимостей
(уже выводимы из `GameModel`); идентичный social-фрейм; jurisdiction→regulatory маппинг скопирован.
Эталоны зрелых игр (на shell): **kitsune-wrath** (сложный — spirit-gate, кумулятивный ретриггер) и
**magnum-opus** (простой). Stone-Rush НЕ эталон (ещё не на shell).

## Цель среза

`@energy8platform/stake-kit` — конвенциональный слой поверх примитивов stake-bridge. Игра пишет
только: zod-схему payload + одну функцию `segmentOf` + override social-словаря. Всё остальное
(ensureBook, коэрсия, resume, enrichConfig, social-фрейм) — из пакета.

## Решения (зафиксированы в брейншторме)

- **Размещение:** in-repo workspace `packages/stake-kit` → `@energy8platform/stake-kit`,
  renderer-agnostic. Зависит от типов stake-bridge + `GameModel` из game-spec. `zod` — peerDependency.
- **Единый путь splitRound — `segmentOf`-хук** (НЕ деление на простой/сложный, НЕ мега-фабрика с
  хуками). Один API `createGameAdapter({ model, schema, segmentOf })` для ВСЕХ игр; игра пишет одну
  чистую функцию `segmentOf(ctx) → SegmentCore`. Механику (loop/ensureBook/nextActions/progressMarker/
  resume/enrich) владеет stake-kit. magnum: `segmentOf` ~5 строк; kitsune: больше (spirit-gate,
  кумулятивный ретриггер сканом `events[0..index]`, settle-override) — но **та же функция**.
- **Schema-first вместо ручного `arrayFields`.** TS-типы стираются в рантайме → знание «какие поля
  массивы» берём из zod-схемы: `deriveArrayFields(schema)` обходит схему, собирает имена array-полей
  на любой глубине; `TData = z.infer<schema>`. Бонус — рантайм-валидация payload. Один источник.
- **`replay.ts` НЕ нужен.** Мост сам фетчит replay-книгу (`/bet/replay/...`, кэш, `payoutMultiplier`/
  `costMultiplier` на раунде); shell через `bonusId`→`features.buyBonus` лейблит режим и читает cost
  (`shell/types.ts:168`). Игро-специфичный кусочек (Stake-режим→`bonusId`) тривиален и derivable.
- **Без миграции боевых игр** в этом срезе. Валидация — расширение `examples/spec-slot/`.

## Архитектура

```
packages/stake-kit/src/
  book.ts          ensureBook(raw, fallbackTrigger), coerceLuaArrays(data, fieldSet),
                   progressMarker(i)/parseProgressMarker(s), roundMoney(v, precision)   (чистые)
  schema.ts        deriveArrayFields(schema): Set<string>  (zod introspection; изолировано)
  adapter.ts       createGameAdapter(config): BookAdapter; resumeFromBook(book, lastEvent, opts)
  jurisdiction.ts  enrichConfigWithJurisdiction(config, mapping?)
  social.ts        DEFAULT_PRE/POST_REPLACEMENTS, applySocialText(text, overrides?),
                   ensureSocialDictionary()
  types.ts         StakeGameConfig, SegmentCore, SegmentContext, SocialRule, RegulatoryMapping
  index.ts         публичный API + ре-экспорт BookAdapter/BookSegment/RoundContext/ModeMap из stake-bridge
packages/stake-kit/
  package.json     exports '.'; zod peerDependency
  rollup.config.ts vitest.config.ts tsconfig.json
```

Каждый модуль — одна ответственность, тестируется отдельно. `adapter.ts` чисто (book→segments,
без сети). Граница: stake-kit оборачивает примитивы stake-bridge (`applySocialReplacements`,
`formatAmount`, `parseStakeUrl` уже там — не дублируем).

## API

```ts
import type { BookAdapter, BookSegment, RoundContext } from '@energy8platform/stake-bridge';
import type { GameModel } from '@energy8platform/platform-core/game-spec';
import type { ZodType } from 'zod';
import type { SessionData } from '@energy8platform/game-sdk';

/** Per-event decisions the game returns; mechanical fields are filled by stake-kit. */
export interface SegmentCore<TData = Record<string, unknown>> {
  action: string;
  winX: number;                              // ×bet multiplier; stake-kit → winThisSegment = roundMoney(winX*bet)
  session?: Partial<SessionData> | null;
  bonusFreeSpin?: { grantId: number; remainingSpins: number };
  data?: TData;                              // optional override; default = coerced payload
}

export interface SegmentContext<TData> {
  event: unknown;                            // raw book event
  index: number;
  events: unknown[];                         // all events (kitsune scans [0..index] for cumulative state)
  payload: TData;                            // coerced + validated payload
  round: RoundContext;                       // betAmount, roundId, mode, triggerAction, currency, payoutMultiplier
}

export interface StakeGameConfig<TData = Record<string, unknown>> {
  model: GameModel;                          // → modeMap, nextRoundActions, costs
  schema: ZodType<TData>;                    // payload schema → array fields + validation
  segmentOf: (ctx: SegmentContext<TData>) => SegmentCore<TData>;
  sessionStages?: string[];                  // default ['free_spins'] — for resume rewind
  readPayload?: (event: unknown) => unknown; // default: ev.data ?? ev.spin ?? {}
  fallbackTrigger?: string;                  // default: first base action key from model
  enrichConfig?: (config: GameConfigData) => GameConfigData; // default: enrichConfigWithJurisdiction
}

export function createGameAdapter<TData>(config: StakeGameConfig<TData>): BookAdapter;
```

## Поток данных (`createGameAdapter.splitRound`)

```
book = ensureBook(rawState, fallbackTrigger)
fieldSet = deriveArrayFields(schema)                       // once per adapter (memoised)
segments = book.events.map((event, index) => {
  payload = coerceLuaArrays(readPayload(event), fieldSet)  // {}→[] at any depth
  payload = schema.parse(payload)  (or safeParse + warn)   // runtime validation
  core = segmentOf({ event, index, events, payload, round })
  return { action: core.action, data: core.data ?? payload,
           winThisSegment: roundMoney(core.winX * round.betAmount),
           session: core.session, bonusFreeSpin: core.bonusFreeSpin,
           progressMarker: progressMarker(index) }
})
// second pass: nextActions
segments[i].nextActions = isFinal ? nextRoundActions(model) : [segments[i+1].action]
```

- `nextRoundActions(model)` = non-free action keys (derivable from `model.modeMap` keys; free-spin
  actions excluded — they're session-internal).
- `resumeFrom` = `resumeFromBook(book, lastEvent, { sessionStages })`: parse `seg-<n>`, mid-bonus
  rewind to the first event whose stage ∈ `sessionStages` (Stake reviewers reject naïve N+1 mid-bonus).
- `enrichConfig` = `enrichConfigWithJurisdiction` (canonical mapping; overridable).

## Modules

### book.ts (pure)
- `ensureBook(raw, fallbackTrigger)` — `{ trigger, events }` from: JSON-string→parse; bare array→wrap;
  object with `events`→passthrough; garbage→`{ trigger: fallbackTrigger, events: [] }`.
- `coerceLuaArrays(data, fieldSet)` — recursive walk; for any key ∈ `fieldSet` whose value is an empty
  plain object `{}`, set `[]`; recurse into objects and array elements. Returns a coerced clone.
- `progressMarker(i)` → `seg-${i}`; `parseProgressMarker(s)` → number | null (`/^seg-(\d+)$/`).
- `roundMoney(v, precision = 'cents')` — `Math.round(v * f) / f`, `f = 100 | 1e6`.

### schema.ts
- `deriveArrayFields(schema): Set<string>` — walk a zod schema: `ZodObject` → recurse `.shape`;
  `ZodArray` → add the owning key, recurse element; unwrap `ZodOptional`/`ZodNullable`/`ZodDefault`
  via `._def.innerType`. Collects array-typed property names at any depth. Isolated so the zod
  version / introspection is swappable.

### adapter.ts
- `createGameAdapter(config)` — see API + flow.
- `resumeFromBook(book, lastEvent, { sessionStages })` — the shared mid-bonus-rewind resume.

### jurisdiction.ts
- `enrichConfigWithJurisdiction(config, mapping?)` — **canonical** jurisdiction→regulatory mapping
  (one set of regulatory keys; kitsune & magnum currently diverge — stake-kit fixes one canon) +
  mirror `stake.maxBet`→`regulatory.max_bet_value` (min-capped) + `stake.defaultBetLevel`→`defaultBet`.
  Preserves any existing `regulatory`. Default mapping; `mapping?` overrides keys.

### social.ts
- `DEFAULT_PRE_REPLACEMENTS` / `DEFAULT_POST_REPLACEMENTS: SocialRule[]` — common base swaps
  (bet→play, cost→play, funds→balance, buy bonus→get bonus; longer phrases first; POST cleanup).
- `applySocialText(text, overrides?)` — PRE(default+overrides.pre) → stake-bridge
  `applySocialReplacements` → POST(default+overrides.post), with `Engine` brand-protect
  (sentinel → swap → restore).
- `ensureSocialDictionary()` — lazy `import('@energy8platform/stake-bridge')`, cache the fn.
- `SocialRule = [RegExp | string, string]`.

## Testing (renderer-free, no Pixi, no network)

- **book**: `ensureBook` (string/array/object/garbage); `coerceLuaArrays` (empty `{}`→`[]` at top
  level + nested in array elements; non-empty untouched; non-listed keys untouched);
  `progressMarker`/`parseProgressMarker`; `roundMoney` (cents + microUnits).
- **schema**: `deriveArrayFields` over a nested zod schema (`cascade_history`→`wins`→`positions`),
  with optional/nullable unwrapping.
- **adapter**: `createGameAdapter` fixture book → expected segments — base round (single segment,
  `session.roundId`, nextActions = model's non-free actions), free-spin round (`bonusFreeSpin` on
  trigger, `action: 'free_spin'` on FS segments, nextActions chain `['free_spin']`), buy-bonus round,
  `{}`→`[]` coercion via schema, `winThisSegment = winX*bet`. `resumeFromBook` (seg-n parse, mid-bonus
  rewind). Model from `defineGame`.
- **jurisdiction**: canonical mapping (disabledTurbo→regulatory key; maxBet min-cap; defaultBet mirror;
  preserves existing regulatory).
- **social**: `applySocialText` (default swaps applied; override merged; `Engine` preserved).

## Validation — extend `examples/spec-slot/`

No new example. Add to `examples/spec-slot/`:
- `stake/schema.ts` — a zod schema for the toy spin payload (a couple of array fields).
- `stake/adapter.ts` — `createGameAdapter({ model, schema, segmentOf })` with a ~5-line `segmentOf`.
- `stake/adapter.test.ts` — run a fixture book through `splitRound`, assert segments (proves the
  factory composes with the real `model` from `./game.spec` end-to-end; pure, runnable in vitest).
The existing node smoke + host `tsc --noEmit` stay green.

## Scope

**В scope:** stake-kit package (book, schema, adapter, jurisdiction, social, types, index) + workspace/
package.json/rollup/vitest wiring + zod peerDependency + tests + `examples/spec-slot/stake/`
(schema + adapter + test).

**Вне scope (отдельные шаги):**
- миграция боевых игр (kitsune/magnum) на stake-kit
- per-game `book-schema.ts` runtime types beyond the zod schema (game authors its own schema)
- the full per-game social vocabulary (games supply override; defaults are the common base)
- `replay.ts` (covered by bridge + shell)
- CLI scaffolder; cascade primitives

## Риски / открытые вопросы

- **zod introspection touches `_def`** (semi-internal). Isolated in `schema.ts`; pin a zod major in
  peerDependencies and test `deriveArrayFields` against the pinned version. If a future zod reshapes
  `_def`, only `schema.ts` changes.
- **schema.parse vs safeParse**: a strict `.parse` throws on an unexpected payload mid-round (bad for
  a live round). Default to `safeParse` + console.warn + pass the coerced-but-unvalidated payload
  through, so validation never breaks a playable round. The plan fixes this contract.
- **Canonical regulatory keys (DECIDED):** kitsune (`turbo_enabled:false`) and magnum
  (`disable_turbo:true`) diverge. stake-kit adopts **kitsune's canon** (`turbo_enabled`/
  `autoplay_enabled`/`feature_buy_enabled` = false; `min_spin_duration_ms`; `session_timer_enabled`;
  `net_loss_display`) — it matches the existing `RuntimeFeatureFlags` reader. Existing games migrate
  later (out of scope). Overridable via the `mapping?` arg.
- **`nextRoundActions` derivation**: relies on `model.modeMap` excluding free-spin actions (it does —
  slice 1 `toModeMap` skips `role:'free'`). Confirm against the model in the plan.
