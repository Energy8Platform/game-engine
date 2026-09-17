# Scene Editor Implementation Plan (slice 17)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scenes become node trees in `scenes/<id>.scene.yml`, rendered by a new `@energy8engine/scenes` row through a plugin registry of node types (`container`, `image`, `scene`, `reels`), with assets loaded per scene; the IDE gets a Scenes sidebar (list), a scene tab (node tree, opened by double-click or from the Explorer), and a right sidebar showing the selected node's properties, while the preview highlights the selection.

**Architecture:** The game reads scene documents from the host (`GET /api/scenes`, `scenes` frames over `/ide`) and mounts them into a design-space root through `ctx.nodeTypes`; `@energy8engine/stage` is deleted and its fit/transition code moves into `@energy8engine/scenes`. The host parses and validates the YAML, serves routes for the IDE, and relays the game's `node-types` report. The client adds a `shell.sideRight` region, a `scenes` service plugin, and three views over it.

**Tech Stack:** cordis 4.0.0-rc.8, pixi.js 8 (`Container`, `Sprite`, `Graphics`, `Assets`), schemastery 3.18.0, js-yaml (host), React 18, vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-scene-editor-design.md`

## Global Constraints

- Scene file path: `scenes/<id>.scene.yml`; `id` = basename; `id` matches `/^[a-z0-9_]+$/` on create.
- `SceneDoc { id, nodes }`, `SceneNode { id, type, props, children? }`; list order = draw order, first at the back.
- Common props (runtime applies after `mount`): `x=0 y=0 scale=1 rotation=0 alpha=1 visible=true anchor=0` (anchor only when the view has one).
- Node types in this slice: `container`, `image` (`src`), `scene` (`scene`), `reels` (`row`, default `reels1`). No `spine`, `text`, `video`.
- `@energy8engine/stage` is DELETED; `@energy8engine/scenes` row id is `scenes1`, `hot: true`, config `{ design (restart), mode, transition, transitionMs }`.
- `reels1.config.layer` is removed. The reels row mounts NOTHING on its own; it registers the `reels` node type. (Spec amendment, ruled at plan time: the host warns "no scene has a reels node" instead of a root fallback — smaller and data-driven.)
- Temporary rule until the flow editor: `main.ts` shows the scene named `result.stage` if it exists, silently otherwise.
- `first-slot/src/main.ts`, `game/script.spin`, `e8.profile.yml` stay byte-identical to `templates/slot-basic`'s (`template.test.ts`).
- Diagnostics from the host scenes check are reported through `ideRpc.reportGameDiagnostics('scenes', …)`, `plugin: 'scenes'`.
- Wire: `ServerMessage` gains `scenes`, `node-types`, `scene-select`; `ClientMessage` gains `node-types`; the preview `/ide` accepts `['game-diagnostics', 'game-transitions', 'node-types']`.
- Client: one `/ide` socket per plugin is the existing pattern; this slice ADDS `connection.onFrame` and the scenes plugin uses it (no fifth socket).
- Scene tab key is the file key `f:scenes/<id>.scene.yml` (it IS the viewer for that path). There is no "open as text" and no dirty-refusal — spec §8.3's last two sentences are dropped (ruled at plan time: same key, no second document).
- Tests render client views through the plugin's OWN ctx (slice-16 lesson). Playwright runs alone; never kill a process you did not start; `git branch --show-current` must print `feat/slot-webide-cordis` before and after.
- Never stage anything under `packages/*`; `engine/examples/first-slot/concept.png` is untracked and not ours.
- Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Commands: from the REPO ROOT, `npm test -w @energy8engine/<pkg>` (workspaces are `engine/*/*`; the lockfile is the root `package-lock.json`); e2e: `cd engine/apps/web && npx playwright test tests/e2e/scenes.spec.ts` with `e8` NOT running on 5679 (`pgrep -fl e8-server | grep -v pantheon`; `ls engine/examples` must be `first-slot probe-plugin workspace`).

---

## File map

| Path | Responsibility |
|---|---|
| `engine/core/contracts/src/protocol.ts` | `SceneDoc`, `SceneNode`, `NodeTypeInfo`, `ScenesResponse`, three new messages, unions |
| `engine/game/scenes/package.json`, `src/index.ts`, `src/fit.ts`, `src/transitions.ts`, `src/node-types.ts`, `src/builtin.ts`, `src/scenes.ts`, `src/runtime.ts`, `src/schema.ts` | New package. `fit.ts`/`transitions.ts` are `stage`'s code moved. `node-types.ts` = registry; `builtin.ts` = `container`/`image`/`scene`; `scenes.ts` = `createScenes`; `runtime.ts` = row |
| `engine/game/stage/**` | DELETED (Task 3) |
| `engine/game/reels/src/runtime.ts` | registers `reels` node type; no mount |
| `engine/game/ide-bridge/src/index.ts` | `scenes`, `scene-select` in; `node-types` out; `scene-preview` → `scenes.show` |
| `engine/ide/host/src/plugins/rpc.ts` | `node-types` mirror/relay/greeting/clear; `broadcastScenes`, `broadcastSceneSelect` |
| `engine/ide/host/src/plugins/dev-game.ts` | accept list; `attachGameRoutes` for scenes |
| `engine/ide/host/src/plugins/scenes.ts` | rewritten: read, check, routes, broadcast |
| `engine/bundles/e8-base/e8.bundle.yml` | `stage1` → `scenes1` |
| `engine/templates/slot-basic/{scenes/,e8.patch.yml,package.json,src/main.ts}`, `engine/examples/first-slot/{same}` | fixture |
| `engine/ide/client/src/plugins/connection.ts` | `onFrame` |
| `engine/ide/client/src/plugins/shell.tsx`, `src/shell/Shell.tsx`, `src/styles.css` | right sidebar |
| `engine/ide/client/src/plugins/scenes.tsx` | rewritten: service + three registrations + viewer |
| `engine/ide/client/src/shell/ScenesSidebar.tsx` | rewritten: list |
| `engine/ide/client/src/shell/SceneDocument.tsx` | new: node tree |
| `engine/ide/client/src/shell/PropertiesSidebar.tsx` | new |
| `engine/ide/client/src/plugins/game-composition.tsx` | `stages`, `previewScene` removed |
| `engine/apps/web/tests/e2e/scenes.spec.ts`, `composition.spec.ts` | rewritten / `scenes1` |

---

### Task 1: Contracts

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts` (after `GameTransitionsMessage`, and the two unions at the end)
- Test: `engine/core/contracts/tests/protocol-scenes.test.ts`

**Interfaces:**
- Produces: the types below, imported by every later task by these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// engine/core/contracts/tests/protocol-scenes.test.ts
import { describe, expect, it } from 'vitest';
import type {
  ClientMessage,
  NodeTypeInfo,
  SceneDoc,
  SceneSelectMessage,
  ScenesMessage,
  ScenesResponse,
  ServerMessage,
} from '../src';

/** Compile-time shapes: a value of each type assigns; the unions carry the new members. */
describe('scene contracts', () => {
  it('shapes assign and the unions carry the three new frames', () => {
    const doc: SceneDoc = {
      id: 'base_game',
      nodes: [
        { id: 'bg', type: 'image', props: { src: 'assets/bg.png', x: 1 } },
        { id: 'grp', type: 'container', props: {}, children: [{ id: 'k', type: 'reels', props: {} }] },
      ],
    };
    const types: NodeTypeInfo[] = [{ type: 'image', schema: { type: 'object' } }];
    const response: ScenesResponse = { scenes: [doc], diagnostics: [], nodeTypes: types };
    const frames: ServerMessage[] = [
      { type: 'scenes', scenes: [doc], diagnostics: [] } satisfies ScenesMessage,
      { type: 'node-types', types },
      { type: 'scene-select', scene: 'base_game', node: null } satisfies SceneSelectMessage,
    ];
    const up: ClientMessage = { type: 'node-types', types };
    expect(response.scenes[0].nodes[1].children?.[0].type).toBe('reels');
    expect(frames.map((f) => f.type)).toEqual(['scenes', 'node-types', 'scene-select']);
    expect(up.type).toBe('node-types');
  });
});
```

- [ ] **Step 2: Run it — expect a compile failure naming `SceneDoc`**

Run: `npm test -w @energy8engine/contracts -- protocol-scenes`
Expected: FAIL (type errors / missing exports).

- [ ] **Step 3: Add the types**

In `engine/core/contracts/src/protocol.ts`, after `GameTransitionsMessage`:

```ts
/** One node of a scene document — see spec §3. `children` mount into the node's view. */
export interface SceneNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: SceneNode[];
}

/** `scenes/<id>.scene.yml`, parsed. List order is draw order, first at the back. */
export interface SceneDoc {
  id: string;
  nodes: SceneNode[];
}

/** A node type the running game registered: its id and its props schema as schemastery JSON. */
export interface NodeTypeInfo {
  type: string;
  schema: unknown;
}

/** The whole document set, replaced whole — host to every `/ide` socket on any change. */
export interface ScenesMessage {
  type: 'scenes';
  scenes: SceneDoc[];
  diagnostics: Diagnostic[];
}

/** The game's node-type registry, both ways (up from the game, relayed down), like `game-transitions`. */
export interface NodeTypesMessage {
  type: 'node-types';
  types: NodeTypeInfo[];
}

/** "Highlight this node" — the IDE selected it; `node: null` clears. Not retained. */
export interface SceneSelectMessage {
  type: 'scene-select';
  scene: string;
  node: string | null;
}

/** What `GET /api/scenes` answers on the root and the preview alike. */
export interface ScenesResponse {
  scenes: SceneDoc[];
  diagnostics: Diagnostic[];
  nodeTypes: NodeTypeInfo[];
}
```

Add `| ScenesMessage | NodeTypesMessage | SceneSelectMessage` to `ServerMessage` and `| NodeTypesMessage` to `ClientMessage`. Make sure `engine/core/contracts/src/index.ts` re-exports `protocol.ts` wholesale (it does today via `export *`; verify).

- [ ] **Step 4: Run the contracts suite**

Run: `npm test -w @energy8engine/contracts`
Expected: PASS (73 tests incl. the new one).

- [ ] **Step 5: Commit**

```bash
git add engine/core/contracts
git commit -m "Name the scene document and its three frames on the wire"
```

---

### Task 2: `@energy8engine/scenes` — package, registry, built-in node types, mounting

**Files:**
- Create: `engine/game/scenes/package.json`, `tsconfig.json`, `vitest.config.ts` (copy `engine/game/stage/`'s three, rename)
- Create: `engine/game/scenes/src/fit.ts` (move `Size`, `Fit`, `fitStage` from `engine/game/stage/src/index.ts`)
- Create: `engine/game/scenes/src/transitions.ts` (move `TickerLike`, `TransitionRun`, `Transition`, `TransitionsService`, `createTransitions`, `cut`, `fade` — `plugin` in its diagnostic becomes `'scenes'`)
- Create: `engine/game/scenes/src/common-schema.ts` (the `COMMON` schema, schemastery only; `package.json` exports `./common-schema`), `src/node-types.ts`, `src/builtin.ts`, `src/scenes.ts`, `src/index.ts`
- Test: `engine/game/scenes/tests/fit.test.ts`, `tests/transitions.test.ts` (moved from stage, `'stage'` → `'scenes'`), `tests/node-types.test.ts`, `tests/mount.test.ts`

**Interfaces:**
- Produces:

```ts
// node-types.ts
export interface NodeType<P = Record<string, unknown>> {
  type: string;
  schema: Schema<P>;
  mount(props: P, ctx: Context): Container;
  update?(view: Container, props: P, ctx: Context): void;
  unmount?(view: Container): void;
  assets?(props: P): string[];
}
export interface NodeTypesService {
  register(t: NodeType<any>): () => void;   // last-wins; notifies
  get(type: string): NodeType | undefined;
  list(): NodeType[];
  subscribe(listener: () => void): () => void;
}
export function createNodeTypes(): NodeTypesService;
// common-schema.ts (schemastery ONLY — the IDE client imports it through the package's `./common-schema` export)
export const COMMON = Schema.object({ x: Schema.number().default(0), y: Schema.number().default(0), scale: Schema.number().default(1), rotation: Schema.number().default(0), alpha: Schema.number().default(1), visible: Schema.boolean().default(true), anchor: Schema.number().default(0) });
// node-types.ts re-exports COMMON and adds
export function applyCommon(view: Container, props: Record<string, unknown>): void;

