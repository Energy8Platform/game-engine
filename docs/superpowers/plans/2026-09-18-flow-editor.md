# Flow Editor Implementation Plan (slice 19)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `flow.yml` — an n8n-style DAG of trigger and action nodes — becomes the only driver of the game: a runtime row `flow1` interprets it, `main.ts` only emits `ui.spin`, the host validates and serves it, and the IDE edits it on a React Flow canvas with a palette, properties on the right, and the last run's trace painted on the graph.

**Architecture:** New runtime package `@energy8engine/flow` (expression evaluator, graph validation, interpreter with branches/fan-out/merge/triggers, built-in kinds, `ctx.events`, `ctx.flowNodes`, `ctx.flow`) composed from `e8-base` as `flow1` (hot). `ide-bridge` carries `flow` in and `flow-kinds`/`flow-trace` out; the host mirrors kinds, relays traces, reads/checks/serves `flow.yml`. The IDE client gets a `flow` service plugin, a `Flow` document on `@xyflow/react`, and a `flow` right-sidebar with `SchemaForm`.

**Tech Stack:** cordis 4.0.0-rc.8, schemastery, js-yaml (host), React 18 + `@xyflow/react` 12.11.6 (renders in jsdom — spiked 2026-09-18), vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-flow-editor-design.md`

## Global Constraints

- `flow.yml` at the project root; `FlowDoc { version: 1; nodes: FlowNode[]; edges: FlowEdge[] }`, `FlowNode { id, kind, props?, ui? }`, `FlowEdge { from, out?, to }`; `ui` is editor-only.
- Node ids unique; edges reference existing nodes; `out` ∈ the kind's `outs` (absent = the first); one input per node; fan-out = several edges from one port run concurrently; `merge` waits for every incoming edge once per run; a cycle must pass through `on` or `wait` (host error "cycle without a wait"; runtime refuses to start); at most one `boot`.
- Built-in kinds and ports EXACTLY: `boot(next)`, `on(next)`, `spin(result, failed)`, `present(next, failed)`, `show(next)`, `hide(next)`, `wait(next)`, `if(true, false)`, `set(next)`, `emit(next)`, `merge(next)`; props per spec §4.
- `if.when` grammar: comparisons `== != < <= > >=`, `&& || !`, parentheses, dotted paths into `vars`, literals (numbers, `'str'`/`"str"`, `true`/`false`/`null`); a bare path is truthy; a parse error → `false` + one diagnostic.
- A kind's `run` that throws or exceeds 30 s → diagnostic `plugin: 'flow'`, `where: <node id>`; the branch ends.
- `vars` is one object per run shared by branches; `on` fires a new branch per event with `vars.event = payload`; `spin` sets `vars.result`, `failed` sets `vars.error`.
- `ctx.events { emit(name, payload?), on(name, fn) → off }`, `ctx.flowNodes` (last-wins registry), `ctx.flow` (`replace, doc, trace, onTrace, ready`) provided by `flow1` in that order; row `hot: true`, config `{}`.
- Wire: `ServerMessage` gains `flow { doc, diagnostics }`, `flow-kinds { kinds }`, `flow-trace { entries }`; `ClientMessage` gains `flow-kinds`, `flow-trace`; preview `/ide` accept list gains both; traces batched per animation frame; trace cap 500.
- Host routes: `GET /api/flow` (root + preview) → `FlowResponse { doc: FlowDoc | null; diagnostics; kinds }`; `PUT /api/flow` body `FlowDoc` → validated, written, broadcast `flow`; refusals `400 { diagnostics }`; checks per spec §6.
- IDE: activity `{ key: 'flow', icon: 'git-branch', order: 36, opens: 'document' }`, document key `flow`, title `Flow`, not closable; DOM contract per spec §7 (`flow-screen`, `flow-palette`, `flow-add-<kind>`, `flow-canvas`, `flow-node-<id>`, `flow-diagnostics`, `flow-empty`, `prop-id`, `prop-kind`); positions debounced 250 ms, structure immediate; new id `<kind>-<n>`; trace classes `e8-flow-ran`/`e8-flow-active`, taken edges `animated`.
- `main.ts` (template ≡ example, pinned): no spin loop, no `presentStage`, no temporary scene rule; `#spin` → `ctx.events.emit('ui.spin')`; `__e8.spin()` = emit + await the next `present` trace entry; `__e8.flowTrace()`.
- `flow1` enters `engine/bundles/e8-base/e8.bundle.yml` after `playloop1`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`; the root lockfile is gitignored. No `git checkout`/`git stash` on files you did not create. Never kill a process you did not start. Playwright runs alone. Branch stays `feat/slot-webide-cordis`.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Commands from the REPO ROOT: `npm test -w @energy8engine/<pkg>` (the loader workspace is `@energy8engine/loader`); e2e: `cd engine/apps/web && npx playwright test tests/e2e/flow.spec.ts`.

---

## File map

| Path | Responsibility |
|---|---|
| `engine/core/contracts/src/protocol.ts` | `FlowNode/FlowEdge/FlowDoc/FlowKindInfo/FlowResponse`, three messages, unions |
| `engine/game/flow/package.json`, `tsconfig.json`, `vitest.config.ts` | new package (copy `engine/game/scenes/`'s; exports `.`, `./runtime`, `./schema`; `e8.runtime.entry/schema`; `hot: true`) |
| `engine/game/flow/src/expr.ts` | `evaluate(expr, vars): boolean` + `parse` |
| `engine/game/flow/src/graph.ts` | `validateFlow(doc, kinds): Diagnostic[]`, `outEdges`, `inEdges`, `cycleWithoutWait` |
| `engine/game/flow/src/events.ts` | `createEvents()` |
| `engine/game/flow/src/kinds.ts` | `createFlowNodes()` registry + the eleven built-ins |
| `engine/game/flow/src/interpreter.ts` | `createFlow({ kinds, ctx, report, fetchFn? })` → `FlowService` |
| `engine/game/flow/src/runtime.ts`, `src/schema.ts`, `src/index.ts` | the row; empty config schema; barrel |
| `engine/bundles/e8-base/e8.bundle.yml` | `flow1` |
| `engine/game/ide-bridge/src/index.ts` | `flow` in; `flow-kinds` + `flow-trace` out |
| `engine/ide/host/src/plugins/rpc.ts`, `dev-game.ts`, `flow.ts` (new), `project-scope.ts` | mirrors/relays, accept list, the flow plugin, compose order |
| `engine/templates/slot-basic/{flow.yml,src/main.ts,package.json,README.md}` + `engine/examples/first-slot/{same}` | fixture |
| `engine/ide/host/tests/template.test.ts` | pins |
| `engine/ide/client/src/plugins/flow.tsx`, `src/screens/FlowDocument.tsx`, `src/screens/flow-graph.ts` (pure reducers), `src/shell/FlowProperties.tsx`, `src/shell/Shell.tsx` (icon), `src/schema-form/fields.tsx` (`pick: 'scene'` hint), `src/styles.css`, `src/context.ts`, `src/index.ts`, `package.json` (`@xyflow/react`) | IDE |
| `engine/apps/web/tests/e2e/flow.spec.ts` | proof |

---

### Task 1: Contracts

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts` (after the scene types; the two unions)
- Test: `engine/core/contracts/tests/protocol-flow.test.ts`

