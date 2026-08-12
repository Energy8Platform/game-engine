/**
 * A loading overlay the GAME owns, covering the gap the engine cannot: from the
 * browser's first paint until the engine's own loading screen is on screen.
 *
 * The case this exists for is Artube. Their platform ships a branded loader
 * whose markup a Vite plugin injects into `index.html`, so it is painted before
 * the game bundle has even been fetched — earlier than any engine code can
 * possibly run. That window (bundle download → Pixi init → SDK handshake) is
 * otherwise a blank page.
 *
 * ── Where it stops ──────────────────────────────────────────────────────────
 * It stops the moment the engine's own loading screen has painted its first
 * frame. From there the player gets the engine's brand, the engine's progress
 * bar and the engine's tap-to-start — exactly as on every other target. The
 * external overlay covers the gap; it does not replace the loading screen.
 *
 * (This inverts an earlier design in which the external overlay REPLACED the
 * CSS preloader for the whole boot. Handing over at the first frame keeps the
 * game's own loading identity on every platform and leaves the built-in
 * preloader's code path untouched — `CSSPreloader.ts` knows nothing about any
 * of this, so non-Artube targets cannot be affected by a change here.)
 *
 * ── Structural, not nominal ─────────────────────────────────────────────────
 * Nothing in `@energy8platform` names Artube's controller. The game passes an
 * instance; we describe the shape (`ExternalLoadingOverlay`). Artube's vendored
 * `LoaderViewController` (`@energy8platform/artube-bridge/loader`) satisfies it
 * with no adapter.
 *
 * ── Module-level state ──────────────────────────────────────────────────────
 * Singleton, like the CSS preloader next door, and for the same reason: the
 * three call sites (boot, hand-over, failure path) are in different files and
 * there is exactly one loading screen per page.
 */
import type { ExternalLoadingOverlay } from '../types';

let adopted: ExternalLoadingOverlay | null = null;
/** Last value pushed, so a repeated milestone cannot walk the bar backwards. */
let lastProgress = 0;
/** When the overlay was adopted — the origin the reveal delay below is measured from. */
let adoptedAt = 0;
/** Highest progress reported while the reveal was still held back. */
let pending = 0;
let revealTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * How long an overlay must have been on screen before the FIRST progress value
 * is allowed through.
 *
 * This exists because of a real, measured failure. Artube's loader is two-phase:
 * a dark screen carrying (by default) their own wordmark, crossfading over 500ms
 * into the green branded screen with the progress bar — and that crossfade is
 * triggered by the first `updateProgress` above zero. On a warm local boot the
 * whole gap this overlay covers was 375ms end to end: the crossfade started at
 * 375ms and the hand-over dismissed the loader 39ms later, so the branded phase
 * never resolved and the player saw an aborted transition instead of either
 * screen (evidence: `.superpowers/sdd/2026-08-10-artube-integration/`).
 *
 * Starting the crossfade EARLIER does not fix that — it is a 500ms animation in
 * a 375ms window. So: hold the first value back, and let a boot that finishes
 * quickly stay on the first phase, whole and clean, all the way to the
 * hand-over. A boot still going at this mark is one where the branded phase has
 * time to resolve and a moving bar is worth having, so from there progress
 * flows straight through.
 *
 * 800ms = their 500ms crossfade plus a 300ms margin (which is also exactly the
 * length of their dismissal fade — the other animation that must not collide
 * with it). It is a judgement call about someone else's animation timings, not
 * a derived constant; if their loader's transitions change, this moves with it.
 */
const REVEAL_DELAY_MS = 800;

/**
 * Call into the game's overlay without letting it break the boot. A third-party
 * controller is outside our control (Artube's throws if its markup is missing,
 * for one), and none of these calls is worth failing a game over — least of all
 * `hideLoader`, where a throw escaping the teardown path is exactly how an
 * overlay ends up stranded on screen forever.
 */
function guard(method: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    console.warn(`[GameEngine] loading overlay ${method}() threw`, err);
  }
}