// builtin.ts
export interface AssetLoader { load(urls: string[]): Promise<void>; unload(urls: string[]): Promise<void>; get(url: string): Texture | undefined; }
export const container: NodeType; export const image: NodeType<{ src: string }>; export const scene: NodeType<{ scene: string }>;
// `image.mount` reads the loader off `ctx.reflect.get('assetLoader', false)`; `scene.mount` reads `ctx.reflect.get('scenes', false)` and calls `scenes.mountDoc(id, cycleGuard)`.

// scenes.ts
export interface CreateScenesOptions { root: Container; design: Size; mode?: 'contain' | 'cover'; transition?: string; transitionMs?: number; transitions?: TransitionsService; nodeTypes: NodeTypesService; loader: AssetLoader; ticker?: TickerLike | null; ctx: Context; report?: (d: Diagnostic) => void; }
export interface ScenesService { show(id, opts?); hide(id); visible(): string[]; docs(): ReadonlyMap<string, SceneDoc>; replace(docs: SceneDoc[]): void; highlight(ref | null): void; container: Container; resize(w, h): Fit; assetsOf(id: string): string[]; mountDoc(id, chain): Container | null; sceneView(id): Container | undefined; view(ref): Container | undefined; destroy(): void; }
export function createScenes(options: CreateScenesOptions): ScenesService;
```

- [ ] **Step 1: Spike — does `Sprite` build headlessly?** Run in `engine/game/stage` (it has pixi): `node -e "import('pixi.js').then(({Sprite,Texture})=>{const s=new Sprite(Texture.EMPTY);s.anchor.set(0.5);console.log('ok',s.width)})"`. Expected: `ok 0`. If it throws, `image.mount` falls back to a `Container` holding the sprite only when `Texture` is real; note the result in the report.

- [ ] **Step 2: Create the package and move fit + transitions**

`engine/game/scenes/package.json` — as `stage/package.json` with `"name": "@energy8engine/scenes"`, exports `.`, `./runtime`, `./schema`, `e8.runtime.entry ./src/runtime.ts`, `e8.runtime.schema ./src/schema.ts`, `hot: true`; same deps. `src/fit.ts` and `src/transitions.ts` are verbatim moves; move `tests/transitions.test.ts` and the `fitStage` cases of `stage.test.ts` into `tests/fit.test.ts`. Run: `npm install && npm test -w @energy8engine/scenes` → PASS on the moved tests.

- [ ] **Step 3: Failing tests for the registry and common props**

```ts
// engine/game/scenes/tests/node-types.test.ts
import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import Schema from 'schemastery';
import { applyCommon, createNodeTypes, type NodeType } from '../src/node-types';

const t = (type: string): NodeType => ({ type, schema: Schema.object({}), mount: () => new Container() });

describe('createNodeTypes', () => {
  it('last registration wins and notifies; the disposer takes back only its own', () => {
    const reg = createNodeTypes();
    const heard = vi.fn();
    reg.subscribe(heard);
    const a = t('image');
    const offA = reg.register(a);
    const b = t('image');
    reg.register(b);
    expect(reg.get('image')).toBe(b);
    expect(heard).toHaveBeenCalledTimes(2);
    offA();
    expect(reg.get('image')).toBe(b);
    expect(reg.list().map((x) => x.type)).toEqual(['image']);
  });
});

describe('applyCommon', () => {
  it('applies the six common props with their defaults and anchor only where there is one', () => {
    const c = new Container();
    applyCommon(c, { x: 10, y: 20, scale: 2, alpha: 0.5, visible: false });
    expect([c.x, c.y, c.scale.x, c.rotation, c.alpha, c.visible]).toEqual([10, 20, 2, 0, 0.5, false]);
    const withAnchor = Object.assign(new Container(), { anchor: { set: vi.fn() } });
    applyCommon(withAnchor as unknown as Container, { anchor: 0.5 });
    expect(withAnchor.anchor.set).toHaveBeenCalledWith(0.5);
  });
});
```

- [ ] **Step 4: Implement `node-types.ts`**

```ts
import type { Context } from 'cordis';
import type { Container } from 'pixi.js';
import Schema from 'schemastery';
import { createRegistry } from '@energy8engine/registry';

export interface NodeType<P = Record<string, unknown>> {
  type: string;
  /** Own props only; the common ones (`COMMON`) are the runtime's. */
  schema: Schema<P>;
  mount(props: P, ctx: Context): Container;
  update?(view: Container, props: P, ctx: Context): void;
  /** The runtime never destroys a view it did not build; `unmount` is the type's chance to detach its own. */
  unmount?(view: Container): void;
  /** Project-relative paths this node needs loaded before it shows. */
  assets?(props: P): string[];
}

export interface NodeTypesService {
  register(t: NodeType<any>): () => void;
  get(type: string): NodeType | undefined;
  list(): NodeType[];
  subscribe(listener: () => void): () => void;
}

export function createNodeTypes(): NodeTypesService {
  const registry = createRegistry<NodeType>({ policy: 'last-wins' });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    register(t) {
      const off = registry.add(t.type, t);
      notify();
      return () => {
        off();
        notify();
      };
    },
    get: (type) => registry.get(type),
    list: () => registry.keys().map((k) => registry.get(k)!),
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// in common-schema.ts (node-types.ts does `export { COMMON } from './common-schema'`):
export const COMMON = Schema.object({
  x: Schema.number().default(0).description('x, design px'),
  y: Schema.number().default(0).description('y, design px'),
  scale: Schema.number().default(1),
  rotation: Schema.number().default(0).description('radians'),
  alpha: Schema.number().default(1),
  visible: Schema.boolean().default(true),
  anchor: Schema.number().default(0).description('applies to views that have one'),
});

export function applyCommon(view: Container, props: Record<string, unknown>): void {
  const c = COMMON(props as any) as Record<string, number | boolean>;
  view.position.set(c.x as number, c.y as number);
  view.scale.set(c.scale as number);
  view.rotation = c.rotation as number;
  view.alpha = c.alpha as number;
  view.visible = c.visible as boolean;
  const anchored = view as unknown as { anchor?: { set(v: number): void } };
  if (anchored.anchor && typeof anchored.anchor.set === 'function') anchored.anchor.set(c.anchor as number);
}
```

Note: `COMMON(props)` validates unknown keys leniently only if the schema allows extra keys — schemastery `Schema.object` strips unknown keys by default; that is what we want (a node's own props pass through untouched to the type's schema).

- [ ] **Step 5: Failing tests for mounting and `replace`**

```ts
// engine/game/scenes/tests/mount.test.ts
import { describe, expect, it, vi } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { Context } from 'cordis';
import Schema from 'schemastery';
import type { Diagnostic, SceneDoc } from '@energy8engine/contracts';
import { createNodeTypes } from '../src/node-types';
import { container, image, scene, type AssetLoader } from '../src/builtin';
import { createScenes, type ScenesService } from '../src/scenes';

const loader: AssetLoader = {
  load: vi.fn(async () => {}),
  unload: vi.fn(async () => {}),
  get: () => Texture.EMPTY,
};

function boot(docs: SceneDoc[] = []) {
  const ctx = new Context();
  const report = vi.fn<(d: Diagnostic) => void>();
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene]) nodeTypes.register(t);
  const root = new Container();
  const scenes = createScenes({ root, design: { width: 100, height: 50 }, nodeTypes, loader, ctx, report });
  scenes.replace(docs);
  return { ctx, report, nodeTypes, root, scenes };
}

const byId = (s: ScenesService, sceneId: string, nodeId: string) => s.view({ scene: sceneId, node: nodeId });

describe('mounting', () => {
  it('mounts nodes in list order with common props, children into their parent', () => {
    const { scenes } = boot([
      { id: 'a', nodes: [
        { id: 'bg', type: 'image', props: { src: 'bg.png', x: 5, y: 6 } },
        { id: 'grp', type: 'container', props: { alpha: 0.5 }, children: [{ id: 'in', type: 'image', props: { src: 'k.png' } }] },
      ] },
    ]);
    const rootA = scenes.sceneView('a')!;
    expect(rootA.children.map((c) => c.label)).toEqual(['bg', 'grp']);
    expect(byId(scenes, 'a', 'bg')!.position.x).toBe(5);
    expect(byId(scenes, 'a', 'grp')!.alpha).toBe(0.5);
    expect(byId(scenes, 'a', 'in')!.parent).toBe(byId(scenes, 'a', 'grp'));
  });

  it('an unknown type is an error diagnostic and the node is skipped; the rest mounts', () => {
    const { scenes, report } = boot([{ id: 'a', nodes: [{ id: 'x', type: 'spine', props: {} }, { id: 'y', type: 'container', props: {} }] }]);
    expect(byId(scenes, 'a', 'x')).toBeUndefined();
    expect(byId(scenes, 'a', 'y')).toBeDefined();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', plugin: 'scenes', where: 'a/x' }));
  });

  it('a duplicate node id: the later node is skipped with an error', () => {
    const { scenes, report } = boot([{ id: 'a', nodes: [{ id: 'n', type: 'container', props: { x: 1 } }, { id: 'n', type: 'container', props: { x: 2 } }] }]);
    expect(byId(scenes, 'a', 'n')!.x).toBe(1);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ where: 'a/n' }));
  });

  it('a scene node mounts the referenced document as a child, hidden by default when told so', () => {
    const { scenes } = boot([
      { id: 'big', nodes: [{ id: 'banner', type: 'container', props: {} }] },
      { id: 'base', nodes: [{ id: 'bw', type: 'scene', props: { scene: 'big', visible: false } }] },
    ]);
    const bw = byId(scenes, 'base', 'bw')!;
    expect(bw.visible).toBe(false);
    expect(bw.children[0].label).toBe('banner');
  });

  it('a reference cycle skips the node with an error; a missing scene too', () => {
    const { scenes, report } = boot([
      { id: 'a', nodes: [{ id: 'toB', type: 'scene', props: { scene: 'b' } }] },
      { id: 'b', nodes: [{ id: 'toA', type: 'scene', props: { scene: 'a' } }, { id: 'toZ', type: 'scene', props: { scene: 'zzz' } }] },
    ]);
    expect(report.mock.calls.map((c) => c[0].where)).toEqual(expect.arrayContaining(['b/toA', 'b/toZ']));
    expect(scenes.sceneView('a')).toBeDefined();
  });

  it('replace remounts only changed documents and keeps a visible scene visible', async () => {
    const { scenes, root } = boot([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] },
      { id: 'b', nodes: [{ id: 'm', type: 'container', props: {} }] },
    ]);
    await scenes.show('a');
    const viewA = scenes.sceneView('a');
    const viewB = scenes.sceneView('b');
    scenes.replace([
      { id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] },
      { id: 'b', nodes: [{ id: 'm', type: 'container', props: { x: 9 } }] },
    ]);
    expect(scenes.sceneView('a')).toBe(viewA);
    expect(scenes.sceneView('b')).not.toBe(viewB);
    expect(scenes.visible()).toEqual(['a']);
    expect(scenes.container.children).toContain(viewA);
    scenes.replace([{ id: 'b', nodes: [] }]);
    expect(scenes.sceneView('a')).toBeUndefined();
    expect(scenes.visible()).toEqual([]);
    expect(root.children).toContain(scenes.container);
  });

  it('re-registering a node type remounts every node of that type', () => {
    const { scenes, nodeTypes } = boot([{ id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] }]);
    const before = byId(scenes, 'a', 'n');
    nodeTypes.register({ ...container });
    expect(byId(scenes, 'a', 'n')).not.toBe(before);
  });

  it('a view the type did not build survives an unmount: `unmount` detaches, the runtime never destroys', () => {
    const foreign = new Container();
    const { scenes, nodeTypes } = boot();
    nodeTypes.register({ type: 'foreign', schema: Schema.object({}), mount: () => foreign, unmount: (v) => v.parent?.removeChild(v) });
    scenes.replace([{ id: 'a', nodes: [{ id: 'f', type: 'foreign', props: {} }] }]);
    scenes.replace([]);
    expect(foreign.destroyed).toBe(false);
    expect(foreign.parent).toBeNull();
  });
});
```

Test-only accessors used above and later: `sceneView(id): Container | undefined` and `view(ref): Container | undefined` are part of `ScenesService` (also what `highlight` uses).

- [ ] **Step 6: Implement `builtin.ts` and `scenes.ts`**

```ts
// engine/game/scenes/src/builtin.ts
import type { Context } from 'cordis';
import { Container, Sprite, type Texture } from 'pixi.js';
import Schema from 'schemastery';
import type { NodeType } from './node-types';

