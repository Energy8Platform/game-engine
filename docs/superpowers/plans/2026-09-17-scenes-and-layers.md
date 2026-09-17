# Scenes and Layers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The stage is layered; a scene (named after a spin stage) says which layers are visible and how to transition into it; the reels mount into a layer; the IDE edits layers and scenes in Composition and in a dedicated Scenes screen, hot, and can push a scene into the running preview.

**Architecture:** `@energy8engine/stage` grows `layers` (child containers ordered by `z`), `scenes`, `enter(scene)`, `current()`, and a `transitions` registry (built-ins `cut`, `fade`); its `destroy` detaches foreign children instead of destroying them, so the row can be re-applied hot under a live `reels`. `reels` mounts into `stage.layer(config.layer)`. `main.ts` calls `stage.enter(result.stage)` before presenting. The host cross-checks scenes against the `.spin` stages, fixes `restartKeys` for nested restart fields, adds `POST /api/scenes/preview` → `scene-preview` frame → `ide-bridge` → `enter`, and mirrors the game's transition ids. The client's `SchemaForm` learns arrays of objects and dicts of objects; a `scenes` client plugin contributes the Scenes screen, which edits the same `stage1` row through the same `PUT`.

**Tech Stack:** cordis 4.0.0-rc.8, pixi.js 8 (`Container`, `Ticker`), schemastery 3.18, React 18, vitest, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-17-scenes-and-layers-design.md`

## Global Constraints

- **A refusal is data.** Unknown scene → all layers visible + one `warning` per id; unknown transition → `cut` + `warning`; a transition's `run` that throws → visibility still applied + `error`; `reels1.config.layer` missing from `layers` → mount into the root + `warning`. Game-side diagnostics go through `ctx.reflect.get('diagnostics', false)` (`DiagnosticsService.report`), lenient, never a throw.
- **`stage` is `hot: true`; `design.width/height` keep `applies: 'restart'`.** The host's `restartKeys` must see NESTED restart fields (slice 13 debt 2) — Task 3 fixes it before Task 7 relies on it.
- **`stage.destroy()` never destroys children it did not create.** Layer containers are the stage's; what rows mounted into them (`board.view`) is theirs — `removeChildren()` on every layer before `destroy`.
- **`main.ts` of the template and `engine/examples/first-slot/src/main.ts` stay byte-identical** (`engine/ide/host/tests/template.test.ts` pins it).
- **No new write path**: every edit is `PUT /api/composition/rows/stage1 { config }` with the full config; both the form and the Scenes screen listen to the `game-composition` frame.
- **Transitions registry policy = `mechanics`**: an id already taken stays with the incumbent; the second registration is an `error` diagnostic and a no-op retract.
- Copy is English throughout. Nothing under `packages/*`. `engine/examples/first-slot/concept.png` is untracked and not ours. zsh: no trailing `#` comments.
- Per task: `npm test --workspace @energy8engine/<pkg>` and `npm run typecheck --workspace …` for every touched package; `npx prettier --check <changed files>` from the repo root. Commits: imperative subject, trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Playwright (Task 7 only): alone from `engine/apps/web`; `git branch --show-current` before/after; afterwards `pgrep -fl e8-server | grep -v pantheon` empty of ours, `ls engine/examples` = `first-slot probe-plugin workspace`.

---

## File map

| File | Responsibility |
|---|---|
| `engine/game/stage/src/index.ts` (modify) | `createStage` with layers/scenes/enter/current; `createTransitions` registry; built-in `cut`/`fade`. |
| `engine/game/stage/src/runtime.ts` (modify) | Provides `stage` and `transitions`; hot-safe teardown. |
| `engine/game/stage/src/schema.ts`, `package.json` (modify) | `layers`, `scenes`, `transition`, `transitionMs`; `hot: true`. |
| `engine/game/stage/tests/*` | Units incl. the hot re-apply test. |
| `engine/game/reels/src/{runtime,schema}.ts` (modify) | `layer` config; mount into the layer. |
| `engine/game/reels/tests/runtime.test.ts` (modify) | Layer mount; stage re-apply under a live board. |
| `engine/templates/slot-basic/src/main.ts`, `engine/examples/first-slot/src/main.ts` (modify) | `enter(stage)` before presenting. |
| `engine/core/contracts/src/protocol.ts` (modify) | `scene-preview` server frame, `game-transitions` client frame, `transitions` on the composition response. |
| `engine/ide/host/src/plugins/rpc.ts` (modify) | `broadcastScenePreview`, accept `game-transitions`, `transitions()`. |
| `engine/ide/host/src/plugins/runtime-assets.ts` (modify) | `restartKeys` nested; `transitions` in `GET /api/composition`. |
| `engine/ide/host/src/plugins/scenes.ts` (new) | `checkScenes`; `POST /api/scenes/preview`. |
| `engine/ide/host/src/plugins/{project-scope,dev-game}.ts` (modify) | Compose `scenes`; preview socket accepts `game-transitions`. |
| `engine/game/ide-bridge/src/index.ts` (modify) | `scene-preview` → `enter`; sends `game-transitions`. |
| `engine/ide/client/src/schema-form/fields.tsx` (modify) | `ArrayField`; dict of objects. |
| `engine/ide/client/src/plugins/game-composition.tsx` (modify) | `stages`, `transitions` in state. |
| `engine/ide/client/src/plugins/scenes.tsx`, `src/screens/ScenesScreen.tsx` (new) | The Scenes screen. |
| `engine/apps/web/tests/e2e/scenes.spec.ts` (new) | Browser proof. |

---

### Task 1: The layered stage — layers, scenes, `enter`, transitions, hot-safe teardown

**Files:**
- Modify: `engine/game/stage/src/index.ts`, `engine/game/stage/src/runtime.ts`, `engine/game/stage/src/schema.ts`, `engine/game/stage/package.json` (`"hot": true`)
- Test: `engine/game/stage/tests/stage.test.ts`, `tests/runtime.test.ts`, `tests/schema.test.ts`, new `tests/transitions.test.ts`

**Interfaces (produced):**

```ts
// index.ts
export interface LayerSpec { id: string; z?: number }
export interface SceneSpec { layers: string[]; transition?: string }
export interface LayerView { id: string; z: number; container: Container }
export interface TickerLike {
  add(fn: (t: { deltaMS: number }) => void): unknown;
  remove(fn: (t: { deltaMS: number }) => void): unknown;
}
export interface TransitionRun { from: Container[]; to: Container[]; ticker: TickerLike | null; ms: number }
export interface Transition { id: string; run(t: TransitionRun): Promise<void> }
export interface TransitionsService {
  register(t: Transition): () => void;   // incumbent keeps the id; a collision reports an error, returns a no-op
  get(id: string): Transition | undefined;
  ids(): string[];
  subscribe(listener: () => void): () => void;
}
export function createTransitions(report?: (d: Diagnostic) => void): TransitionsService;
export const cut: Transition;             // resolves immediately
export const fade: Transition;            // alpha tween over `ms` on the ticker; with `ticker: null` behaves as cut
export interface Stage {
  readonly container: Container;
  layer(id: string): Container | undefined;
  layers(): readonly LayerView[];         // by z ascending, ties by declaration order
  enter(scene: string): Promise<void>;    // same scene again → resolved no-op
  current(): string | null;
  resize(w: number, h: number): Fit;
  destroy(): void;                        // removeChildren() on every layer first
}
export interface CreateStageOptions {
  root: Container; design: Size; mode?: 'contain' | 'cover';
  layers?: LayerSpec[]; scenes?: Record<string, SceneSpec>;
  transition?: string; transitionMs?: number;
  transitions?: TransitionsService; ticker?: TickerLike | null;
  report?: (d: Diagnostic) => void;
}
export function createStage(options: CreateStageOptions): Stage;
```

`runtime.ts`: `apply(ctx, config)` builds `createTransitions(report)` with `cut` and `fade` registered, provides `ctx.transitions`, then `createStage({ root: ctx.renderer.app.stage, ticker: ctx.renderer.app.ticker ?? null, transitions, report, ...config })`, provides `ctx.stage`; `report` = `(ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report` bound, else a no-op. `declare module 'cordis' { interface Context { stage: Stage; transitions: TransitionsService } }`. `Diagnostic`/`diagnostic()` come from `@energy8engine/contracts` (add the dependency to `package.json` if missing — check `engine/game/reels/package.json` for the pattern); `DiagnosticsService` type from `@energy8engine/diagnostics` (type-only import).

Diagnostics (all `plugin: 'stage'`): unknown scene → `warning`, `where: scene`, message `scene "<id>" is not declared — every layer is shown`, once per id per stage instance; unknown transition → `warning`, `where: <transition id>`, `transition "<id>" is not registered — cut instead`; a `run` that rejects → `error`, `where: <transition id>`, `transition "<id>" failed: <message>` (visibility already applied before `run` is awaited — see below); registry collision → `error`, `where: <id>`, `a second transition registered as "<id>" — the first keeps it`.

`enter(scene)` algorithm: if `scene === current` → return. `spec = scenes[scene]`; if none → report once, `to = all layers`, `from = []`; else `to = layers named in spec.layers (in z order)`, `from = layers visible now and not in to`. Pick transition id: `spec?.transition ?? options.transition ?? 'cut'`; resolve through `transitions.get`; unknown → report + `cut`. Set `current = scene`. Apply visibility first: every layer in `to` → `visible = true`; every other layer → `visible = false` **after** the transition for `from` layers (so a fade-out is visible): concretely — set `to` visible, `await run({ from, to, ticker, ms })` in a try/catch (reject → report error), then set every layer not in `to` invisible and `alpha = 1`. `cut.run` resolves immediately. `fade.run`: if `ticker === null` resolve; else `to` layers start at `alpha = 0`, each tick adds `deltaMS`, sets `to.alpha = t`, `from.alpha = 1 - t` (clamped), resolves at `t ≥ 1` with `to.alpha = 1`, `from.alpha = 1` (visibility is the stage's job); remove the tick fn on resolve.

- [ ] **Step 1: Schema and manifest**

`schema.ts`:

```ts
import Schema from 'schemastery';

const restart = { applies: 'restart' };

export const Config = Schema.object({
  design: Schema.object({
    width: Schema.natural().description('design width, px').extra('extra', restart),
    height: Schema.natural().description('design height, px').extra('extra', restart),
  }).description('design resolution'),
  layers: Schema.array(
    Schema.object({
      id: Schema.string().required().description('layer id'),
      z: Schema.number().default(0).description('draw order, low first'),
    }),
  )
    .default([{ id: 'reels', z: 0 }])
    .description('layers, children of the stage'),
  scenes: Schema.dict(
    Schema.object({
      layers: Schema.array(Schema.string()).default([]).description('layers visible in this scene'),
      transition: Schema.string().description('transition id; the stage default when empty'),
    }),
  )
    .default({})
    .description('scene id (a spin stage) → what it shows'),
  transition: Schema.string().default('cut').description('default transition id'),
  transitionMs: Schema.natural().default(300).description('transition length, ms'),
});
```

`package.json`: `"hot": true`. Update `schema.ts`'s module doc (the row is hot now; `design` alone reloads). Extend `tests/schema.test.ts`: the default config validates with `layers` `[{id:'reels',z:0}]`, `scenes` `{}`; a scene with `layers: ['reels']` validates; `layers: [{}]` (no id) is rejected; `toJSON()` keeps `applies: 'restart'` under `design.width`.

- [ ] **Step 2: Failing tests — `tests/transitions.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { Container } from 'pixi.js';
import type { Diagnostic } from '@energy8engine/contracts';
import { createTransitions, cut, fade, type TickerLike } from '../src/index';

/** A ticker the test drives by hand: `tick(ms)` runs every registered fn once with that `deltaMS`. */
function fakeTicker(): TickerLike & { tick(ms: number): void; size(): number } {
  const fns = new Set<(t: { deltaMS: number }) => void>();
  return {
    add: (fn) => fns.add(fn),
    remove: (fn) => fns.delete(fn),
    tick: (ms) => [...fns].forEach((fn) => fn({ deltaMS: ms })),
    size: () => fns.size,
  };
}

