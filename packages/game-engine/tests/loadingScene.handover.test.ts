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
  releaseExternalOverlay,
  removeCSSPreloader,
  createCSSPreloader,
  hasExternalOverlay,
} from '@energy8platform/platform-core/loading';
import { LoadingScene } from '../src/loading/LoadingScene';

const PRELOADER_ID = '__ge-css-preloader__';

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
    overlay: {
      showLoader: () => void log.push('show'),
      updateProgress: (v: number) => void log.push(`progress:${v}`),
      hideLoader: () => {
        log.push('hide');
        preloaderAtHide = document.getElementById(PRELOADER_ID) !== null;
        brandAtHide = document.querySelector('#ge-vm-loader-rect') !== null;
        framesBeforeHide = frames;
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
    adoptExternalOverlay(w.overlay);

    const scene = new LoadingScene();
    await scene.onEnter({ engine: fakeEngine(container), targetScene: 'game' });

    expect(w.log).toContain('hide');
    // The property that matters: our overlay was already in the document when theirs went away.
    expect(w.preloaderAtHide).toBe(true);
  });

  it('waits for a painted frame — not just for the element to be inserted', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay);

    const scene = new LoadingScene();
    await scene.onEnter({ engine: fakeEngine(container), targetScene: 'game' });

    // Inserting an element only queues a frame. At least one full animation frame must have gone
    // by before the dismissal, or "mounted" and "visible" are not the same thing.
    expect(w.framesBeforeHide).toBeGreaterThanOrEqual(1);
  });

  it('gives the overlay back its ownership — the engine no longer holds it', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay);

    const scene = new LoadingScene();
    await scene.onEnter({ engine: fakeEngine(container), targetScene: 'game' });

    expect(hasExternalOverlay()).toBe(false);
    // Exactly one dismissal, even though the scene also removes the preloader on the way out.
    expect(w.log.filter((c) => c === 'hide')).toHaveLength(1);
  });

  it('hands over to the game’s OWN branded screen, already rendered', async () => {
    const w = witness();
    adoptExternalOverlay(w.overlay);

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
    adoptExternalOverlay(w.overlay);

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