/** What `image` reads to build a sprite — `pixi.js`' `Assets` in the runtime, a fake in tests. */
export interface AssetLoader {
  load(urls: string[]): Promise<void>;
  unload(urls: string[]): Promise<void>;
  get(url: string): Texture | undefined;
}

export const container: NodeType = {
  type: 'container',
  schema: Schema.object({}),
  mount: () => new Container(),
};

export const image: NodeType<{ src: string }> = {
  type: 'image',
  schema: Schema.object({ src: Schema.string().required().description('image path, project-relative') }),
  mount(props, ctx) {
    const loader = ctx.reflect.get('assetLoader', false) as AssetLoader | undefined;
    const texture = loader?.get(props.src);
    // No texture yet (not loaded, or failed): an empty sprite keeps the
    // node's slot; `show` reports the load failure itself.
    return texture ? new Sprite(texture) : new Sprite();
  },
  assets: (props) => [props.src],
};

/** The referenced document, mounted as a child. `mountDoc` is the runtime's; the cycle guard is its chain of ids. */
export const scene: NodeType<{ scene: string }> = {
  type: 'scene',
  schema: Schema.object({ scene: Schema.string().required().description('scene id') }),
  mount(props, ctx) {
    const scenes = ctx.reflect.get('scenes', false) as
      { mountDoc(id: string, chain: string[]): Container | null } | undefined;
    const chain = ((ctx as unknown as { __sceneChain?: string[] }).__sceneChain ?? []);
    const view = scenes?.mountDoc(props.scene, chain);
    if (!view) throw new Error(`scene "${props.scene}" cannot be nested here (missing, or a cycle)`);
    return view;
  },
};
```

`scenes.ts` — the runtime core. Write it around these rules, each covered by Step 5:

```ts
import type { Context } from 'cordis';
import { Container, Graphics } from 'pixi.js';
import { diagnostic, type Diagnostic, type SceneDoc, type SceneNode } from '@energy8engine/contracts';
import { fitStage, type Fit, type Size } from './fit';
import { createTransitions, cut, type TickerLike, type TransitionsService } from './transitions';
import { applyCommon, type NodeTypesService } from './node-types';
import type { AssetLoader } from './builtin';

export interface CreateScenesOptions { /* as in Interfaces above */ }

export interface ScenesService {
  show(id: string, opts?: { transition?: string }): Promise<void>;
  hide(id: string): Promise<void>;
  visible(): string[];
  docs(): ReadonlyMap<string, SceneDoc>;
  replace(docs: SceneDoc[]): void;
  highlight(ref: { scene: string; node: string } | null): void;
  /** Every asset path the document (and its nested scenes) needs. */
  assetsOf(id: string): string[];
  /** Mounts `id`'s tree into a fresh container for a `scene` node; `null` on a cycle or a missing id (reported). Internal to `scene` nodes. */
  mountDoc(id: string, chain: string[]): Container | null;
  sceneView(id: string): Container | undefined;
  view(ref: { scene: string; node: string }): Container | undefined;
  readonly container: Container;
  resize(viewportWidth: number, viewportHeight: number): Fit;
  destroy(): void;
}

export function createScenes(options: CreateScenesOptions): ScenesService { … }
```

Implementation notes (the implementer writes the bodies; these are the decisions):
- State: `docs: Map<string, SceneDoc>`, `mounted: Map<string, { view: Container; nodes: Map<string, { view: Container; node: SceneNode; type: string }> }>` for TOP-LEVEL documents; nested mounts (via `mountDoc`) register their node views under the OUTER scene's map keyed `<nestedScene>/<nodeId>`? No — keep it simple: a nested `scene` node's subtree is NOT addressable by `view()`; only the `scene` node itself is. `nodeVisible(scene, node)` in `main.ts` reads top-level only.
- `mountNode(node, parent, sceneId, chain, seen: Set<string>)`: duplicate id → report `a/n` "node id "n" is declared twice — the later one is skipped", return; type unknown → report, return; `mount` throws → report `${scene}/${node.id}` with the message, return; then `applyCommon(view, node.props)`, `view.label = node.id`, `parent.addChild(view)`, recurse `children` into `view`. `ctx` passed to `mount` is `Object.create(options.ctx)` with `__sceneChain = [...chain, sceneId]` so `scene.mount` sees the chain without a new API surface.
- `mountDoc(id, chain)`: `chain.includes(id)` or `!docs.has(id)` → report on the caller (the `scene` node reports via its throw — so `mountDoc` returns `null` and the throw carries the words) and return `null`; else build a `Container` labelled `id`, mount each node with `chain=[...chain, id]`.
- `replace(next)`: diff by id with `JSON.stringify` per doc; for removed/changed: `unmountDoc(id)` (walk node views in reverse: `type.unmount?.(view)`, `view.parent?.removeChild(view)`, then `view.destroy({ children: false })` only for views the runtime itself knows the type built — i.e. every view EXCEPT ones whose type has `unmount`; simplest correct rule: **destroy only `container`/`image` views (the two the package builds); anything else is detached**), remember `wasVisible`, then mount again and re-add to `container` if it was visible. Nested `scene` nodes referencing a changed doc: a changed doc remounts every top-level doc whose tree references it (walk `type === 'scene'` props). Unchanged docs untouched (identity test).
- `nodeTypes.subscribe(() => remount every top-level doc containing a node of the changed type)` — simplest: on any registry change, remount all docs that contain any node whose type is not `container`/`image`/`scene`… no: remount ALL docs whose tree contains a node of a type that is now registered differently. Track `typeIdentity: Map<string, NodeType>` at last mount; on notify compare `nodeTypes.get(t)` identity per used type; remount docs using a changed type.
- `show(id, opts)`: queue (`chain = chain.then(run)`); unknown id → error diagnostic `scenes/<id>` "scene "id" is not declared", resolve; already visible → resolve; load `assetsOf(id)` minus `loaded` via `loader.load`, catch → error diagnostic per failed path (`where: id`, message names the path), continue; then for a top-level doc: `container.addChild(view)`, `view.visible = true`, push to `visibleIds`; for a doc that is only nested (some visible top-level scene has a `scene` node pointing at it): set that node's view `visible = true` (no push to `visibleIds`; `visible()` lists top-level only). Then run the transition `{ from: [], to: [view], ticker, ms }` (`fade` fades the arriving container only — its rule already). `hide(id)`: reverse; then `loader.unload(paths not needed by any visible scene)`.
- `highlight(ref)`: one `Graphics` kept at the end of `container`'s children; `clear()`, and for a ref with a view: `getLocalBounds` of the view mapped into `container` space via `view.getBounds()` and `container.toLocal` — draw `rect(...).stroke({ width: 2, color: 0x38bdf8 })`. Headless bounds of empty containers are 0-size; the test asserts the Graphics is present and cleared on `null`, nothing more.
- `resize`/`container` — as `createStage` had.
- `destroy()`: hide nothing; unmount every doc (detach foreign views), remove `container` from `root`, destroy `container`.

- [ ] **Step 7: Failing tests for show/hide/assets/queue/highlight, then make them pass**

```ts
// append to engine/game/scenes/tests/mount.test.ts
describe('show / hide', () => {
  it('loads the union of assets through nesting before showing, unloads orphans on hide', async () => {
    const { scenes } = boot([
      { id: 'big', nodes: [{ id: 'i', type: 'image', props: { src: 'big.png' } }] },
      { id: 'base', nodes: [{ id: 'bg', type: 'image', props: { src: 'bg.png' } }, { id: 'bw', type: 'scene', props: { scene: 'big' } }] },
      { id: 'other', nodes: [{ id: 'bg2', type: 'image', props: { src: 'bg.png' } }] },
    ]);
    expect(scenes.assetsOf('base').sort()).toEqual(['big.png', 'bg.png']);
    await scenes.show('base');
    expect(loader.load).toHaveBeenLastCalledWith(expect.arrayContaining(['bg.png', 'big.png']));
    await scenes.show('other');
    await scenes.hide('base');
    expect(loader.unload).toHaveBeenLastCalledWith(['big.png']); // bg.png still shown by `other`
    expect(scenes.visible()).toEqual(['other']);
  });

  it('a failed load is an error naming the path; the scene still shows', async () => {
    const failing: AssetLoader = { ...loader, load: vi.fn(async () => { throw new Error('404'); }) };
    const ctx = new Context();
    const report = vi.fn<(d: Diagnostic) => void>();
    const nodeTypes = createNodeTypes();
    nodeTypes.register(image);
    const scenes = createScenes({ root: new Container(), design: { width: 1, height: 1 }, nodeTypes, loader: failing, ctx, report });
    scenes.replace([{ id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'nope.png' } }] }]);
    await scenes.show('a');
    expect(scenes.visible()).toEqual(['a']);
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', message: expect.stringContaining('nope.png') }));
  });

  it('showing a nested scene flips its node visible inside the visible parent', async () => {
    const { scenes } = boot([
      { id: 'big', nodes: [] },
      { id: 'base', nodes: [{ id: 'bw', type: 'scene', props: { scene: 'big', visible: false } }] },
    ]);
    await scenes.show('base');
    await scenes.show('big');
    expect(byId(scenes, 'base', 'bw')!.visible).toBe(true);
    expect(scenes.visible()).toEqual(['base']);
    await scenes.hide('big');
    expect(byId(scenes, 'base', 'bw')!.visible).toBe(false);
  });

  it('an unknown scene is an error diagnostic, resolved; the same scene twice is a no-op', async () => {
    const { scenes, report } = boot([{ id: 'a', nodes: [] }]);
    await scenes.show('zzz');
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ where: 'zzz' }));
    await scenes.show('a');
    await scenes.show('a');
    expect(scenes.visible()).toEqual(['a']);
  });

  it('concurrent shows run in order', async () => {
    const order: string[] = [];
    const slow: AssetLoader = { ...loader, load: vi.fn(async (urls) => { await new Promise((r) => setTimeout(r, 5)); order.push(urls.join()); }) };
    const ctx = new Context();
    const nodeTypes = createNodeTypes();
    nodeTypes.register(image);
    const scenes = createScenes({ root: new Container(), design: { width: 1, height: 1 }, nodeTypes, loader: slow, ctx });
    scenes.replace([
      { id: 'a', nodes: [{ id: 'i', type: 'image', props: { src: 'a.png' } }] },
      { id: 'b', nodes: [{ id: 'i', type: 'image', props: { src: 'b.png' } }] },
    ]);
    await Promise.all([scenes.show('a'), scenes.show('b')]);
    expect(order).toEqual(['a.png', 'b.png']);
    expect(scenes.visible()).toEqual(['a', 'b']);
  });

  it('highlight draws one box at the top and null clears it', () => {
    const { scenes } = boot([{ id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] }]);
    scenes.highlight({ scene: 'a', node: 'n' });
    const top = scenes.container.children.at(-1)!;
    expect(top.label).toBe('highlight');
    expect(top.visible).toBe(true);
    scenes.highlight(null);
    expect(scenes.container.children.at(-1)!.visible).toBe(false);
  });
});
```

Run: `npm test -w @energy8engine/scenes` → PASS.

- [ ] **Step 8: `src/index.ts` re-exports** `fit`, `transitions`, `node-types`, `builtin`, `scenes`. Commit.

```bash
git add engine/game/scenes package-lock.json
git commit -m "Grow @energy8engine/scenes: node types, built-ins, mounting, show and hide"
```

---

### Task 3: The `scenes1` row, the bundle swap, and the end of `@energy8engine/stage`

**Files:**
- Create: `engine/game/scenes/src/runtime.ts`, `src/schema.ts`
- Modify: `engine/bundles/e8-base/e8.bundle.yml:46-47` (`stage1`/`@energy8engine/stage` → `scenes1`/`@energy8engine/scenes`)
- Modify: `engine/game/reels/package.json:27`, `engine/ide/client/package.json:25` (`@energy8engine/stage` → `@energy8engine/scenes`)
- Delete: `engine/game/stage/` (whole directory), `engine/ide/client/tests/scenes-sidebar.test.tsx` (it imports the stage schema; Task 11 writes the new one)
- Test: `engine/game/scenes/tests/runtime.test.ts`, `tests/schema.test.ts`

**Interfaces:**
- Consumes: Task 2's `createScenes`, `createNodeTypes`, built-ins, `createTransitions`, `cut`, `fade`.
- Produces: `ctx.nodeTypes: NodeTypesService`, `ctx.transitions`, `ctx.assetLoader: AssetLoader`, `ctx.scenes: ScenesService` (provided in that order); `export type ScenesConfig`; `export const Config` schema; row `name = 'scenes'`, `inject = ['renderer']`.

- [ ] **Step 1: Failing tests**

```ts
// engine/game/scenes/tests/schema.test.ts
import { describe, expect, it } from 'vitest';
import { Config } from '../src/schema';