**Produces:**

```ts
export interface FlowNode { id: string; kind: string; props?: Record<string, unknown>; ui?: { x: number; y: number } }
export interface FlowEdge { from: string; out?: string; to: string }
export interface FlowDoc { version: 1; nodes: FlowNode[]; edges: FlowEdge[] }
export interface FlowKindInfo { kind: string; outs: string[]; trigger: boolean; schema: unknown }
export interface FlowTraceEntry { run: number; node: string; out: string | null; at: number }
export interface FlowMessage { type: 'flow'; doc: FlowDoc | null; diagnostics: Diagnostic[] }
export interface FlowKindsMessage { type: 'flow-kinds'; kinds: FlowKindInfo[] }        // both ways
export interface FlowTraceMessage { type: 'flow-trace'; entries: FlowTraceEntry[] }     // both ways
export interface FlowResponse { doc: FlowDoc | null; diagnostics: Diagnostic[]; kinds: FlowKindInfo[] }
```

`ServerMessage` += `FlowMessage | FlowKindsMessage | FlowTraceMessage`; `ClientMessage` += `FlowKindsMessage | FlowTraceMessage`.

- [ ] **Step 1: Failing test** (same shape as `protocol-scenes.test.ts`: a value of each type assigns; the unions carry the three frames; `ClientMessage` carries the two).
- [ ] **Step 2: Add the types; `npm test -w @energy8engine/contracts` → PASS.** Commit `git commit -m "Name the flow document and its frames on the wire"`.

---

