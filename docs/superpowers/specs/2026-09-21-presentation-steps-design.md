# Presentation steps, value expressions, small debts — design (slice 29)

Date: 2026-09-21. Branch: `feat/slot-webide-cordis` at `a95e7d6` (slice 28).
Source: round 2 of the paper-duel port
(`docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`), requests
N2, N3, N6 and N7. N1, N4 and N5 (composite symbol states, named states,
count-up tweens) are slice 30.

## 0. Rules

- `packages/*` is not edited. The legacy `ReelGrid.geometry` is read, not
  changed.
- Every new prop keeps the flow's existing rule: a string prop refuses an
  unquoted YAML scalar; `''` means "untouched".
- Every fix carries a unit test in its package; the browser proof is the
  e2e suite plus the cases named in §5.
- A value that cannot be resolved is a **warning on the node** and the
  value is left as written; the branch continues.

## 1. N2 — beats between board steps

### 1.1 The problem

A mechanic's plan is a script for the board; everything paper-duel does
*between* cascade rounds (meter fills, the plaque climbing, per-cluster win
floats, a sound per removal, a beat before a duel) has no home but a pixi
`StepHandler` in the project plugin. The flow cannot react: `present` is
one node and `on` does not fire while the run is busy.

### 1.2 The `emit` step

`@energy8engine/contracts` `presentation.ts` gains a sixth known step:

```ts
/** A beat on the flow bus, not a board step: `event` fires with `payload`;
 *  `wait: true` holds the plan until every flow branch that event started has ended. */
export interface EmitStep {
  kind: 'emit';
  event: string;
  payload?: unknown;
  wait?: boolean;
}
```

- `KnownPresentationStep` includes it, so a mechanic's `PresentationPlan`
  may carry it with compile-time checking.
