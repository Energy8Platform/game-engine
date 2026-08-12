// @vitest-environment jsdom

/**
 * The seam: a game-supplied loading overlay (Artube's) covers the gap the engine cannot paint —
 * bundle download, Pixi init, SDK handshake — and hands the screen to the engine's own loading
 * screen at its first painted frame.
 *
 * The failure this suite exists to catch is a single frame long and invisible in code review: if
 * the overlay is dismissed before our preloader has been painted, the player sees a flash of bare
 * background between two loading screens. The ordering is therefore asserted from inside the
 * overlay's own `hideLoader()` — the only place that can observe what was on screen at the instant
 * it was dismissed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  adoptExternalOverlay,
  advanceExternalOverlay,
  releaseExternalOverlay,
  removeCSSPreloader,
  createCSSPreloader,
  hasExternalOverlay,
} from '@energy8platform/platform-core/loading';
import { LoadingScene } from '../src/loading/LoadingScene';

const PRELOADER_ID = '__ge-css-preloader__';
/**
 * The powered-by splash plus the brand floor, which every start waits out on every target — the
 * one gate that is NOT the tap. Mirrors `platform-core/src/loading/splash.ts`.
 */
const BRAND_GATE_MS = 3000;

let container: HTMLElement;

function makeContainer(): HTMLElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.appendChild(document.createElement('canvas'));
  return el;
}

function fakeEngine(host: HTMLElement, loading: Record<string, unknown> = {}) {
  return {
    config: {
      loading: { tapToStart: false, minDisplayTime: 0, ...loading },
      manifest: { bundles: [] },
    },
    assets: {
      init: async () => {},
      getBundleNames: () => [] as string[],
      isBundleLoaded: () => false,
      loadBundle: async () => {},
      loadBundles: async () => {},
    },
    audio: { init: async () => {} },
    app: { canvas: host.querySelector('canvas') },
    scenes: { goto: async () => {} },
  };
}

/** Records what the DOM looked like at the moment each method was called. */
function witness() {
  const log: string[] = [];
  let preloaderAtHide: boolean | null = null;
  let brandAtHide: boolean | null = null;
  let framesBeforeHide = 0;
  let hiddenAt = 0;
  let frames = 0;
  const tick = () => {
    frames++;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return {
    log,
    get preloaderAtHide() {
      return preloaderAtHide;
    },
    /** Whether the mounted preloader had actually rendered its variant's artwork by then. */
    get brandAtHide() {
      return brandAtHide;
    },
    get framesBeforeHide() {
      return framesBeforeHide;
    },
    /** Wall-clock instant the overlay was dismissed — the minimum-display assertions read this. */
    get hiddenAt() {
      return hiddenAt;
    },
    overlay: {
      showLoader: () => void log.push('show'),
      updateProgress: (v: number) => void log.push(`progress:${v}`),
      hideLoader: () => {
        log.push('hide');
        preloaderAtHide = document.getElementById(PRELOADER_ID) !== null;
        brandAtHide = document.querySelector('#ge-vm-loader-rect') !== null;
        framesBeforeHide = frames;
        hiddenAt = Date.now();
      },
    },
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  container = makeContainer();
});

afterEach(async () => {
  releaseExternalOverlay();
  await removeCSSPreloader(container);
  container.remove();
});

describe('LoadingScene hands over from a game-supplied overlay', () => {
  it('mounts the engine’s loading screen BEFORE dismissing the overlay', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay, 0);

    const scene = new LoadingScene();
    await scene.onEnter({ engine: fakeEngine(container), targetScene: 'game' });

    expect(w.log).toContain('hide');
    // The property that matters: our overlay was already in the document when theirs went away.
    expect(w.preloaderAtHide).toBe(true);
  });

  it('waits for a painted frame — not just for the element to be inserted', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay, 0);

    const scene = new LoadingScene();
    await scene.onEnter({ engine: fakeEngine(container), targetScene: 'game' });

    // Inserting an element only queues a frame. At least one full animation frame must have gone
    // by before the dismissal, or "mounted" and "visible" are not the same thing.
    expect(w.framesBeforeHide).toBeGreaterThanOrEqual(1);
  });

  it('gives the overlay back its ownership — the engine no longer holds it', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay, 0);

    const scene = new LoadingScene();
    await scene.onEnter({ engine: fakeEngine(container), targetScene: 'game' });

    expect(hasExternalOverlay()).toBe(false);
    // Exactly one dismissal, even though the scene also removes the preloader on the way out.
    expect(w.log.filter((c) => c === 'hide')).toHaveLength(1);
  });

  it('hands over to the game’s OWN branded screen, already rendered', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay, 0);

    const scene = new LoadingScene();
    // The game's loading config is honoured on this path like any other — it is the engine's
    // loading screen now, not a placeholder. `voidmoon` renders `#ge-vm-loader-rect`.
    await scene.onEnter({
      engine: fakeEngine(container, { preloaderVariant: 'voidmoon' }),
      targetScene: 'game',
    });

    expect(w.brandAtHide).toBe(true);
  });

  it('measures minDisplayTime from the hand-over, not from before it', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay, 0);

    const scene = new LoadingScene();
    const started = Date.now();
    await scene.onEnter({
      engine: fakeEngine(container, { minDisplayTime: 120 }),
      targetScene: 'game',
    });

    // The player must get the full minimum on OUR screen. Anything measured from before the
    // hand-over would let a slow boot swallow it whole.
    expect(Date.now() - started).toBeGreaterThanOrEqual(110);
  });
});

