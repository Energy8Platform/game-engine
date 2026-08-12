/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VENDORED THIRD-PARTY CODE — NOT WRITTEN BY ENERGY8. DO NOT EDIT AS IF IT WERE.
 *
 *   Upstream package : @artube/loader
 *   Upstream version : 2.1.0
 *   Obtained from    : https://gitlab.com/api/v4/projects/81086971/packages/npm/
 *                      (Artube's private, token-gated GitLab npm registry;
 *                      `publishConfig.access: restricted`)
 *   Vendored on      : 2026-08-12
 *   License          : NONE STATED. The upstream `package.json` declares no
 *                      `license`, no `author` and no `repository` field, and the
 *                      tarball ships no LICENSE file. This code is redistributed
 *                      inside `@energy8platform/artube-bridge` on Artube's
 *                      instruction so that studios building Artube games need no
 *                      account on that registry. It is Artube's code, not ours.
 *   Upstream shape   : 11 KB of built (minified) ESM in `dist/index.js`. There is
 *                      no published source. The class below is that bundle's
 *                      `LoaderViewController` transcribed back into readable
 *                      TypeScript, statement for statement — same element ids,
 *                      same class names, same throw, same crossfade trigger.
 *
 *   RE-VENDOR when Artube ships a new `@artube/loader`. Nothing here updates
 *   itself. The procedure is in `docs/vendored-artube-loader.md`.
 *
 *   The Node/Vite half of the same upstream package (`artubePartnerLoader`,
 *   which injects the markup this class binds to) is vendored separately in
 *   `@energy8platform/artube-server/vite` — it must not live here, because this
 *   module ends up in the game's BROWSER bundle and `artube-server` pulls in
 *   grpc and ws.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Why this is its OWN entry (`@energy8platform/artube-bridge/loader`) rather
 * than part of `.`: the game's `main.ts` imports the controller STATICALLY, on
 * every target, because only a static import lets the bundler resolve it in the
 * plain `npm run dev` build too. `.` pulls in `ArtubeBridge` and the game-sdk;
 * this leaf module imports nothing at all, so a non-Artube build of the same
 * game pays a few hundred bytes and no bridge. Same discipline as `./detect`.
 */

/** The upstream contract, unchanged. Structurally identical to the engine's
 *  `ExternalLoadingOverlay` (`@energy8platform/platform-core`), which is what
 *  lets an instance be handed straight to `createSlotGame({ loading })`. */
export interface ILoaderViewController {
  updateProgress(value: number): void;
  showLoader(): void;
  hideLoader(): void;
}

/**
 * Two-phase loader controller.
 *
 * Phase 1 (partner): Dark screen with configurable partner logo slot.
 * Phase 2 (artube):  Green-branded Artube screen with progress bar.
 *
 * Transition: crossfade from partner -> artube on first progress update.
 *
 * Modes (set via the Vite plugin, not here):
 *  - fullscreen: covers entire viewport, gradient fades to black
 *  - contained: fills parent container, gradient fades to transparent
 *
 * THROWS when the markup is absent — i.e. in any build that did not run
 * `artubePartnerLoader`. Construct it behind a
 * `document.getElementById('loader')` guard, or use {@link createArtubeLoader}.
 */
export class LoaderViewController implements ILoaderViewController {
  private loader: HTMLElement;
  private partnerPhase: HTMLElement | null;
  private artubePhase: HTMLElement;
  private progressContainer: HTMLElement;
  private progressBar: HTMLElement;
  private currentProgress = 0;
  private transitioned = false;

  constructor() {
    this.loader = document.getElementById('loader') as HTMLElement;
    this.partnerPhase = document.getElementById('loader-partner');
    this.artubePhase = document.getElementById('loader-artube') as HTMLElement;
    this.progressContainer = document.getElementById('progress-container') as HTMLElement;
    this.progressBar = document.getElementById('progress-bar') as HTMLElement;
    if (!this.loader || !this.progressContainer || !this.progressBar) {
      throw new Error('Loader elements not found on page!');
    }
  }

  /** Transition from partner phase to artube phase */
  private transitionToArtube(): void {
    if (this.transitioned) return;
    this.transitioned = true;
    this.partnerPhase?.classList?.remove('active');
    this.artubePhase.classList.add('active');
  }

  updateProgress(value: number): void {
    if (value === this.currentProgress) return;
    this.currentProgress = value;
    if (!this.transitioned && value > 0) this.transitionToArtube();
    this.progressBar.style.width = `${value}%`;
  }

  showLoader(): void {
    this.progressContainer.classList.remove('hidden-progress');
    if (!this.partnerPhase && !this.transitioned) this.transitionToArtube();
  }

  hideLoader(): void {
    this.loader.classList.add('hidden-loader');
    this.loader.addEventListener('animationend', (e: AnimationEvent) => {
      if (e.animationName === 'hideLoader') this.loader.remove();
    });
  }
}

/**
 * ENERGY8 ADDITION — not upstream.
 *
 * `null` when the page carries no Artube loader markup, instead of throwing.
 * Every game that supports more than one platform needs exactly this guard
 * (only an Artube build injects the markup, and every other target must keep
 * the engine's own preloader), so it belongs here rather than copy-pasted into
 * each `main.ts`. Also safe under SSR / a missing `document`.
 */
export function createArtubeLoader(): LoaderViewController | null {
  if (typeof document === 'undefined') return null;
  if (!document.getElementById('loader')) return null;
  try {
    return new LoaderViewController();
  } catch {
    return null;
  }
}