- `KNOWN_STEP_KINDS` and `BoardApi` do **not** include it: it is not a
  board step, and `executePlan`'s gate (`isKnownKind ? board[kind] :
  registry`) sends it to the step registry unchanged. The "nothing can
  perform step" diagnostic for `emit` names the missing handler.
- `isPresentationStep`: `emit` is well-formed when `event` is a non-empty
  string; `payload` is anything; `wait` is a boolean when present.

The mechanic is still pure: it emits data (which cell, what value, when),
never a scene or shell name.

```ts
steps.push({ kind: 'emit', event: 'pd.round', payload: { step, meters, casc_mult, step_win }, wait: true });
```

### 1.3 The handler (`@energy8engine/play-loop`)

`apply` registers a built-in handler for `emit` on its own `steps` registry
(a project plugin registering `emit` collides, first wins — the built-in).

- `run(step)`: `bus.emit(step.event, step.payload)`; when `step.wait` is
  true and `emit` returned a promise, await it.
- No `events` service yet (the flow row not landed): throw `no 'events'
  service in this composition` — `executePlan` turns it into the usual
  `step "emit" failed` diagnostic.
- `skip()`: releases every pending wait at once (the plan stops holding;
  the branches keep running). Turbo is not the handler's business: a branch
  reads `$shell.turbo` itself.

### 1.4 The bus and the interpreter (`@energy8engine/flow`)

- `EventsService.emit(name, payload): Promise<void>` — dispatch stays
  synchronous; the promise settles when every listener's returned promise
  has settled (`Promise.allSettled`; a rejection is not the emitter's). A
  listener may return `void` or `Promise<void>`.
- The interpreter's `fire(vars?)` (the `arm` callback) returns
  `Promise<void>`: resolved when the run it started has no live branch
  (a per-run counter beside the epoch's), at once when the epoch is
  aborted, and by `stop()` for every run still live.
- `on.busy` gains `'parallel'`: fire at once, always, a concurrent run. The
  listener returns the run's promise for `parallel` and for an idle
  `ignore`/`queue`; a dropped or queued fire returns `undefined`.
- A parallel run's `vars` are fresh (`Object.create(view)`): `$event` and
  the live roots (`$shell`, `$session`, …), **not** the emitting run's vars
  — the payload carries what the branch needs.
- The flow `emit` kind gains `wait: boolean` (default `false`) with the
  same meaning.

```yaml
- { id: onround, kind: on,    props: { event: pd.round, busy: parallel } }
- { id: meter,   kind: prop,  props: { target: base_game/meter_rock, prop: width, value: '$event.meters.rock * 2' } }
- { id: plaque,  kind: prop,  props: { target: base_game/mult_value, prop: text, value: 'x{$event.casc_mult}' } }
- { id: climb,   kind: shell, props: { win: '$event.running_win' } }
```

Not here: the built-in `classic`/`cascade` mechanics emit no beats (nothing
asks yet); `present` does not announce every step on the bus.

## 2. N3 — value expressions and formatting

### 2.1 One resolver

`@energy8engine/flow` exports
`resolveValue(value: unknown, vars, report?: (message: string) => void): unknown`:

- a string containing `{…}` is a **template**: each `{expr}` is evaluated,
  `String()`ed and joined with the literal text; the result is a string;
- a string starting with `$` is an **expression** (`evaluateValue`);
- any other value is the literal, unchanged.

A `SyntaxError` (or an unknown format) calls `report` with the message and
returns the string **as written**. Every kind that resolved a `$path` today
uses it: `spin.action`/`betLevel`, `step.roundId`/`action`,
`present.turbo`, `prop.target`/`value`, `set.value`, `emit.payload`, every
`shell.*` prop, and flow-fx `audio.volume`. Numeric props (`wait.ms`,
`tween.x`…, `sound.volume`) stay numbers — not this slice. The schema
descriptions say "literal, `$expr`, or a `{…}` template".

A bare `$path` is a valid expression, so every document written so far
resolves as before.

### 2.2 The grammar (`expr.ts`)

```
value   := or ( '|' NAME ( ':' primary )? )*     -- formats, left to right
or      := and ( '||' and )*
and     := not ( '&&' not )*
not     := '!' not | cmp
cmp     := add ( ( '==' | '!=' | '<' | '<=' | '>' | '>=' ) add )?
add     := mul ( ( '+' | '-' ) mul )*
mul     := unary ( ( '*' | '/' ) unary )*
unary   := '-' unary | primary
primary := NUMBER | STRING | 'true' | 'false' | 'null' | PATH | '(' or ')'
```

- Arithmetic is numeric: both sides through `Number()`, except that a
  missing var (`null`), `undefined` and `''` read as `NaN`; `NaN` propagates
  through arithmetic AND formats (`$missing | currency` → `$NaN`), so a
  typo'd path shows, rather than rendering as `$0.00` — a kind's own "is not
  a number" diagnostic then names the prop.
- `||`/`&&` return the operand, as JS does (both sides are still
  evaluated): `$result.win || 0 | int` formats the real number. Inside a
  parenthesised group feeding a comparison it is the operand that is
  compared, not a coerced boolean. Consequence: a `-` inside a `$path` is
  now subtraction (`$my-var` reads `$my` minus `$var`); no document in the
  repo carries one.
- A path token accepts numeric segments (`$result.data.cascades.0.step_win`),
  matching what `readPath` already reads.
- `evaluateValue(expr, vars): unknown` is new; `evaluate` is
  `Boolean(evaluateValue(...))`, so `if` gains arithmetic for free.
- Formats (a pipe makes the value a string):
  - `currency` — `symbol` + `toFixed(decimals)` per `$session.currency`
    (`{ symbol, decimals, position }`; `left` → `$4.60`, `right` →
    `4.60 €`); no session root → `toFixed(2)`, no symbol;
  - `int` — `Math.round`;
  - `fixed:N` — `toFixed(N)`;
  - `multiplier` — `'x' + n` with trailing zeros trimmed (`x48`, `x2.5`);
  - anything else — `SyntaxError: unknown format 'name'`.

Not here: `{{`/`}}` escapes (a literal brace pair has no author yet),
function calls, ternaries.

### 2.3 `shell` scalar siblings

`shell` gains `freeSpinsCurrent`, `freeSpinsTotalWin` and `bonusTotalWin`
(strings, `''` untouched, number or expression). `freeSpins*` merge over
`shell.state.freeSpins` and reach `setFreeSpins` in one call;
`bonusTotalWin` merges over `shell.state.bonus` and reaches `setBonus` —
with no bonus set it is a warning (`shell: bonusTotalWin: no bonus to
update`). The object forms of `freeSpins`/`bonus` stay.

## 3. N6 — the default build's session

`e8 build` without `--target platform` adds one `info` diagnostic to the
report and the printed summary:

> `the default target has no session: serve /api/session and /api/spin from
> a host, or build with --target platform`

Nothing is frozen for it — without a host there is no math to play either.

## 4. N7 — small ones

### 4.1 The dev wallet charges an action's cost

- `SessionInit.actions?: Record<string, number>` — the bet multiplier per
  action name (`{ spin: 1, tournament: 100 }`); optional, `session-sdk`
  never sets it (the platform charges server-side).
- The host's `GET /api/session` fills it from `ctx.spinSchema.schema.actions`
  (`name → cost`); no schema → omitted.
- `session-host` charges `betLevel × (init.actions?.[action] ?? 1)` on an
  opening play (`roundId` undefined), as today for the `?? 1` case.

### 4.2 `e8 spin` divides by the action's cost

`SpinReport.cost: number` — the played action's cost from the assembled
schema (`1` when the action or the schema is unknown); `rtp = mean(final
totalWin) / cost`. The `rtp` help line says so; steps are still free.

### 4.3 `reels.origin`

The `reels` node type gains `origin: 'cell' | 'center'` (default `cell` —
today's, reel 0's cell centre). `center` mounts a wrapper `Container` with
`board.view` at `(-geometry.centerX, -geometry.centerY)` of the legacy
grid's `geometry` (`GridLike` gains an optional `geometry`), so `x`/`y` name
the board's centre. Pick and bounds work through the wrapper unchanged.

### 4.4 `GET /api/spec` and the paytable

- The host serves `GET /api/spec` → `{ spec: <game/spec.json parsed> | null }`
  (`null` when absent or unparsable); `e8 build` freezes it under
  `dist/api/spec` with the other documents.
- `shell-pixi`: when `config.gameInfo.sections` is empty, the row fetches
  `/api/spec` once, before `createPixiShell` (the shell has no game-info
  setter; one request on the row's own boot) and, when `spec.symbols` carries
  `pay` entries, adds one `{ type: 'paytable', title: 'Paytable', rows }`
  section: a row per symbol with `pay`, `wins` = its entries sorted by count
  ascending as `{ count, multiplier }`; `symbol.image` = the symbol's
  `static.props.src` when `ctx.symbols.doc()` has it as an `image`, else
  `symbol.text` = `name ?? id`. A fetch failure or no `pay` anywhere leaves
  the sections empty, silently (the static default build has no host).
  Authored `sections` are never touched.

## 5. Tests

- contracts: `EmitStep` shape in `isPresentationStep` (valid, empty event,
  non-boolean wait).
- play-loop: the built-in `emit` handler fires the bus, `wait: true` holds
  until the listener's promise settles, `skip()` releases the hold, a
  missing bus is a `step "emit" failed` diagnostic, a registry collision on
  `emit` keeps the built-in.
- flow: `emit` returns a promise settling after listeners; `fire` resolves
  when the run drains and on `stop()`; `on { busy: parallel }` fires while
  busy and sees `$event` but not the parent's vars; `emit` kind `wait`;
  `evaluateValue` arithmetic, precedence, unary minus, numeric path
  segments, every format, unknown format, template joins, the as-written
  fallback with a report; `shell` siblings merge over state.
- flow-fx: `audio.volume` through `resolveValue`.
- session-host: `actions` cost charged; absent → `× 1`.
- ide-host: `/api/session` carries `actions`; `/api/spec` answers and 404s
  nothing; `spin`'s `cost` divides `rtp`; `build` adds the info line on the
  default target and freezes `spec`.
- reels: `origin: center` offsets by the geometry's centre; `cell` is
  byte-identical to today.
- shell-pixi: the derived paytable (image from symbols, text fallback,
  sorted counts, authored sections untouched).
- e2e (`engine/apps/web/tests/e2e`): one case per new behaviour that
  reaches the page — a template + `currency` on the example's win text, an
  `on { busy: parallel }` branch fired by a flow `emit { wait: true }`
  (the example has no mechanic emitting beats; the flow kind proves the
  same bus path).
- The example/template pair (`first-slot`): the win text becomes
  `'{$result.winAmount | currency}'`; the byte-pin test follows.

## 6. Not here

- N1, N4, N5 — slice 30.
- Mobile asset tier per node; `present.step` announcements; beats from the
  built-in mechanics; numeric props as expressions; brace escapes.
