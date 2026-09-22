# Symbol scenes, named states, count-up — implementation plan (slice 30)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A symbol state may be a scene whose nodes bind `$cell`, a symbol may carry any number of named states a plan step plays on chosen cells, and a flow node can count a text node up to a value with a format.

**Architecture:** The `$cell` resolution moves out of `@energy8engine/symbols` into `@energy8engine/scenes` (`cellProps`), where every mount uses it leniently and a new `mountCell` hands back a copy with `bind`/`once`/`destroy`; the symbols handle mounts a `scene` state through it. `SymbolDef.states` is a map beside the three built-ins, `playState(name)` generalises `playWin`, and `playState` becomes the sixth known board step. `count` is a new flow-fx kind reusing the pipe formats, refactored out of `expr.ts` as `formatValue`.

**Tech Stack:** TypeScript, cordis 4, schemastery, pixi.js v8, vitest per package, Playwright (`engine/apps/web/tests/e2e`).

**Spec:** `docs/superpowers/specs/2026-09-21-symbol-scenes-design.md`

## Global Constraints

- `packages/*` is never edited or staged (the legacy `SymbolCell`/`SymbolView` contract is consumed, not changed). Never stage `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.
- A string prop refuses an unquoted YAML scalar; `''` means "untouched". A value that cannot be resolved is a warning on the node; the branch continues.
- An asset prop bound to `$cell` stays refused everywhere (the slice-28 message).
- Tests: one workspace per command, `npm test -w @energy8engine/<pkg>` (CLI = `@energy8engine/e8`, IDE client = `@energy8engine/ide-client`, web app = `@energy8engine/ide-web`). The Playwright suite runs ALONE.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Never `git stash`/`checkout`/`restore`; commit only your own listed files; retry a commit that hits `index.lock` after 2 s.

---

## File map

| Area | File | Change |
|---|---|---|
| contracts | `engine/core/contracts/src/protocol.ts` | `SymbolDef.states?`; `SymbolState = string`; `stateNode()` |
| contracts | `engine/core/contracts/src/presentation.ts` | `PlayStateStep`; `KNOWN_STEP_KINDS` six |
| scenes | `engine/game/scenes/src/common-schema.ts` | `cellProps` (pixi-free) |
| scenes | `engine/game/scenes/src/scenes.ts` | lenient `$cell` on every mount; `Entry.bound`; `mountCell`; `CellMount` |
| scenes | `engine/game/scenes/src/builtin.ts` | `scene.scene` gains `.extra('pick', 'scene')` |
| symbols | `engine/game/symbols/src/view.ts` | `scene` states through `mountCell`; `playState`; drop `resolveProps` |
| symbols | `engine/game/symbols/src/runtime.ts` | `states` in the preload sweep + `scenes.assetsOf`; `STATES` → names |
| play-loop | `engine/game/play-loop/src/index.ts` | `BoardApi.playState` |
| reels | `engine/game/reels/src/index.ts` | the `playState` board method |
| flow | `engine/game/flow/src/expr.ts`, `src/index.ts` | `formatValue` exported |
| flow-fx | `engine/game/flow-fx/src/count.ts` (new), `src/runtime.ts` | the `count` kind |
| ide-host | `engine/ide/host/src/plugins/symbols.ts` | `states` check, `scene` state check, cell-scene ids |
| ide-host | `engine/ide/host/src/plugins/scenes.ts` | `cellBindings` from the symbols document; re-check |
| ide-client | `engine/ide/client/src/shell/symbols-doc.ts`, `SymbolsDocument.tsx`, `SymbolsProperties.tsx` | named states in the chip row |
| example | `engine/examples/first-slot/**`, `engine/templates/slot-basic/**` | a cell scene, a named state, `count` |
| e2e | `engine/apps/web/tests/e2e/symbols.spec.ts`, `text.spec.ts` | the browser proofs |

---

### Task 1: Contracts — `SymbolDef.states`, `SymbolState`, `PlayStateStep`

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts`, `engine/core/contracts/src/presentation.ts`
- Test: the existing `presentation` test file; a `protocol`/`symbols` test file if one exists, else add the `stateNode` cases to the presentation file's neighbour that already imports `SymbolDef`.

**Interfaces:**
- Produces: `SymbolState = string`; `SymbolDef.states?: Record<string, SymbolNode>`; `stateNode(def, name): SymbolNode | undefined`; `BUILTIN_STATES = ['static','idle','win'] as const`; `PlayStateStep`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('playState — a named state on chosen cells', () => {
  it('is well-formed with cells and a non-empty state; wait is a boolean when present', () => {
    expect(isPresentationStep({ kind: 'playState', cells: [{ col: 0, row: 1 }], state: 'death' })).toBe(true);
    expect(isPresentationStep({ kind: 'playState', cells: [], state: 'death', wait: false })).toBe(true);
    expect(isPresentationStep({ kind: 'playState', cells: [{ col: 0, row: 1 }], state: '' })).toBe(false);
    expect(isPresentationStep({ kind: 'playState', cells: 'no', state: 'death' })).toBe(false);
    expect(isPresentationStep({ kind: 'playState', cells: [{ col: 0 }], state: 'death' })).toBe(false);
    expect(isPresentationStep({ kind: 'playState', cells: [], state: 'death', wait: 'yes' })).toBe(false);
  });
  it('is one of the board kinds', () => expect(KNOWN_STEP_KINDS).toContain('playState'));
});

describe('stateNode', () => {
  const def = { id: 'ROCK', static: { type: 'image', props: {} }, states: { death: { type: 'strip', props: {} } } };
  it('answers the built-ins off the def and the rest off `states`', () => {
    expect(stateNode(def, 'static')).toBe(def.static);
    expect(stateNode(def, 'death')).toBe(def.states!.death);
    expect(stateNode(def, 'idle')).toBeUndefined();
    expect(stateNode(def, 'nope')).toBeUndefined();
    expect(stateNode({ id: 'X', static: def.static, states: { toString: def.static } } as any, 'constructor')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** `npm test -w @energy8engine/contracts` → FAIL.

- [ ] **Step 3: Implement.** `presentation.ts`, after `TumbleStep`:

```ts
/**
 * These cells play a named state of their symbol (`symbols.yml`'s `states`)
 * — a death morph on a duel's losers, a celebration on the scatters — and
 * return to their resting state when it ends. Not a win reveal: no amount,
 * no line, and the state is the mechanic's to name.
 *
 * `wait` (default true) is what the plan does, not what the cells do: with
 * `false` the states start and the plan moves on, so a morph can play over
 * the tumble that follows it.
 */