describe('scenes Config', () => {
  it('defaults mode/transition/transitionMs and marks design as restart', () => {
    const v = Config({ design: { width: 480, height: 288 } });
    expect(v).toEqual({ design: { width: 480, height: 288 }, mode: 'contain', transition: 'cut', transitionMs: 300 });
    const json = JSON.parse(JSON.stringify(Config)) as { refs: Record<string, any>; uid: number };
    const text = JSON.stringify(json);
    expect(text).toContain('"applies":"restart"');
  });
  it('refuses a non-natural design size and an unknown mode', () => {
    expect(() => Config({ design: { width: -1, height: 1 } })).toThrow();
    expect(() => Config({ design: { width: 1, height: 1 }, mode: 'stretch' })).toThrow();
  });
});
```

```ts
// engine/game/scenes/tests/runtime.test.ts
import { describe, expect, it, vi } from 'vitest';
import { Container } from 'pixi.js';
import { Context } from 'cordis';
import * as runtime from '../src/runtime';

const fetchOk = (body: unknown) => vi.fn(async () => ({ ok: true, json: async () => body })) as unknown as typeof fetch;

function boot(fetchFn = fetchOk({ scenes: [{ id: 'a', nodes: [{ id: 'n', type: 'container', props: {} }] }], diagnostics: [], nodeTypes: [] })) {
  const ctx = new Context();
  const app = { stage: new Container(), ticker: null };
  ctx.provide('renderer', { app });
  const fiber = ctx.plugin(runtime, { design: { width: 100, height: 50 }, fetchFn });
  return { ctx, app, fiber };
}

describe('scenes row', () => {
  it('provides nodeTypes, transitions, assetLoader, scenes; fetches /api/scenes and mounts', async () => {
    const { ctx, app, fiber } = boot();
    await fiber;
    expect(ctx.get('nodeTypes')!.list().map((t) => t.type).sort()).toEqual(['container', 'image', 'scene']);
    expect(ctx.get('transitions')!.ids()).toEqual(['cut', 'fade']);
    await vi.waitFor(() => expect(ctx.get('scenes')!.docs().has('a')).toBe(true));
    expect(app.stage.children).toContain(ctx.get('scenes')!.container);
  });

  it('a failed GET is one error diagnostic through ctx.diagnostics, and the row still applies', async () => {
    const report = vi.fn();
    const { ctx, fiber } = boot(vi.fn(async () => { throw new Error('down'); }) as unknown as typeof fetch);
    ctx.provide('diagnostics', { report });
    await fiber;
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(expect.objectContaining({ plugin: 'scenes', where: '/api/scenes' })));
    expect(ctx.get('scenes')).toBeDefined();
  });

  it('disposing the fiber detaches the design root without destroying foreign views', async () => {
    const { ctx, app, fiber } = boot();
    await fiber;
    const foreign = new Container();
    ctx.get('nodeTypes')!.register({ type: 'foreign', schema: (await import('schemastery')).default.object({}), mount: () => foreign, unmount: (v) => v.parent?.removeChild(v) });
    ctx.get('scenes')!.replace([{ id: 'a', nodes: [{ id: 'f', type: 'foreign', props: {} }] }]);
    await fiber.dispose();
    expect(app.stage.children).toEqual([]);
    expect(foreign.destroyed).toBe(false);
  });
});
```

Run: `npm test -w @energy8engine/scenes -- runtime schema` → FAIL (modules missing).

- [ ] **Step 2: `schema.ts`**

```ts
import Schema from 'schemastery';
const restart = { applies: 'restart' };
export const Config = Schema.object({
  design: Schema.object({
    width: Schema.natural().description('design width, px').extra('extra', restart),
    height: Schema.natural().description('design height, px').extra('extra', restart),
  }).description('design resolution'),
  mode: Schema.union(['contain', 'cover']).default('contain').description('how the design fits the viewport'),
  transition: Schema.string().default('cut').description('default transition id for show()'),
  transitionMs: Schema.natural().default(300).description('transition length, ms'),
});
```

- [ ] **Step 3: `runtime.ts`**

```ts
import type { Context } from 'cordis';
import { Assets, type Container } from 'pixi.js';
import { diagnostic, type Diagnostic, type ScenesResponse } from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import type { PixiRenderer } from '@energy8engine/renderer-pixi';
import { container, image, scene, type AssetLoader } from './builtin';
import { createNodeTypes, type NodeTypesService } from './node-types';
import { createScenes, type ScenesService } from './scenes';
import { createTransitions, cut, fade, type TickerLike, type TransitionsService } from './transitions';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
    nodeTypes: NodeTypesService;
    transitions: TransitionsService;
    assetLoader: AssetLoader;
    scenes: ScenesService;
  }
}

export interface ScenesConfig {
  design: { width: number; height: number };
  mode?: 'contain' | 'cover';
  transition?: string;
  transitionMs?: number;
  /** Tests only; the page's `fetch` otherwise. */
  fetchFn?: typeof fetch;
}

export const name = 'scenes';
export const inject = ['renderer'];

/** `pixi.js`' `Assets`, project-relative paths served same-origin by the dev server. */
const pixiLoader: AssetLoader = {
  load: async (urls) => { await Assets.load(urls.map((u) => `/${u}`)); },
  unload: async (urls) => { await Assets.unload(urls.map((u) => `/${u}`)); },
  get: (url) => Assets.get(`/${url}`),
};

