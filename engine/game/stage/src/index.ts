/**
 * `stage`: scenes, layers, viewport, resize (§4 of the design spec). A
 * fixed design-resolution root `Container`, scaled and centred to fit
 * whatever viewport the renderer actually has, holding one child
 * `Container` per declared **layer** (ordered by `z`). A **scene** names
 * the layers it shows; `enter(scene)` flips visibility and runs a
 * **transition** (`cut`, `fade`, or anything registered) between the
 * layers leaving and the layers arriving. Rows mount their views into a
 * layer (`stage.layer('reels')`); the stage never destroys those views —
 * `destroy()` detaches them first, so a hot re-apply keeps them alive.
 *
 * `Container` itself was measured (alongside `createReelSystem`, in
 * Task 9's spike) to build and be fully manipulable headlessly in plain
 * Node — no live pixi `Application` needed for scene-graph objects, only
 * for rendering them to a screen. So unlike `renderer-pixi`, this module
 * IS unit-testable end to end: `fitStage` is plain arithmetic, and
 * `createStage`'s `resize()` is checked against a real (unrendered)
 * `Container`'s own `scale`/`position`, not a mock.
 */
import { Container } from 'pixi.js';
import { diagnostic, type Diagnostic } from '@energy8engine/contracts';
import { createRegistry } from '@energy8engine/registry';

export interface Size {
  width: number;
  height: number;
}

export interface Fit {
  scale: number;
  x: number;
  y: number;
}

/**
 * How a fixed `design` resolution maps onto an arbitrary `viewport`:
 * `'contain'` (default) fits the whole design inside the viewport,
 * letterboxed; `'cover'` fills the viewport, cropping the design.
 * Either way the result is centred.
 */
export function fitStage(viewport: Size, design: Size, mode: 'contain' | 'cover' = 'contain'): Fit {
  const scaleX = viewport.width / design.width;
  const scaleY = viewport.height / design.height;
  const scale = mode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  return {
    scale,
    x: (viewport.width - design.width * scale) / 2,
    y: (viewport.height - design.height * scale) / 2,
  };
}

export interface LayerSpec {
  id: string;
  /** Draw order, low first; ties keep declaration order. */
  z?: number;
}

export interface SceneSpec {
  /** Layer ids visible in this scene. */
  layers: string[];
  /** Transition id; the stage default when empty. */
  transition?: string;
}

export interface LayerView {
  id: string;
  z: number;
  container: Container;
}

/** The slice of pixi's `Ticker` a transition drives on — a hand-driven fake in tests. */
export interface TickerLike {
  add(fn: (t: { deltaMS: number }) => void): unknown;
  remove(fn: (t: { deltaMS: number }) => void): unknown;
}

export interface TransitionRun {
  /** Layers leaving — visible while `run` is pending, hidden by the stage after it. */
  from: Container[];
  /** Layers arriving — made visible by the stage before `run`. */
  to: Container[];
  /** `null` where nothing ticks (headless); a transition then finishes at once. */
  ticker: TickerLike | null;
  ms: number;
}

export interface Transition {
  id: string;
  run(t: TransitionRun): Promise<void>;
}

export interface TransitionsService {
  /** The incumbent keeps a taken id: a collision reports an error and returns a no-op. */
  register(t: Transition): () => void;
  get(id: string): Transition | undefined;
  ids(): string[];
  /** Hears every register and retract. */
  subscribe(listener: () => void): () => void;
}