### Task 2: `@energy8engine/flow` — package, expression evaluator, events, graph validation

**Files:**
- Create: package files (copy from `engine/game/scenes/`; name `@energy8engine/flow`; deps `@energy8engine/contracts`, `@energy8engine/diagnostics`, `@energy8engine/registry`, `@energy8engine/scenes` (types), `@energy8engine/play-loop` (types), `cordis`, `schemastery`)
- Create: `src/expr.ts`, `src/events.ts`, `src/graph.ts`, `src/index.ts` (barrel)
- Test: `tests/expr.test.ts`, `tests/events.test.ts`, `tests/graph.test.ts`

**Produces:**

```ts
// expr.ts
export function evaluate(expr: string, vars: Record<string, unknown>): boolean;   // throws SyntaxError on a bad expression
export function readPath(path: string, vars: Record<string, unknown>): unknown;   // 'result.stage' → vars.result?.stage; '$x' and 'x' both accepted
// events.ts
export interface EventsService { emit(name: string, payload?: unknown): void; on(name: string, fn: (payload: unknown) => void): () => void }
export function createEvents(): EventsService;
// graph.ts
export interface KindShape { kind: string; outs: readonly string[]; trigger?: boolean }
export function validateFlow(doc: FlowDoc, kinds: readonly KindShape[] | null /* null = kinds unknown, skip kind checks */, sceneIds: readonly string[] | null): Diagnostic[];
export function outEdges(doc: FlowDoc, from: string, out: string): FlowEdge[];
export function inEdges(doc: FlowDoc, to: string): FlowEdge[];
```

`validateFlow` diagnostics (`plugin: 'flow'`, `where` = node id or `from→to`): duplicate id (error); unknown kind (error, only when `kinds`); edge from/to a missing node (error); `out` not in outs (error); more than one `boot` (error); a non-trigger node with no incoming edge (warning); `on`/`wait` with neither `event` nor `ms` (error); `show`/`hide` naming a scene not in `sceneIds` (error, only when `sceneIds`); a cycle whose nodes include no `on`/`wait` (error, `where` = the first node of the cycle, message "cycle without a wait: a → b → a").

- [ ] **Step 1: Failing tests**

```ts
// tests/expr.test.ts
import { describe, expect, it } from 'vitest';
import { evaluate, readPath } from '../src/expr';
const vars = { result: { stage: 'free_spins', win: 12.5 }, ready: true, n: 0, s: 'x' };
describe('evaluate', () => {
  it.each([
    ["result.stage == 'free_spins'", true], ['result.stage != "base_game"', true], ['result.win >= 12.5', true], ['result.win > 12.5', false],
    ['n < 1 && ready', true], ['n < 1 && !ready', false], ['s == "y" || ready', true], ['!(ready && n == 0)', false],
    ['ready', true], ['n', false], ['missing', false], ['missing.deep == null', true], ['result.win == 12.5', true],
  ])('%s → %s', (expr, out) => expect(evaluate(expr, vars)).toBe(out));
  it('a bad expression throws a SyntaxError naming the position', () => {
    expect(() => evaluate('n ==', vars)).toThrow(SyntaxError);
    expect(() => evaluate('(n > 1', vars)).toThrow(/position/);
  });
  it('readPath accepts a leading $', () => expect(readPath('$result.stage', vars)).toBe('free_spins'));
});
```

```ts
// tests/events.test.ts
it('on hears emit with the payload; off stops it; emit with no listener is fine', …);
```

```ts
// tests/graph.test.ts
const kinds = [{ kind: 'boot', outs: ['next'], trigger: true }, { kind: 'on', outs: ['next'], trigger: true }, { kind: 'show', outs: ['next'] }, { kind: 'if', outs: ['true', 'false'] }, { kind: 'wait', outs: ['next'] }, { kind: 'spin', outs: ['result', 'failed'] }];
const doc = (nodes, edges): FlowDoc => ({ version: 1, nodes, edges });
describe('validateFlow', () => {
  it('a clean loop through `on` is silent', () => expect(validateFlow(doc([{id:'a',kind:'boot'},{id:'b',kind:'show',props:{scene:'s'}},{id:'c',kind:'on',props:{event:'e'}},{id:'d',kind:'spin'}], [{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',to:'d'},{from:'d',to:'c'}]), kinds, ['s'])).toEqual([]));
  it('reports duplicate ids, unknown kinds, dangling edges, bad ports, two boots, an orphan, a bad wait, a missing scene', () => { /* one doc with each; assert `where`s with arrayContaining */ });
  it('a cycle with no on/wait is an error naming the cycle', () => {
    const out = validateFlow(doc([{id:'a',kind:'boot'},{id:'b',kind:'show',props:{scene:'s'}},{id:'c',kind:'if',props:{when:'x'}}], [{from:'a',to:'b'},{from:'b',to:'c'},{from:'c',out:'true',to:'b'}]), kinds, ['s']);
    expect(out).toContainEqual(expect.objectContaining({ severity: 'error', where: 'b', message: expect.stringContaining('cycle without a wait') }));
  });
  it('kinds null skips kind checks; sceneIds null skips scene checks', …);
});
```