export function apply(ctx: Context, config: ScenesConfig): void {
  const report = (d: Diagnostic) =>
    (ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(d);
  const nodeTypes = createNodeTypes();
  for (const t of [container, image, scene]) nodeTypes.register(t);
  ctx.provide('nodeTypes', nodeTypes);
  const transitions = createTransitions(report);
  transitions.register(cut);
  transitions.register(fade);
  ctx.provide('transitions', transitions);
  ctx.provide('assetLoader', pixiLoader);
  const app = ctx.renderer.app as { stage: Container; ticker?: TickerLike };
  const scenes = createScenes({
    root: app.stage,
    design: config.design,
    mode: config.mode,
    transition: config.transition,
    transitionMs: config.transitionMs,
    transitions,
    nodeTypes,
    loader: pixiLoader,
    ticker: app.ticker ?? null,
    ctx,
    report,
  });
  ctx.effect(() => () => scenes.destroy(), 'scenes:root');
  ctx.provide('scenes', scenes);

  const fetchFn = config.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  void (async () => {
    try {
      const res = await fetchFn('/api/scenes');
      if (!res.ok) throw new Error(`the host answered ${res.status}`);
      const body = (await res.json()) as Partial<ScenesResponse>;
      if (!Array.isArray(body.scenes)) throw new Error('the response has no "scenes" array');
      scenes.replace(body.scenes);
    } catch (error) {
      report(diagnostic('error', 'scenes', '/api/scenes',
        `could not read the scene documents: ${error instanceof Error ? error.message : String(error)}`,
        'the host serves this route; the game shows no scene until it answers'));
    }
  })();
}
```

`ctx.provide('assetLoader', …)` must come before `scenes` so `image.mount` can read it. Where `PixiRenderer.app` is typed, keep the cast exactly as `stage/runtime.ts` had it. Note `Assets.load` of a list resolves to a record — the loader ignores it.

- [ ] **Step 4: Run** `npm test -w @energy8engine/scenes` → PASS.

- [ ] **Step 5: Bundle, package refs, delete stage**

`engine/bundles/e8-base/e8.bundle.yml`: `- id: scenes1` / `name: '@energy8engine/scenes'` in place of `stage1` (same position, after `renderer1`). `engine/game/reels/package.json` and `engine/ide/client/package.json`: rename the dep. `git rm -r engine/game/stage engine/ide/client/tests/scenes-sidebar.test.tsx`. `npm install`. In `engine/game/reels/src/runtime.ts` replace `import type { Stage } from '@energy8engine/stage'` with nothing for now (Task 4 rewrites the file; make the typecheck pass by deleting the import and the `ctx.inject(['stage'], …)` block, leaving the board provided and unmounted). Update `engine/game/reels/tests/runtime.test.ts` in the same way: remove `stageRuntime` import, `fakeStage`, and the two mount tests (Task 4 writes the replacements).

Run: `npm test -w @energy8engine/reels && npm run typecheck -w @energy8engine/ide-client && npm test -w @energy8engine/game-loader -w @energy8engine/game-runtime` → PASS (the loader/runtime tests use a FAKE `stage1` row name; leave them).

- [ ] **Step 6: Commit**

```bash
git add engine/game/scenes engine/game/reels engine/ide/client engine/bundles package-lock.json
git rm -r -q engine/game/stage
git commit -m "Compose scenes1 from e8-base; retire @energy8engine/stage"
```

---

### Task 4: `reels` registers the `reels` node type

**Files:**
- Modify: `engine/game/reels/src/runtime.ts` (`apply`: drop the `layer` config key and the stage mount; add the registration)
- Modify: `engine/game/reels/src/schema.ts` (remove `layer` if the schema declares it; check `grep -n layer`)
- Test: `engine/game/reels/tests/runtime.test.ts`

**Interfaces:**
- Consumes: `ctx.nodeTypes` (`NodeTypesService`) and `ctx.board` (`ReelsBoard` with `.view: Container`).
- Produces: node type `reels`, schema `{ row: string default 'reels1' }`, `mount` returns `board.view` detached from any parent, `unmount` detaches it.

- [ ] **Step 1: Failing tests** (replace the removed mount tests)

```ts
describe('the reels node type', () => {
  it('registers `reels` once nodeTypes appears, regardless of order; mount hands out the board view; unmount detaches', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(runtime, { config: { grid: { cols: 5, rows: 3 } } });
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const type = nodeTypes.get('reels')!;
    const parent = new Container();
    parent.addChild(ctx.get('board')!.view);
    const view = type.mount({ row: 'reels1' }, ctx);
    expect(view).toBe(ctx.get('board')!.view);
    expect(view.parent).toBeNull();
    const holder = new Container();
    holder.addChild(view);
    type.unmount!(view);
    expect(view.parent).toBeNull();
    expect(view.destroyed).toBe(false);
  });

  it('a hot re-apply registers again (a new board) and the disposer takes the old registration back', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    const nodeTypes = createNodeTypes();
    ctx.provide('nodeTypes', nodeTypes);
    const fiber = ctx.plugin(runtime, { config: { grid: { cols: 5, rows: 3 } } });
    await fiber;
    await vi.waitFor(() => expect(nodeTypes.get('reels')).toBeDefined());
    const first = nodeTypes.get('reels')!;
    await fiber.update({ config: { grid: { cols: 3, rows: 3 } } });
    await vi.waitFor(() => expect(nodeTypes.get('reels')).not.toBe(first));
    await fiber.dispose();
    expect(nodeTypes.get('reels')).toBeUndefined();
  });
});
```

Import `createNodeTypes` from `@energy8engine/scenes` (already a dep after Task 3). Run → FAIL.

- [ ] **Step 2: Implement** — replace the `ctx.inject(['stage'], …)` block with:

```ts
  // The board reaches the screen only through a `reels` scene node
  // (`@energy8engine/scenes`): registered whenever `nodeTypes` is on the
  // context, again on a hot re-apply (a new board), taken back on dispose.
  ctx.inject(['nodeTypes'], (typesCtx) => {
    typesCtx.effect(
      () =>
        typesCtx.nodeTypes.register({
          type: 'reels',
          schema: Schema.object({ row: Schema.string().default('reels1').description('the reels row this node shows') }),
          mount: () => {
            board.view.parent?.removeChild(board.view);
            return board.view;
          },
          unmount: (view) => {
            view.parent?.removeChild(view);
          },
        }),
      'reels:node-type',
    );
  });
```

Add `import Schema from 'schemastery'` and `import type {} from '@energy8engine/scenes/runtime'` (for the `nodeTypes` context augmentation). Update the module doc's mount paragraph; drop `layer` from the config type and the schema. Run `npm test -w @energy8engine/reels` → PASS.

- [ ] **Step 3: Commit** `git add engine/game/reels && git commit -m "Mount the reels board through a scene node, not a stage layer"`.

---

### Task 5: `ide-bridge` — scenes in, node types out

**Files:**
- Modify: `engine/game/ide-bridge/src/index.ts` (the second `message` listener; the transitions-forwarding block gets a twin)
- Test: `engine/game/ide-bridge/tests/index.test.ts`

**Interfaces:**
- Consumes: `ctx.scenes` (`replace`, `show`, `highlight`), `ctx.nodeTypes` (`list`, `subscribe`), read leniently; `ScenesMessage`, `SceneSelectMessage`, `NodeTypesMessage`.
- Produces: outgoing `{ type: 'node-types', types: [{ type, schema: JSON.parse(JSON.stringify(t.schema)) }] }` on open, on provide, on registry change.

- [ ] **Step 1: Failing tests** — next to the existing `scene-preview`/`game-transitions` tests, using the same fake socket helpers that file already has:

```ts
it('a `scenes` frame replaces the documents; `scene-select` highlights; `scene-preview` shows', async () => {
  const scenes = { replace: vi.fn(), show: vi.fn(async () => {}), highlight: vi.fn() };
  const { ctx, socket } = await bootWithSocket(); // the file's existing helper that yields the fake socket
  ctx.provide('scenes', scenes);
  socket.receive({ type: 'scenes', scenes: [{ id: 'a', nodes: [] }], diagnostics: [] });
  expect(scenes.replace).toHaveBeenCalledWith([{ id: 'a', nodes: [] }]);
  socket.receive({ type: 'scene-select', scene: 'a', node: 'n' });
  expect(scenes.highlight).toHaveBeenCalledWith({ scene: 'a', node: 'n' });
  socket.receive({ type: 'scene-select', scene: 'a', node: null });
  expect(scenes.highlight).toHaveBeenCalledWith(null);
  socket.receive({ type: 'scene-preview', scene: 'a' });
  expect(scenes.show).toHaveBeenCalledWith('a');
});

it('reports node-types on open, again when the registry changes, and again when nodeTypes is re-provided', async () => {
  const { ctx, socket, sent } = await bootWithSocket();
  const nodeTypes = createNodeTypes();
  nodeTypes.register({ type: 'container', schema: Schema.object({}), mount: () => new Container() });
  ctx.provide('nodeTypes', nodeTypes);
  await vi.waitFor(() => expect(sent().filter((m) => m.type === 'node-types')).toHaveLength(1));
  expect(sent().at(-1)).toEqual({ type: 'node-types', types: [{ type: 'container', schema: expect.objectContaining({ uid: expect.any(Number) }) }] });
  nodeTypes.register({ type: 'image', schema: Schema.object({ src: Schema.string() }), mount: () => new Container() });
  expect(sent().filter((m) => m.type === 'node-types')).toHaveLength(2);
});
```

Adapt helper names to what the file already has (read it: `attachDiagnosticsForwarding` tests build a fake `WebSocketLike` with `readyState`, `send`, `addEventListener`; reuse that shape). Run → FAIL.

- [ ] **Step 2: Implement**

In the second listener, widen the type filter to `game-composition | scene-preview | scenes | scene-select`; branches:

```ts
    const scenes = ctx.reflect.get('scenes', false) as
      { replace?(docs: unknown[]): void; show?(id: string): Promise<void>; highlight?(ref: { scene: string; node: string } | null): void } | undefined;
    if (message.type === 'scene-preview') { if (scenes?.show) void scenes.show(message.scene); return; }
    if (message.type === 'scenes') { if (scenes?.replace && Array.isArray(message.scenes)) scenes.replace(message.scenes); return; }
    if (message.type === 'scene-select') {
      if (scenes?.highlight) scenes.highlight(message.node === null ? null : { scene: message.scene, node: message.node });
      return;
    }
```

Then duplicate the transitions-forwarding block for `nodeTypes` (`currentNodeTypes`, `forwardNodeTypes` sending `{ type: 'node-types', types: list().map((t) => ({ type: t.type, schema: JSON.parse(JSON.stringify(t.schema)) })) }`, `subscribeNodeTypes`, the `ctx.inject(['nodeTypes'])` re-arm, and an effect that unsubscribes). Keep the `stage` word out of the comments. Run → PASS.

- [ ] **Step 3: Commit** `git add engine/game/ide-bridge && git commit -m "Bridge scenes into the game and node types out of it"`.

---

### Task 6: Host `rpc` — `node-types` mirror, two broadcasts, preview accept list

**Files:**
- Modify: `engine/ide/host/src/plugins/rpc.ts` (service interface + impl; message handler; greeting; project-switch clear)
- Modify: `engine/ide/host/src/plugins/dev-game.ts:247` (`accept: ['game-diagnostics', 'game-transitions', 'node-types']`)
- Test: `engine/ide/host/tests/rpc.test.ts`

**Interfaces:**
- Produces on `IdeRpcService`: `nodeTypes(): NodeTypeInfo[]`; `broadcastScenes(frame: Omit<ScenesMessage, 'type'>): void`; `broadcastSceneSelect(frame: Omit<SceneSelectMessage, 'type'>): void`; event `ctx.emit('game/node-types', types)` when a fresh list lands.

- [ ] **Step 1: Failing tests** — mirror the existing `game-transitions` tests in `rpc.test.ts` (find them with `grep -n "game-transitions" engine/ide/host/tests/rpc.test.ts`); add:

```ts
it('mirrors node-types from one socket to the others, greets a late socket with it, and clears on project switch', async () => {
  // same setup as the game-transitions test: host + two sockets a, b
  a.send(JSON.stringify({ type: 'node-types', types: [{ type: 'image', schema: { uid: 1 } }] }));
  await expect.poll(() => bFrames.some((f) => f.type === 'node-types')).toBe(true);
  expect(host.ctx.ideRpc.nodeTypes()).toEqual([{ type: 'image', schema: { uid: 1 } }]);
  const c = await connect();
  await expect.poll(() => cFrames).toContainEqual({ type: 'node-types', types: [{ type: 'image', schema: { uid: 1 } }] });
  host.ctx.emit('workspace/changed', { ...host.ctx.workspace.state(), active: null }); // as the transitions test does it
  await expect.poll(() => host.ctx.ideRpc.nodeTypes()).toEqual([]);
});

