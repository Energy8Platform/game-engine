# Declared assets and `scenes.once` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the pixi loader calling a path a declared document names "nothing loaded", and let a caller play a scene node once and await its end.

**Architecture:** `AssetLoader` gains an optional `expect(urls)`; `createScenes`' `replace` and `require` call it, and the pixi loader in the scenes row treats expected paths as asked. `ScenesService` gains `once(ref)`, which runs the node type's own `once` on every mounted copy of the node — the same per-copy walk `setProps` uses.

**Tech Stack:** TypeScript, pixi.js v8, cordis 4, vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-declared-assets-and-node-once-design.md`

## Global Constraints

- `packages/*` is not edited.
- Every fix carries a unit test in its package.
- One workspace per test command: `npm test -w @energy8engine/scenes`; `npm run typecheck -w @energy8engine/scenes`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Never stage `packages/*`, `engine/apps/web/dist`, `engine/examples/first-slot/concept.png`, `engine/examples/paper-duel`, `docs/superpowers/notes/2026-09-19-paper-duel-port-feasibility.md`. Never `git stash`/`checkout`/`restore`.

## Review Focus

1. A document dropped by a later `replace`, or a `require` whose disposer ran: its paths STAY expected (additive by design — the warning is a hint, not a ledger). Pin it in Task 1 so a change is deliberate.
2. `expect` must run BEFORE the remount in `replace` — a mount calls `get` synchronously. Pinned in Task 1 by call order.
3. A loader without `expect` (every existing fake) must keep working: optional call `loader.expect?.(…)`. Pinned in Task 1.
4. `once` on a node of a HIDDEN document still plays and answers `true` — the caller owns `visible`. Pinned in Task 2.
5. One copy's `once` throwing while another copy plays: the call still settles `true`, after the playing copy ends, and reports the throw once. Pinned in Task 2.

---

### Task 1: `AssetLoader.expect` — declared paths are not "nothing loaded"

**Files:**
- Modify: `engine/game/scenes/src/builtin.ts` (`AssetLoader`, ~line 18)
- Modify: `engine/game/scenes/src/runtime.ts` (`createPixiLoader`, ~lines 58–110, and its doc)
- Modify: `engine/game/scenes/src/scenes.ts` (`replace` ~line 1097; `requireAssets` ~line 963)
- Test: `engine/game/scenes/tests/require.test.ts`, `engine/game/scenes/tests/runtime.test.ts`

**Interfaces:**
- Produces: `AssetLoader.expect?(urls: string[]): void` — marks paths as declared; loads nothing.

- [ ] **Step 1: Write the failing unit tests (`require.test.ts`)**

Add at the end of the file. `spyLoader` there has no `expect`; these tests build their own loader with one.

```ts
describe('declared paths reach the loader before anything mounts', () => {
  function expectLoader() {
    const order: string[] = [];
    const expected: string[][] = [];
    const loader: AssetLoader = {
      load: vi.fn(async () => {}),
      unload: vi.fn(async () => {}),
      get: (url) => {
        order.push(`get ${url}`);
        return Texture.EMPTY;
      },
      expect: (urls) => {
        order.push(`expect ${[...urls].sort().join(',')}`);
        expected.push([...urls]);
      },
    };
    return { loader, order, expected };
  }

  it('replace expects every declared document’s paths, hidden ones included, before mounting', () => {
    const { loader, order, expected } = expectLoader();
    boot(
      [
        docA,
        { id: 'b', nodes: [{ id: 'art', type: 'image', props: { src: 'b.png' } }] },
      ],
      loader,
    );
    expect(expected.flat().sort()).toEqual(['b.png', 'bg.png']);
    // Mounting calls `get`; the expect must come first.
    const firstGet = order.findIndex((s) => s.startsWith('get '));
    const lastExpect = order.map((s) => s.startsWith('expect ')).lastIndexOf(true);
    expect(lastExpect).toBeGreaterThanOrEqual(0);
    expect(firstGet).toBeGreaterThan(lastExpect);
  });

  it('require expects its paths at once, before its batch runs', () => {
    const { loader, expected } = expectLoader();
    const { scenes } = boot([], loader);
    expected.length = 0;
    scenes.require(['assets/fx.png']);
    // Synchronously — no tick awaited.
    expect(expected).toEqual([['assets/fx.png']]);
  });

  it('a loader without expect still boots and requires', async () => {
    const loader = spyLoader();
    const { scenes } = boot([docA], loader);
    scenes.require(['assets/fx.png']);
    await tick();
    expect(loader.calls).toContainEqual(['assets/fx.png']);
  });
});
```

- [ ] **Step 2: Write the failing integration test (`runtime.test.ts`)**

Add inside `describe('scenes row', …)`, after the existing "the loader warns once…" case. It boots the REAL row, so the pixi loader and `replace` are wired as the game wires them.

```ts
  // `Assets.load` rejects in this environment (no `document`), which still
  // settles the first batch — the moment after which a miss is a warning.
  it('after the first batch, a hidden declared document’s path is not "nothing loaded"; an undeclared one is', async () => {
    const report = vi.fn();
    const { ctx, fiber } = boot(
      fetchOk({
        scenes: [
          { id: 'a', nodes: [{ id: 'n', type: 'image', props: { src: 'a.png' } }] },
          { id: 'b', nodes: [{ id: 'n', type: 'image', props: { src: 'b.png' } }] },
        ],
        diagnostics: [],
        nodeTypes: [],
      }),
    );
    ctx.provide('diagnostics', { report });
    await fiber;
    await vi.waitFor(() => expect(ctx.get('scenes')!.docs().has('b')).toBe(true));
    const loader = ctx.get('assetLoader')!;
    await expect(loader.load(['other.png'])).rejects.toThrow();

    loader.get('b.png'); // declared by document b, never shown
    expect(report).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('b.png') }));

    loader.get('stray.png'); // named by nothing
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ where: 'assetLoader', message: expect.stringContaining('stray.png') }),
    );
    await fiber.dispose();
  });

  it('an expected path stays expected after the document naming it is replaced away', async () => {
    const report = vi.fn();
    const { ctx, fiber } = boot(
      fetchOk({ scenes: [{ id: 'b', nodes: [{ id: 'n', type: 'image', props: { src: 'b.png' } }] }], diagnostics: [], nodeTypes: [] }),
    );
    ctx.provide('diagnostics', { report });
    await fiber;
    await vi.waitFor(() => expect(ctx.get('scenes')!.docs().has('b')).toBe(true));
    ctx.get('scenes')!.replace([]);
    const loader = ctx.get('assetLoader')!;
    await expect(loader.load(['other.png'])).rejects.toThrow();
    // Additive by design: the warning is a hint about paths nothing EVER named.
    loader.get('b.png');
    expect(report).not.toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('b.png') }));
    await fiber.dispose();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @energy8engine/scenes`
Expected: FAIL — the `require.test.ts` cases (no `expect` call; typecheck of the fake also fails on the unknown `expect` member), and the first `runtime.test.ts` case reports `b.png`.

- [ ] **Step 4: Add `expect` to `AssetLoader` (`builtin.ts`)**

```ts
export interface AssetLoader {
  load(urls: string[]): Promise<void>;
  unload(urls: string[]): Promise<void>;
  get(url: string): Texture | undefined;
  /** Paths something declared it will load — a document names them, or a row `require`d them: `get` does not call them "nothing loaded". Loads nothing. Optional: a loader without it warns as before. */
  expect?(urls: string[]): void;
}
```

- [ ] **Step 5: Implement it in the pixi loader (`runtime.ts`)**

In `createPixiLoader`'s returned object, beside `load`:

```ts
    expect: (urls) => {
      for (const u of urls) asked.add(u);
    },