export interface PlayStateStep {
  kind: 'playState';
  cells: Cell[];
  state: string;
  wait?: boolean;
}
```

`KnownPresentationStep` gains `| PlayStateStep`; `KNOWN_STEP_KINDS` gains `'playState'` (its doc: the sixth board kind, and why it is not `revealWins` with a field — a reveal carries an amount and lights a line). `isPresentationStep`:

```ts
    case 'playState':
      return (
        Array.isArray(value.cells) &&
        value.cells.every(isCell) &&
        typeof value.state === 'string' &&
        value.state.length > 0 &&
        (value.wait === undefined || typeof value.wait === 'boolean')
      );
```

`protocol.ts`:

```ts
/** Which of a symbol's views is showing: one of `BUILTIN_STATES`, or a key of its `states` map. */
export type SymbolState = string;

/** The three states every symbol may declare directly; every other name lives in `states`. */
export const BUILTIN_STATES = ['static', 'idle', 'win'] as const;

/** The node for a state, wherever it lives: `def.static`/`idle`/`win`, else `def.states[name]`. Never reads a prototype key. */
export function stateNode(def: SymbolDef, state: string): SymbolNode | undefined {
  if ((BUILTIN_STATES as readonly string[]).includes(state)) {
    return def[state as (typeof BUILTIN_STATES)[number]];
  }
  return def.states && Object.hasOwn(def.states, state) ? def.states[state] : undefined;
}
```

`SymbolDef` gains:

```ts
  /** Named states a plan's `playState` step can play — a death morph, a celebration. Keys are identifiers; the three built-ins above are not allowed here. */
  states?: Record<string, SymbolNode>;