- [ ] **Step 2: Implement.** `expr.ts`: a tokenizer (`ident.path`, number, string, `(`, `)`, ops) + recursive descent (`or → and → not → comparison → primary`); comparisons coerce like the old evaluator (`==`/`!=` strict on strings/booleans/null, numeric for numbers when both parse). `graph.ts`'s cycle check: DFS over edges from every node, collecting back-edge cycles; a cycle is reported once (by its lexicographically smallest node) when none of its nodes is `on`/`wait`. Run → PASS; typecheck.
- [ ] **Step 3: Commit** `git commit -m "Start @energy8engine/flow: expressions, events, graph checks"`.

---

### Task 3: The interpreter and the built-in kinds

**Files:**
- Create: `engine/game/flow/src/kinds.ts`, `src/interpreter.ts`
- Test: `tests/kinds.test.ts`, `tests/interpreter.test.ts`

**Produces:**

```ts
// kinds.ts
export interface RunCtx { vars: Record<string, unknown>; ctx: Context; signal: AbortSignal; fetchFn: typeof fetch }
export interface FlowNodeKind<P = Record<string, unknown>> {
  kind: string; schema: Schema<P>; outs: readonly string[]; trigger?: boolean;
  arm?(props: P, fire: (vars?: Record<string, unknown>) => void, ctx: RunCtx): () => void;
  run?(props: P, ctx: RunCtx): Promise<{ out: string; vars?: Record<string, unknown> }>;
}
export interface FlowNodesService { register(k: FlowNodeKind<any>): () => void; get(kind: string): FlowNodeKind | undefined; list(): FlowNodeKind[]; subscribe(fn: () => void): () => void }
export function createFlowNodes(): FlowNodesService;
export const BUILTIN_KINDS: FlowNodeKind[];   // boot, on, spin, present, show, hide, wait, if, set, emit, merge
// interpreter.ts
export interface CreateFlowOptions { kinds: FlowNodesService; ctx: Context; report(d: Diagnostic): void; fetchFn?: typeof fetch; now?: () => number; timeoutMs?: number /* 30000 */ }
export interface FlowService { replace(doc: FlowDoc): void; doc(): FlowDoc | null; trace(): readonly FlowTraceEntry[]; onTrace(fn: (e: FlowTraceEntry) => void): () => void; ready: Promise<void>; stop(): void }
export function createFlow(o: CreateFlowOptions): FlowService;
```

Built-ins read services LENIENTLY off `ctx.ctx.reflect.get(name, false)`: `spin` → `fetchFn('/api/spin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })`, `vars.result = body`, `ctx.reflect.get('play')?.record({ request: {}, result, steps: [] })` (check `SpinLogEntry`'s shape in `@energy8engine/play-loop` and match it — read `main.ts`'s `recordSpin` for the exact fields); non-2xx or throw → `{ out: 'failed', vars: { error: message } }`. `present` → `mechanics.present(result.stage, result.data)` (`ctx.reflect.get('mechanics')`), diagnostics → `failed`; else `play.execute(plan, board)` (`ctx.reflect.get('board')`), non-empty diagnostics → `failed`; `vars.plan = plan`. `show`/`hide` → `scenes.show/hide`. `wait` → `ms` timer and/or `events.on(event)`, whichever first; aborted by `signal`. `if` → `evaluate(when, vars)` (a `SyntaxError` → diagnostic + `false`). `set` → `vars[name] = value` (`$path` → `readPath`). `emit` → `events.emit`. `merge` is special-cased by the interpreter (its `run` is never called). Triggers: `boot.arm` fires once on the next microtask; `on.arm` subscribes `events.on(event, p => fire({ event: p }))`.

