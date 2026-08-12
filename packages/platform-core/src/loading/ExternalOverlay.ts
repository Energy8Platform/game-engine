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
 * It stops once BOTH are true: the engine's own loading screen has painted its
 * first frame, and the overlay has had its guaranteed time on screen
 * ({@link DEFAULT_EXTERNAL_MIN_DISPLAY_MS}, `loading.externalOverlayMinDisplayTime`).
 * The gap alone is often only a few hundred milliseconds, which is not long
 * enough for a partner's branding to register — let alone for their two-phase
 * screen to reach its second phase.
 *
 * From there the player gets the engine's brand, the engine's progress bar and
 * the engine's tap-to-start — exactly as on every other target. The external
 * overlay covers the gap; it does not replace the loading screen, and it has no
 * say in the tap gate: by then the player is looking at OUR screen.
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
/** When the overlay was adopted — the origin the minimum display time is measured from. */
let adoptedAt = 0;
/** How long this overlay is owed on screen; see {@link DEFAULT_EXTERNAL_MIN_DISPLAY_MS}. */
let minDisplayMs = 0;
/** When the first progress went out, i.e. when their phase crossfade started. 0 = not yet. */
let crossfadeStartedAt = 0;
/** The one pending timer: the hand-over waiting out the floor below. */
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let holdResolve: (() => void) | null = null;

/**
 * How long a game-supplied overlay is guaranteed on screen, measured from
 * adoption (which is the first thing the boot does, so in practice from the
 * page's first paint).
 *
 * Without a floor the overlay lives exactly as long as the gap it covers, and
 * that gap is short: a warm local boot handed over at ~500ms and dismissed
 * their screen at ~840ms. A partner's branding that flashes past in under a
 * second has not been shown. 1500ms is the user's number, and it is also the
 * smallest one that fits their two-phase screen whole — a 500ms crossfade into
 * the branded phase plus time to read it — with room for the 300ms dismissal
 * fade on top.
 *
 * Overridable per game: `loading.externalOverlayMinDisplayTime`.
 */
export const DEFAULT_EXTERNAL_MIN_DISPLAY_MS = 1500;

/**
 * Artube's partner→branded crossfade, `transition: opacity 0.5s ease` in the
 * markup their Vite plugin injects (vendored verbatim in
 * `@energy8platform/artube-server/vite`). It is triggered by the first
 * `updateProgress` above zero.
 *
 * The floor below is extended to cover it because a crossfade that starts and
 * then gets cut is worse than one that never starts: the player sees a
 * half-formed gradient and a bar that never fills — the three-screens-at-once
 * artefact this integration hit once and rejected (evidence:
 * `rejected-immediate-progress-01-Lartube_P_C.png`). Extending the floor is
 * bounded by construction: only the FIRST progress starts it, and every
 * progress value comes from a boot milestone that precedes the hand-over.
 */
const PHASE_CROSSFADE_MS = 500;

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
 *
 * @param minDisplayMillis how long the overlay is owed on screen before the
 * hand-over may dismiss it (`loading.externalOverlayMinDisplayTime`); defaults
 * to {@link DEFAULT_EXTERNAL_MIN_DISPLAY_MS}. Adoption is where the clock
 * starts, so it is taken here rather than read at the hand-over.
 */
export function adoptExternalOverlay(
  overlay: ExternalLoadingOverlay,
  minDisplayMillis?: number,
): void {
  if (adopted) return; // idempotent: boot step 0 and step 2 both reach here
  adopted = overlay;
  lastProgress = 0;
  crossfadeStartedAt = 0;
  minDisplayMs =
    typeof minDisplayMillis === 'number' && Number.isFinite(minDisplayMillis)
      ? Math.max(0, minDisplayMillis)
      : DEFAULT_EXTERNAL_MIN_DISPLAY_MS;
  adoptedAt = Date.now();
  guard('showLoader', () => overlay.showLoader());
}