describe('transitions registry', () => {
  it('registers, lists, gets, retracts', () => {
    const t = createTransitions();
    const off = t.register({ id: 'wipe', run: async () => {} });
    expect(t.ids()).toEqual(['wipe']);
    expect(t.get('wipe')?.id).toBe('wipe');
    off();
    expect(t.ids()).toEqual([]);
  });
  it('the incumbent keeps a taken id; the collision is an error diagnostic; the returned retract is a no-op', () => {
    const reported: Diagnostic[] = [];
    const t = createTransitions((d) => reported.push(d));
    const first = { id: 'wipe', run: async () => {} };
    t.register(first);
    const off = t.register({ id: 'wipe', run: async () => {} });
    expect(t.get('wipe')).toBe(first);
    expect(reported[0]).toMatchObject({ severity: 'error', plugin: 'stage', where: 'wipe' });
    off();
    expect(t.get('wipe')).toBe(first);
  });
  it('subscribers hear register and retract', () => {
    const t = createTransitions();
    let n = 0;
    t.subscribe(() => n++);
    const off = t.register({ id: 'a', run: async () => {} });
    off();
    expect(n).toBe(2);
  });
});

describe('built-in transitions', () => {
  it('cut resolves at once and touches nothing', async () => {
    const a = new Container();
    await cut.run({ from: [a], to: [], ticker: fakeTicker(), ms: 300 });
    expect(a.alpha).toBe(1);
  });
  it('fade tweens alpha over ms on the ticker and cleans up', async () => {
    const from = new Container();
    const to = new Container();
    const ticker = fakeTicker();
    const done = fade.run({ from: [from], to: [to], ticker, ms: 200 });
    expect(to.alpha).toBe(0);
    ticker.tick(100);
    expect(to.alpha).toBeCloseTo(0.5);
    expect(from.alpha).toBeCloseTo(0.5);
    ticker.tick(100);
    await done;
    expect(to.alpha).toBe(1);
    expect(from.alpha).toBe(1);
    expect(ticker.size()).toBe(0);
  });
  it('fade with no ticker behaves as cut', async () => {
    const to = new Container();
    await fade.run({ from: [], to: [to], ticker: null, ms: 200 });
    expect(to.alpha).toBe(1);
  });
});
```

- [ ] **Step 3: Failing tests — extend `tests/stage.test.ts`**

```ts
describe('createStage — layers and scenes', () => {
  const layers = [{ id: 'ui', z: 20 }, { id: 'bg', z: 0 }, { id: 'reels', z: 10 }];

  it('creates one child container per layer, ordered by z, ties by declaration order', () => {
    const root = new Container();
    const stage = createStage({ root, design: { width: 1, height: 1 }, layers: [...layers, { id: 'fx', z: 10 }] });
    expect(stage.layers().map((l) => l.id)).toEqual(['bg', 'reels', 'fx', 'ui']);
    expect(stage.container.children).toEqual(stage.layers().map((l) => l.container));
    expect(stage.layer('reels')).toBe(stage.layers()[1].container);
    expect(stage.layer('nope')).toBeUndefined();
  });

  it('defaults to one layer named reels', () => {
    const stage = createStage({ root: new Container(), design: { width: 1, height: 1 } });
    expect(stage.layers().map((l) => l.id)).toEqual(['reels']);
  });

  it('enter shows the scene’s layers and hides the rest; current() follows; the same scene again is a no-op', async () => {
    const stage = createStage({
      root: new Container(), design: { width: 1, height: 1 }, layers,
      scenes: { base_game: { layers: ['bg', 'reels'] }, free_spins: { layers: ['bg', 'ui'] } },
    });
    expect(stage.current()).toBeNull();
    await stage.enter('base_game');
    expect(stage.current()).toBe('base_game');
    expect(stage.layer('bg')!.visible).toBe(true);
    expect(stage.layer('reels')!.visible).toBe(true);
    expect(stage.layer('ui')!.visible).toBe(false);
    await stage.enter('free_spins');
    expect(stage.layer('reels')!.visible).toBe(false);
    expect(stage.layer('ui')!.visible).toBe(true);
    const before = stage.layer('ui')!.visible;
    await stage.enter('free_spins');
    expect(stage.layer('ui')!.visible).toBe(before);
  });

  it('an undeclared scene shows every layer and warns once', async () => {
    const reported: Diagnostic[] = [];
    const stage = createStage({ root: new Container(), design: { width: 1, height: 1 }, layers, scenes: {}, report: (d) => reported.push(d) });
    await stage.enter('bonus');
    await stage.enter('bonus2');
    await stage.enter('bonus');
    expect(stage.layers().every((l) => l.container.visible)).toBe(true);
    expect(reported.map((d) => d.where)).toEqual(['bonus', 'bonus2']);
    expect(reported[0]).toMatchObject({ severity: 'warning', plugin: 'stage' });
  });

  it('uses the scene’s transition, else the stage default, else cut; unknown → cut + warning; a failing run → error, visibility still applied', async () => {
    const reported: Diagnostic[] = [];
    const calls: string[] = [];
    const transitions = createTransitions();
    transitions.register({ id: 'wipe', run: async () => { calls.push('wipe'); } });
    transitions.register({ id: 'boom', run: async () => { throw new Error('no gpu'); } });
    transitions.register(cut);
    const stage = createStage({
      root: new Container(), design: { width: 1, height: 1 }, layers,
      scenes: { a: { layers: ['bg'], transition: 'wipe' }, b: { layers: ['ui'] }, c: { layers: ['reels'], transition: 'ghost' }, d: { layers: ['bg'], transition: 'boom' } },
      transition: 'wipe', transitions, report: (d) => reported.push(d),
    });
    await stage.enter('a');
    await stage.enter('b');
    expect(calls).toEqual(['wipe', 'wipe']);
    await stage.enter('c');
    expect(reported.at(-1)).toMatchObject({ severity: 'warning', where: 'ghost' });
    expect(stage.layer('reels')!.visible).toBe(true);
    await stage.enter('d');
    expect(reported.at(-1)).toMatchObject({ severity: 'error', where: 'boom' });
    expect(stage.layer('bg')!.visible).toBe(true);
    expect(stage.layer('reels')!.visible).toBe(false);
  });

  it('destroy detaches what rows mounted into layers instead of destroying it', () => {
    const root = new Container();
    const stage = createStage({ root, design: { width: 1, height: 1 }, layers });
    const view = new Container();
    stage.layer('reels')!.addChild(view);
    stage.destroy();
    expect(view.destroyed).toBe(false);
    expect(view.parent).toBeNull();
    expect(root.children).toEqual([]);
  });
});
```

(`Diagnostic` from `@energy8engine/contracts`; `createTransitions`, `cut` from `../src/index`.)

- [ ] **Step 4: Failing tests — extend `tests/runtime.test.ts`**

```ts
  it('provides transitions with cut and fade registered, and a stage built from the config', async () => {
    const ctx = new Context();
    await ctx.plugin(fakeRenderer(new Container()));
    await ctx.plugin(runtime, { design: { width: 1, height: 1 }, layers: [{ id: 'a', z: 1 }, { id: 'b', z: 0 }], scenes: { s: { layers: ['a'] } } });
    expect(ctx.transitions.ids().sort()).toEqual(['cut', 'fade']);
    expect(ctx.stage.layers().map((l) => l.id)).toEqual(['b', 'a']);
    await ctx.stage.enter('s');
    expect(ctx.stage.layer('b')!.visible).toBe(false);
    await ctx.fiber.dispose();
  });

  it('re-applies on fiber.update: a new stage with the new layers, a child mounted in the old layer survives', async () => {
    const ctx = new Context();
    const root = new Container();
    await ctx.plugin(fakeRenderer(root));
    const fiber = await ctx.plugin(runtime, { design: { width: 1, height: 1 }, layers: [{ id: 'reels', z: 0 }] });
    const before = ctx.stage;
    const view = new Container();
    before.layer('reels')!.addChild(view);
    fiber.update({ design: { width: 1, height: 1 }, layers: [{ id: 'bg', z: 0 }, { id: 'reels', z: 1 }] });
    await fiber.await();
    expect(ctx.stage).not.toBe(before);
    expect(ctx.stage.layers().map((l) => l.id)).toEqual(['bg', 'reels']);
    expect(view.destroyed).toBe(false);
    expect(root.children).toEqual([ctx.stage.container]);
    await ctx.fiber.dispose();
  });

  it('reports through ctx.diagnostics when present', async () => {
    const ctx = new Context();
    const reported: Diagnostic[] = [];
    await ctx.plugin({ name: 'diagnostics', apply(c: Context) { c.provide('diagnostics', { report: (d: Diagnostic) => reported.push(d) }); } });
    await ctx.plugin(fakeRenderer(new Container()));
    await ctx.plugin(runtime, { design: { width: 1, height: 1 } });
    await ctx.stage.enter('nope');
    expect(reported).toHaveLength(1);
    await ctx.fiber.dispose();
  });