Interpreter: `replace(doc)` → `validateFlow(doc, kinds.list(), null)` — errors → report all, `doc()` keeps the new doc but no run starts (a warning-only result runs); `stop()` aborts the current run's signal and disarms triggers; arm every trigger node; a fired trigger starts `run++` with `vars = {}` (merged with the fire's vars) and one branch at each `outEdges(node, outs[0])`. A branch at node N: trace `{ run, node: N, out: null }`, `merge` → count arrival, stop unless every `inEdges(N)` arrived this run; else `kind.run(props, runCtx)` with a `timeoutMs` race and the run's `signal`; on `{ out, vars }` merge vars, trace `{ node: N, out }`, start a branch per `outEdges(N, out)`; on throw/timeout/unknown kind → `report` + trace `{ out: 'failed' }`? no — trace `out: null` stays and the branch ends; report only. `onTrace` listeners hear every entry; `trace()` is the last 500. `ready` = `Promise.resolve()` here (the runtime assigns the boot GET's).

- [ ] **Step 1: Failing tests** (a fake `Context` with `events` provided, fake `scenes` (`show`/`hide` spies), fake `mechanics`/`play`/`board`, `fetchFn` returning `{ ok: true, json: async () => ({ stage: 'base_game', data: {}, win: 0 }) }`):

```ts
it('boot → show → on: boot fires once, show is called, on is armed; an event starts a new branch each time', …);
it('spin puts result in vars and records; a 500 leaves by failed with vars.error', …);
it('present calls mechanics.present + play.execute; diagnostics leave by failed', …);
it('if takes true/false; a bad expression is a diagnostic and false', …);
it('fan-out runs both branches; merge waits for both, passes once per run', …);
it('wait ms resolves; wait event resolves on emit; replace() mid-wait aborts the branch (no trace after)', …);
it('a throwing run and a 30 s run (fake timers) report a diagnostic naming the node; the branch ends', …);
it('an unknown kind on a node is reported and the branch ends', …);
it('replace with a cycle-without-wait reports and starts nothing; a warning-only doc runs', …);
it('trace keeps the last 500 entries; onTrace hears each; stop() disarms `on`', …);
it('set writes a literal and a $path; emit reaches events.on', …);
```

- [ ] **Step 2: Implement; `npm test -w @energy8engine/flow` → PASS; typecheck.** Commit `git commit -m "Interpret the flow: triggers, branches, fan-out, merge, the built-in kinds"`.

---

### Task 4: The `flow1` row, the bundle, ide-bridge

**Files:**
- Create: `engine/game/flow/src/runtime.ts`, `src/schema.ts`
- Modify: `engine/bundles/e8-base/e8.bundle.yml` (`flow1` after `playloop1`), `engine/game/ide-bridge/src/index.ts`
- Test: `engine/game/flow/tests/runtime.test.ts`, `engine/game/ide-bridge/tests/index.test.ts`

**Produces:** `runtime.ts`: `name = 'flow'`, `inject = []` (reads everything leniently — `scenes`/`mechanics`/`play`/`board` may compose after it); provides `events`, `flowNodes` (built-ins registered), `flow`; boot `GET /api/flow` with the `replaced`/`alive` guard and `flow.ready` (rejects on a failed GET when nothing replaced; `.catch(() => {})` attached) — same shape as `scenes/runtime.ts`; a `doc: null` answer → nothing to run, `ready` resolves. `schema.ts`: `Schema.object({})`. ide-bridge: `flow` frame → `flow.replace(doc)` when `doc` is an object (null → `stop()`); `flow-kinds` forwarded on open/provide/registry change (`{ kind, outs, trigger: !!trigger, schema: JSON.parse(JSON.stringify(schema)) }`), same helper shape as `node-types` (fold both into one `forwardRegistry` helper if the file already has one); `flow-trace`: subscribe `flow.onTrace`, buffer, flush with `requestAnimationFrame` (or `setTimeout(0)` when no `requestAnimationFrame`) as one `{ type: 'flow-trace', entries }` frame; re-arm on re-provide.

- [ ] **Step 1: Failing tests**: runtime — provides the three, GET applies, a frame first wins, failed GET rejects `ready`, dispose stops the run; ide-bridge — `flow` in (object → replace, null → stop), `flow-kinds` out on provide + change, `flow-trace` batched (two entries in one tick → one frame).
- [ ] **Step 2: Implement; suites + typecheck green.** Commit `git commit -m "Compose flow1 from e8-base and bridge it to the IDE"`.

---

### Task 5: Host — rpc mirrors, the `flow` plugin