/** Whether a game-supplied overlay is currently on screen and owned by us. */
export function hasExternalOverlay(): boolean {
  return adopted !== null;
}

/**
 * Take ownership of the game's overlay: from here on the engine is responsible
 * for taking it down, including when the boot fails.
 *
 * Called BEFORE anything in the boot that can throw — notably before the
 * container selector is resolved. Until the engine has adopted it, nothing can
 * dismiss it, and Artube's is already on screen from `index.html`.
 *
 * `showLoader()` is Artube's "reveal the progress affordance"; it does not
 * switch their two-phase screen to the branded phase — only progress does, see
 * {@link advanceExternalOverlay}.
 */
export function adoptExternalOverlay(overlay: ExternalLoadingOverlay): void {
  if (adopted) return; // idempotent: boot step 0 and step 2 both reach here
  adopted = overlay;
  lastProgress = 0;
  pending = 0;
  adoptedAt = Date.now();
  guard('showLoader', () => overlay.showLoader());
}

/** Push a value through to the overlay, in the 0–100 percentage it documents. */
function send(fraction: number): void {
  if (!adopted || fraction <= lastProgress) return;
  lastProgress = fraction;
  const overlay = adopted;
  guard('updateProgress', () => overlay.updateProgress(fraction * 100));
}

/**
 * Report boot progress, as a 0..1 fraction, to a game-supplied overlay.
 *
 * NOT the asset-loading progress the built-in preloader shows — that belongs to
 * the engine's own loading screen, which by then has taken over. This is the
 * pre-first-frame boot: bundle up, Pixi up, SDK handshake done.
 *
 * Sending it is deliberate, not decorative — and so is holding the first value
 * back for {@link REVEAL_DELAY_MS}, which is where the subtlety lives. Artube's
 * loader crossfades to its branded phase on the first progress above zero; on a
 * boot short enough that the crossfade cannot finish, starting it at all is
 * worse than not starting it. Read the constant's comment before changing this.
 *
 * Values are clamped to 0..1, kept monotonic, and converted to the PERCENTAGE
 * (0–100) that `ILoaderViewController.updateProgress` documents.
 */
export function advanceExternalOverlay(fraction: number): void {
  if (!adopted) return;
  const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  if (clamped <= Math.max(lastProgress, pending)) return;

  const waited = Date.now() - adoptedAt;
  if (waited >= REVEAL_DELAY_MS) {
    send(clamped);
    return;
  }

  // Too early to start their crossfade. Remember the value; if the boot is still
  // running when the delay is up, the LATEST one goes out then — a stale early
  // milestone would understate how far the boot actually got.
  pending = clamped;
  if (revealTimer === null) {
    revealTimer = setTimeout(() => {
      revealTimer = null;
      const value = pending;
      pending = 0;
      // `adopted` may be null by now: a boot that finished inside the delay
      // handed over and released, which is exactly the case this defers for.
      send(value);
    }, REVEAL_DELAY_MS - waited);
  }
}

/**
 * Dismiss the overlay and forget it. Idempotent — this is reached both on the
 * normal hand-over and defensively from the failure paths, and a second
 * `hideLoader()` must not fire.
 *
 * @returns whether this call is the one that dismissed it. Callers that can run
 * BEFORE adoption (`createSlotGame`'s `fatal`, which refuses some launches
 * before `GameApplication` exists) use the `false` to fall back to hiding the
 * game's overlay directly.
 */
export function releaseExternalOverlay(): boolean {
  // Drop a deferred first progress even if there is nothing to release: a timer
  // that fired after the hand-over would start a crossfade on an overlay already
  // fading out, and would keep the process alive in Node-side tests.
  if (revealTimer !== null) {
    clearTimeout(revealTimer);
    revealTimer = null;
  }
  pending = 0;

  const overlay = adopted;
  if (!overlay) return false;
  adopted = null;
  lastProgress = 0;
  guard('hideLoader', () => overlay.hideLoader());
  return true;
}