```

`fakeRenderer` in that file provides `{ app: { stage: root } }` — no `ticker`; the runtime must tolerate `ticker` absent (`ctx.renderer.app.ticker ?? null`).

- [ ] **Step 5: RED** — `cd engine/game/stage && npx vitest run` — the new tests fail (`createTransitions is not a function`, `stage.layers is not a function`, …).

- [ ] **Step 6: Implement `index.ts`**

Keep `fitStage`, `Size`, `Fit`. Add the interfaces above and:

```ts
export function createTransitions(report: (d: Diagnostic) => void = () => {}): TransitionsService {
  const byId = new Map<string, Transition>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    register(t) {
      if (byId.has(t.id)) {
        report(diagnostic('error', 'stage', t.id, `a second transition registered as "${t.id}" — the first keeps it`, 'give it an id of its own'));
        return () => {};
      }
      byId.set(t.id, t);
      notify();
      return () => {
        if (byId.get(t.id) === t) {
          byId.delete(t.id);
          notify();
        }
      };
    },
    get: (id) => byId.get(id),
    ids: () => [...byId.keys()],
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const cut: Transition = { id: 'cut', run: () => Promise.resolve() };

export const fade: Transition = {
  id: 'fade',
  run({ from, to, ticker, ms }) {
    if (!ticker || ms <= 0) return Promise.resolve();
    for (const c of to) c.alpha = 0;
    return new Promise((resolve) => {
      let elapsed = 0;
      const step = (t: { deltaMS: number }) => {
        elapsed += t.deltaMS;
        const k = Math.min(1, elapsed / ms);
        for (const c of to) c.alpha = k;
        for (const c of from) c.alpha = 1 - k;
        if (k >= 1) {
          ticker.remove(step);
          for (const c of from) c.alpha = 1;
          resolve();
        }
      };
      ticker.add(step);
    });
  },
};

export function createStage(options: CreateStageOptions): Stage {
  const { report = () => {} } = options;
  const container = new Container();
  options.root.addChild(container);
  const specs = options.layers ?? [{ id: 'reels', z: 0 }];
  const views: LayerView[] = specs
    .map((spec, index) => ({ id: spec.id, z: spec.z ?? 0, index, container: new Container() }))
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map(({ id, z, container: c }) => ({ id, z, container: c }));
  for (const view of views) container.addChild(view.container);
  const transitions = options.transitions ?? createTransitions(report);
  if (!transitions.get('cut')) transitions.register(cut);
  const warned = new Set<string>();
  let current: string | null = null;

  return {
    container,
    layer: (id) => views.find((v) => v.id === id)?.container,
    layers: () => views,
    current: () => current,
    async enter(scene) {
      if (scene === current) return;
      const spec = options.scenes?.[scene];
      if (!spec && !warned.has(scene)) {
        warned.add(scene);
        report(diagnostic('warning', 'stage', scene, `scene "${scene}" is not declared — every layer is shown`, 'declare it under stage1.config.scenes'));
      }
      const to = spec ? views.filter((v) => spec.layers.includes(v.id)) : views;
      const from = views.filter((v) => v.container.visible && !to.includes(v));
      const wanted = spec?.transition ?? options.transition ?? 'cut';
      let transition = transitions.get(wanted);
      if (!transition) {
        report(diagnostic('warning', 'stage', wanted, `transition "${wanted}" is not registered — cut instead`, 'register it, or pick one that is'));
        transition = cut;
      }
      current = scene;
      for (const v of to) v.container.visible = true;
      try {
        await transition.run({ from: from.map((v) => v.container), to: to.map((v) => v.container), ticker: options.ticker ?? null, ms: options.transitionMs ?? 300 });
      } catch (error) {
        report(diagnostic('error', 'stage', transition.id, `transition "${transition.id}" failed: ${error instanceof Error ? error.message : String(error)}`));
      }
      for (const v of views) {
        if (!to.includes(v)) v.container.visible = false;
        v.container.alpha = 1;
      }
    },
    resize(w, h) { /* unchanged */ },
    destroy() {
      for (const v of views) v.container.removeChildren();
      options.root.removeChild(container);
      container.destroy({ children: true });
    },
  };
}
```

Note in `enter`: a `from` layer is hidden only AFTER the transition, so a fade-out is seen; `to` layers are shown BEFORE it, so a fade-in is seen. The `index` sort key is why ties keep declaration order. `diagnostic` from `@energy8engine/contracts`.

- [ ] **Step 7: Implement `runtime.ts`**

```ts
import type { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import type { DiagnosticsService } from '@energy8engine/diagnostics';
import type { PixiRenderer } from '@energy8engine/renderer-pixi';
import { createStage, createTransitions, cut, fade, type CreateStageOptions, type Stage, type TransitionsService } from './index';

declare module 'cordis' {
  interface Context {
    renderer: PixiRenderer;
    stage: Stage;
    transitions: TransitionsService;
  }
}

export type StageConfig = Pick<CreateStageOptions, 'design' | 'mode' | 'layers' | 'scenes' | 'transition' | 'transitionMs'>;

export const name = 'stage';
export const inject = ['renderer'];

export function apply(ctx: Context, config: StageConfig): void {
  const log = ctx.reflect.get('diagnostics', false) as DiagnosticsService | undefined;
  const report = (d: Diagnostic) => log?.report(d);
  const transitions = createTransitions(report);
  transitions.register(cut);
  transitions.register(fade);
  ctx.provide('transitions', transitions);
  const app = ctx.renderer.app as { stage: CreateStageOptions['root']; ticker?: CreateStageOptions['ticker'] };
  const stage = createStage({ root: app.stage, ticker: app.ticker ?? null, transitions, report, ...config });
  ctx.effect(() => () => stage.destroy(), 'stage:container');
  ctx.provide('stage', stage);
}
```

Order matters: `transitions` is provided BEFORE `stage`, so a project plugin with `inject: ['transitions']` can register before the first `enter`. Add `@energy8engine/contracts` and `@energy8engine/diagnostics` to `package.json` `dependencies` (`"*"`, workspace) if not present; run `npm install --no-audit --no-fund` from the repo root once if the symlink is missing.

- [ ] **Step 8: GREEN, typecheck, prettier, commit**

`cd engine/game/stage && npm test && npm run typecheck`; from the root `npx prettier --check engine/game/stage/src engine/game/stage/tests`.

```bash
git add engine/game/stage
git commit -m "Layer the stage: layers by z, scenes that show them, a transitions registry with cut and fade

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Reels mount into a layer; the page enters the scene

**Files:**
- Modify: `engine/game/reels/src/schema.ts`, `engine/game/reels/src/runtime.ts`
- Modify: `engine/templates/slot-basic/src/main.ts`, `engine/examples/first-slot/src/main.ts` (identical edit)
- Test: `engine/game/reels/tests/runtime.test.ts`, `engine/game/reels/tests/schema.test.ts`

**Interfaces:**
- Consumes: `Stage.layer(id)`, `Stage.container` (Task 1).
- Produces: `reels1.config.layer: string` (default `'reels'`).

- [ ] **Step 1: Failing tests** — in `reels/tests/runtime.test.ts`, the file's `fakeStage` provides a plain `{ container }`; extend it to also provide `layer(id)` backed by a map of child containers created from a `layers` list, e.g. `fakeStage(['reels', 'bg'])`, and add:

```ts
  it('mounts the board into the layer its config names, reels by default', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(fakeStage(['bg', 'reels']));
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });
    expect(ctx.stage.layer('reels')!.children).toEqual([ctx.board.view]);
    expect(ctx.stage.container.children).not.toContain(ctx.board.view);
    await ctx.fiber.dispose();
  });

  it('a layer that does not exist falls back to the root, with a warning', async () => {
    const ctx = new Context();
    const reported: Diagnostic[] = [];
    await ctx.plugin({ name: 'diagnostics', apply(c: Context) { c.provide('diagnostics', { report: (d: Diagnostic) => reported.push(d) }); } });
    await ctx.plugin(assetsService);
    await ctx.plugin(fakeStage(['bg']));
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } }, layer: 'fx' });
    expect(ctx.stage.container.children).toEqual([ctx.board.view]);
    expect(reported[0]).toMatchObject({ severity: 'warning', plugin: 'reels', where: 'fx' });
    await ctx.fiber.dispose();
  });

  it('follows a re-provided stage into its new layer, with the same board', async () => {
    // The REAL stage runtime, so this is the hot-stage path Task 1 promised.
    const ctx = new Context();
    const root = new Container();
    await ctx.plugin({ name: 'renderer-pixi', apply(c: Context) { c.provide('renderer', { app: { stage: root } } as any); } });
    await ctx.plugin(assetsService);
    const stageFiber = await ctx.plugin(stageRuntime, { design: { width: 1, height: 1 }, layers: [{ id: 'reels', z: 0 }] });
    await ctx.plugin(runtime, { config: { grid: { cols: 2, rows: 2 } } });
    const board = ctx.board;
    expect(ctx.stage.layer('reels')!.children).toEqual([board.view]);
    stageFiber.update({ design: { width: 1, height: 1 }, layers: [{ id: 'bg', z: 0 }, { id: 'reels', z: 1 }] });
    await stageFiber.await();    expect(ctx.board).toBe(board);
    expect(ctx.stage.layers().map((l) => l.id)).toEqual(['bg', 'reels']);
    expect(ctx.stage.layer('reels')!.children).toEqual([board.view]);
    expect(board.view.destroyed).toBe(false);
    await ctx.fiber.dispose();
  });
```

(`stageRuntime` = `import * as stageRuntime from '@energy8engine/stage/runtime'` — the reels package already depends on `@energy8engine/stage`; `Container` from `pixi.js`; `Diagnostic` from contracts.) In `schema.test.ts`: `layer` defaults to `'reels'`; `layer: 'ui'` validates.

- [ ] **Step 2: RED** — `cd engine/game/reels && npx vitest run tests/runtime.test.ts tests/schema.test.ts`.

- [ ] **Step 3: Implement**

`reels/src/schema.ts`: add `layer: Schema.string().default('reels').description('stage layer to mount the board into')` at the top level of `Config`.

`reels/src/runtime.ts`: the config type gains `layer?: string`; replace the inject callback:

```ts
  ctx.inject(['stage'], (stageCtx) => {
    const wanted = config.layer ?? 'reels';
    const target = stageCtx.stage.layer?.(wanted);
    if (!target) {
      (stageCtx.reflect.get('diagnostics', false) as DiagnosticsService | undefined)?.report(
        diagnostic('warning', 'reels', wanted, `stage has no layer "${wanted}" — the board is mounted on the stage root`, 'declare the layer under stage1.config.layers, or point reels1.config.layer at one that exists'),
      );
    }
    (target ?? stageCtx.stage.container).addChild(board.view);
  });
```

`stageCtx.stage.layer?.(…)` — optional call, because a test's fake stage may be the old `{ container }` shape; keep the existing tests green. Import `diagnostic` from contracts and the `DiagnosticsService` type from `@energy8engine/diagnostics` (add to `package.json` if missing). Note: `board.view` is added to a NEW parent on re-provide — pixi's `addChild` reparents (removes from the old parent) — that is what "follows the stage" relies on; the old stage's `destroy` already detached it (Task 1).

`main.ts` (both files, identical): in `presentStage`, before `const bound = mechanics.forStage(stage);`, add:

```ts
  // Scenes (slice 16): a stage row that declares scenes shows this spin
  // stage's layers before anything is presented on them. Read leniently —
  // a game composed without a stage row, or on an older stage, has no
  // scenes and presents exactly as before.
  const scenes = ctx.reflect.get('stage', false) as { enter?(scene: string): Promise<void> } | undefined;
  if (scenes?.enter) await scenes.enter(stage);
```

Run `cd engine/ide/host && npx vitest run tests/template.test.ts` — the byte-identity test must stay green (`cmp` the two files).

- [ ] **Step 4: GREEN, typecheck, prettier, commit**

`cd engine/game/reels && npm test && npm run typecheck`; `cd engine/ide/host && npx vitest run tests/template.test.ts`; prettier on the four files.

```bash
git add engine/game/reels engine/templates/slot-basic/src/main.ts engine/examples/first-slot/src/main.ts
git commit -m "Mount the reels into a layer, and enter the scene before presenting a stage

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Host — nested `restartKeys`, `checkScenes`, `POST /api/scenes/preview`, transition mirror, contracts

**Files:**
- Modify: `engine/core/contracts/src/protocol.ts`
- Modify: `engine/ide/host/src/plugins/rpc.ts`, `runtime-assets.ts`, `project-scope.ts`, `dev-game.ts`
- Create: `engine/ide/host/src/plugins/scenes.ts`
- Test: `engine/ide/host/tests/runtime-assets.test.ts`, `tests/rpc.test.ts`, new `tests/scenes.test.ts`, contracts tests if they enumerate message types

**Interfaces:**

```ts
// contracts/protocol.ts
export interface ScenePreviewMessage { type: 'scene-preview'; scene: string }
export interface GameTransitionsMessage { type: 'game-transitions'; ids: string[] }
export type ServerMessage = … | ScenePreviewMessage;
export type ClientMessage = … | GameTransitionsMessage;
// GET /api/composition response gains `transitions: string[]`
// host rpc.ts
IdeRpcService += { broadcastScenePreview(frame: { scene: string }): void; transitions(): string[] }
// host scenes.ts
export function checkScenes(stageConfig: unknown, stageNames: string[]): Diagnostic[];   // plugin 'scenes'
export const name = 'scenes'; export const inject = ['server', 'ideRpc', 'composition', 'spinSchema'];
// POST /api/scenes/preview { scene } → 200 { diagnostics } | 400 { diagnostics }
```

- [ ] **Step 1: Contracts** — add the two message interfaces and union members; on the composition response type (find the `GET /api/composition` response interface — `grep -rn "diagnostics: Diagnostic\[\]; schema" engine/core/contracts/src`; if the response has no named type, add `transitions: string[]` where the host builds it and to the client's parse) add `transitions: string[]` with doc "transition ids the running game's `transitions` registry reported (`game-transitions`), empty until a game connects". `npm test --workspace @energy8engine/contracts`; if a test enumerates message types, extend it.

- [ ] **Step 2: Failing tests**

`tests/runtime-assets.test.ts` — next to any existing `restartKeys` test (or a new `describe('restartKeys')`):

```ts
  it('sees a restart field nested under a top-level object', () => {
    const schema = Schema.object({
      design: Schema.object({ width: Schema.natural().extra('extra', { applies: 'restart' }) }),
      layers: Schema.array(Schema.object({ id: Schema.string() })),
    }).toJSON();
    expect([...restartKeys(schema)]).toEqual(['design']);
  });
  it('PUT on a hot stage row: layers → reload false, design.width → reload true', async () => {
    // Boot a host over a project copy whose stage row is hot (the real @energy8engine/stage manifest is, since Task 1);
    // PUT { config: { ...current, layers: [...] } } → body.reload === false; PUT { config: { ...current, design: { width: 1 } } } → reload true.
    // Use the file's existing PUT harness (see `describe('PUT /api/composition/rows/:id')`).
  });
```

(Write the second test against that describe block's existing helpers — read them; the assertion is the requirement.)

`tests/scenes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkScenes } from '../src/plugins/scenes';

const cfg = (over: Record<string, unknown> = {}) => ({
  layers: [{ id: 'bg' }, { id: 'reels' }],
  scenes: { base_game: { layers: ['bg', 'reels'] } },
  ...over,
});

describe('checkScenes', () => {
  it('is silent when every scene is a stage and every stage a scene, on known layers', () => {
    expect(checkScenes(cfg(), ['base_game'])).toEqual([]);
  });
  it('a scene the script has no stage for is a warning', () => {
    const d = checkScenes(cfg({ scenes: { base_game: { layers: [] }, bonus: { layers: [] } } }), ['base_game']);
    expect(d).toEqual([expect.objectContaining({ severity: 'warning', plugin: 'scenes', where: 'bonus' })]);
  });
  it('a stage with no scene is a warning', () => {
    const d = checkScenes(cfg(), ['base_game', 'free_spins']);
    expect(d).toEqual([expect.objectContaining({ severity: 'warning', where: 'free_spins' })]);
  });
  it('a scene naming a layer that is not declared is an error; a duplicate layer id is an error', () => {
    const d = checkScenes(cfg({ scenes: { base_game: { layers: ['ui'] } } }), ['base_game']);
    expect(d[0]).toMatchObject({ severity: 'error', where: 'base_game' });
    expect(d[0].message).toContain('"ui"');
    const dup = checkScenes(cfg({ layers: [{ id: 'a' }, { id: 'a' }] , scenes: {} }), []);
    expect(dup).toEqual([expect.objectContaining({ severity: 'error', where: 'a' })]);
  });
  it('a config with no scenes and no layers (an older stage row) says nothing', () => {
    expect(checkScenes({ design: { width: 1, height: 1 } }, ['base_game'])).toEqual([]);
  });
});
```

Plus, in the same file, a route test booting a host over `fixture('plain')`-style project the way `tests/runtime-assets.test.ts` boots one for `PUT` (reuse its helper): `POST /api/scenes/preview` with `{ scene: 'base_game' }` → 200 and the frame reaches a preview `/ide` socket (open a `WebSocket` to the preview url's `/ide`, as `tests/dev-game.test.ts` or `tests/rpc.test.ts` already do — read them and copy the pattern) as `{ type: 'scene-preview', scene: 'base_game' }`; `{}` body → 400 `malformed-request`-style diagnostic; when no preview is running (a host booted with no project open, if the harness allows) → 200 with one `warning`.

`tests/rpc.test.ts`: a socket sending `{ type: 'game-transitions', ids: ['cut','fade','wipe'] }` → `ctx.ideRpc.transitions()` returns those ids; a later socket with a different list replaces them; on the game leaving (the existing `game-gone` path, if the file tests it) the list is kept (the mirror is "last known").

- [ ] **Step 3: RED** — `cd engine/ide/host && npx vitest run tests/scenes.test.ts tests/runtime-assets.test.ts tests/rpc.test.ts`.

- [ ] **Step 4: Implement**

`runtime-assets.ts` `restartKeys` — nested walk:

```ts
export function restartKeys(schema: unknown): Set<string> {
  if (!schema) return new Set();
  const dict = (new Schema(schema as Schema) as Schema).dict ?? {};
  const hasRestart = (node: Schema): boolean => {
    if ((node.meta.extra as { applies?: string } | undefined)?.applies === 'restart') return true;
    if (node.type === 'object' && node.dict) return Object.values(node.dict).some((child) => hasRestart(child as Schema));
    if ((node.type === 'array' || node.type === 'dict') && node.inner) return hasRestart(node.inner as Schema);
    return false;
  };
  return new Set(Object.keys(dict).filter((key) => hasRestart(dict[key] as Schema)));
}
```

Update its doc: "a top-level key reloads when it, or anything under it, is `applies: 'restart'` — `stage1`'s `design` is the case that made this nested". `GET /api/composition` handler: add `transitions: ctx.ideRpc.transitions()` to the JSON (both the root and the preview route share the handler).

`rpc.ts`: state `let lastTransitions: string[] = []`; in the message dispatch accept `type === 'game-transitions'` (extend the `type !== 'update' && …` guard), store `message.ids` (validate: array of strings, else ignore); service gains `transitions: () => [...lastTransitions]` and `broadcastScenePreview({ scene }) { for (const socket of clients) send(socket, { type: 'scene-preview', scene }); }`. Broadcasting to every client is fine: the IDE's own sockets ignore frame types they do not handle (verify: `engine/ide/client/src/plugins/connection.ts` switches on known types; an unknown `type` falls through — if it throws or logs, add an explicit ignore there).

`dev-game.ts`: `ctx.ideRpc.attach(preview, { accept: ['game-diagnostics', 'game-transitions'] })`.

`scenes.ts` (new):

```ts
import type { Context } from 'cordis';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';

/** Scenes against the script: every scene is a stage, every stage a scene, every scene's layers declared, layer ids unique. */
export function checkScenes(stageConfig: unknown, stageNames: string[]): Diagnostic[] {
  const cfg = (stageConfig ?? {}) as { layers?: { id?: unknown }[]; scenes?: Record<string, { layers?: unknown[] }> };
  if (!Array.isArray(cfg.layers) && !cfg.scenes) return [];
  const out: Diagnostic[] = [];
  const ids = (cfg.layers ?? []).map((l) => String(l?.id ?? ''));
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i)))
    out.push(diagnostic('error', 'scenes', id, `layer "${id}" is declared twice`, 'give each layer one id'));
  const known = new Set(ids);
  const scenes = cfg.scenes ?? {};
  for (const [scene, spec] of Object.entries(scenes)) {
    const missing = (Array.isArray(spec?.layers) ? spec.layers : []).map(String).filter((l) => !known.has(l));
    if (missing.length)
      out.push(diagnostic('error', 'scenes', scene, `scene "${scene}" names ${missing.map((m) => `"${m}"`).join(', ')}, which stage1.config.layers does not declare`, 'declare the layer, or drop it from the scene'));
    if (!stageNames.includes(scene))
      out.push(diagnostic('warning', 'scenes', scene, `scene "${scene}" has no stage of that name in the script`, 'name scenes after `enum … tag stage` members'));
  }
  for (const stage of stageNames)
    if (!(stage in scenes))
      out.push(diagnostic('warning', 'scenes', stage, `stage "${stage}" has no scene — every layer will be shown in it`, 'add a scene of that name'));
  return out;
}