/**
 * Report boot progress, as a 0..1 fraction, to a game-supplied overlay.
 *
 * NOT the asset-loading progress the built-in preloader shows — that belongs to
 * the engine's own loading screen, which by then has taken over. This is the
 * pre-first-frame boot: bundle up, Pixi up, SDK handshake done.
 *
 * Sending it is deliberate, not decorative: Artube's loader only crossfades to
 * its BRANDED phase on the first value above zero, so without progress the
 * player never sees the half of their screen the integration exists to show.
 * Values go out as they arrive — the guarantee that the crossfade has room to
 * finish is the dismissal floor ({@link externalOverlayHold}), not a delay
 * here. An earlier design held the first value back for 800ms instead; the
 * floor makes that redundant, and one timer on this overlay is the whole point.
 *
 * Values are clamped to 0..1, kept monotonic, and converted to the PERCENTAGE
 * (0–100) that `ILoaderViewController.updateProgress` documents.
 */
export function advanceExternalOverlay(fraction: number): void {
  const overlay = adopted;
  if (!overlay) return;
  const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  if (clamped <= lastProgress) return;
  lastProgress = clamped;
  // The first non-zero value is what starts their partner→branded crossfade, so
  // it is also what the floor has to cover.
  if (clamped > 0 && crossfadeStartedAt === 0) crossfadeStartedAt = Date.now();
  guard('updateProgress', () => overlay.updateProgress(clamped * 100));
}

/**
 * Milliseconds still owed to the overlay before the hand-over may dismiss it:
 * the minimum display time, extended when needed so a phase crossfade that has
 * started can finish. Zero once both are satisfied — and zero when there is no
 * overlay, so nothing on a normal target ever waits.
 */
function remainingHoldMs(): number {
  if (!adopted) return 0;
  const now = Date.now();
  const floor = Math.max(
    adoptedAt + minDisplayMs,
    crossfadeStartedAt === 0 ? 0 : crossfadeStartedAt + PHASE_CROSSFADE_MS,
  );
  return Math.max(0, floor - now);
}

/**
 * Wait until the overlay has had its guaranteed time on screen. The hand-over
 * awaits this BEFORE it mounts the engine's own loading screen, so the two
 * timelines do not overlap: their screen is whole and undisturbed for the whole
 * window, then ours mounts, paints, and only then takes over.
 *
 * Resolves immediately when no overlay is adopted (every non-Artube target) or
 * when the floor has already passed (any boot slower than it, which is the
 * normal case in production — this costs nothing there).
 *
 * NOT part of the failure path on purpose: {@link releaseExternalOverlay} is
 * synchronous and immediate, so a boot that throws takes the overlay down at
 * once instead of stranding the player behind a courtesy delay. A release also
 * settles a wait already in progress.
 */
export function externalOverlayHold(): Promise<void> {
  // Reaching here means the boot is done and the only thing left is the wait, so the bar is
  // finished too. Without this it freezes at the last boot milestone (0.85 live) and their screen
  // is taken away with the bar still short — a bar that never fills, which is the same artefact in
  // a different costume. Only when a bar is actually on screen: if no progress ever went out the
  // player is still on the first phase, and starting a crossfade at the hand-over is precisely
  // what must not happen.
  if (crossfadeStartedAt !== 0) advanceExternalOverlay(1);
  const remaining = remainingHoldMs();
  if (remaining <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      if (holdTimer !== null) clearTimeout(holdTimer);
      holdTimer = null;
      holdResolve = null;
      resolve();
    };
    holdResolve = finish;
    holdTimer = setTimeout(finish, remaining);
  });
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
  // Settle a hand-over that is still waiting out the floor, even if there is
  // nothing to release. This is the failure path: a boot that threw must not
  // leave a timer holding the process open (Node-side tests) or a promise that
  // resolves into a teardown that already happened.
  if (holdResolve) holdResolve();

  const overlay = adopted;
  if (!overlay) return false;
  adopted = null;
  lastProgress = 0;
  crossfadeStartedAt = 0;
  guard('hideLoader', () => overlay.hideLoader());
  return true;
}