```

- [ ] **Step 4: Run** `npm test -w @energy8engine/contracts`; `npm run typecheck -w @energy8engine/contracts` → clean.
- [ ] **Step 5: Commit** `git add engine/core/contracts && git commit -m "Contracts: named symbol states and the playState board step"`

---

### Task 2: Scenes — `cellProps`, lenient mounts, `mountCell`

**Files:**
- Modify: `engine/game/scenes/src/common-schema.ts`, `engine/game/scenes/src/scenes.ts`, `engine/game/scenes/src/node-types.ts` (re-export), `engine/game/scenes/src/builtin.ts` (`pick`)
- Test: `engine/game/scenes/tests/cell.test.ts` (new), plus a case in `tests/mount.test.ts`

**Interfaces:**
- Consumes: `isCellBinding`, `cellField`, `emptyProp` (existing).
- Produces:

```ts
export function cellProps(
  type: { schema: Schema },
  raw: Record<string, unknown>,
  data?: Record<string, unknown>,
): { props: Record<string, unknown>; bound: string[] };

mountCell(id: string, data?: Record<string, unknown>): CellMount | null;
export interface CellMount {
  view: Container;
  bind(data: Record<string, unknown>): void;
  once(): Promise<void>;
  destroy(): void;
}
```

- [ ] **Step 1: Failing tests.** `tests/cell.test.ts` — `cellProps` first (pure): a bound `string` prop with data → the string; with no data → `''`; a `number` prop bound to a numeric string → a number; a bound `boolean` → `Boolean`; an unbound prop untouched; `bound` lists exactly the bound keys; a `$cell` on a prop the type does not declare (a COMMON one, `alpha`) resolves through `COMMON`'s entry.

Then `mountCell` against a fake `nodeTypes`/`loader` the way `tests/mount.test.ts` builds its service (read it): a document `orb` with a root `container` and two children (`image` with a literal `src`, `text` with `text: '$cell.mv'`) → `mountCell('orb', { mv: 64 })` renders the text node with `'64'`; `bind({ mv: 8 })` changes it and does NOT re-run the unbound image's `update` with different props; `once()` resolves at once with no media node and awaits a fake media type's `once` when present; `destroy()` empties the view and unmounts every node; `mountCell('missing')` → `null`.

In `tests/mount.test.ts`: an ordinary `show()` of a document whose node carries `text: '$cell.mv'` mounts with `''` (no throw, no diagnostic from the runtime).

- [ ] **Step 2: Run** `npm test -w @energy8engine/scenes -- cell mount` → FAIL.

- [ ] **Step 3: Implement.**

`common-schema.ts` — move the resolution in (from `symbols/src/view.ts`'s `resolveProps`/`boundValue`, which are deleted there):

```ts
/**
 * A node's props with every `$cell.<field>` binding resolved against one
 * cell's data — the one place a binding turns into a value, shared by
 * `@energy8engine/symbols` (a symbol's own states) and the scenes runtime
 * (a cell scene, and any other mount, where an unresolved binding simply
 * stands at its empty value rather than failing the schema).
 *
 * `bound` is what a later `bind()` must re-resolve: the keys that carried
 * a binding, in declaration order. A prop that is not bound keeps whatever
 * the document said, so the schema sees the author's own value.
 */
export const cellProps = (
  type: { schema: Schema },
  raw: Record<string, unknown>,
  data?: Record<string, unknown>,
): { props: Record<string, unknown>; bound: string[] } => { … };
```

Its body is the old `resolveProps` with `dictOf(type.schema)`/`dictOf(COMMON)` and `boundValue` inlined as a local (`number` → `Number()` or 0 on NaN; `boolean` → `field === 'true'` for a string else `Boolean`; `string` → `String`; anything else the field as is; a missing field → `emptyProp(entry)`), returning `bound` as well.

`scenes.ts`:
- `Entry` gains `bound?: string[]` and `cell?: Record<string, unknown>`.
- In `mountNode`, replace `type.schema(node.props)` / the `merged` path's schema call with `cellProps(type, raw, cell)` — the cell being the one `mountCell` is mounting with (threaded as a new optional parameter, `undefined` for every other caller). A variant/live merge still happens first (`tryVariant` unchanged), then `cellProps` resolves what the merge produced. Store `bound` on the entry.
- `mountCell(id, data)`:

```ts
    mountCell(id, data) {
      const doc = docs.get(id);
      if (!doc) return null;
      const view = new Container();
      view.label = id;
      const entries: Entry[] = [];
      const seen = new Set<string>();
      // Its own entry list: a cell copy is not part of any `Mount` (it has
      // no id of its own, `setProps` must never find it, and it lives and
      // dies with one cell, not with a shown scene).
      const prev = building;
      building = { view, nodes: new Map(), all: entries, types: new Map(), missing: [] } as Mount;
      try {
        for (const node of doc.nodes) mountNode(node, view, id, [id], seen, false, true, undefined, data);
      } finally {
        building = prev;
      }
      return {
        view,
        bind(next) { /* for each entry with `bound?.length`: cellProps(type, rawOf(e), next) → type.update?.(view, props, mountCtx([id])) + applyCommon */ },
        async once() { /* Promise.all of every entry whose type has `once`, each guarded; resolves at once when none */ },
        destroy() { /* unmount every entry's type, then view.destroy({ children: true }) */ },
      };
    },