**Files:**
- Modify: `engine/ide/host/src/plugins/rpc.ts` (`flowKinds()`, `broadcastFlow`, `flow-kinds` mirror/relay/greeting/clear, `flow-trace` relay to every OTHER socket (not retained), event `game/flow-kinds`), `dev-game.ts` (accept list `+ 'flow-kinds', 'flow-trace'`; `ctx.get('flowHost')?.attachGameRoutes(preview)`), `project-scope.ts` (`await ctx.plugin(flow)` after `scenes`)
- Create: `engine/ide/host/src/plugins/flow.ts`
- Create fixture: `engine/ide/host/tests/fixtures/project-flow/` (= `project-scenes` + `flow.yml` with the five-node loop + one bad edge and a `show` of a missing scene in a second fixture file `flow-bad/`? — simpler: ONE fixture whose `flow.yml` is clean; the checks are unit-tested on `validateFlow` (Task 2) and the plugin test feeds a bad doc through `PUT`)
- Test: `engine/ide/host/tests/rpc.test.ts`, `tests/flow.test.ts`

**Produces:** `flow.ts`: `name = 'flow'`, `inject = ['server', 'ideRpc', 'files']`, reads `flow.yml` (`js-yaml`, shape check → error diagnostic `where: 'flow.yml'`), `validateFlow(doc, ctx.ideRpc.flowKinds() or null when empty, sceneIds from ctx.get('scenesHost')?.state().scenes.map(s => s.id) or null)`, reports `reportGameDiagnostics('flow', …)` deduped by value, broadcasts `flow` on every refresh (boot included — the slice-17 lesson), routes `GET /api/flow`, `PUT /api/flow` (400 on shape/validation ERRORS; warnings are written), re-reads on `files/written|removed` of `flow.yml` or `scenes/*`, and on `game/flow-kinds`; provides `flowHost { attachGameRoutes(server), state(): FlowResponse }`. `validateFlow` is imported from `@energy8engine/flow` — verify that subpath pulls no pixi (it must not; `flow` has no pixi dep).

- [ ] **Step 1: Failing tests** (rpc: mirror/greet/clear for `flow-kinds`, relay of `flow-trace`, the two broadcasts; flow: GET shape, PUT writes YAML + broadcasts + a bad doc → 400 with the diagnostics, a `files` write of `flow.yml` re-broadcasts, boot broadcast to a connected socket, missing `flow.yml` → `doc: null` and no diagnostic).
- [ ] **Step 2: Implement; `npm test -w @energy8engine/ide-host` green; typecheck.** Commit `git commit -m "Read, check and serve flow.yml from the host; mirror the game's flow kinds"`.

---

### Task 6: Template and example — `flow.yml`, the thin `main.ts`

**Files:**
- Create: `engine/templates/slot-basic/flow.yml` (spec §3 exactly) and `engine/examples/first-slot/flow.yml` (byte-identical)
- Modify: `engine/templates/slot-basic/src/main.ts` then `cp` to `first-slot`; `package.json` (both: `@energy8engine/flow`); `README.md` (both: one paragraph); `engine/ide/host/tests/template.test.ts` (top-level list `+ 'flow.yml'`; identity loop `+ 'flow.yml'`)

`main.ts` after: keep `createGame`, `resolve`, the `need()` block (drop `play` from the page needs if nothing on the page reads it any more — `__e8.spins()` still reads `spinLog`), `mechanicSelect` handling, diagnostics forwarding; DELETE `presentStage`, the spin-click body, `recordSpin`, `lastSpin`, `__e8.present`; `spinBtn.onclick = () => events.emit('ui.spin')` where `events = ctx.reflect.get('events', false)` (a page composed without `flow1` shows "no flow row — the spin button does nothing" in `#status`); `__e8.spin()` = `new Promise` resolved by the next `flow.onTrace` entry with `node kind present`… the trace carries node ids, not kinds — resolve on the next entry whose `out` is `'next'` or `'failed'` for a node whose kind is `present` (look the kind up in `flow.doc()`), returning `{ result: vars? }` — the interpreter does not expose vars; expose `flow.lastVars()`? Keep it minimal: `__e8.spin()` resolves `{ out }` after `present` leaves; `__e8.spins()` stays (spin-log); `__e8.flowTrace()` = `flow.trace()`; `__e8.scenesVisible()`/`nodeVisible()` stay.