it('broadcastScenes and broadcastSceneSelect reach every socket', async () => {
  host.ctx.ideRpc.broadcastScenes({ scenes: [{ id: 'a', nodes: [] }], diagnostics: [] });
  host.ctx.ideRpc.broadcastSceneSelect({ scene: 'a', node: null });
  await expect.poll(() => aFrames.map((f) => f.type)).toEqual(expect.arrayContaining(['scenes', 'scene-select']));
});
```

Run: `npm test -w @energy8engine/ide-host -- rpc` → FAIL.

- [ ] **Step 2: Implement** — `let lastNodeTypes: NodeTypeInfo[] = []`; in the message filter allow `'node-types'`; handler validates `Array.isArray(message.types) && every(t => typeof t.type === 'string')`, stores, relays to others, `ctx.emit('game/node-types', [...lastNodeTypes])`; greeting sends when non-empty; the switch block resets to `[]` and also sends `{ type: 'game-transitions', ids: [] }` and `{ type: 'node-types', types: [] }` to every socket (closes slice-16 debt 2). Declare the event in the `Events` augmentation next to `files/written`'s. Run → PASS.

- [ ] **Step 3: Commit** `git add engine/ide/host && git commit -m "Mirror the game's node types on the host, and clear the mirrors on a project switch"`.

---

### Task 7: Host `scenes` plugin — read, check, routes, broadcast

**Files:**
- Rewrite: `engine/ide/host/src/plugins/scenes.ts`
- Modify: `engine/ide/host/src/plugins/dev-game.ts` (after `ctx.runtimeAssets.attachGameRoutes(preview)`: `ctx.get('scenesHost')?.attachGameRoutes(preview)`)
- Create fixtures: `engine/ide/host/tests/fixtures/project-scenes/` = copy of `project-e8-base` plus `scenes/base_game.scene.yml`, `scenes/big_win.scene.yml`, `scenes/bad.scene.yml` (`id: other` + a `spine` node + a `scene: nowhere` node + `image` with `src: missing.png`), `assets/bg.png` (any 1×1 PNG), and `e8.patch.yml` with a `scenes1` row (design only) — check what `project-e8-base`'s patch holds and keep its other rows.
- Test: `engine/ide/host/tests/scenes.test.ts` (rewrite; keep the `preview` route tests)

**Interfaces:**
- Consumes: `ctx.files` (`tree`, `read`, `write`, `remove`), `ctx.ideRpc` (`reportGameDiagnostics`, `broadcastScenes`, `broadcastSceneSelect`, `broadcastScenePreview`, `nodeTypes`), `ctx.project.composition.rows` (to warn when a reels row exists and no scene has a `reels` node), events `files/written`, `files/removed`, `game/node-types`.
- Produces: `export function checkScenes(docs: ParsedDoc[], nodeTypes: NodeTypeInfo[], hasFile: (path: string) => boolean, hasReelsRow: boolean): Diagnostic[]`; service `scenesHost: { attachGameRoutes(server): void; state(): ScenesResponse }`; routes per spec §6; `plugin: 'scenes'` diagnostics with `where` = `<scene>` or `<scene>/<node>`.

- [ ] **Step 1: Failing unit tests for `checkScenes`**

```ts
const types = [{ type: 'container', schema: JSON.parse(JSON.stringify(Schema.object({}))) }, { type: 'image', schema: JSON.parse(JSON.stringify(Schema.object({ src: Schema.string().required() }))) }, { type: 'scene', schema: JSON.parse(JSON.stringify(Schema.object({ scene: Schema.string().required() }))) }, { type: 'reels', schema: JSON.parse(JSON.stringify(Schema.object({ row: Schema.string().default('reels1') }))) }];
const doc = (id: string, nodes: SceneNode[], file = `scenes/${id}.scene.yml`) => ({ file, doc: { id, nodes } });

describe('checkScenes', () => {
  it('is silent on a clean pair of documents', () => {
    expect(checkScenes([doc('base', [{ id: 'bg', type: 'image', props: { src: 'assets/bg.png' } }, { id: 'r', type: 'reels', props: {} }, { id: 'bw', type: 'scene', props: { scene: 'big' } }]), doc('big', [])], types, (p) => p === 'assets/bg.png', true)).toEqual([]);
  });
  it('id ≠ basename is a warning; duplicate node id, unknown type, missing scene, cycle, missing file, bad props are errors', () => {
    const out = checkScenes([
      doc('other', [{ id: 'a', type: 'container', props: {} }, { id: 'a', type: 'spine', props: {} }, { id: 'b', type: 'scene', props: { scene: 'nowhere' } }, { id: 'c', type: 'image', props: { src: 'missing.png' } }, { id: 'd', type: 'image', props: {} }], 'scenes/bad.scene.yml'),
      doc('x', [{ id: 'toY', type: 'scene', props: { scene: 'y' } }]),
      doc('y', [{ id: 'toX', type: 'scene', props: { scene: 'x' } }]),
    ], types, () => false, false);
    const wheres = out.map((d) => `${d.severity}:${d.where}`);
    expect(wheres).toEqual(expect.arrayContaining(['warning:bad', 'error:bad/a', 'error:bad/a', 'error:bad/b', 'error:bad/c', 'error:bad/d', 'error:x/toY']));
  });
  it('unknown types are not reported until the game has reported its node types', () => {
    expect(checkScenes([doc('a', [{ id: 'n', type: 'spine', props: {} }])], [], () => true, false)).toEqual([]);
  });
  it('a reels row with no reels node anywhere is a warning', () => {
    expect(checkScenes([doc('a', [])], types, () => true, true)).toEqual([expect.objectContaining({ severity: 'warning', where: 'reels1' })]);
  });
});
```

Where `bad` is the basename of `scenes/bad.scene.yml`, the lookup key, and the scene mentioned in `where` (the rule: `where` uses the basename). The cycle check reports the first node that closes a cycle only once per cycle (`x/toY` here; `y/toX` may also appear — assert `arrayContaining`).

- [ ] **Step 2: Failing route tests** (use `e8BaseWorkspace()`-style copy of `project-scenes`):

```ts
describe('/api/scenes', () => {
  it('GET lists the parsed documents (basename as id) with diagnostics and the node types the game reported', async () => {
    host = await createIdeHost({ root: scenesWorkspace(), port: 0 });
    const body = (await (await fetch(`${host.url}/api/scenes`)).json()) as ScenesResponse;
    expect(body.scenes.map((s) => s.id).sort()).toEqual(['bad', 'base_game', 'big_win']);
    expect(body.diagnostics).toContainEqual(expect.objectContaining({ where: 'bad' }));
    expect(body.nodeTypes).toEqual([]);
  });
  it('PUT writes YAML, answers the refreshed set, broadcasts `scenes`; body id must match', async () => { /* PUT /api/scenes/base_game with a new node; read scenes/base_game.scene.yml from disk; expect a `scenes` frame on a root socket; PUT with id 'other' → 400 */ });
  it('POST creates scenes/<id>.scene.yml with nodes: []; refuses an existing id or a bad one', async () => { /* POST {id:'intro'} → 200 and the file exists; again → 400 with `exists`; {id:'Bad Name'} → 400 */ });
  it('DELETE removes the file and broadcasts', async () => {});
  it('a write through /api/files under scenes/ re-reads and broadcasts too', async () => { /* PUT /api/files/scenes/big_win.scene.yml raw YAML; poll for a `scenes` frame */ });
  it('POST /api/scenes/select broadcasts scene-select', async () => {});
});
```

Fill the bodies following the existing `preview` tests' shape (host + `Server` fiber + `ws`). Run → FAIL.

- [ ] **Step 3: Implement `scenes.ts`**

Skeleton (the implementer fills in the marked bodies exactly as the tests demand):

```ts
export const name = 'scenes';
export const inject = ['server', 'ideRpc', 'project', 'files'];

const SCENE_FILE = /^scenes\/([a-z0-9_]+)\.scene\.yml$/;
const ID = /^[a-z0-9_]+$/;

export interface ParsedDoc { file: string; doc: SceneDoc; }

export function checkScenes(docs, nodeTypes, hasFile, hasReelsRow): Diagnostic[] { … }

async function readAll(files: FilesService): Promise<{ docs: ParsedDoc[]; diagnostics: Diagnostic[] }> {
  // tree() → entries matching SCENE_FILE → read → yaml.load → shape check
  // ({ id: string, nodes: array of { id: string, type: string, props?: object, children?: array }})
  // A file that does not parse or has the wrong shape: error diagnostic where=<basename>, skipped.
  // The doc's `id` is REPLACED by the basename after the mismatch warning is recorded by checkScenes.
}

export function apply(ctx: Context): void {
  let state: ScenesResponse = { scenes: [], diagnostics: [], nodeTypes: [] };
  const refresh = async (broadcast: boolean) => {
    const tree = await ctx.files.tree();
    const paths = new Set(tree.entries.map((e) => e.path));   // FileTreeResponse { entries: FileEntry[]; diagnostics }
    const { docs, diagnostics } = await readAll(ctx.files);
    const hasReelsRow = ctx.project.composition.rows.some((r) => r.name === '@energy8engine/reels' || r.id === 'reels1');
    const found = [...diagnostics, ...checkScenes(docs, ctx.ideRpc.nodeTypes(), (p) => paths.has(p), hasReelsRow)];
    state = { scenes: docs.map((d) => d.doc), diagnostics: found, nodeTypes: ctx.ideRpc.nodeTypes() };
    ctx.ideRpc.reportGameDiagnostics('scenes', found);
    if (broadcast) ctx.ideRpc.broadcastScenes({ scenes: state.scenes, diagnostics: found });
  };
  void refresh(false);
  ctx.on('files/written', () => void refresh(true));
  ctx.on('files/removed', () => void refresh(true));
  ctx.on('game/node-types', () => void refresh(true));

  const get = (_req, res) => res.json(state);
  const put = async (req, res) => { /* parse body, id check, yaml.dump({ id, nodes }), ctx.files.write(path, bytes) (emits files/written → refresh) , then await refresh(false) and res.json(state) */ };
  const post = async (req, res) => { /* { id } → ID check, exists check (paths), files.write with 'id: <id>\nnodes: []\n' */ };
  const del = async (req, res) => { /* files.remove(`scenes/${id}.scene.yml`) */ };
  const select = async (req, res) => { /* { scene: string, node: string|null } → broadcastSceneSelect; 400 otherwise */ };
  ctx.server.get('/api/scenes', get);
  ctx.server.put('/api/scenes/:id', put);
  ctx.server.post('/api/scenes', post);
  ctx.server.delete('/api/scenes/:id', del);
  ctx.server.post('/api/scenes/select', select);
  ctx.server.post('/api/scenes/preview', /* unchanged */);
  ctx.provide('scenesHost', { attachGameRoutes: (server) => server.get('/api/scenes', get), state: () => state });
}
```

Route order matters on this server: register `/api/scenes/preview` and `/api/scenes/select` BEFORE `/api/scenes/:id` if the router matches in order (measure: `curl -X POST /api/scenes/select` must not hit `:id`; if it does, reorder). Refusals answer `400 { diagnostics: [...] }` in the `DiagnosticsResponse` shape the existing preview route uses. `ctx.server.delete` — verify the server exposes `delete` (grep `files.ts` for how `DELETE /api/files` is registered and copy).

- [ ] **Step 4: Run** `npm test -w @energy8engine/ide-host` → PASS (scenes + rpc + everything else; `runtime-assets.test.ts` may mention `stage1` in a comment only).

- [ ] **Step 5: Commit** `git add engine/ide/host && git commit -m "Read, check and serve the scene documents from the host"`.

---

### Task 8: Template and example project

**Files:**
- Create: `engine/templates/slot-basic/scenes/base_game.scene.yml`, `scenes/big_win.scene.yml`; the same two under `engine/examples/first-slot/`
- Modify: `engine/templates/slot-basic/e8.patch.yml`, `engine/examples/first-slot/e8.patch.yml` (`git checkout -- engine/examples/first-slot/e8.patch.yml engine/examples/first-slot/package.json` FIRST — the working tree carries the user's manual edits; this task replaces them)
- Modify: `engine/templates/slot-basic/package.json`, `engine/examples/first-slot/package.json` (`@energy8engine/scenes` dep replaces nothing — `stage` came from the bundle; ADD `"@energy8engine/scenes": "*"` next to `reels`)
- Modify: `engine/templates/slot-basic/src/main.ts` then `cp` over `engine/examples/first-slot/src/main.ts`
- Modify: `engine/ide/host/tests/template.test.ts` (top-level list gains `'scenes'`; a test that the two scene files are byte-identical to first-slot's)
- Modify: `engine/templates/slot-basic/README.md` (one paragraph: scenes live in `scenes/`)

- [ ] **Step 1: Scene files**

```yaml
# scenes/base_game.scene.yml
id: base_game
nodes:
  - id: board
    type: reels
    props: { row: reels1 }
  - id: big_win
    type: scene
    props: { scene: big_win, visible: false }