```

(Read `mountDoc` and `unmountEntry` first and follow their idioms; `mountCell` must not touch `mounted`, `visibleIds` or `shownNested`.)

`builtin.ts`: `scene`'s `scene` prop gains `.extra('pick', 'scene')`.

`node-types.ts`: re-export `cellProps` beside `cellField`/`emptyProp`/`isCellBinding`.

- [ ] **Step 4: Run** `npm test -w @energy8engine/scenes`; typecheck → clean.
- [ ] **Step 5: Commit** `git add engine/game/scenes && git commit -m "Scenes: one cell-prop resolver, and a cell scene a symbol can mount"`

---

### Task 3: Symbols — a `scene` state, `playState`, `states`

**Files:**
- Modify: `engine/game/symbols/src/view.ts`, `engine/game/symbols/src/runtime.ts`
- Test: `engine/game/symbols/tests/view.test.ts`, `tests/runtime.test.ts`

**Interfaces:**
- Consumes: `cellProps`, `mountCell`/`CellMount` (Task 2); `stateNode`, `BUILTIN_STATES` (Task 1).
- Produces: `SymbolHandle.playState(state: string): Promise<void>`; `BoundSymbolView.playState`.

- [ ] **Step 1: Failing tests** (read the file's existing fakes — a fake `nodeTypes`, a fake `scenes` is new):
  - a `scene` state mounts through `scenes.mountCell(id, cell)` (the fake returns a `CellMount` spy) and its view is added under the wrapper; `handle.bind(data)` forwards to `CellMount.bind`; `playWin` on a `scene` `win` awaits `CellMount.once()` and then unmounts it (`destroy` called once);
  - no `scenes` service → the state reports `symbols/<id>/<state>` and the handle still shows the fallback/rest;
  - `playState('death')` mounts `def.states.death`, hides the resting state, awaits the type's `once`, restores; a second `playState('celebrate')` while the first plays replaces it (the first promise resolves, the first wrapper is unmounted);
  - `playState('nope')` resolves and reports ONE `info` (`no state "nope"`), a second call reports nothing;
  - `view.playState` exists whenever the def has any state, `view.playWin` only when `win` exists (unchanged).
  - runtime: a def with `states` preloads their assets; a `scene` state's assets come from `scenes.assetsOf(id)`.

- [ ] **Step 2: Run** `npm test -w @energy8engine/symbols` → FAIL.

- [ ] **Step 3: Implement.**

`view.ts`:
- delete `resolveProps`/`boundValue`, import `cellProps`;
- `Wrapper` gains `cell?: CellMount` (a scene state) and keeps `bound: string[]` instead of the boolean;
- `mount(state, node)`: when `node.type === 'scene'`, read `scenes` (`deps.ctx.reflect.get('scenes', false)`), call `mountCell(String(node.props.scene ?? ''), cell)`, report and bail when either is missing, else `w.cell = mount; w.container.addChild(mount.view)`; otherwise today's path with `cellProps`;
- `unmount(w)`: `w.cell?.destroy()` before the container's own destroy;
- `bind(data)`: for a `w.cell` forward, else today's re-resolve using `w.bound.length > 0`;
- `playWin` becomes `playState(state)`:

```ts
  async function playState(state: string): Promise<void> {
    const node = def && stateNode(def, state);
    if (!node) { … one `info` per (id, state) via a `Set` on the handle …; return; }
    if (playing) { const old = playing; playing = null; unmount(old); if (rest) rest.container.visible = true; }
    … today's playWin body, with `mount(state, node)` and `w.cell ? w.cell.once() : (w.type?.once ? … : wait(600))` …
  }
