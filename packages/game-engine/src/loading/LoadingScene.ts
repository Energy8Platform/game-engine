import { Container, Graphics, Text, Sprite, Assets } from 'pixi.js';
import { Scene } from '../core/Scene';
import { Tween } from '../animation/Tween';
import { Easing } from '../animation/Easing';
import type { LoadingScreenConfig } from '../types';
import { buildLogoSVG, LOADER_BAR_MAX_WIDTH } from '@energy8platform/platform-core/loading';

/**
 * Build the loading scene variant of the logo SVG.
 * Uses unique IDs (prefixed with 'ls') to avoid collisions with CSSPreloader.
 */
function buildLoadingLogoSVG(): string {
  return buildLogoSVG({
    idPrefix: 'ls',
    svgStyle: 'width:100%;height:auto;',
    clipRectId: 'ge-loader-rect',
    textId: 'ge-loader-pct',
    textContent: '0%',
  });
}

interface LoadingSceneData {
  engine: any; // GameApplication — avoid circular import
  targetScene: string;
  targetData?: unknown;
}

/**
 * Built-in loading screen using the Energy8 SVG logo with animated loader bar.
 *
 * Renders as an HTML overlay on top of the canvas for crisp SVG quality.
 * The loader bar fill width is driven by asset loading progress.
 */
export class LoadingScene extends Scene {
  private _engine!: any;
  private _targetScene!: string;
  private _targetData?: unknown;
  private _config!: LoadingScreenConfig;

  // HTML overlay
  private _overlay: HTMLDivElement | null = null;
  private _loaderRect: SVGRectElement | null = null;
  private _percentEl: Element | null = null;
  private _tapToStartEl: Element | null = null;

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

    // Create the HTML overlay with the SVG logo
    this.createOverlay();

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

    // Show "Tap to Start" or transition directly
    if (this._config.tapToStart !== false) {
      await this.showTapToStart();
    } else {
      await this.transitionToGame();
    }
  }

  override onUpdate(dt: number): void {
    // Smooth progress bar fill via HTML (during active loading)
    if (!this._loadingComplete && this._displayedProgress < this._targetProgress) {
      this._displayedProgress = Math.min(
        this._displayedProgress + dt * 1.5,
        this._targetProgress,
      );
      this.updateLoaderBar(this._displayedProgress);
    }
  }

  override onResize(_width: number, _height: number): void {
    // Overlay is CSS-based, auto-resizes
  }

  override onDestroy(): void {
    this.removeOverlay();
  }

  // ─── HTML Overlay ──────────────────────────────────────

  private createOverlay(): void {
    const bgColor =
      typeof this._config.backgroundColor === 'string'
        ? this._config.backgroundColor
        : typeof this._config.backgroundColor === 'number'
          ? `#${this._config.backgroundColor.toString(16).padStart(6, '0')}`
          : '#0a0a1a';

    const bgGradient =
      this._config.backgroundGradient ??
      `linear-gradient(135deg, ${bgColor} 0%, #1a1a3e 100%)`;

    this._overlay = document.createElement('div');
    this._overlay.id = '__ge-loading-overlay__';
    this._overlay.innerHTML = `
      <div class="ge-loading-content">
        ${buildLoadingLogoSVG()}
      </div>
    `;

    const style = document.createElement('style');
    style.id = '__ge-loading-style__';
    style.textContent = `
      #__ge-loading-overlay__ {
        position: absolute;
        top: 0; left: 0;
        width: 100%; height: 100%;
        background: ${bgGradient};
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        transition: opacity 0.5s ease-out;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      #__ge-loading-overlay__.ge-fade-out {
        opacity: 0;
        pointer-events: none;
      }
      .ge-loading-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 75%;
        max-width: 650px;
      }
      .ge-loading-content svg {
        filter: drop-shadow(0 0 40px rgba(121, 57, 194, 0.5));
        cursor: default;
      }

      .ge-svg-pulse {
        animation: ge-tap-pulse 1.2s ease-in-out infinite;
      }
      @keyframes ge-tap-pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 1; }
      }
    `;

    // Get the container that holds the canvas
    const container = this._engine.app?.canvas?.parentElement;
    if (container) {
      container.style.position = container.style.position || 'relative';
      container.appendChild(style);
      container.appendChild(this._overlay);
    }

    // Cache the SVG loader rect for progress updates
    this._loaderRect = this._overlay.querySelector('#ge-loader-rect');
    this._percentEl = this._overlay.querySelector('#ge-loader-pct');
  }

  private removeOverlay(): void {
    this._overlay?.remove();
    document.getElementById('__ge-loading-style__')?.remove();
    this._overlay = null;
    this._loaderRect = null;
    this._percentEl = null;
    this._tapToStartEl = null;
  }

  // ─── Progress ──────────────────────────────────────────

  private updateLoaderBar(progress: number): void {
    if (this._loaderRect) {
      this._loaderRect.setAttribute('width', String(LOADER_BAR_MAX_WIDTH * progress));
    }
    if (this._percentEl) {
      const pct = Math.round(progress * 100);
      (this._percentEl as SVGTextElement).textContent = `${pct}%`;
    }
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

  // ─── Tap to Start ─────────────────────────────────────

  private async showTapToStart(): Promise<void> {
    const tapText = this._config.tapToStartText ?? 'TAP TO START';

    // Reuse the same SVG text element — replace percentage with tap text
    if (this._percentEl) {
      const el = this._percentEl as SVGTextElement;
      el.textContent = tapText;
      el.setAttribute('fill', '#ffffff');
      el.classList.add('ge-svg-pulse');
      this._tapToStartEl = el;
    }

    // Make overlay clickable
    if (this._overlay) {
      this._overlay.style.cursor = 'pointer';
    }

    // Wait for tap
    return new Promise<void>((resolve) => {
      const handler = async () => {
        this._overlay?.removeEventListener('click', handler);
        await this.transitionToGame();
        resolve();
      };

      // Listen on the full overlay for easier mobile tap
      this._overlay?.addEventListener('click', handler);
    });
  }

  // ─── Transition ────────────────────────────────────────

  private async transitionToGame(): Promise<void> {
    // Fade out the HTML overlay
    if (this._overlay) {
      this._overlay.classList.add('ge-fade-out');
      await new Promise<void>((resolve) => {
        this._overlay!.addEventListener('transitionend', () => resolve(), { once: true });
        // Safety timeout
        setTimeout(resolve, 600);
      });
    }

    // Remove overlay
    this.removeOverlay();

    // Navigate to the target scene, always passing the engine reference
    await this._engine.scenes.goto(this._targetScene, {
      engine: this._engine,
      ...(this._targetData && typeof this._targetData === 'object' ? this._targetData as Record<string, unknown> : { data: this._targetData }),
    });
  }
}