```

```yaml
# scenes/big_win.scene.yml
id: big_win
nodes:
  - id: banner
    type: container
    props: { x: 240, y: 144 }
```

`e8.patch.yml` (both): the `stage1` row becomes

```yaml
  - id: scenes1
    config:
      design:
        width: 480
        height: 288
```

- [ ] **Step 2: `main.ts`** — replace the slice-16 block in `presentStage`:

```ts
  // Scenes (slice 17, the temporary rule until the flow editor drives the
  // game): show the scene named after this spin stage when one exists.
  // Read leniently — a composition without a scenes row presents as before.
  const scenes = ctx.reflect.get('scenes', false) as
    { show?(id: string): Promise<void>; docs?(): ReadonlyMap<string, unknown> } | undefined;
  if (scenes?.show && scenes.docs?.().has(stage)) await scenes.show(stage);
```

and in `window.__e8` replace `sceneCurrent`/`layerVisible` with:

```ts
  /** Visible top-level scenes, as `scenes.visible()`; `[]` with no scenes row. */
  scenesVisible(): string[] {
    return (ctx.reflect.get('scenes', false) as { visible?(): string[] } | undefined)?.visible?.() ?? [];
  },
  /** Whether a node of a mounted top-level scene is visible; `null` when there is no such node. */
  nodeVisible(scene: string, node: string): boolean | null {
    const s = ctx.reflect.get('scenes', false) as { view?(ref: { scene: string; node: string }): { visible: boolean } | undefined } | undefined;
    const v = s?.view?.({ scene, node });
    return v ? v.visible : null;
  },
```

`cp engine/templates/slot-basic/src/main.ts engine/examples/first-slot/src/main.ts`.

- [ ] **Step 3: `template.test.ts`** — the ten-files list becomes eleven with `'scenes'` between `'package.json'` and `'src'`; extend the byte-identical loop with `'scenes/base_game.scene.yml'`, `'scenes/big_win.scene.yml'`. Run `npm test -w @energy8engine/ide-host -- template` → PASS.

- [ ] **Step 4: Boot check** — `cd engine/examples && node ../apps/cli/bin/e8.mjs` (only if 5679 is free), open `http://127.0.0.1:5681/`, press spin: the board renders, `__e8.scenesVisible()` is `['base_game']`. Stop the host you started. Record in the report.

- [ ] **Step 5: Commit**

```bash
git add engine/templates/slot-basic engine/examples/first-slot/scenes engine/examples/first-slot/e8.patch.yml engine/examples/first-slot/package.json engine/examples/first-slot/src/main.ts engine/ide/host/tests/template.test.ts
git commit -m "Give the template two scenes and show the spin stage's scene"
```

---

### Task 9: Client — `connection.onFrame` and the right sidebar

**Files:**
- Modify: `engine/ide/client/src/plugins/connection.ts` (`ConnectionService.onFrame`; the socket handler calls the listeners with EVERY object-shaped frame before its own type filter)
- Modify: `engine/ide/client/src/plugins/shell.tsx` (`slots.sideRight`, `sideRight()`, `showSideRight`, `hideSideRight`, `useShell().sideRight`)
- Modify: `engine/ide/client/src/shell/Shell.tsx` (fourth column), `engine/ide/client/src/styles.css`
- Test: `engine/ide/client/tests/connection.test.ts` (one case), `engine/ide/client/tests/shell.test.tsx` (three cases)

**Interfaces:**
- Produces: `ConnectionService.onFrame(listener: (frame: ServerMessage) => void): () => void`; `ShellService.slots.sideRight: 'shell.sideRight'`, `sideRight(): string | undefined`, `showSideRight(key: string): void`, `hideSideRight(): void`; `useShell` returns `sideRight`; DOM `data-testid="side-right"` holding `data-testid="side-right-<key>"`; class `e8-side-right-collapsed` on `.e8-shell` when hidden or unregistered.

- [ ] **Step 1: Failing tests**

```ts
// connection.test.ts
it('onFrame hears every well-formed frame, including types the service itself ignores', async () => {
  const { ctx, socket } = await boot(); // the file's own fake-socket boot
  const heard: string[] = [];
  const off = ctx.connection.onFrame((f) => heard.push(f.type));
  socket.receive({ type: 'scenes', scenes: [], diagnostics: [] });
  socket.receive('not json');
  socket.receive({ type: 'snapshot', snapshot: { rows: [], diagnostics: [] } });
  expect(heard).toEqual(['scenes', 'snapshot']);
  off();
  socket.receive({ type: 'scenes', scenes: [], diagnostics: [] });
  expect(heard).toHaveLength(2);
});
```

```tsx
// shell.test.tsx
describe('right sidebar', () => {
  it('is collapsed with nothing registered, shows a registered contribution on showSideRight, hides on hideSideRight', async () => {
    const { ctx } = await bootShell();
    render(<Shell ctx={ctx} />);
    expect(screen.getByTestId('shell').className).toContain('e8-side-right-collapsed');
    ctx.slots.register({ name: 'shell.sideRight', key: 'props', title: 'Properties' }, () => <p>props here</p>);
    act(() => ctx.shell.showSideRight('props'));
    expect(screen.getByTestId('side-right-props')).toHaveTextContent('props here');
    expect(screen.getByTestId('shell').className).not.toContain('e8-side-right-collapsed');
    act(() => ctx.shell.hideSideRight());
    expect(screen.queryByTestId('side-right-props')).toBeNull();
  });
  it('a retracted contribution collapses the region even while its key is shown', async () => {
    const { ctx } = await bootShell();
    render(<Shell ctx={ctx} />);
    const off = ctx.slots.register({ name: 'shell.sideRight', key: 'props', title: 'Properties' }, () => <p>x</p>);
    act(() => ctx.shell.showSideRight('props'));
    act(() => off());
    expect(screen.getByTestId('shell').className).toContain('e8-side-right-collapsed');
  });
});
```

Use the helpers `shell.test.tsx` already has for booting a ctx with `slots` + `shell`. Run → FAIL.

- [ ] **Step 2: Implement**

`connection.ts`: `const frameListeners = new Set<(f: ServerMessage) => void>()`; in the handler, after the `parsed === null || …` guard and BEFORE the type filter: `for (const l of frameListeners) l(parsed as ServerMessage);` (wrap in try/catch per listener; a listener throw becomes `ctx.connection.report`-style diagnostic `plugin: 'connection'`). `onFrame(l) { frameListeners.add(l); return () => frameListeners.delete(l); }`.

`shell.tsx`: `SLOT_NAMES.sideRight = 'shell.sideRight'`; `let sideRightKey: string | undefined`; `sideRight: () => sideRightKey`, `showSideRight(key) { sideRightKey = key; notify(); }`, `hideSideRight() { sideRightKey = undefined; notify(); }`; `useShell` reads it.

`Shell.tsx`: `const sideRightEntry = sideRight === undefined ? undefined : ctx.slots.list<SlotMeta & SidebarMeta>(ctx.shell.slots.sideRight).find((e) => e.key === sideRight)`; className gains `e8-side-right-collapsed` when `!sideRightEntry`; after `.e8-editors`' closing tag (still inside the grid) add

```tsx
      <aside className="e8-side-right" data-testid="side-right">
        {sideRightEntry ? (
          <div data-testid={`side-right-${sideRight}`}>
            <sideRightEntry.component ctx={ctx} />
          </div>
        ) : null}
      </aside>
```

`styles.css`: `--e8-side-right-w: 280px;` next to `--e8-sidebar-w`; `.e8-shell` columns become `var(--e8-activity-w) var(--e8-sidebar-w) minmax(0, 1fr) var(--e8-side-right-w)`; areas `'activity sidebar editors right' 'activity sidebar panel right' 'status status status status'`; `.e8-side-right { grid-area: right; overflow: auto; border-left: 1px solid var(--e8-border); background: var(--e8-sidebar-bg); }` (use whatever token `.e8-sidebar` uses — read it); `.e8-shell.e8-side-right-collapsed { grid-template-columns: … 0; } .e8-shell.e8-side-right-collapsed .e8-side-right { display: none; }`. Mind the existing `.e8-sidebar-collapsed` rule sets ALL columns — when both classes apply, the last rule must still zero both; write one combined rule `.e8-shell.e8-sidebar-collapsed.e8-side-right-collapsed { grid-template-columns: calc(var(--e8-activity-w) + var(--e8-gap)) 0 minmax(0, 1fr) 0; }`.

Run `npm test -w @energy8engine/ide-client` → PASS.

- [ ] **Step 3: Commit** `git add engine/ide/client && git commit -m "Hear every frame on the connection; give the shell a right sidebar"`.

---

### Task 10: Client `scenes` service

**Files:**
- Rewrite: `engine/ide/client/src/plugins/scenes.tsx` (the service and the activity registration only; Tasks 11–13 add the sidebar, viewer and side-right registrations to this file — no placeholder views)
- Modify: `engine/ide/client/src/context.ts` (`ctx.plugin(scenes, config)` — pass the same `config` `gameComposition` gets, for `fetchFn`/`origin`)
- Modify: `engine/ide/client/src/index.ts` (export `ScenesService` type, `useScenes`)
- Test: `engine/ide/client/tests/scenes-service.test.tsx`

**Interfaces:**
- Consumes: `ctx.connection.onFrame`, `ctx.shell` (`openPath`, `showSideRight`, `hideSideRight`, `subscribe`, `active`), `ctx.slots`, `ctx.viewers`.
- Produces:

```ts
export interface SceneSelection { scene: string; node: string | null }
export interface ScenesService {
  docs(): readonly SceneDoc[];
  diagnostics(): readonly Diagnostic[];
  nodeTypes(): readonly NodeTypeInfo[];
  selected(): SceneSelection | null;
  select(sel: SceneSelection | null): void;           // POSTs /api/scenes/select; null clears (POST with the last scene, node null)
  create(id: string): Promise<Diagnostic[]>;            // [] on success; refusals as diagnostics
  remove(id: string): Promise<Diagnostic[]>;
  update(doc: SceneDoc): Promise<Diagnostic[]>;
  preview(id: string): Promise<Diagnostic[]>;
  open(id: string): void;                               // ctx.shell.openPath(`scenes/${id}.scene.yml`)
  subscribe(listener: () => void): () => void;
}
export const name = 'scenes'; export const inject = ['slots', 'connection', 'shell', 'viewers'];
export function useScenes(ctx: Context): { docs; diagnostics; nodeTypes; selected }  // subscribe hook
```

- [ ] **Step 1: Failing tests** — boot a ctx with fakes: `slots` (real), `connection` (real, fake socket as `connection.test.ts` does), `shell` (real), `viewers` (real), `fetchFn` a `vi.fn` routing by URL/method:

```tsx
it('boots from GET /api/scenes, updates on `scenes` and `node-types` frames', …);   // docs() has the GET's docs; a frame replaces them; nodeTypes from frame
it('create POSTs and returns the refusal as diagnostics on 400', …);
it('update PUTs the document and applies the answer; remove DELETEs', …);
it('select POSTs /api/scenes/select and notifies; selecting null POSTs node: null', …);
it('open opens the file path through the shell; closing that tab clears a selection in that scene', …); // ctx.shell.registerPathOpener(spy); expect spy('scenes/a.scene.yml'); then ctx.shell.open({key:'f:scenes/a.scene.yml',…}); select({scene:'a',node:'n'}); ctx.shell.close(key) → selected() null
```

