# Plugin assets, overlapping steps, cell expressions — implementation plan (slice 31)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A row declares the assets it draws with (and the loader says when nothing loaded a path), a plan step can decline to hold the plan, a cell prop is a full expression, a row hooks the ticker through a service, and a duplicate node id says what to do.

**Architecture:** The expression resolver moves DOWN from `@energy8engine/flow` into `@energy8engine/contracts` (flow depends on scenes, so scenes cannot import flow), and flow re-exports it so no importer changes. `ScenesService` gains `require(paths)` and `onFrame(fn)`, both disposer-returning and both folded into machinery the scenes row already owns (the load batch, the ticker). `executePlan` grows one generic rule — `step.wait === false` starts a step without awaiting it there and awaits it at the end of the plan.

**Tech Stack:** TypeScript, cordis 4, schemastery, pixi.js v8, vitest per package, Playwright (`engine/apps/web/tests/e2e`).

**Spec:** `docs/superpowers/specs/2026-09-23-plugin-assets-and-cell-expressions-design.md`

## Global Constraints

- `packages/*` is never edited or staged. Never stage `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel` (the user's own working tree), `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`.
- `@energy8engine/contracts` imports NOTHING foreign — no cordis, no schemastery, no node builtins (`tests/purity.test.ts` enforces it, including dynamic and bare-side-effect forms).
- A string prop refuses an unquoted YAML scalar; `''` means "untouched". A value that cannot be resolved is a diagnostic on the node that owns it; the render continues with the prop's empty value.
- Tests: one workspace per command, `npm test -w @energy8engine/<pkg>`. The `ide-host` suite spawns a headless Chromium of its own (`compute-shot`) — run nothing alongside it. The Playwright suite runs ALONE.
- Commit messages end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. Never `git stash`/`checkout`/`restore`; commit only your own listed files; retry a commit that hits `index.lock` after 2 s.

---

## File map

| Area | File | Change |
|---|---|---|
| contracts | `engine/core/contracts/src/expression.ts` (new) | `expr.ts` + `value.ts`, moved verbatim |
| contracts | `engine/core/contracts/src/index.ts` | export it |
| contracts | `engine/core/contracts/tests/expression.test.ts` (new) | the two flow test files, moved |
| flow | `engine/game/flow/src/{expr,value}.ts` | deleted; `src/index.ts` re-exports from contracts |
| play-loop | `engine/game/play-loop/src/index.ts` | the `wait: false` rule in `executePlan` |
| contracts | `engine/core/contracts/src/presentation.ts` | `PlayStateStep.wait`'s doc points at the generic rule |
| reels | `engine/game/reels/src/index.ts` | `playState` drops its own `wait` branch |
| scenes | `engine/game/scenes/src/scenes.ts` | `require`, `onFrame`, the duplicate-id message |
| scenes | `engine/game/scenes/src/runtime.ts` | the loader's "nothing loaded" warning |
| scenes | `engine/game/scenes/src/common-schema.ts` | `isCellBinding` widened, `cellProps` through `resolveValue`, `cellField` gone |
| scenes | `engine/game/scenes/src/node-types.ts` | drop `cellField` from the re-exports |
| ide-host | `engine/ide/host/src/plugins/scenes.ts` | the widened predicate (import only) |
| flow-fx | `engine/game/flow-fx/src/count.ts` | one doc sentence (a hidden scene still counts) |
| example | `engine/examples/first-slot/**`, `engine/templates/slot-basic/**` | the orb's template text, the `require` proof |
| e2e | `engine/apps/web/tests/e2e/symbols.spec.ts` | the two browser cases |

---

### Task 1: The expression resolver moves into contracts

**Files:**
- Create: `engine/core/contracts/src/expression.ts`, `engine/core/contracts/tests/expression.test.ts`
- Delete: `engine/game/flow/src/expr.ts`, `engine/game/flow/src/value.ts`, `engine/game/flow/tests/expr.test.ts`, `engine/game/flow/tests/value.test.ts`
- Modify: `engine/core/contracts/src/index.ts`, `engine/game/flow/src/index.ts`

**Interfaces:**
- Produces: `readPath`, `evaluate`, `evaluateValue`, `resolveValue`, `formatValue` from `@energy8engine/contracts` AND (re-exported, unchanged) from `@energy8engine/flow`.
- Consumed by: Task 4 (`scenes`), flow-fx and the IDE host (unchanged imports).

- [ ] **Step 1: Move the code.** `expression.ts` is `expr.ts` followed by `value.ts`'s `resolveValue` (its `import { evaluateValue } from './expr'` becomes a local reference). Keep every doc comment as it stands — the module doc gains one sentence saying why it lives in contracts: flow depends on scenes, and scenes needs the same resolver for `$cell` props.
- [ ] **Step 2: Move the tests.** `expression.test.ts` is `expr.test.ts` + `value.test.ts` concatenated, both `describe` blocks intact, imports pointing at `../src/expression`.
- [ ] **Step 3: Re-export.** `contracts/src/index.ts` gains `export * from './expression';`. `flow/src/index.ts`'s first two lines become:

```ts
// The expression resolver lives in `@energy8engine/contracts` (scenes needs
// it for `$cell` props and cannot import this package — flow depends on
// scenes). Re-exported here because every caller in the repo, and every flow
// document's author-facing vocabulary, learned it from this package.
export {
  evaluate,
  evaluateValue,
  formatValue,
  readPath,
  resolveValue,
} from '@energy8engine/contracts';
```

(check the exact export list of the two files before writing this — anything else they exported goes in too.)

- [ ] **Step 4: Run** `npm test -w @energy8engine/contracts` (the purity test must still pass — `expression.ts` imports nothing foreign), `npm test -w @energy8engine/flow`, `npm test -w @energy8engine/flow-fx`; typecheck contracts, flow, flow-fx, ide-host.
- [ ] **Step 5: Commit** `git add engine/core/contracts engine/game/flow && git commit -m "Contracts: the expression resolver moves down, flow re-exports it"`

---

### Task 2: `wait: false` — a step that does not hold the plan

**Files:**
- Modify: `engine/game/play-loop/src/index.ts`, `engine/core/contracts/src/presentation.ts`, `engine/game/reels/src/index.ts`
- Test: `engine/game/play-loop/tests/execute.test.ts`, `engine/game/reels/tests/board.test.ts`

**Interfaces:**
- Produces: the `executePlan` rule — `step.wait === false` starts a step and does not await it there.
- Consumes: `PlayStateStep.wait` (existing).

- [ ] **Step 1: Failing tests** (play-loop, in `execute.test.ts` — read its fakes first):

```ts
describe('a step that does not hold the plan', () => {
  it('wait: false starts the step and moves on; the plan still awaits it before returning', async () => {
    const order: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const board = {
      playState: async () => { order.push('playState:start'); await held; order.push('playState:end'); },
      spinTo: async () => { order.push('spinTo'); },
    } as unknown as BoardApi;
    const running = executePlan(
      [
        { kind: 'playState', cells: [{ col: 0, row: 0 }], state: 'death', wait: false },
        { kind: 'spinTo', board: [[1]] },
      ],
      board,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(['playState:start', 'spinTo']);
    release();
    expect(await running).toEqual([]);
    expect(order).toEqual(['playState:start', 'spinTo', 'playState:end']);
  });

  it('a non-blocking step that rejects is a diagnostic naming the index it started at', async () => {
    const board = {
      playState: async () => { throw new Error('nope'); },
      spinTo: async () => {},
    } as unknown as BoardApi;
    const problems = await executePlan(
      [
        { kind: 'playState', cells: [], state: 'death', wait: false },
        { kind: 'spinTo', board: [[1]] },
      ],
      board,
    );
    expect(problems.map((d) => [d.where, d.message])).toEqual([
      ['plan[0]', 'step "playState" failed: nope'],
    ]);
  });

  it('a registered kind takes the same rule', async () => { /* a handler with wait: false, same shape */ });
  it('wait: true and wait absent both hold the plan', async () => { /* the existing behaviour, pinned */ });
});
```

reels (`board.test.ts`): `playState` starts every named cell and returns WITHOUT awaiting them (the board no longer branches on `step.wait`); `skip()` still drains them through `showStatic`.

> **Superseded (task review).** The board did NOT lose its `await Promise.all(...)`:
> `reels`' `playState` still settles when the last cell's state ends. Only the
> branch on `step.wait` went. `wait` is `executePlan`'s call for every kind at
> once, and a board that returned early would take the choice away from it —
> and from `skip()`, which needs a promise to collapse. Do not re-implement the
> line above.

- [ ] **Step 2: Run** `npm test -w @energy8engine/play-loop -- execute`, `npm test -w @energy8engine/reels -- board` → FAIL.

- [ ] **Step 3: Implement.** In `executePlan`, beside the existing `problems` array:

```ts
  /**
   * The steps that declined to hold the plan (`wait: false`). They are
   * started in order with everything else and awaited HERE, at the end, so a
   * plan stays atomic — `present` is one node in the flow, and a beat that
   * outlives its own plan is not a thing this vocabulary offers. Each one
   * remembers the index it started at, because by the time it fails the loop
   * is somewhere else entirely.
   */
  const started: Promise<void>[] = [];
```

Where the step runs (both the board-method branch and the handler branch), replace `await running` with:

```ts
      if ((step as { wait?: unknown }).wait === false) {
        started.push(
          running.catch((error: unknown) => {
            problems.push(
              diagnostic('error', 'play-loop', where, `step "${step.kind}" failed: ${message(error)}`),
            );
          }),
        );
        started(step);   // the hook still announces it — mind the name clash, rename the local
        continue;
      }
```

(`where` is the existing `plan[${index}]`; factor the error-message formatting the `catch` already does into a local so both paths share it. The `started(step)` hook call is the existing `started` FUNCTION — rename one of the two; the array can be `pending`.)

After the loop, before `return problems`:

```ts
  await Promise.all(pending);
```

`presentation.ts`: `PlayStateStep.wait`'s doc now says the field is read by `executePlan` for every step kind, and what it means (start it, keep going, the plan awaits it at the end).

`reels/src/index.ts`: `playState` always starts every cell and returns; the `wait: false` branch and its `Promise.all` go. Its doc says the plan decides, not the board.

- [ ] **Step 4: Run** both suites in full; typecheck play-loop, reels, contracts.
- [ ] **Step 5: Commit** `git add engine/game/play-loop engine/game/reels engine/core/contracts && git commit -m "The plan decides what holds it: wait: false starts a step and awaits it at the end"`

---

### Task 3: `scenes.require` and the loader's warning

**Files:**
- Modify: `engine/game/scenes/src/scenes.ts`, `engine/game/scenes/src/runtime.ts`
- Test: `engine/game/scenes/tests/require.test.ts` (new), `engine/game/scenes/tests/runtime.test.ts`

**Interfaces:**
- Produces: `ScenesService.require(paths: string[]): () => void`.

- [ ] **Step 1: Failing tests.** `require.test.ts` (build the service the way `tests/mount.test.ts` does — read it):
  - a `require` BEFORE the first `show`/load joins that batch (one `loader.load` call carrying both the document's and the required paths);
  - a `require` AFTER it loads only what is new, and the views refresh (`type.update` called);
  - a path two holders require is loaded once; one holder's disposer leaves it required;
  - the last disposer drops the claim: a later batch does not re-request it (and nothing is unloaded — assert `loader.unload` not called);
  - `require([])` and a duplicate path inside one call are no-ops;
  - a `load` that rejects reports per path, as the document path does.

  `runtime.test.ts`: the row's loader reports ONE `warning` at `assetLoader` for a `get(path)` of a path no batch requested, only after the first batch settled, once per path; a path that WAS requested and failed gets no second diagnostic; a `get` before the first batch is silent.

- [ ] **Step 2: Run** `npm test -w @energy8engine/scenes -- require runtime` → FAIL.

- [ ] **Step 3: Implement.** In `createScenes`, beside `loaded`:

```ts
  /** Paths a row draws with that no document names, per holder. */
  const required = new Set<{ paths: string[] }>();
  const requiredPaths = (): string[] => [...new Set([...required].flatMap((h) => h.paths))];
```

`load(id)`'s `need` becomes `[...assetsOf(id), ...requiredPaths()].filter(p => !loaded.has(p))`. `require(paths)` adds a holder, and when a batch has already run (`loaded.size > 0` — or a flag the first `load` sets, whichever reads truer) enqueues a load of what is new, then `refresh()`/`redraw()` exactly as `load` does. The disposer deletes the holder.

The loader warning lives in `runtime.ts`'s `pixiLoader`, which is the object every `get` goes through: track the paths `load()` was asked for, a `settled` flag the first `load` sets, and a `reported` set; `get(url)` answering `undefined` after `settled` for a url outside the asked-for set reports once. Keep `pixiLoader` a module-level constant if you can; if the state must be per-row, build it inside `apply` and say why in a comment.

- [ ] **Step 4: Run** `npm test -w @energy8engine/scenes`; typecheck.
- [ ] **Step 5: Commit** `git add engine/game/scenes && git commit -m "Scenes: a row can require the assets it draws with, and the loader says when nothing loaded one"`

---

### Task 4: A cell prop is an expression

**Files:**
- Modify: `engine/game/scenes/src/common-schema.ts`, `engine/game/scenes/src/node-types.ts`, `engine/ide/host/src/plugins/scenes.ts` (import only)
- Test: `engine/game/scenes/tests/cell.test.ts`, `engine/ide/host/tests/scenes.test.ts`

**Interfaces:**
- Consumes: `resolveValue` from `@energy8engine/contracts` (Task 1).
- Produces: `isCellBinding(value)` — true when a string mentions `$cell`; `cellField` removed.

- [ ] **Step 1: Failing tests** (`cell.test.ts`): a bare `'$cell.mv'` resolves as today; `'x{$cell.mv}'` → `'x64'`; `'{$cell.mv | multiplier}'` → `'x64'`; `'$cell.layer > 0'` into a `boolean` prop → `true`; `'$cell.mv * 2'` into a `number` prop → a number; a malformed `'{$cell.mv +}'` reports and stands at the empty; NO data → the empty, and `resolveValue` is NOT called (spy it); `| currency` with no session → `'4.60'`; `bound` still lists exactly the keys that mention `$cell`; a string that merely CONTAINS `cell` (`'$cellar'`, `'a cell'`) is not bound.

  `ide-host/tests/scenes.test.ts`: a template mentioning `$cell` outside a cell scene is refused with the existing message; inside one it is accepted; an asset prop mentioning `$cell` stays refused.

- [ ] **Step 2: Run** `npm test -w @energy8engine/scenes -- cell`, `npm test -w @energy8engine/ide-host -- scenes` → FAIL.

- [ ] **Step 3: Implement.** `common-schema.ts`:

```ts
/**
 * A prop that reads the cell: a bare `$cell.<field>`, an expression over it
 * (`$cell.layer > 0`, `$cell.mv * 2`) or a template (`x{$cell.mv}`,
 * `{$cell.mv | multiplier}`). The test is "the string mentions `$cell`",
 * because the resolver decides the rest — see `cellProps`.
 */
export const isCellBinding = (value: unknown): value is string =>
  typeof value === 'string' && value.includes('$cell');
```

> **Superseded (task review).** The predicate shipped as `/\$cell\b/`, not
> `includes`: `value.includes('$cell')` makes `'$cellular'` a binding, and the
> word boundary is what keeps a var that merely starts like it out. See
> `isCellBinding` in `scenes/src/common-schema.ts`.

`cellProps(type, raw, data?)`: for a bound key, `data === undefined` → `emptyProp(entry)` (unchanged, and no evaluation); otherwise `resolveValue(value, { cell: data }, report)` followed by the existing type coercion. `cellProps` needs a `report` — add an optional fourth parameter `report?: (message: string) => void` and thread the callers' existing `error(where, …)` into it (`resolveCell` in `scenes.ts` has a `where`). `cellField` is deleted here and from `node-types.ts`'s re-exports.

Note for the implementer: `boundValue`'s coercion took a RAW field; it now takes a RESOLVED value (a template already yields a string). Keep the same rules — `number` → `Number()` or 0 on NaN, `boolean` → `'true'` for a string else `Boolean`, `string` → `String` — and say in the doc that a template is already a string.

- [ ] **Step 4: Run** `npm test -w @energy8engine/scenes`, `npm test -w @energy8engine/symbols` (it consumes `cellProps`), `npm test -w @energy8engine/ide-host -- scenes`; typecheck scenes, symbols, ide-host.
- [ ] **Step 5: Commit** `git add engine/game/scenes engine/ide/host && git commit -m "A cell prop is an expression: templates, formats and arithmetic over \$cell"`

---

### Task 5: `scenes.onFrame`, the duplicate-id message, the `count` doc

**Files:**
- Modify: `engine/game/scenes/src/scenes.ts`, `engine/core/contracts/src/protocol.ts` (the `SceneDoc.nodes` doc), `engine/game/flow-fx/src/count.ts` (one doc sentence)
- Test: `engine/game/scenes/tests/runtime.test.ts` or a new `frame.test.ts`, `engine/game/scenes/tests/mount.test.ts` (the message)

**Interfaces:**
- Produces: `ScenesService.onFrame(fn: (dt: number) => void): () => void`.

- [ ] **Step 1: Failing tests:** `onFrame` fires per tick with the ticker's `deltaMS`; the disposer unhooks; two registrations both fire; a `fn` that throws is unhooked and reported ONCE (`scenes`, `onFrame`) and its siblings keep firing; with `ticker: null` the registration is accepted, never fires, and its disposer is a no-op. The duplicate-id case in `mount.test.ts` asserts the new message and fix text.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement.** `createScenes` already holds `options.ticker` (`TickerLike | null`) — read how `fit`/the safe-area watcher uses it and follow that idiom. One ticker callback fans out to the registered fns; register it lazily (on the first `onFrame`) and remove it when the last one goes, so a composition that never calls `onFrame` adds no per-frame work.

The duplicate-id error becomes:

```ts
      error(
        where,
        `node id "${node.id}" is declared twice in "${sceneId}" — ids are unique per document, not per parent`,
        'prefix them, e.g. "rock_bar" and "paper_bar"',
      );
```

`SceneDoc.nodes`'s doc (contracts `protocol.ts`) gains the same rule in one sentence. `count`'s kind doc gains: a count writes its node's `text` whether or not the node's scene is shown — show the scene first, or accept that the value is final when it appears.

- [ ] **Step 4: Run** `npm test -w @energy8engine/scenes`, `npm test -w @energy8engine/contracts`, `npm test -w @energy8engine/flow-fx`; typecheck each.
- [ ] **Step 5: Commit** `git add engine/game/scenes engine/core/contracts engine/game/flow-fx && git commit -m "Scenes: a row can hook the ticker; a duplicate id says what to do"`

---

### Task 6: The example and the browser proof

**Files:**
- Modify: `engine/examples/first-slot/scenes/orb.scene.yml` + the template twin, `engine/examples/first-slot/plugins/reel-step/src/index.ts` (the `require` call) + its twin if the template carries the plugin, `engine/apps/web/tests/e2e/symbols.spec.ts`
- Test: `npm test -w @energy8engine/ide-host -- template`; `cd engine/apps/web && npx playwright test symbols.spec.ts` (ALONE)

- [ ] **Step 1: The orb's text becomes a template** — `text: 'x{$cell.multiplier}'` in both trees (byte-identical; `engine/ide/host/tests/template.test.ts` pins them). `first-slot`'s math carries no `multiplier`, so the rendered value stays `'x'` + nothing → assert what it ACTUALLY renders (read the resolver: a template span reading `null` renders `''`, so the text is `'x'`). Update the e2e case slice 30 added.
- [ ] **Step 2: The `require` proof.** The `reel-step` project plugin gains, in its `apply`, `ctx.effect(() => (ctx.reflect.get('scenes', false) as ScenesService | undefined)?.require(['assets/logo.png']) ?? (() => {}))` — a path NO document names (check `first-slot`'s documents; pick one that is in `assets/` and unnamed, or add a small file). A new `__e8` hook `loaded(path): boolean` beside `cellArt` (`main.ts`, both trees) answers `!!assetLoader.get(path)`. The e2e case: after boot, `loaded('<that path>')` is true.
- [ ] **Step 3: Run** the byte-pin, then `symbols.spec.ts` ALONE; remove any leaked `engine/examples/e8-compose-*` folder.
- [ ] **Step 4: Commit** `git add engine/examples/first-slot engine/templates/slot-basic engine/apps/web/tests/e2e && git commit -m "Example: the orb's text is a template, and a row requires art no document names"`

---

## Self-review (done while writing)

- Spec §1 → Tasks 3, 6; §2 → Task 2; §3 → Tasks 1, 4; §4 → Task 5; §5 → Task 5; §6 → Task 5 (the `count` doc) and the debts note (the `strip` finish).
- Names across tasks: `resolveValue` (T1 → T4), `require`/`onFrame` (T3, T5 → T6), `isCellBinding` (T4 → the host), the `pending` array (T2 only).
- Order: T1 first (T4 needs it); T2, T3, T5 are independent of each other and of T1; T4 after T1; T6 last, alone.
- No task edits `packages/*` or `engine/examples/paper-duel`.