export const name = 'scenes';
export const inject = ['server', 'ideRpc', 'composition', 'spinSchema'];

export function apply(ctx: Context): void {
  const recheck = () => {
    const row = ctx.composition.rows.find((r) => r.name === '@energy8engine/stage') ?? ctx.composition.rows.find((r) => r.id === 'stage1');
    const stages = Object.keys(ctx.spinSchema.schema?.stages ?? {});
    ctx.ideRpc.reportGameDiagnostics('scenes', row ? checkScenes(row.config, stages) : []);
  };
  recheck();
  // Re-run when the game composition or the script changes — find the events/hooks the two services expose (`composition` reload, `spinSchema` reload) and subscribe; if they expose none, run `recheck` from `putRow`'s success path and the `files/written` `.spin` path (say which in the report).
  ctx.server.post('/api/scenes/preview', async (req, res) => {
    let body: unknown;
    try { body = await req.json(); } catch { body = undefined; }
    const scene = (body as { scene?: unknown } | undefined)?.scene;
    if (typeof scene !== 'string' || scene === '') {
      res.status = 400;
      res.json({ diagnostics: [diagnostic('error', 'scenes', req.path, `POST ${req.path} needs a JSON body shaped {"scene": string}`)] });
      return;
    }
    ctx.ideRpc.broadcastScenePreview({ scene });
    res.json({ diagnostics: [] });
  });
}
```

Where the GAME composition lives on the host: read `project-scope.ts` — the service that holds the game rows (`e8.profile.yml` + `e8.patch.yml`, provided as `composition`? or `project`? — `runtime-assets.ts`'s `putRow` reads it; use the same). `spinSchema` is `ctx.spinSchema.schema` (used by the composition GET). Compose `scenes` in `project-scope.ts` after `runtime-assets` (it is per-project state). Reporting through `ideRpc.reportGameDiagnostics('scenes', …)` puts the rows in the panel under the host's own list, replacing the speaker's previous rows each time — exactly the retract semantics wanted. The "no preview running" warning: if `dev-game` exposes an `alive`/preview presence the plugin can read (`ctx.reflect.get('devGame', false)`?), answer 200 with `warning` when absent; if nothing exposes it, broadcast anyway and note it in the report (the frame reaches nobody — harmless).

- [ ] **Step 5: GREEN, typecheck, prettier, commit**

`cd engine/ide/host && npm test && npm run typecheck`; `npm test --workspace @energy8engine/contracts`; prettier.

```bash
git add engine/core/contracts/src/protocol.ts engine/ide/host/src/plugins/scenes.ts engine/ide/host/src/plugins/rpc.ts engine/ide/host/src/plugins/runtime-assets.ts engine/ide/host/src/plugins/project-scope.ts engine/ide/host/src/plugins/dev-game.ts engine/ide/host/tests
git commit -m "Check scenes against the script, push a scene into the preview, mirror the game's transitions, see nested restart fields

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `ide-bridge` — `scene-preview` in, `game-transitions` out