Write each with real assertions (paths, methods, bodies). Run → FAIL.

- [ ] **Step 2: Implement** — the plugin mirrors `game-composition.tsx`'s structure (`fetchFn`, `origin`, `ownDiagnostic` with `plugin: 'scenes'`, boot GET guarded against a frame landing first). `send(method, path, body?)` helper folds the five requests. `onFrame`: `scenes` → replace docs+diagnostics; `node-types` → replace types. Selection clearing: `ctx.effect(() => ctx.shell.subscribe(() => { const sel = selected; if (sel && !ctx.shell.documents().some((d) => d.key === \`f:scenes/${sel.scene}.scene.yml\`)) select(null); }))`. Register the activity (`layers` icon, order 35, opens sidebar) here as today. `useScenes` follows `useShell`'s shape.

Run → PASS. `npm run typecheck -w @energy8engine/ide-client` clean.

- [ ] **Step 3: Commit** `git add engine/ide/client && git commit -m "A scenes service in the IDE: documents, node types, selection"`.

---

### Task 11: Scenes sidebar (list)

**Files:**
- Rewrite: `engine/ide/client/src/shell/ScenesSidebar.tsx`
- Modify: `engine/ide/client/src/plugins/scenes.tsx` (register `shell.sidebar` key `scenes` → `ScenesSidebar`)
- Test: `engine/ide/client/tests/scenes-sidebar.test.tsx` (new; renders through the plugin's ctx: `ctx.slots.list('shell.sidebar').find(k==='scenes').component`)

**DOM contract** (Playwright reads these): root `data-testid="scenes-screen"`; header button `scene-add` → `InlineInput` `data-testid="scene-add-input"` (Enter → `create`; a refusal renders inline `scene-add-error`); rows `scene-<id>` with `role="button"`, `title="click: show in preview · double-click: open"`, `onClick` → `select({scene:id,node:null})` + `preview(id)`, `onDoubleClick` → `open(id)`; hover `×` `scene-remove-<id>` → confirm `confirm-yes`/`confirm-no` → `remove`; a diagnostics list `scenes-diagnostics` (each `severity: where — message`); empty → `scenes-empty` "no scenes yet — press + to add one".

- [ ] **Step 1: Failing tests** (five: list renders ids; `+`/Enter calls `create('intro')` and a refusal shows; click selects+previews; double-click opens; remove confirms). Run → FAIL.
- [ ] **Step 2: Implement.** Reuse `InlineInput` from `Explorer.tsx` (already exported). Run → PASS.
- [ ] **Step 3: Commit** `git commit -m "List the scenes: add, show, open, remove"`.

---

### Task 12: Scene tab — the node tree

**Files:**
- Create: `engine/ide/client/src/shell/SceneDocument.tsx`
- Modify: `engine/ide/client/src/plugins/scenes.tsx` (`ctx.viewers.register({ id: 'scene', match: (p) => /^scenes\/[a-z0-9_]+\.scene\.yml$/.test(p), component: SceneDocument })`)
- Test: `engine/ide/client/tests/scene-document.test.tsx`

**DOM contract:** root `scene-doc-<id>`; toolbar: `node-add` opens a `<select data-testid="node-add-type">` listing `nodeTypes()` with a confirm button `node-add-ok` (no menu component needed); rows `node-<id>` (`role="treeitem"`, `aria-level` = depth+1, `aria-selected`), text `<type> <id>`; click → `select({scene,node:id})`; hover `×` `node-remove-<id>` → `update(doc without the node)`; rows are `draggable`; drop on a row of type `container` = nest as last child, on any other row = insert before it (`dataTransfer.setData('text/e8-node', id)`); the tab calls `preview(id)` when it becomes the active document (`ctx.shell.subscribe`, compare `active()?.key === 'f:<path>'`, also once on mount if active); unknown document (`docs()` has no such id — deleted meanwhile) → `scene-doc-gone` text.

New node: `id` = `<type>-<n>` with the smallest `n ≥ 1` free in the document; `props` = `defaults` of the type's schema (`new Schema(json)({})`; `image` → `{ src: '' }`); appended to the selected node if that node is a `container`, else to the root.

- [ ] **Step 1: Failing tests** (tree renders nested rows with levels; add appends `container-1` under root and `container-2` under a selected container; remove drops the node and its children; a drop before a sibling reorders; a drop onto a container nests; activating the tab previews). Use `fireEvent.dragStart/dragOver/drop` with a stub `dataTransfer`. Run → FAIL.
- [ ] **Step 2: Implement** — pure helpers exported for the tests: `addNode(doc, type, defaults, parentId | null): SceneDoc`, `removeNode(doc, id)`, `moveNode(doc, id, target: { before: string } | { into: string })`, `nextId(doc, type)`. The component holds no draft state: every edit → `update(newDoc)`; the tree renders `docs().find(id)`. Run → PASS.
- [ ] **Step 3: Commit** `git commit -m "Open a scene as a tab: its node tree, editable"`.

---

### Task 13: Properties (right sidebar)

**Files:**
- Create: `engine/ide/client/src/shell/PropertiesSidebar.tsx`
- Modify: `engine/ide/client/src/plugins/scenes.tsx` (register `shell.sideRight` key `scenes` → `PropertiesSidebar`; a `subscribe` effect calling `ctx.shell.showSideRight('scenes')` when `selected()` becomes non-null and `hideSideRight()` when it becomes null)
- Test: `engine/ide/client/tests/properties-sidebar.test.tsx`

**DOM contract:** root `properties`; node selected: `prop-id` input (commit on Enter/blur → renames the node; a duplicate id → inline `prop-id-error`, no write), `prop-type` text, then `SchemaForm` with `rowId={`${scene}.${node}`}` over a schema built as `Schema.object({ ...COMMON_JSON.dict, ...typeSchema.dict })` — build the merged schema on the client by rebuilding both from JSON (`new Schema(json)`) and composing a new `Schema.object` from their `.dict`s; `value` = `node.props`; `onChange` → `update(doc with props replaced)`. `COMMON` JSON: the client cannot import `@energy8engine/scenes` (pixi) — put `COMMON` into `engine/game/scenes/src/common-schema.ts` (schemastery only) and add a `./common-schema` export; `ide-client` imports it from there (same pattern as `@energy8engine/stage/schema` was). Scene selected, no node: `prop-scene-id` text, `prop-node-count`, `prop-assets` list (`image.src` values through nested scenes — compute client-side from `docs()`: nodes of type `image` → `props.src`; nodes of type `scene` → recurse).

- [ ] **Step 1: Failing tests** (node form renders `x`/`src` fields and a change PUTs; rename refuses a duplicate; scene view lists assets through nesting; the side-right shows on select and hides on `select(null)` — assert through the plugin's ctx and `ctx.shell.sideRight()`). Run → FAIL.
- [ ] **Step 2: Implement.** Run → PASS. Also `npm run build -w @energy8engine/ide-web` succeeds (pixi must NOT be in the client bundle: `grep -c pixi engine/apps/web/dist/assets/*.js` prints 0 for every file).
- [ ] **Step 3: Commit** `git commit -m "Show the selected node's properties on the right"`.

---

### Task 14: Retire the slice-16 client bits

**Files:**
- Modify: `engine/ide/client/src/plugins/game-composition.tsx` (remove `stages`, `previewScene`; keep `transitions`)
- Modify: `engine/ide/client/src/screens/CompositionScreen.tsx` and any reader of `stages`/`previewScene` (`grep -rn "previewScene\|\.stages" engine/ide/client/src engine/apps/web/src`)
- Modify: `engine/ide/client/tests/game-composition.test.tsx` (drop the two cases)
- Modify: `engine/apps/web/tests/activity-icons.test.tsx` if it asserts the Scenes activity through the old plugin shape
- Modify: `engine/game/runtime/src/index.ts:520-525`, `engine/ide/host/src/plugins/runtime-assets.ts:687` (comments: `stage1` → `scenes1`)

- [ ] **Step 1:** make the edits; `npm test -w @energy8engine/ide-client -w @energy8engine/ide-web -w @energy8engine/game-runtime -w @energy8engine/ide-host` → PASS; `npm run typecheck -w @energy8engine/ide-client` clean.
- [ ] **Step 2: Commit** `git commit -m "Drop the stage-keyed scene bits the composition plugin carried"`.

---

### Task 15: End to end

**Files:**
- Rewrite: `engine/apps/web/tests/e2e/scenes.spec.ts`
- Modify: `engine/apps/web/tests/e2e/composition.spec.ts` (`stage1` → `scenes1` in the four YAML fixtures and the id list at line ~650; `layers` assertions, if any, go)
- Modify: `engine/apps/web/tests/e2e/project-fixture.ts` only if `projectCopy` filters directories (it must copy `scenes/`)

- [ ] **Step 1: Write the spec** (helpers as the old file: `openComposition`, `gameFrame`; new readers `scenesVisible(frame)`, `nodeVisible(frame, scene, node)`):

```ts
test('the Scenes sidebar adds a scene, the Explorer shows the file, a double-click opens the tree', async ({ page }) => {
  await page.goto(`${IDE_URL}#/doc/composition`);
  await page.getByTestId('activity-scenes').click();
  await expect(page.getByTestId('scene-base_game')).toBeVisible();
  await page.getByTestId('scene-add').click();
  await page.getByTestId('scene-add-input').fill('intro');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('scene-intro')).toBeVisible();
  expect(existsSync(join(host.dir, 'scenes', 'intro.scene.yml'))).toBe(true);
  await page.getByTestId('scene-intro').dblclick();
  await expect(page.getByTestId('scene-doc-intro')).toBeVisible();
});

test('adding a node shows its properties on the right and writes the file', async ({ page }) => {
  // open base_game tab; node-add → container → node-add-ok; expect node-container-1 row, properties `prop-id` = container-1; set x=12 via the form; poll the file for `x: 12`
});

test('clicking a scene shows it in the preview; showing big_win flips its node visible', async ({ page }) => {
  // open composition (preview iframe boots the game); activity-scenes; click scene-base_game → poll scenesVisible == ['base_game']; click scene-big_win → poll nodeVisible('base_game','big_win') === true
});

test('a spin still presents under the temporary rule', async ({ page }) => {
  // __e8.spin(); scenesVisible contains 'base_game'; #status non-empty
});
```

`activity-scenes` is `ActivityButton`'s `data-testid={`activity-${entry.key}`}`.

- [ ] **Step 2: Run** `cd engine/apps/web && npx playwright test tests/e2e/scenes.spec.ts tests/e2e/composition.spec.ts` (nothing else running on 5679/5680/5681). Fix what fails in the product or the test with a reason in the report.

- [ ] **Step 3: Whole suite** — from the repo root: `npm test -w @energy8engine/contracts -w @energy8engine/scenes -w @energy8engine/reels -w @energy8engine/ide-bridge -w @energy8engine/ide-host -w @energy8engine/ide-client -w @energy8engine/ide-web -w @energy8engine/game-runtime -w @energy8engine/game-loader`, then `cd engine/apps/web && npx playwright test` (the full e2e — the fixture changed). Record counts.

- [ ] **Step 4: Commit** `git add engine/apps/web/tests && git commit -m "Prove the scene editor in a browser"`.
