# Flow editor — design (slice 19, sub-project C of the scenes redesign)

Date: 2026-09-18. Branch: `feat/slot-webide-cordis`. Builds on slice 17
(scenes as node trees, `@energy8engine/scenes`) and slice 18 (the canvas).

## 0. Where this sits

The user's rule: the flow graph is the ONLY driver of the game. Today
`main.ts` hard-codes the loop (button → `POST /api/spin` → `presentStage`
→ the temporary "show the scene named `result.stage`" rule). This slice
replaces that with a document, `flow.yml`, interpreted by a runtime row
`flow1`; a page (or later a shell) only emits events into `ctx.events`.
The IDE gets a Flow document: an n8n-style DAG on React Flow, a node
palette from the game's registry, properties on the right, and a trace of
the last run painted on the graph.

## 1. Goal

An author describes the whole game — what shows at boot, what a button
does, the spin loop, which scene a stage enters — as nodes and edges, by
dragging in the IDE, without touching code. The runtime walks the graph.
Node kinds are a plugin registry, as scene node types are.

## 2. Non-goals

- `tween`, `sound`, `forEach` node kinds (D, with animations).
- Sub-graphs, copy/paste, undo, auto-layout (React Flow's own DnD and
  pan/zoom are the layout).
- A shell: the example page's `#spin` button emits `ui.spin`; a shell
  integration is the same `emit` from other buttons, later.
- Editing `flow.yml` while a run is mid-node (a `replace` restarts the
  interpreter from `boot`; a spin in flight completes into the void).
- Bundling `flow.yml` into a production build (same ceiling as scenes).

## 3. The document — `flow.yml`

One file at the project root.

```yaml
version: 1
nodes:
  - { id: start, kind: boot,    ui: { x: 40,  y: 80 } }
  - { id: base,  kind: show,    props: { scene: base_game }, ui: { x: 220, y: 80 } }
  - { id: idle,  kind: on,      props: { event: ui.spin },   ui: { x: 400, y: 80 } }
  - { id: spin,  kind: spin,    ui: { x: 580, y: 80 } }
  - { id: draw,  kind: present, ui: { x: 760, y: 80 } }
edges:
  - { from: start, to: base }
  - { from: base,  to: idle }
  - { from: idle,  to: spin }
  - { from: spin,  to: draw }
  - { from: draw,  to: idle }
```

```ts
// @energy8engine/contracts
export interface FlowNode { id: string; kind: string; props?: Record<string, unknown>; ui?: { x: number; y: number } }
export interface FlowEdge { from: string; out?: string; to: string }   // `out` = the source port; the kind's first port when absent
export interface FlowDoc  { version: 1; nodes: FlowNode[]; edges: FlowEdge[] }
```

Rules: node ids unique; `from`/`to` must exist; `out` must be one of the
kind's ports; every node has ONE input; a node with several outgoing
edges from one port fans out (the branches run concurrently); `merge` is
the only kind whose input waits for every incoming edge. A cycle must pass
through an `on` or a `wait` (else the host reports "cycle without a wait"
and the runtime refuses to start it). `ui` is editor-only.

## 4. Node kinds — `ctx.flowNodes`

```ts
// @energy8engine/flow
export interface FlowNodeKind<P = Record<string, unknown>> {
  kind: string;
  schema: Schema<P>;                 // props; travels to the IDE as JSON like node-types
  /** Output port names in order; the first is the default edge target. */
  outs: readonly string[];
  /** `trigger` kinds start a run; the runtime calls `arm` once per doc and `run` never. */
  trigger?: boolean;
  arm?(props: P, fire: (vars?: Record<string, unknown>) => void, ctx: RunCtx): () => void;
  /** Non-trigger: do the thing, return the port to leave by (and vars to merge). */
  run?(props: P, ctx: RunCtx): Promise<{ out: string; vars?: Record<string, unknown> }>;
}
export interface RunCtx { vars: Record<string, unknown>; ctx: Context; signal: AbortSignal }
```

`ctx.flowNodes` = `createRegistry({ policy: 'last-wins' })`, provided by
`flow1` before `ctx.flow`. Built in:

| kind | outs | props | does |
|---|---|---|---|
| `boot` | `next` | — | trigger; fires once when the run starts |
| `on` | `next` | `event: string` | trigger; fires on every `ctx.events.emit(event, payload)`, `vars.event = payload` |
| `spin` | `result`, `failed` | — | `POST /api/spin` with `{}`; `vars.result = SpinResult`; records to `play.record`; a non-2xx/throw → `failed` with `vars.error` |
| `present` | `next`, `failed` | — | `mechanics.present(vars.result.stage, vars.result.data)` → `play.execute(plan, board)`; `failed` on diagnostics |
| `show` | `next` | `scene: string`, `transition?: string` | `scenes.show(scene, { transition })` |
| `hide` | `next` | `scene: string` | `scenes.hide(scene)` |
| `wait` | `next` | `ms?: number`, `event?: string` | one of the two; both → whichever first |
| `if` | `true`, `false` | `when: string` | the old branch's micro-expression over `vars` (`==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `\|\|`, `!`, dotted paths, literals) |
| `set` | `next` | `name: string`, `value: unknown` (`$path` reads a var) | `vars[name] = value` |
| `emit` | `next` | `event: string`, `payload?: unknown` | `ctx.events.emit(event, payload)` |
| `merge` | `next` | — | passes when every incoming edge has arrived once since the last pass |