**Files:**
- Modify: `engine/game/ide-bridge/src/index.ts`
- Test: `engine/game/ide-bridge/tests/*.test.ts` (the file that fakes the socket — read it)

**Interfaces:**
- Consumes: `ctx.stage.enter` (Task 1, lenient), `ctx.transitions.ids/subscribe` (Task 1, lenient), frames from Task 3.

- [ ] **Step 1: Failing tests** (in the existing socket-fake harness — reuse its `fakeSocket`/`emit` helpers):

```ts
  it('a scene-preview frame enters that scene on the stage', async () => {
    const entered: string[] = [];
    const ctx = await boot({ stage: { enter: async (s: string) => { entered.push(s); } } });
    socket.receive(JSON.stringify({ type: 'scene-preview', scene: 'free_spins' }));
    await flush();
    expect(entered).toEqual(['free_spins']);
  });
  it('without a stage, a scene-preview frame is ignored', …);
  it('sends game-transitions on open, and again when the registry changes', async () => {
    const listeners = new Set<() => void>();
    const ids = ['cut', 'fade'];
    const ctx = await boot({ transitions: { ids: () => [...ids], subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } } });
    socket.open();
    expect(socket.sent.map(JSON.parse).filter((m) => m.type === 'game-transitions')).toEqual([{ type: 'game-transitions', ids: ['cut', 'fade'] }]);
    ids.push('wipe');
    listeners.forEach((fn) => fn());
    expect(socket.sent.map(JSON.parse).filter((m) => m.type === 'game-transitions').at(-1)).toEqual({ type: 'game-transitions', ids: ['cut', 'fade', 'wipe'] });
  });
```

