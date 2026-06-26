import { Scene } from '../core/Scene';
import type { LoadingScreenConfig } from '../types';
import {
  setCSSPreloaderProgress,
  waitCSSPreloaderTap,
  removeCSSPreloader,
} from '@energy8platform/platform-core/loading';

interface LoadingSceneData {
  engine: any; // GameApplication — avoid circular import
  targetScene: string;
  targetData?: unknown;
}

/**
 * Built-in loading screen.
 *
 * It does NOT render its own overlay — the CSS preloader created at boot
 * (`createPlatformSession`/`GameApplication.start`) stays on screen, and this
 * scene merely drives it: asset-load progress → `setCSSPreloaderProgress`,
 * tap-to-start → `waitCSSPreloaderTap`, then fades it out via
 * `removeCSSPreloader` before entering the game. One continuous overlay from
 * boot to gameplay — no second logo, no mid-load flash.
 */
export class LoadingScene extends Scene {
  private _engine!: any;
  private _targetScene!: string;
  private _targetData?: unknown;
  private _config!: LoadingScreenConfig;

  // State
  private _displayedProgress = 0;
  private _targetProgress = 0;
  private _loadingComplete = false;
  private _startTime = 0;

  override async onEnter(data?: unknown): Promise<void> {
    const { engine, targetScene, targetData } = data as LoadingSceneData;
    this._engine = engine;
    this._targetScene = targetScene;
    this._targetData = targetData;
    this._config = engine.config.loading ?? {};
    this._startTime = Date.now();

    // Initialize asset manager
    await this._engine.assets.init();

    // Initialize audio manager
    await this._engine.audio.init();

    // Phase 1: Load preload bundle
    const bundles = this._engine.assets.getBundleNames();
    const hasPreload = bundles.includes('preload');

    if (hasPreload) {
      const preloadAssets = this._engine.config.manifest?.bundles?.find(
        (b: any) => b.name === 'preload',
      )?.assets;

      if (preloadAssets && preloadAssets.length > 0) {
        await this._engine.assets.loadBundle('preload', (p: number) => {
          this._targetProgress = p * 0.15;
        });
      } else {
        this._targetProgress = 0.15;
      }
    }

    // Phase 2: Load remaining bundles
    const remainingBundles = bundles.filter(
      (b: string) => b !== 'preload' && !this._engine.assets.isBundleLoaded(b),
    );

    if (remainingBundles.length > 0) {
      const hasAssets = remainingBundles.some((name: string) => {
        const bundle = this._engine.config.manifest?.bundles?.find(
          (b: any) => b.name === name,
        );
        return bundle?.assets && bundle.assets.length > 0;
      });

      if (hasAssets) {
        await this._engine.assets.loadBundles(remainingBundles, (p: number) => {
          this._targetProgress = 0.15 + p * 0.85;
        });
      }
    }

    this._targetProgress = 1;
    this._loadingComplete = true;

    // Enforce minimum display time: spread the remaining progress fill
    // over the remaining time so the bar fills smoothly, not abruptly
    const minTime = this._config.minDisplayTime ?? 1500;
    const elapsed = Date.now() - this._startTime;
    const remaining = Math.max(0, minTime - elapsed);

    if (remaining > 0) {
      // Distribute fill animation over the remaining time
      await this.animateProgressTo(1, remaining);
    }

    // Final snap to 100%
    this._displayedProgress = 1;
    this.updateLoaderBar(1);

    // Wait for the player's tap — resolves immediately when tapToStart is
    // false (the preloader honours that flag) — then enter the game.
    await waitCSSPreloaderTap();
    await this.transitionToGame();
  }

  override onUpdate(dt: number): void {
    // Smooth progress bar fill (during active loading)
    if (!this._loadingComplete && this._displayedProgress < this._targetProgress) {
      this._displayedProgress = Math.min(
        this._displayedProgress + dt * 1.5,
        this._targetProgress,
      );
      this.updateLoaderBar(this._displayedProgress);
    }
  }

  override onResize(_width: number, _height: number): void {
    // The preloader overlay is CSS-based and auto-resizes.
  }

  override onDestroy(): void {
    // Defensive: ensure the preloader is gone even if we never transitioned
    // (e.g. the scene was popped externally). Idempotent.
    void removeCSSPreloader(this.hostElement());
  }

  // ─── Progress ──────────────────────────────────────────

  private updateLoaderBar(progress: number): void {
    setCSSPreloaderProgress(Math.max(0, Math.min(1, progress)));
  }

  /**
   * Smoothly animate the displayed progress from its current value to `target`
   * over `durationMs` using an easeOutCubic curve.
   */
  private async animateProgressTo(target: number, durationMs: number): Promise<void> {
    const startVal = this._displayedProgress;
    const delta = target - startVal;
    if (delta <= 0 || durationMs <= 0) return;

    const startTime = Date.now();

    return new Promise<void>((resolve) => {
      const tick = () => {
        const elapsed = Date.now() - startTime;
        const t = Math.min(elapsed / durationMs, 1);
        // easeOutCubic for a natural deceleration feel
        const eased = 1 - Math.pow(1 - t, 3);
        this._displayedProgress = startVal + delta * eased;
        this.updateLoaderBar(this._displayedProgress);

        if (t < 1) {
          requestAnimationFrame(tick);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  // ─── Transition ────────────────────────────────────────

  /** The DOM element hosting the canvas + preloader overlay. */
  private hostElement(): HTMLElement {
    return this._engine?.app?.canvas?.parentElement ?? document.body;
  }

  private async transitionToGame(): Promise<void> {
    // Fade out and remove the shared CSS preloader (resolves after the fade).
    await removeCSSPreloader(this.hostElement());

    // Navigate to the target scene, always passing the engine reference
    await this._engine.scenes.goto(this._targetScene, {
      engine: this._engine,
      ...(this._targetData && typeof this._targetData === 'object'
        ? (this._targetData as Record<string, unknown>)
        : { data: this._targetData }),
    });
  }
}