- [ ] **Step 1: Write the files; `npm test -w @energy8engine/ide-host -- template` green; `cd engine/examples/first-slot && npx tsc --noEmit` clean.**
- [ ] **Step 2: Boot check** (ports free): `cd engine/examples && node ../apps/cli/bin/e8.mjs` in the background, open the project via `POST /api/workspace/open` as Task 4 of slice 18 did, `curl :5681/api/flow` shows the doc, then with Playwright's Chromium or `curl` alone — at least the flow GET; stop what you started.
- [ ] **Step 3: Commit** `git commit -m "Drive the example from flow.yml; the page only emits ui.spin"`.

---

### Task 7: IDE — the `flow` service, activity, document shell, icon

**Files:**
- Create: `engine/ide/client/src/plugins/flow.tsx`
- Modify: `engine/ide/client/src/shell/Shell.tsx` (icon map: `'git-branch'` path — a simple three-dot-and-two-lines glyph, e.g. `M6 3v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 6c0 4-12 4-12 9`), `src/context.ts` (compose `flow` after `scenes`), `src/index.ts` (exports)
- Test: `engine/ide/client/tests/flow-service.test.tsx`

**Produces:**

```ts
export interface FlowClientService {
  doc(): FlowDoc | null; diagnostics(): readonly Diagnostic[]; kinds(): readonly FlowKindInfo[]; trace(): readonly FlowTraceEntry[];
  selected(): string | null; select(id: string | null): void;
  update(doc: FlowDoc): Promise<Diagnostic[]>;     // PUT /api/flow; [] on success
  subscribe(fn: () => void): () => void;
}
export const name = 'flow'; export const inject = ['slots', 'connection', 'shell', 'scenes'];
export function useFlow(ctx): { doc, diagnostics, kinds, trace, selected };
```