```

And amend the doc comment above `createPixiLoader`: the sentence "And never for a path a batch DID ask for" becomes

```
 * And never for a path a batch DID ask for (that one has its own error from
 * `load()` already), nor for one something DECLARED (`expect`): every path a
 * declared document names — `replace()` mounts them all, hidden, long before
 * `show` loads them — and every path a row `require`d. Additive: a path stays
 * declared after the document naming it is gone.
```

- [ ] **Step 6: Call it from `replace` and `require` (`scenes.ts`)**

In `replace(next)`, after `for (const doc of next) docs.set(doc.id, doc);` and BEFORE `remount([...changed]);`:

```ts
      // Every path a declared document names is one something WILL load (on
      // its `show`), so the loader must not call it "nothing loaded" when a
      // hidden mount draws it first. Before the remount: mounting calls `get`.
      loader.expect?.([...new Set(next.flatMap((d) => assetsOf(d.id)))]);
```

In `requireAssets(paths)`, right after `required.add(holder);`:

```ts
    loader.expect?.(holder.paths);
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test -w @energy8engine/scenes` — Expected: PASS (all).
Run: `npm run typecheck -w @energy8engine/scenes` — Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add engine/game/scenes/src/builtin.ts engine/game/scenes/src/runtime.ts engine/game/scenes/src/scenes.ts engine/game/scenes/tests/require.test.ts engine/game/scenes/tests/runtime.test.ts
git commit -m "Scenes: a path a declared document names is not \"nothing loaded\"

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `scenes.once(ref)` — play a node once and await its end

**Files:**
- Modify: `engine/game/scenes/src/scenes.ts` (`ScenesService` interface ~line 177, near `view`/`setProps`; the returned service object ~line 1236, beside `setProps`)
- Create: `engine/game/scenes/tests/once.test.ts`

**Interfaces:**
- Consumes: `NodeType.once?(view: Container, props: P, ctx: Context): Promise<void>` (`node-types.ts:36`, existing); `entriesOf(ref)` (existing, `scenes.ts` ~line 853).
- Produces: `ScenesService.once(ref: SceneRef): Promise<boolean>`.

- [ ] **Step 1: Write the failing tests (`once.test.ts`)**

```ts
/**
 * `scenes.once(ref)` — a scene node's own `once` (a strip's one-shot), awaited
 * by whoever asked, on every mounted copy of the node.
 */
import { describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createNodeTypes } from '../src/node-types';
import { container, image, scene, type AssetLoader } from '../src/builtin';
import { createScenes } from '../src/scenes';

const loader: AssetLoader = {
  load: vi.fn(async () => {}),
  unload: vi.fn(async () => {}),
  get: () => Texture.EMPTY,
};

/** A `once` that settles only when the test says, one release per call. */
function gatedType() {
  const releases: (() => void)[] = [];
  const played: Container[] = [];
  let throwOn = -1;
  const t = {
    type: 'clip',
    schema: Schema.object({}),
    mount: () => new Container(),
    once: vi.fn((view: Container) => {
      played.push(view);
      if (played.length - 1 === throwOn) return Promise.reject(new Error('broke'));
      return new Promise<void>((r) => releases.push(r));
    }),
  };
  return { t, releases, played, throwNth: (n: number) => (throwOn = n) };
}

function boot(docs: SceneDoc[], extra: ReturnType<typeof gatedType>['t']) {
  const report = vi.fn<(d: Diagnostic) => void>();
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene]) nodeTypes.register(t);
  nodeTypes.register(extra);
  const scenes = createScenes({
    root: new Container(),
    design: { width: 100, height: 50 },
    nodeTypes,
    loader,
    ctx: new Context(),
    report,
  });
  scenes.replace(docs);
  return { scenes, report };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const stage: SceneDoc = { id: 'stage', nodes: [{ id: 'attack', type: 'clip', props: {} }] };