(`boot(services)` provides the given services on a fresh `Context` before applying `ide-bridge` — shape it after the file's existing helpers; the assertions are the requirement.)

- [ ] **Step 2: RED**, **Step 3: Implement** — in `apply`: (a) in the `message` listener that handles `game-composition`, also handle `type === 'scene-preview'`: `const stage = ctx.reflect.get('stage', false) as { enter?(s: string): Promise<void> } | undefined; if (stage?.enter) void stage.enter(message.scene);` (b) a `forwardTransitions` function mirroring `forward` for diagnostics: reads `ctx.reflect.get('transitions', false)`; if present and the socket is open, sends `{ type: 'game-transitions', ids }`; called on `open`, once immediately, and from `transitions.subscribe`; and re-armed via `ctx.inject(['transitions'], …)` so a re-provided registry (hot stage) is followed — the same shape as the `mechanics` inject in that file. `ClientMessage` typing covers the new frame after Task 3.

- [ ] **Step 4: GREEN, typecheck, prettier, commit**

```bash
git add engine/game/ide-bridge
git commit -m "Let the IDE push a scene into the running game, and hear which transitions it has

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `SchemaForm` — arrays of objects, dicts of objects

**Files:**
- Modify: `engine/ide/client/src/schema-form/fields.tsx`, `engine/ide/client/src/styles.css`
- Test: `engine/ide/client/tests/schema-form.test.tsx`

**Interfaces:**
- Produces: `Field` renders `node.type === 'array'` with an `inner` object/primitive as `ArrayField` (`data-testid="array-<id>"`), rows `data-testid="array-row-<id>-<index>"`, buttons `aria-label="add"`, `remove`, `up`, `down`; `node.type === 'dict'` with a non-string `inner` as `DictObjectField`: key inputs (`aria-label="key"`) + a nested `Field` for the value, add/remove; both commit through `onChange(nextWhole)`, respecting `commit: 'blur'` by delegating to the inner fields (which already buffer) and committing structural changes (add/remove/reorder) immediately.

- [ ] **Step 1: Failing tests** — in `tests/schema-form.test.tsx` (read its `renderForm`/schema helpers first; the file builds `SchemaNode`s from real schemastery `toJSON()`):

```tsx
describe('SchemaForm — arrays of objects', () => {
  const schema = Schema.object({
    layers: Schema.array(Schema.object({ id: Schema.string().required(), z: Schema.number().default(0) })).default([]),
  });
  it('renders one row per item with the item’s fields', () => {
    renderForm(schema, { layers: [{ id: 'bg', z: 0 }, { id: 'reels', z: 10 }] });
    expect(screen.getAllByTestId(/^array-row-/)).toHaveLength(2);
    expect((screen.getAllByLabelText('id')[1] as HTMLInputElement).value).toBe('reels');
  });
  it('add appends an item from the inner defaults and commits at once', async () => {
    const onChange = renderForm(schema, { layers: [] });
    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    expect(onChange).toHaveBeenLastCalledWith({ layers: [{ z: 0 }] });
  });
  it('remove and up/down commit the reordered array', async () => {
    const onChange = renderForm(schema, { layers: [{ id: 'a', z: 0 }, { id: 'b', z: 1 }] });
    await userEvent.click(screen.getAllByRole('button', { name: 'up' })[1]);
    expect(onChange).toHaveBeenLastCalledWith({ layers: [{ id: 'b', z: 1 }, { id: 'a', z: 0 }] });
    await userEvent.click(screen.getAllByRole('button', { name: 'remove' })[0]);
    expect(onChange).toHaveBeenLastCalledWith({ layers: [{ id: 'a', z: 0 }] });
  });
  it('editing a field inside a row commits on blur under commit: blur, with the row replaced in place', async () => {
    const onChange = renderForm(schema, { layers: [{ id: 'a', z: 0 }] }, { commit: 'blur' });
    const z = screen.getByLabelText('z');
    await userEvent.clear(z);
    await userEvent.type(z, '5');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith({ layers: [{ id: 'a', z: 5 }] });
  });
});

describe('SchemaForm — dicts of objects', () => {
  const schema = Schema.object({
    scenes: Schema.dict(Schema.object({ layers: Schema.array(Schema.string()).default([]), transition: Schema.string() })).default({}),
  });
  it('renders a key input and a nested form per entry; add creates an entry once the key is typed and left', async () => {
    const onChange = renderForm(schema, { scenes: { base_game: { layers: ['bg'] } } });
    expect(screen.getByLabelText('key')).toHaveValue('base_game');
    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    await userEvent.type(screen.getAllByLabelText('key')[1], 'free_spins');
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith({ scenes: { base_game: { layers: ['bg'] }, free_spins: {} } });
  });
  it('an array of strings inside renders as a comma-free list of string inputs with add/remove', async () => {
    const onChange = renderForm(schema, { scenes: { base_game: { layers: ['bg'] } } });
    await userEvent.click(screen.getAllByRole('button', { name: 'add' })[0]);
    expect(onChange).toHaveBeenLastCalledWith({ scenes: { base_game: { layers: ['bg', ''] } } });
  });
});
```

Adapt `renderForm(schema, value, opts)` to the file's helper (it must return the `onChange` spy; add the `commit` option if the helper lacks it).

- [ ] **Step 2: RED**, **Step 3: Implement**

In `fields.tsx`, before the `UnsupportedField` fallback in `Field`:

```tsx
  if (node.type === 'array' && node.inner) {
    return <ArrayField id={id} node={node} value={value} onChange={onChange} commit={commit} />;
  }
  if (node.type === 'dict' && node.inner && node.inner.type !== 'string') {
    return <DictObjectField id={id} node={node} value={value} onChange={onChange} commit={commit} />;
  }
```

`ArrayField`: `items = (value ?? node.meta?.default ?? []) as unknown[]`; `defaults(inner)` = for an object inner, `{ ...each child.meta.default where defined }`, for a primitive its `meta.default ?? ''`; render `<div className="e8-array" data-testid={`array-${id}`}>`; each item: `<div className="e8-array-row" data-testid={`array-row-${id}-${i}`}>` with `<Field id={`${id}-${i}`} node={node.inner} value={item} onChange={(next) => onChange(replaceAt(items, i, next))} commit={commit} />` — for an object inner render `ObjectFields` so labels come from the child keys (`id`, `z`); then buttons `up` (disabled at 0), `down` (disabled at last), `remove`; after the rows an `add` button. Structural buttons call `onChange` immediately. A primitive string inner renders a plain `<input>` per item, committed on blur under `commit: 'blur'` (reuse `StringField`).

`DictObjectField`: like `DictField` (rows with `key`, `origin`, `dirty`) but the value column is `<Field node={node.inner} …>`; key edits buffer until the row's `key` input blurs (then `merge` renames the key, dropping the old one); value edits go straight through `onChange({ ...current, [key]: nextValue })` (the inner fields already buffer under `blur`); `add` appends a row with an empty key and `defaults(inner)`; the entry lands when the key is non-empty on blur; `remove` deletes at once.

Styles: `.e8-array-row { display: flex; gap: var(--e8-gap); align-items: flex-start; padding: 4px; border: 1px solid var(--e8-border); border-radius: var(--e8-radius-sm); margin-bottom: var(--e8-gap); }`, `.e8-array-row .e8-field { flex: 1; }`, `.e8-array-tools { display: flex; gap: 2px; }` — token colours only.

Existing tests: the `UnsupportedField` test for an array (if any) now renders an editor — update it to the new expectation and say so.

- [ ] **Step 4: GREEN, typecheck, prettier, commit**

```bash
git add engine/ide/client/src/schema-form/fields.tsx engine/ide/client/src/styles.css engine/ide/client/tests/schema-form.test.tsx
git commit -m "Teach the schema form arrays of objects and dicts of objects

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The Scenes screen

**Files:**
- Modify: `engine/ide/client/src/plugins/game-composition.tsx` (`stages`, `transitions` in state, parsed from `GET /api/composition`)
- Create: `engine/ide/client/src/plugins/scenes.tsx` (activity + document contribution), `engine/ide/client/src/screens/ScenesScreen.tsx`
- Modify: `engine/ide/client/src/context.ts` (compose `scenes` after `gameComposition`), `src/index.ts` (export), `src/styles.css`
- Test: `engine/ide/client/tests/scenes-screen.test.tsx`, `tests/game-composition.test.ts`

**Interfaces:**
- Consumes: `useGameComposition(ctx)` → `{ rows, diagnostics, stages, transitions }`; `ctx.gameComposition.update(id, config)`; `ctx.slots.register` (`shell.activity` key `scenes`, icon `layers`, order 35, opens `document`; `shell.document` key `scenes`, title `Scenes`).
- Produces (DOM contract for Task 7): `data-testid="scenes-screen"`; scene list items `data-testid="scene-<id>"` (click selects); `data-testid="scene-add"` with an inline `<input data-testid="scene-add-input">` (Enter); layer rows `data-testid="layer-<id>"` each with a checkbox `aria-label="<id> in <scene>"`, `up`/`down` buttons; a `<select data-testid="scene-transition">` listing `''` (stage default) + `transitions`; `data-testid="scene-show"` button ("Show in preview"); diagnostics of `plugin: 'scenes'` for the selected scene rendered under it; `data-testid="scenes-empty"` when no stage row exists.

**Semantics:** `stageRow = rows.find(r => r.schema && 'scenes' in (r.schema.dict ?? {}))` (a row whose schema has `scenes`), else the empty state. Every edit builds the full next `config` from `stageRow.config` and calls `update(stageRow.id, nextConfig)`: checkbox toggles membership of the layer in `scenes[selected].layers` (order of `layers` in a scene follows the stage's `layers` order); `up`/`down` swap the layer's `z` with its neighbour in z-order (`layers` array rewritten with swapped `z` values); transition select sets/clears `scenes[selected].transition`; `scene-add` adds `{ layers: all layer ids }` under the typed id (suggest ids from `stages` not yet scenes as `<datalist>`); "Show in preview" → `fetchFn(`${origin}/api/scenes/preview`, POST { scene })` and reports its diagnostics. The screen re-renders from the `game-composition` frame like Composition does (state comes from `useGameComposition`).

- [ ] **Step 1: Failing tests** — `tests/game-composition.test.ts`: the GET response `{ rows, diagnostics, schema: { stages: { base_game: {}, free_spins: {} } }, transitions: ['cut','fade'] }` yields `state.stages` `['base_game','free_spins']` and `state.transitions` `['cut','fade']`; missing fields → `[]`. `tests/scenes-screen.test.tsx` (harness = `createIdeClient` with a fake `fetchFn` answering `/api/composition` with a stage row `{ id: 'stage1', name: '@energy8engine/stage', hot: true, schema: <real stage Config toJSON>, config: { design: {…}, layers: [{id:'bg',z:0},{id:'reels',z:10}], scenes: { base_game: { layers: ['bg','reels'] } } } }`, and recording `PUT` bodies and `POST /api/scenes/preview`):

```tsx
  it('lists scenes and layers, checks the layers the selected scene shows', …);
  it('unchecking a layer PUTs the full config with it removed from the scene', …);   // body.config.scenes.base_game.layers === ['bg'] and design/layers untouched
  it('down on bg swaps z with reels', …);                                              // layers: [{id:'bg',z:10},{id:'reels',z:0}]
  it('choosing a transition writes it; the stage default clears it', …);
  it('adding a scene from a stage the script declares creates it with every layer', …); // free_spins offered; scenes.free_spins.layers === ['bg','reels']
  it('Show in preview POSTs the scene', …);                                            // /api/scenes/preview { scene: 'base_game' }
  it('without a stage row the screen says so', …);
  it('scenes diagnostics for the selected scene are shown under it', …);               // a diagnostic { plugin: 'scenes', where: 'base_game' } in the composition diagnostics
```

Write each with the DOM contract above; assert the recorded request bodies.

- [ ] **Step 2: RED**, **Step 3: Implement** — `game-composition.tsx`: parse `schema?.stages` keys and `transitions` from the GET body into state (`stages: string[]`, `transitions: string[]`), default `[]`; keep them across `game-composition` frames (frames carry rows only). `plugins/scenes.tsx`: `name = 'scenes'`, `inject = ['slots', 'gameComposition']`, two `ctx.effect(() => ctx.slots.register(...))` calls like `screen-demo`, component `ScenesScreen`. `screens/ScenesScreen.tsx`: the component per the semantics; two columns (`e8-scenes` grid: `220px 1fr`), reuse `.e8-explorer-entry`-like row styles or add `.e8-scenes-*` classes with tokens only. `context.ts`: `await ctx.plugin(scenes)` after `gameComposition`. `index.ts`: export `ScenesScreen`.

- [ ] **Step 4: GREEN, typecheck, prettier, commit**

```bash
git add engine/ide/client/src/plugins/game-composition.tsx engine/ide/client/src/plugins/scenes.tsx engine/ide/client/src/screens/ScenesScreen.tsx engine/ide/client/src/context.ts engine/ide/client/src/index.ts engine/ide/client/src/styles.css engine/ide/client/tests/scenes-screen.test.tsx engine/ide/client/tests/game-composition.test.ts
git commit -m "Add the Scenes screen: which layers each stage shows, in what order, with what transition

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: The browser — `scenes.spec.ts`

**Files:**
- Create: `engine/apps/web/tests/e2e/scenes.spec.ts`
- Modify (if needed): `engine/examples/first-slot/e8.patch.yml` — NOT modified: the stage row's `layers`/`scenes` come from schema defaults (`layers: [{id:'reels'}]`, `scenes: {}`); the e2e adds a scene through the screen. `first-slot/src/main.ts` exposes on `window.__e8` (already there from slice 13 — extend in Task 2 if not present): `sceneCurrent(): string | null` and `layerVisible(id): boolean | null` reading `ctx.reflect.get('stage')`. If Task 2 did not add these, add them now in BOTH main.ts files (byte-identical) and re-run `tests/template.test.ts`.

**Tests** (host per test via `projectCopy`/`startDevHost`; open the IDE at `http://127.0.0.1:5680/`; the preview iframe is `page.frameLocator('iframe')` — read `hot-fork.spec.ts` for how it reads `__e8` and counts spins/reloads):

1. `Scenes` activity opens the screen; it lists layer `reels`; `base_game` is offered by `scene-add` (script stage) — add it → `e8.patch.yml` on disk contains `scenes:` with `base_game` and `layers: [reels]`; the preview did NOT reload (the reload counter / iframe identity as `hot-fork.spec.ts` measures).
2. Uncheck `reels` in `base_game` → preview not reloaded; after one spin (`__e8.spin()`), `__e8.layerVisible('reels')` is `false` and `__e8.sceneCurrent()` is `'base_game'`; re-check → `true`.
3. Add a scene `free_spins` is NOT offered (the script has no such stage) — type it manually → the screen shows the `scenes` warning ("has no stage of that name"); set its transition to `fade`; "Show in preview" → `__e8.sceneCurrent()` becomes `'free_spins'` within 2 s.
4. Composition screen: the `stage1` form now shows `layers` as rows (`array-row-…`) and `design.width` still carries the `restart` badge; changing `design.width` reloads the preview (reload counter +1).

Run alone (`npx playwright test tests/e2e/scenes.spec.ts`, expect 4 passed), then the full suite alone (expect 105 = 101 + 4). Post-run checks per Global Constraints. Commit:

```bash
git add engine/apps/web/tests/e2e/scenes.spec.ts engine/templates/slot-basic/src/main.ts engine/examples/first-slot/src/main.ts
git commit -m "Prove scenes in a browser: a layer hidden without a reload, a scene pushed into the preview

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** §2 layers/scenes/enter/current → T1; transitions registry + cut/fade + policy → T1; who enters → T2; hot + `restartKeys` nested → T1 (manifest) + T3; remount → T1 (`destroy` detaches) + T2 (reels follows, tested against the real stage runtime); `checkScenes` three rules + dup → T3; `SchemaForm` arrays/dicts → T5; Scenes screen + preview push + transitions list → T3/T4/T6; wire (contracts) → T3; §4 refusals → T1/T2/T3; §5 units and Playwright → each task + T7.
- **Placeholders.** T3's `recheck` subscription and "no preview running" warning name a lookup the implementer must do ("say which in the report") — measured facts, not TBDs; T6's tests are listed as titles with the exact assertion in a comment — the DOM contract and semantics blocks carry the values. T4's `boot(services)` helper is shaped after the file's own.
- **Type consistency.** `Stage.layer/layers/enter/current`, `TransitionsService.register/get/ids/subscribe`, `TickerLike`, `TransitionRun` (T1) used by T2 (`layer`), T4 (`enter`, `ids`, `subscribe`), T6/T7 (`sceneCurrent`, `layerVisible` via `__e8`). Frames `scene-preview { scene }` / `game-transitions { ids }` (T3 contracts) used by T3 rpc, T4 bridge, T6 screen. `restartKeys` nested (T3) is what T7's step 4 asserts. Testids: `scene-<id>`, `scene-add`, `scene-add-input`, `layer-<id>`, `scene-transition`, `scene-show`, `scenes-empty`, `array-row-<id>-<i>` — T6 defines, T7 uses.