```

  `playWin = () => playState('win')`; `view.playState = playState`; `view.playWin` set only when `stateNode(def, 'win')` exists. `apply()` assigns both.
- The `info` report needs a severity: `ViewDeps.report` gains an optional third parameter `severity` (default `'error'`), and `runtime.ts`'s `report` passes it through to `diagnostic(severity, …)`.

`runtime.ts`: `STATES` becomes "every state of a def" — `[...BUILTIN_STATES, ...Object.keys(def.states ?? {})]` in the preload sweep, and for a `scene` node add `scenes.assetsOf(props.scene)` (read `scenes` leniently).

- [ ] **Step 4: Run** `npm test -w @energy8engine/symbols`; typecheck → clean.
- [ ] **Step 5: Commit** `git add engine/game/symbols && git commit -m "Symbols: a state may be a cell scene, and any named state can be played"`

---

### Task 4: `playState` through the board

**Files:**
- Modify: `engine/game/play-loop/src/index.ts` (`BoardApi`), `engine/game/reels/src/index.ts`
- Test: `engine/game/play-loop/tests/execute.test.ts`, `engine/game/reels/tests/board.test.ts`

**Interfaces:**
- Consumes: `PlayStateStep` (Task 1); `view.playState` (Task 3).
- Produces: `BoardApi.playState(step, opts?)`.

- [ ] **Step 1: Failing tests.**
  - play-loop: a plan with `{ kind: 'playState', … }` reaches `board.playState` (not the registry), and a board without the method is the "board cannot perform" diagnostic naming it. Update the "known kinds" list assertions that enumerate the five.
  - reels (`tests/board.test.ts`, whose fake grid/cells you must read): `playState` calls `view.playState('death')` on each named cell, awaits all when `wait` is absent, returns before they settle when `wait: false`, skips a cell with no view / no `playState` / past a short reel, and `skip()` (the board's) makes the pending ones show their resting state (`view.showStatic`).

- [ ] **Step 2: Run** both files → FAIL.

- [ ] **Step 3: Implement.** `BoardApi`:

```ts
  /** The named cells play a state of their symbol (`symbols.yml`'s `states`) and return to rest. */
  playState(step: PlayStateStep, opts?: StepOpts): Promise<void>;
```

`reels/src/index.ts`, beside `revealWins` (follow its `tracked(...)`/`getCell` idiom):

```ts
    playState: tracked(async (step: PlayStateStep) => {
      const playing = step.cells
        .map(({ col, row }) => (grid.getCell(col, row) as CellLike | undefined)?.view)
        .filter((v): v is NonNullable<typeof v> => !!v?.playState)
        .map((v) => v.playState!(step.state));
      if (step.wait === false) return;
      await Promise.all(playing);
    }),