describe('scenes.once', () => {
  it('plays the node through its type’s once and settles only when that does — true', async () => {
    const g = gatedType();
    const { scenes } = boot([stage], g.t);
    let done: boolean | undefined;
    void scenes.once({ scene: 'stage', node: 'attack' }).then((v) => (done = v));
    await tick();
    expect(g.played).toEqual([scenes.view({ scene: 'stage', node: 'attack' })]);
    expect(done).toBeUndefined();
    g.releases.forEach((r) => r());
    await tick();
    expect(done).toBe(true);
  });

  it('plays a node of a document that is not shown — the caller owns visible', async () => {
    const g = gatedType();
    const { scenes } = boot([stage], g.t);
    expect(scenes.visible()).toEqual([]);
    const p = scenes.once({ scene: 'stage', node: 'attack' });
    await tick();
    g.releases.forEach((r) => r());
    await expect(p).resolves.toBe(true);
  });

  it('plays every mounted copy of a nested document, and waits for all of them', async () => {
    const g = gatedType();
    const host: SceneDoc = { id: 'host', nodes: [{ id: 'inner', type: 'scene', props: { scene: 'stage' } }] };
    const { scenes } = boot([stage, host], g.t);
    let done = false;
    void scenes.once({ scene: 'stage', node: 'attack' }).then(() => (done = true));
    await tick();
    expect(g.played.length).toBe(2);
    g.releases[0]();
    await tick();
    expect(done).toBe(false);
    g.releases[1]();
    await tick();
    expect(done).toBe(true);
  });

  it('a copy whose once throws is reported, and the others still play — true', async () => {
    const g = gatedType();
    g.throwNth(0);
    const host: SceneDoc = { id: 'host', nodes: [{ id: 'inner', type: 'scene', props: { scene: 'stage' } }] };
    const { scenes, report } = boot([stage, host], g.t);
    const p = scenes.once({ scene: 'stage', node: 'attack' });
    await tick();
    expect(g.played.length).toBe(2);
    g.releases.forEach((r) => r());
    await expect(p).resolves.toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining('failed to play: broke') }),
    );
  });

  it('a type without once answers false and reports nothing', async () => {
    const g = gatedType();
    const doc: SceneDoc = { id: 'stage', nodes: [{ id: 'bg', type: 'container', props: {} }] };
    const { scenes, report } = boot([doc], g.t);
    await expect(scenes.once({ scene: 'stage', node: 'bg' })).resolves.toBe(false);
    expect(report).not.toHaveBeenCalled();
  });

  it('a node nothing mounted answers false with an error at <scene>/<node>', async () => {
    const g = gatedType();
    const { scenes, report } = boot([stage], g.t);
    await expect(scenes.once({ scene: 'stage', node: 'nope' })).resolves.toBe(false);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        where: 'stage/nope',
        message: 'node "nope" is not mounted in scene "stage" — nothing to play',
      }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @energy8engine/scenes`
Expected: FAIL — `scenes.once is not a function` (and a typecheck error on the missing member).

- [ ] **Step 3: Declare it on `ScenesService` (`scenes.ts`)**

Directly after the `setProps(ref, patch)` declaration and its doc:

```ts
  /**
   * Plays every mounted copy of the node once through its type's `once` (a
   * strip's one-shot) and settles when the last one ends: `true` when the
   * type has a `once` and a copy played, `false` otherwise. Every copy,
   * the way `setProps` patches every copy — nesting is by copy, and only
   * one of them is on screen. `visible` is the caller's: a node of a hidden
   * document plays unseen. A node nothing mounted is `false` with an error;
   * a copy whose `once` throws is reported at its `where`, and the others
   * still play.
   */
  once(ref: SceneRef): Promise<boolean>;
```

- [ ] **Step 4: Implement it (`scenes.ts`, the returned service object, after `setProps`)**

Same failure message and per-entry `try` as `CellMount.once` (~line 1212):

```ts
    async once(ref) {
      const entries = entriesOf(ref);
      if (entries.length === 0) {
        error(
          `${ref.scene}/${ref.node}`,
          `node "${ref.node}" is not mounted in scene "${ref.scene}" — nothing to play`,
          'check the scene and node ids',
        );
        return false;
      }
      const ran = entries.filter((e) => e.type.once);
      await Promise.all(
        ran.map(async (e) => {
          try {
            await e.type.once!(e.view, e.props, ctx);
          } catch (err) {
            error(e.where, `${e.node.type} "${e.node.id}" failed to play: ${why(err)}`);
          }
        }),
      );
      return ran.length > 0;
    },
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -w @energy8engine/scenes` — Expected: PASS (all).
Run: `npm run typecheck -w @energy8engine/scenes` — Expected: 0 errors.
Then every package with a `ScenesService` fake that must now carry `once` — find them:
`grep -rln "ScenesService" engine --include=*.ts | grep -v node_modules | grep tests`
and run each such package's `npm run typecheck -w <name>`; a fake typed as the full `ScenesService` gains `once: async () => false`. Expected: 0 errors everywhere.

- [ ] **Step 6: Commit**

```bash
git add engine/game/scenes/src/scenes.ts engine/game/scenes/tests/once.test.ts
# plus any fake the typecheck step touched, by path
git commit -m "Scenes: once(ref) plays a node's one-shot and settles when it ends

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