export function createTransitions(report: (d: Diagnostic) => void = () => {}): TransitionsService {
  const registry = createRegistry<Transition>({ policy: 'first-wins' });
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((fn) => fn());
  return {
    register(t) {
      if (registry.get(t.id) !== undefined) {
        report(
          diagnostic(
            'error',
            'stage',
            t.id,
            `a second transition registered as "${t.id}" — the first keeps it`,
            'give it an id of its own',
          ),
        );
        return () => {};
      }
      const off = registry.add(t.id, t);
      notify();
      return () => {
        if (registry.get(t.id) !== t) return;
        off();
        notify();
      };
    },
    get: (id) => registry.get(id),
    ids: () => [...registry.keys()],
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** Resolves at once; visibility alone does the switch. */
export const cut: Transition = { id: 'cut', run: () => Promise.resolve() };

/**
 * Cross-fades alpha over `ms` on the ticker: `to` climbs 0 → 1 while
 * `from` sinks 1 → 0, and both end at 1 (hiding `from` is the stage's
 * job). With no ticker it behaves as `cut`.
 */
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

export interface Stage {
  /** The design-resolution root; the layers are its children. */
  readonly container: Container;
  /** The layer's container — mount game content (e.g. `ReelsBoard.view`) into this. */
  layer(id: string): Container | undefined;
  /** By z ascending, ties by declaration order — the draw order. */
  layers(): readonly LayerView[];
  /** Shows the scene's layers, hides the rest, through its transition. The same scene again is a no-op. */
  enter(scene: string): Promise<void>;
  current(): string | null;
  /** Re-fits `container` to a new viewport size; returns the fit it applied. */
  resize(viewportWidth: number, viewportHeight: number): Fit;
  /** Detaches whatever rows mounted into the layers, then destroys only what the stage built. */
  destroy(): void;
}

export interface CreateStageOptions {
  /** Parent to mount the stage container into — typically a renderer's `app.stage`. */
  root: Container;
  design: Size;
  mode?: 'contain' | 'cover';
  /** Default: one layer, `reels`. */
  layers?: LayerSpec[];
  scenes?: Record<string, SceneSpec>;
  /** Default transition id when a scene names none; `cut` when absent. */
  transition?: string;
  transitionMs?: number;
  /** Where transition ids resolve; a private registry holding `cut` when absent. */
  transitions?: TransitionsService;
  ticker?: TickerLike | null;
  report?: (d: Diagnostic) => void;
}

export function createStage(options: CreateStageOptions): Stage {
  const { report = () => {} } = options;
  const container = new Container();
  options.root.addChild(container);
  const views: LayerView[] = (options.layers ?? [{ id: 'reels', z: 0 }])
    .map((spec, index) => ({ id: spec.id, z: spec.z ?? 0, index, container: new Container() }))
    .sort((a, b) => a.z - b.z || a.index - b.index)
    .map(({ id, z, container: c }) => ({ id, z, container: c }));
  Object.freeze(views);
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
      // Warned only when the row declares scenes at all: a stage that
      // declares none shows every layer in every scene by design, and
      // there is nothing to cross-check the name against — the same rule
      // the host's `checkScenes` applies to "stage has no scene".
      const declared = Object.keys(options.scenes ?? {}).length > 0;
      if (!spec && declared && !warned.has(scene)) {
        warned.add(scene);
        report(
          diagnostic(
            'warning',
            'stage',
            scene,
            `scene "${scene}" is not declared — every layer is shown`,
            'declare it under stage1.config.scenes',
          ),
        );
      }
      const to = spec ? views.filter((v) => spec.layers.includes(v.id)) : views;
      const from = views.filter((v) => v.container.visible && !to.includes(v));
      const wanted = spec?.transition ?? options.transition ?? 'cut';
      let transition = transitions.get(wanted);
      if (!transition) {
        report(
          diagnostic(
            'warning',
            'stage',
            wanted,
            `transition "${wanted}" is not registered — cut instead`,
            'register it, or pick one that is',
          ),
        );
        transition = cut;
      }
      // ponytail: concurrent `enter` calls are not queued — the play loop
      // enters scenes one after another; a promise chain is the upgrade if
      // a second caller ever races this one.
      current = scene;
      // `to` shows before the run (a fade-in is seen); `from` hides only
      // after it (a fade-out is seen).
      for (const v of to) v.container.visible = true;
      try {
        await transition.run({
          from: from.map((v) => v.container),
          to: to.map((v) => v.container),
          ticker: options.ticker ?? null,
          ms: options.transitionMs ?? 300,
        });
      } catch (error) {
        report(
          diagnostic(
            'error',
            'stage',
            transition.id,
            `transition "${transition.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
      for (const v of views) {
        if (!to.includes(v)) v.container.visible = false;
        v.container.alpha = 1;
      }
    },
    resize(viewportWidth, viewportHeight) {
      const fit = fitStage(
        { width: viewportWidth, height: viewportHeight },
        options.design,
        options.mode,
      );
      container.scale.set(fit.scale);
      container.position.set(fit.x, fit.y);
      return fit;
    },
    destroy() {
      // Never destroy what other rows mounted — into a layer, or straight
      // onto the root (where `reels` mounts today): detach it all first,
      // then destroy only the containers this stage built.
      for (const v of views) {
        v.container.removeChildren();
        v.container.destroy();
      }
      container.removeChildren();
      options.root.removeChild(container);
      container.destroy();
    },
  };
}