```

`CellLike['view']` gains `playState?(state: string): Promise<void>` and `showStatic?(): void` if not already declared. The existing `skip()` path already calls `showStatic` on cells — check it, and extend it to the cells a `playState` left playing if it does not.

- [ ] **Step 4: Run** `npm test -w @energy8engine/play-loop`, `npm test -w @energy8engine/reels`; typecheck both.
- [ ] **Step 5: Commit** `git add engine/game/play-loop engine/game/reels && git commit -m "The board plays a named symbol state on chosen cells"`

---

### Task 5: `formatValue` out of `expr.ts`, and the `count` kind

**Files:**
- Modify: `engine/game/flow/src/expr.ts`, `engine/game/flow/src/index.ts`
- Create: `engine/game/flow-fx/src/count.ts`
- Modify: `engine/game/flow-fx/src/runtime.ts` (register), `engine/game/flow-fx/src/index.ts` if it re-exports kinds
- Test: `engine/game/flow/tests/expr.test.ts` (the export), `engine/game/flow-fx/tests/count.test.ts` (new)

**Interfaces:**
- Consumes: `resolveValue`, `parseTarget`, `ScenesService.setProps`, `Tween.to` (the `tween` kind's `TweenDeps` idiom).
- Produces: `formatValue(name: string, value: unknown, arg: unknown, vars: Record<string, unknown>): string` from `@energy8engine/flow`; the `count` kind.

- [ ] **Step 1: Failing tests.** flow: `formatValue('currency', 4.604, undefined, { session: { currency: … } })` → `'$4.60'`; `formatValue('bogus', 1, undefined, {})` throws `SyntaxError` naming it (position 0 is fine — the message shape is what the pipe already produces).

`flow-fx/tests/count.test.ts` (model it on `tests/tween.test.ts` — read it for the fake `to`, the fake scenes and the `rc` run-context):
  - ticks: a fake `to` that drives the tween's target object through 0 → 1 writes `setProps` with the formatted value at each tick and the EXACT final value last (`'$4.60'` for `to: '4.604'`, `format: currency`);
  - `from` defaults to `'0'`; an explicit `from` is used; a `$expr` for either resolves;
  - a non-numeric `to` reports `is not a number` and leaves by `next` without touching the node;
  - a target with no `text` prop (the fake `nodeSchema` says so) reports and leaves by `next`;
  - `wait: false` leaves at once, the tween keeps writing;
  - the abort signal kills the tween (`kill` called with the target) and no further `setProps` lands;
  - `format: ''` writes `String(n)`; `format: int` rounds.

- [ ] **Step 2: Run** both → FAIL.

- [ ] **Step 3: Implement.** `expr.ts`: rename the module-local `format(...)` to an exported `formatValue(name, value, arg, vars)` (same body, same messages — `pos` becomes a parameter of the thrown message only where the parser has one: keep an internal wrapper for the parser that appends ` at position N`). Export it from `src/index.ts`.

`count.ts` — the kind, following `tween.ts`'s shape (`createCount(deps)` with `to`/`kill` injectable):

```ts
const count: FlowNodeKind<CountProps> = {
  kind: 'count',
  schema: Schema.object({
    target: Schema.string().required().extra('pick', 'node').description('<scene>/<node> whose `text` counts'),
    from: Schema.string().default('0').description('start value: a number, `$expr`, or a `{…}` template'),
    to: Schema.string().required().description('end value: a number, `$expr`, or a `{…}` template'),
    ms: Schema.number().default(600).description('duration, milliseconds'),
    easing: Schema.union(EASINGS).default('easeOutQuad'),
    format: Schema.union(['', 'currency', 'int', 'fixed:1', 'fixed:2', 'multiplier']).default('').description('how each value is written'),
    wait: Schema.boolean().default(true).description('wait for the count to finish before leaving by `next`'),
  }),
  outs: ['next'],
  timeout: false,
  async run(p, { ctx, vars, signal, report }) { … },
};
```

(`format` as a union keeps the IDE a dropdown; `fixed:N` for N ∈ {1,2} covers what a slot needs — the spec's `fixed:N` in general is the pipe's, not this prop's. Say so in the description.)

`run`: resolve `target` (`parseTarget` + `resolveValue`), refuse a node whose `nodeSchema(ref)?.dict` has no `text`; resolve `from`/`to` through `resolveValue` and `Number()`; write the first value; run one tween over a local `{ n }` object with an `onUpdate`-equivalent — `Tween.to` has no per-tick hook, so drive it through the ticker the way `audio-state` does, OR tween `{ n }` and poll it on `ctx.ticker` (read `flow-fx/src/audio.ts`'s clock injection and `tween.ts`'s `to` — pick ONE and say which in your report; the fake in the test drives whatever you pick). Write the exact end value after the tween resolves. `wait: false` → return `{ out: 'next' }` immediately (the tween keeps going). On abort: `kill(target)` and stop writing. `ui.skip`: subscribe to the bus's skip events the way `play-loop` does (`skipEvents` is play-loop's config; here just `ui.skip`), and on one, jump to the end value and finish.

- [ ] **Step 4: Run** `npm test -w @energy8engine/flow`, `npm test -w @energy8engine/flow-fx`; typecheck both.
- [ ] **Step 5: Commit** `git add engine/game/flow engine/game/flow-fx && git commit -m "Flow: a count kind that runs a text node up to a value"`

---

### Task 6: The host — cell scenes and state names

**Files:**
- Modify: `engine/ide/host/src/plugins/symbols.ts`, `engine/ide/host/src/plugins/scenes.ts`
- Test: `engine/ide/host/tests/symbols.test.ts`, `engine/ide/host/tests/scenes.test.ts`

**Interfaces:**
- Consumes: `stateNode`, `BUILTIN_STATES` (Task 1).
- Produces: `symbolsHost.cellScenes(): string[]` (the scene ids some state references) — what `scenes.ts`'s check reads.

- [ ] **Step 1: Failing tests.**
  - symbols: a `states` map with a good name checks clean; a name that is `static`/`idle`/`win` → error `a named state cannot be called "win"`; a name with a space/dot → error naming the rule; a `scene` state whose document does not exist → `unknown scene "orb"`; one that exists → clean; a `scene` state's props are checked against the `scene` node type as any other.
  - scenes: a document that some symbol state names may carry `$cell` on a non-asset prop (clean); the same document not referenced → the (reworded) error; an asset prop bound to `$cell` stays an error in both; after a `PUT /api/symbols` that adds a `scene` state, the scenes check for that document flips from error to clean without a host restart (write the symbols doc, then `GET /api/scenes` and read its diagnostics).

- [ ] **Step 2: Run** `npm test -w @energy8engine/ide-host -- symbols scenes` → FAIL.

- [ ] **Step 3: Implement.**
  - `symbols.ts`: the state sweep walks `BUILTIN_STATES` then `Object.keys(def.states ?? {})`; a named state's key is validated (`/^[A-Za-z_][\w-]*$/`, not a built-in); a `scene`-typed node's `props.scene` must be a known scene id (read the scenes host's documents leniently — `ctx.get('scenesHost')`); `cellScenes()` on the provided service returns every such id.
  - `scenes.ts`: `cellBindings` becomes `cellScenes().includes(doc.id)`; the refusal message is reworded (`only a cell scene (one a symbols.yml state names) reads a cell`). Both plugins re-run their check when the other's document is written: the symbols plugin already refreshes on its own writes — add a `scenesHost.recheck()` call after a symbols write, and a `symbolsHost.recheck()` after a scenes write (an idempotent re-read + broadcast; follow each plugin's own `refresh()`).
  - Mind the boot order: whichever plugin applies first must tolerate the other's service being absent (`ctx.get(...)` lenient, an empty list then).

- [ ] **Step 4: Run** `npm test -w @energy8engine/ide-host -- symbols scenes`; then the full `npm test -w @energy8engine/ide-host` once; typecheck.
- [ ] **Step 5: Commit** `git add engine/ide/host && git commit -m "Host: a cell scene is one a symbol state names, and named states are checked"`

---

### Task 7: The IDE — named states in the symbols panel

**Files:**
- Modify: `engine/ide/client/src/shell/symbols-doc.ts`, `engine/ide/client/src/shell/SymbolsDocument.tsx`, `engine/ide/client/src/shell/SymbolsProperties.tsx`
- Test: `engine/ide/client/tests/symbols-doc.test.ts` (or wherever those helpers are tested — find it), plus the component test file for the document if one exists

**Interfaces:**
- Consumes: `BUILTIN_STATES`, `stateNode`.
- Produces: `addState(doc, id, name)`, `removeState(doc, id, name)`; `setState`/`setStateType` accept a named state.

- [ ] **Step 1: Failing tests.** `symbols-doc`: `addState` creates `states.death` with an empty image and refuses a duplicate/built-in/invalid name (returns the doc unchanged); `removeState` drops the key and the whole `states` map when it empties; `setState(doc, id, 'death', node)` writes into `states`; `setState(doc, id, 'death', null)` removes it; `setStateType` keeps the shared props for a named state; `STATES` is still the three built-ins and a new `statesOf(def)` lists built-ins-present + named in order.

- [ ] **Step 2: Run** `npm test -w @energy8engine/ide-client -- symbols` → FAIL.

- [ ] **Step 3: Implement.** The helpers, then the chip row: after the three built-in chips, one chip per named state (label = the name, same drop/select behaviour, `data-testid={`symbol-chip-${id}-${name}`}`), then a `+` chip that prompts for a name (`window.prompt` is fine — the panel has no modal; if the file already has an inline-rename idiom, follow it) and calls `addState`. `SymbolsProperties` gains a "Remove state" button for a named state (not for the built-ins). The selection type (`{ id, state }`) already carries a string.

- [ ] **Step 4: Run** `npm test -w @energy8engine/ide-client`; typecheck (`ide-client`, `ide-web`).
- [ ] **Step 5: Commit** `git add engine/ide/client && git commit -m "IDE: named symbol states in the chip row"`

---

### Task 8: The example, the template and the browser proof

**Files:**
- Create: `engine/examples/first-slot/scenes/orb.scene.yml` + the same file in `engine/templates/slot-basic/scenes/`
- Modify: `engine/examples/first-slot/symbols.yml`, `flow.yml` and their template twins; `engine/ide/host/tests/template.test.ts` if it enumerates the pinned files
- Modify: `engine/apps/web/tests/e2e/symbols.spec.ts`, `engine/apps/web/tests/e2e/text.spec.ts`
- Test: `npm test -w @energy8engine/ide-host -- template`; `cd engine/apps/web && npx playwright test symbols.spec.ts text.spec.ts` (ALONE)

- [ ] **Step 1: The example.** `scenes/orb.scene.yml`:

```yaml
id: orb
nodes:
  - { id: art, type: image, props: { src: assets/symbols/6.png } }
  - { id: value, type: text, props: { text: '$cell.multiplier', size: 28, fill: '#ffffff', anchor: 0.5, y: 34 } }