Boot GET `/api/flow` with the frame-first guard; `flow`/`flow-kinds`/`flow-trace` via `connection.onFrame` (`flow-trace` entries APPENDED, capped 500, a new `run` number clears the older run's entries); registers the activity (`git-branch`, 36, document) and `shell.document` key `flow` → `FlowDocument` (Task 8 creates it; in this task register a placeholder? NO — create `FlowDocument.tsx` here as the empty/diagnostics shell: `flow-screen` root, `flow-empty` with the create button when `doc() === null`, `flow-diagnostics` list; Task 8 fills the canvas in).

- [ ] **Step 1: Failing tests** (boot GET; frames; a frame before the GET wins; `update` PUT body + refusal; trace append/cap/run rollover; the document renders `flow-empty` and the create button PUTs the one-boot doc; render through `ctx.slots.list('shell.document')`).
- [ ] **Step 2: Implement; client suite + typecheck green.** Commit `git commit -m "A flow service in the IDE, and the Flow document's empty state"`.

---

### Task 8: The canvas — React Flow, palette, reducers, trace

**Files:**
- Modify: `engine/ide/client/package.json` (`"@xyflow/react": "12.11.6"`), then `npm install`
- Create: `engine/ide/client/src/screens/flow-graph.ts` (pure: `toReactFlow(doc, trace, selected)`, `addNode(doc, kind, info, at)`, `connect(doc, from, out, to)`, `removeNodes(doc, ids)`, `removeEdges(doc, edges)`, `moveNode(doc, id, at)`, `nextId(doc, kind)`)
- Modify: `engine/ide/client/src/screens/FlowDocument.tsx` (the canvas), `src/styles.css` (`.e8-flow-*`, React Flow's CSS imported once in `FlowDocument.tsx` via `import '@xyflow/react/dist/style.css'` — check the ide-web build carries it)
- Test: `engine/ide/client/tests/flow-graph.test.ts`, `tests/flow-document.test.tsx`

Behaviour per spec §7: custom node `e8` (label = kind, sub-label = id, one target `Handle` left, one source `Handle` per `outs` entry on the right labelled with the port name, `data-testid="flow-node-<id>"`, classes `e8-flow-ran`/`e8-flow-active`); `edges` with `sourceHandle = out ?? outs[0]`, `animated` when the trace's latest run took that edge (consecutive entries `{node: from, out}` then `{node: to, out: null}`); `onNodesChange` positions → `moveNode` (debounced 250 ms, one PUT); `onConnect` → `connect` (refused when the same `from/out/to` exists) → PUT; `onEdgesDelete`/`onNodesDelete` → PUT; `onNodeClick` → `select`; `onPaneClick` → `select(null)`; palette buttons `flow-add-<kind>` (click → add at `{ x: 80 + 40·count, y: 80 + 40·count }`; drag → `onDrop` with `screenToFlowPosition`); `ResizeObserver` guarded for jsdom.

- [ ] **Step 1: Failing tests** (reducers: each function; document: renders the five fixture nodes as `flow-node-*`; clicking `flow-add-wait` PUTs a doc with `wait-1`; a `flow-trace` frame marks `spin`/`draw` as ran; node click selects; delete via `onNodesDelete` (call the handler through React Flow's keyboard `Delete` on a selected node if jsdom delivers it, else expose the reducer path) PUTs without the node and its edges).
- [ ] **Step 2: Implement; suite + typecheck green; `npm run build -w @energy8engine/ide-web` succeeds (React Flow CSS present in `dist/assets/*.css`).** Commit `git commit -m "Draw the flow on a canvas: palette, nodes, edges, the last run"`.

---

### Task 9: Flow properties on the right, `scene` pick

**Files:**
- Create: `engine/ide/client/src/shell/FlowProperties.tsx`
- Modify: `engine/ide/client/src/plugins/flow.tsx` (register `shell.sideRight` key `flow`; show/hide on `selected()`; when a flow node is selected, `ctx.scenes.select(null)` so the two panels do not fight, and vice versa is Task 9's `scenes` plugin tweak: on `ctx.scenes` selection → `ctx.flow.select(null)` — implement both directions), `src/schema-form/fields.tsx` (a string field whose schema meta has `extra.pick === 'scene'` renders a `<select>` of `ctx.scenes.docs()` ids — `SchemaForm` gets an optional `pickers?: Record<string, () => string[]>` prop the caller supplies; the `flow` `show`/`hide` schemas set `.extra('pick', 'scene')` in `kinds.ts` — add that to Task 3's schemas now, it is one call each)
- Test: `engine/ide/client/tests/flow-properties.test.tsx`, `tests/schema-form.test.tsx` (extend)

DOM: `prop-id` (rename → edges follow; duplicate → `prop-id-error`), `prop-kind`, `SchemaForm rowId="flow.<id>"` `commit="blur"` with `pickers={{ scene: () => [...ctx.scenes.docs().map(d => d.id)] }}`; unknown kind → `prop-error` "kind "x" is not registered".

- [ ] **Step 1: Failing tests** (form renders `scene` as a select of scene ids and a change PUTs; rename updates edges; duplicate refused; selecting a flow node hides the scenes panel and shows `side-right-flow`; a `pickers`-less `SchemaForm` renders the string field as before).
- [ ] **Step 2: Implement; green.** Commit `git commit -m "Edit a flow node's props on the right; pick a scene by name"`.

---

### Task 10: End to end

**Files:**
- Create: `engine/apps/web/tests/e2e/flow.spec.ts`
- Modify: e2e specs whose premise changed: `scenes.spec.ts` ("a spin still presents under the temporary rule" → now via the flow: `__e8.spin()` resolves `{ out: 'next' }` and `scenesVisible()` is `['base_game']` from boot), `composition.spec.ts`/`schema.spec.ts`/`hot-fork.spec.ts`/`reel-step.spec.ts` if they call `__e8.present` or rely on the old status text — read `grep -rn "__e8\.\|#status" tests/e2e` and adjust to what the page does now (`#status` text after a spin: keep `done`/`error — see log` semantics by setting it from the `present` trace in `main.ts`).

- [ ] **Step 1: Write** `flow.spec.ts`: the Flow document shows five nodes; `flow-add-wait` → `wait-1` in the file; connect `draw → wait-1` by dragging the `next` handle onto `wait-1`'s target handle (Playwright `mouse` between the handles' bounding boxes) → edge in the file; a spin in the Preview paints `spin` and `draw` with `e8-flow-ran`; `Delete` on a selected node removes it and its edges from the file; the Preview spins with no loop in `main.ts` (`__e8.spin()` → `{ out: 'next' }`, `spins()` grew by one); the canvas boots with `base_game` visible (`scenesVisible()` before any spin).
- [ ] **Step 2: Run** `flow.spec.ts` + the touched specs alone; product defects → product + unit test; premise errors → the test with a reason.
- [ ] **Step 3: Whole suite** — unit: contracts, flow, scenes, scene-edit, reels, ide-bridge, ide-host, ide-client, ide-web, game-runtime, loader; then the full Playwright run alone (twice if flaky; name the flakes).
- [ ] **Step 4: Commit** `git commit -m "Prove the flow editor in a browser"`.