A kind's `run` that throws or exceeds 30 s → a diagnostic (`plugin:
'flow'`, `where: <node id>`), the branch ends. `vars` is one object per
run, shared by concurrent branches (last writer wins; documented).

## 5. Runtime — `@energy8engine/flow`, row `flow1`

- `ctx.events`: `{ emit(name, payload?), on(name, fn): () => void }` —
  provided by `flow1` (a page or shell reads it leniently).
- `ctx.flowNodes`, then `ctx.flow`:

```ts
export interface FlowService {
  replace(doc: FlowDoc): void;     // validates, stops the current run, arms triggers, fires `boot`
  doc(): FlowDoc | null;
  /** Trace of the current/last run: node id, port taken, time; capped 500. */
  trace(): readonly TraceEntry[];
  onTrace(fn: (e: TraceEntry) => void): () => void;
  ready: Promise<void>;            // as scenes.ready
}
export interface TraceEntry { run: number; node: string; out: string | null /* null = entered */; at: number }
```

Interpretation: a run is a set of branches; a branch is "at node X with
vars"; leaving node X by port P starts one branch per edge `{from: X,
out: P}`; a branch with no edge ends. `merge` counts arrivals per run.
`on` keeps listening across runs (a branch entering `on` ends; the
trigger fires a NEW branch from `on.next` each time). Concurrent branches
interleave on the microtask queue; no scheduler.

Boot: `GET /api/flow` (same race guard as scenes: a `flow` frame first
wins; `ready` rejects on a failed GET); `ide-bridge` handles a `flow`
frame → `flow.replace(doc)`, and forwards `flow-trace` entries up (batched
per animation frame) plus `flow-kinds` (like `node-types`) on provide and
registry change. `main.ts` becomes: `createGame`, `spinBtn` →
`ctx.events.emit('ui.spin')`, `mechanicSelect` as is, `__e8.spin()` =
emit + await the next `present` trace entry with `out: 'next'` (or
`failed`), `__e8.flowTrace()`. `presentStage`, the temporary rule, and the
`spins`-record call move into `spin`/`present` kinds.

## 6. Host

`engine/ide/host/src/plugins/flow.ts`: reads `flow.yml` (`files`), `GET
/api/flow` → `FlowResponse { doc: FlowDoc | null; diagnostics; kinds:
FlowKindInfo[] }` (root + preview), `PUT /api/flow` (validates, writes,
broadcasts `flow`), `flow-kinds` mirror from the game (relayed, greeted,
cleared on project switch, like `node-types`), `flow-trace` relayed to IDE
sockets. Checks (`plugin: 'flow'`): duplicate id; unknown kind (once
kinds arrived); edge to/from a missing node; `out` not a port; `show`/
`hide` naming a scene with no document; `on`/`wait` with no event/ms; a
node with no incoming edge that is not a trigger (warning); a cycle with
no `on`/`wait` (error); more than one `boot` (error). Re-checked on
`files/written|removed` of `flow.yml` or any scene file, and on
`game/flow-kinds`.

Contracts: `FlowDoc`, `FlowNode`, `FlowEdge`, `FlowKindInfo { kind, outs,
trigger, schema }`, `FlowResponse`, messages `flow { doc, diagnostics }`,
`flow-kinds { kinds }` (both ways), `flow-trace { entries }` (both ways).

## 7. IDE

- Activity `{ key: 'flow', icon: 'git-branch' (add to the icon map),
  order: 36, opens: 'document' }`; `shell.document` key `flow`, title
  `Flow`, not closable — `src/plugins/flow.tsx` (service + registrations,
  the `scenes` plugin's shape), `src/screens/FlowDocument.tsx`.
- Service `ctx.flow`: `doc()`, `diagnostics()`, `kinds()`, `trace()`,
  `selected(): string | null`, `select(id)`, `update(doc): Promise<Diagnostic[]>`
  (`PUT /api/flow`), `subscribe`; state from the boot GET and `flow`/
  `flow-kinds`/`flow-trace` frames via `connection.onFrame`.
- `FlowDocument`: React Flow (`@xyflow/react`, one dependency of
  `ide-client`; CSS imported from the package) with `nodes` = doc nodes
  (`type: 'e8'`, a custom node component: kind label, id, one target
  handle, one source handle per `outs` entry labelled), `edges` = doc
  edges (`sourceHandle = out`); `onNodesChange` (position → `ui`),
  `onConnect` (→ edge; refused when the target already has an edge from
  the same source+port), `onEdgesDelete`, `onNodesDelete` (+ its edges),
  `onNodeClick` → `select`; every change → `update` (positions debounced
  250 ms, structure immediate). Palette (left, 180 px): one button per
  `kinds()` entry, drag onto the canvas (React Flow's `onDrop` +
  `screenToFlowPosition`) or click to add at the viewport centre; new id
  `<kind>-<n>`; props from the schema's defaults. Trace: nodes whose id
  appears in `trace()` for the latest `run` get class `e8-flow-ran`, the
  most recent one `e8-flow-active`; edges taken get `animated`. Empty doc
  (`null`) → a `flow-empty` note with a "create flow.yml" button →
  `update({ version: 1, nodes: [{ id: 'start', kind: 'boot', ui: {x:40,y:80} }], edges: [] })`.
- Properties: `shell.sideRight` key `flow` — `prop-id` (rename, refused on
  duplicate; edges follow), `prop-kind` (read-only), `SchemaForm` over the
  kind's schema (`commit="blur"`); `scene` props render as a `<select>` of
  `ctx.scenes.docs()` ids when the schema field is named `scene`
  (a small `SchemaForm` hint: `.extra('pick', 'scene')` on the schema;
  the form reads it); shown while `selected()`, hidden otherwise (the
  scenes and flow side-right keys coexist; whichever selected last wins).
- DOM: root `flow-screen`, palette `flow-palette` with `flow-add-<kind>`,
  canvas `flow-canvas`, nodes `flow-node-<id>` (React Flow's `data-id`
  also present), `flow-diagnostics`, `flow-empty`, `prop-*` as above.

## 8. Template and example

- `flow.yml` (both, byte-identical, pinned): the five-node loop in §3.
- `main.ts` as §5; `e8.patch.yml` untouched (`flow1` comes from the
  bundle: `engine/bundles/e8-base/e8.bundle.yml` gains `flow1` after
  `playloop1`; `hot: true`).
- `package.json` (both): `@energy8engine/flow`.
- README: one paragraph.

## 9. Testing

- `@energy8engine/flow` (vitest, fakes for `scenes`/`mechanics`/`play`/
  `fetch`): each built-in kind; fan-out + `merge`; `if` both ports and the
  expression grammar; `on` re-fires across runs; a `wait` cancelled by
  `replace`; unknown kind → diagnostic, branch ends; a throwing `run` →
  diagnostic; the cycle refusal; trace entries and cap; `ready` semantics.
- `ide-bridge`: `flow` in, `flow-kinds` + `flow-trace` out (batched).
- host: every check with a fixture; routes; broadcast on write; kinds
  greeting/clear.
- client: the `flow` service; `FlowDocument` (React Flow renders in jsdom
  with `ResizeObserver` stubbed — measure in a spike before the plan; if
  it cannot, test the reducers `addNode/connect/remove/move` as pure
  functions and the DOM contract with React Flow mocked); Properties.
- `template.test.ts` pins `flow.yml` and the new `main.ts`.
- e2e `flow.spec.ts`: the Flow document shows five nodes; a click on the
  palette's `wait` adds `wait-1` and the file has it; connecting
  `draw → wait-1` by dragging handles writes an edge; a spin in the
  Preview paints `spin`/`draw` as ran; deleting a node removes its edges
  from the file; the Preview still spins after `main.ts` lost its loop
  (`__e8.spin()` resolves with a result).

## 10. Debts this closes

Slice 17 debt 1 (empty canvas at boot — `boot → show base_game`); the
temporary `result.stage` rule; `main.ts` shrinks by ~150 lines.