```

(check `text`'s real prop names in `engine/game/scenes/src/builtin.ts` and use those.) In `symbols.yml`, symbol `'6'` gains `static: { type: scene, props: { scene: orb } }` and a named state:

```yaml
    states:
      pop: { type: spritesheet, props: { sheet: assets/coin.json, loop: false } }
```

In `flow.yml`, `show_win` becomes:

```yaml
  - { id: show_win, kind: count, props: { target: base_game/win, to: '$result.winAmount', ms: 400, format: currency }, ui: { x: 1300, y: 80 } }
```

Both files in the example and the template, byte-identical. Run the byte-pin test; if `template.test.ts` lists the pinned files by name, add `scenes/orb.scene.yml`.

- [ ] **Step 2: `text.spec.ts`.** Case 1's final assertion still holds (`$X.XX` off the last spin's `winAmount`) — the count's end value is exact. Update the header comment: the win text is counted up by a `count` node now. Run the file alone.

- [ ] **Step 3: `symbols.spec.ts`** — add two cases (read the file's fixture and `__e8` helpers first):
  - **a cell scene draws the cell's data**: after a spin, for a cell whose symbol is `'6'`, `__e8.cellArt(col,row)` reaches the scene copy (its constructor name is `Container`/`Sprite` — assert what the copy actually is, not a guess) and a new `__e8` hook `cellText(col,row)` (add it to `engine/examples/first-slot/src/main.ts` beside `cellArt`: walk the cell's view for the first node with a `text` property and return `String(it.text)`) shows the bound `multiplier` for that cell — the fixture's math must produce one, so if `first-slot`'s result has no `multiplier` per cell, drive it instead through the IDE: PUT a `symbols.yml` where a symbol's `static` is the orb scene, spin, and assert the text node exists and is empty (a `$cell` with no data). Pick the honest version and say which in your report.
  - **a named state plays**: the `reel-step` project plugin's mechanic emits, after its `revealWins`, `{ kind: 'playState', cells: <the winning cells>, state: 'pop', wait: true }` (edit `engine/examples/first-slot/plugins/reel-step/src/mechanic.ts` and its unit test); the e2e asserts the spin completes and `__e8.spins()`'s last plan contains a `playState` step.
- [ ] **Step 4: Run** `npm test -w @energy8engine/ide-host -- template`, the reel-step plugin's own tests if it has a suite, then the two e2e files ALONE.
- [ ] **Step 5: Commit** `git add engine/examples/first-slot engine/templates/slot-basic engine/apps/web/tests/e2e && git commit -m "Example: an orb symbol drawn by a cell scene, a popped state, a counted win"`

---

## Self-review (done while writing)

- Spec §1 → Tasks 2, 3 (+6 host, 7 IDE); §2 → Tasks 1, 3, 4 (+6, 7); §3 → Task 5; §4 → Task 1; §6 → every task's tests + Task 8.
- Names across tasks: `cellProps`/`mountCell`/`CellMount` (T2 → T3), `stateNode`/`BUILTIN_STATES`/`PlayStateStep` (T1 → T3, T4, T6, T7), `view.playState` (T3 → T4), `formatValue` (T5), `cellScenes()` (T6).
- Order: T1 and T2 first (T2 needs nothing from T1); T3 needs both; T4 needs T1+T3; T5 is independent; T6 needs T1; T7 needs T1; T8 last, alone.
- No task edits `packages/*`.