/**
 * The overlay's own minimum. The gap it covers can be a few hundred milliseconds, which shows a
 * partner's branding to nobody — so the hand-over waits before it takes the screen, rather than
 * dismissing the overlay the instant the engine is ready.
 */
describe('the hand-over waits out the overlay’s minimum display time', () => {
  it('does not dismiss the overlay before its minimum has elapsed', async () => {
    const w = witness();
    const adoptedAt = Date.now();
    adoptExternalOverlay(w.overlay, 300);

    const scene = new LoadingScene();
    await scene.onEnter({
      engine: fakeEngine(container, { minDisplayTime: 0 }),
      targetScene: 'game',
    });

    expect(w.hiddenAt - adoptedAt).toBeGreaterThanOrEqual(295);
    // And the seam still holds: waiting must not have cost the ordering guarantee.
    expect(w.preloaderAtHide).toBe(true);
  });

  it('mounts nothing of ours while their screen is still owed the time', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay, 300);

    const scene = new LoadingScene();
    const done = scene.onEnter({
      engine: fakeEngine(container, { minDisplayTime: 0 }),
      targetScene: 'game',
    });

    // Waiting BEFORE mounting is what keeps the two timelines from overlapping — our powered-by
    // splash and brand floor start when the player can see them, not behind someone else's screen.
    await new Promise((r) => setTimeout(r, 120));
    expect(document.getElementById(PRELOADER_ID)).toBeNull();
    expect(w.log).toEqual(['show']);

    await done;
    expect(w.log).toContain('hide');
  });

  it('holds long enough for a late phase crossfade to finish', async () => {
    const w = witness();
    const adoptedAt = Date.now();
    adoptExternalOverlay(w.overlay, 100);
    // Their partner→branded crossfade runs 500ms and starts on the first progress above zero. One
    // that starts near the floor must not be cut: a half-formed gradient over a bar that never
    // fills is the artefact this integration hit once and rejected.
    advanceExternalOverlay(0.35);

    const scene = new LoadingScene();
    await scene.onEnter({
      engine: fakeEngine(container, { minDisplayTime: 0 }),
      targetScene: 'game',
    });

    expect(w.log).toContain('progress:35');
    expect(w.hiddenAt - adoptedAt).toBeGreaterThanOrEqual(490);
  }, 10000);
});

/**
 * `tapToStart` must mean the same thing here as on every other target. The external overlay has no
 * part in it: by the time the gate is reached it has been dismissed, and the player is looking at
 * the engine's own loading screen.
 */
describe('the tap gate on the external-overlay path', () => {
  const tapText = () => document.body.textContent?.includes('TAP TO START') ?? false;

  it('with tapToStart:false the game is entered with no input at all', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay, 0);

    let entered = false;
    const engine = fakeEngine(container, { tapToStart: false, minDisplayTime: 0 });
    engine.scenes.goto = async () => {
      entered = true;
    };

    const scene = new LoadingScene();
    await scene.onEnter({ engine, targetScene: 'game' });

    // No pointerdown was ever dispatched.
    expect(entered).toBe(true);
    expect(tapText()).toBe(false);
  }, 15000);

  it('with tapToStart:true it still waits for a pointerdown', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay, 0);

    let entered = false;
    const engine = fakeEngine(container, { tapToStart: true, minDisplayTime: 0 });
    engine.scenes.goto = async () => {
      entered = true;
    };

    const scene = new LoadingScene();
    const done = scene.onEnter({ engine, targetScene: 'game' });

    // Past the powered-by splash and the brand floor, which gate BOTH settings — so what is left
    // holding the boot here can only be the tap.
    await new Promise((r) => setTimeout(r, BRAND_GATE_MS + 200));
    expect(entered).toBe(false);
    expect(tapText()).toBe(true);

    document.getElementById(PRELOADER_ID)!.dispatchEvent(new Event('pointerdown'));
    await done;
    expect(entered).toBe(true);
  }, 15000);
});

describe('with no external overlay the scene behaves exactly as before', () => {
  it('drives the preloader the boot mounted, and mounts no second one', async () => {
    // Stand in for boot step 2, which is where the preloader comes from on every other target.
    createCSSPreloader(container, { tapToStart: false, minDisplayTime: 0 });
    expect(document.querySelectorAll(`#${PRELOADER_ID}`)).toHaveLength(1);

    const scene = new LoadingScene();
    await scene.onEnter({ engine: fakeEngine(container), targetScene: 'game' });

    // The hand-over path is the ONLY thing that mounts a preloader late; without an adopted
    // overlay the scene must not go anywhere near it, or non-Artube games get two.
    expect(document.querySelectorAll(`#${PRELOADER_ID}`)).toHaveLength(0); // removed on transition
  });
});
