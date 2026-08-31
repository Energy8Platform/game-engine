/**
 * `stage`: scene, viewport, resize (§4 of the design spec). A fixed
 * design-resolution root `Container` — what `reels`' `ReelsBoard.view`
 * mounts into — scaled and centred to fit whatever viewport the renderer
 * actually has.
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

export interface Stage {
  /** The design-resolution root — mount game content (e.g. `ReelsBoard.view`) into this. */
  readonly container: Container;
  /** Re-fits `container` to a new viewport size; returns the fit it applied. */
  resize(viewportWidth: number, viewportHeight: number): Fit;
  destroy(): void;
}

export interface CreateStageOptions {
  /** Parent to mount the stage container into — typically a renderer's `app.stage`. */
  root: Container;
  design: Size;
  mode?: 'contain' | 'cover';
}

export function createStage(options: CreateStageOptions): Stage {
  const container = new Container();
  options.root.addChild(container);

  return {
    container,
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
      options.root.removeChild(container);
      container.destroy({ children: true });
    },
  };
}
