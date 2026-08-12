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
  guard('showLoader', () => overlay.showLoader());
}

/**
 * Report boot progress, as a 0..1 fraction, to a game-supplied overlay.
 *
 * NOT the asset-loading progress the built-in preloader shows — that belongs to
 * the engine's own loading screen, which by then has taken over. This is the
 * pre-first-frame boot: bundle up, Pixi up, SDK handshake done.
 *
 * Sending it is deliberate, not decorative. Artube's loader crossfades from its
 * dark partner phase to the green Artube-branded phase **on the first
 * `updateProgress` with a value above zero**, and their branding is the entire
 * reason a game uses their loader. A boot that never reported progress would
 * hand over while still on the partner phase, and the player would never see
 * the brand the loader exists to show.
 *
 * The value is converted to the PERCENTAGE (0–100) that
 * `ILoaderViewController.updateProgress` documents, and clamped monotonic.
 */
export function advanceExternalOverlay(fraction: number): void {
  if (!adopted) return;
  const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  if (clamped <= lastProgress) return;
  lastProgress = clamped;
  const overlay = adopted;
  guard('updateProgress', () => overlay.updateProgress(clamped * 100));
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
  const overlay = adopted;
  if (!overlay) return false;
  adopted = null;
  lastProgress = 0;
  guard('hideLoader', () => overlay.hideLoader());
  return true;
}
