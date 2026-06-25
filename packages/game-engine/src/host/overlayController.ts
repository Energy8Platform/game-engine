import { Container, Graphics } from 'pixi.js';
import type { SceneOverlay, OverlayShowOptions } from './sceneController';

interface OverlayDeps {
  /** Container mounted above the shell on the stage. */
  parent: Container;
  /** Live canvas size getter (for the hit area + build size). */
  size(): { width: number; height: number };
}

interface ActiveOverlay {
  layer: Container;
  resolve(): void;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createOverlayController(deps: OverlayDeps): {
  overlay: SceneOverlay;
  resize(w: number, h: number): void;
  destroy(): void;
} {
  let current: ActiveOverlay | null = null;

  const teardown = (): void => {
    if (!current) return;
    if (current.timer) clearTimeout(current.timer);
    const { layer, resolve } = current;
    current = null;
    layer.removeFromParent();
    layer.destroy({ children: true });
    resolve();
  };

  const overlay: SceneOverlay = {
    show(opts: OverlayShowOptions): Promise<void> {
      if (current) {
        console.warn('[overlay] show() ignored — an overlay is already open');
        return Promise.reject(new Error('Overlay already open'));
      }
      const { width, height } = deps.size();
      const layer = new Container();
      layer.eventMode = 'static';

      // Pointer-eating + (optional) dim backdrop sized to the canvas.
      const hit = new Graphics().rect(0, 0, width, height).fill({
        color: 0x000000,
        alpha: opts.dim ?? 0.0001, // ~0 keeps it transparent but hit-testable
      });
      hit.eventMode = 'static';
      layer.addChild(hit);

      const content = new Container();
      layer.addChild(content);
      opts.build(content, { width, height });

      deps.parent.addChild(layer);

      return new Promise<void>((resolve) => {
        current = { layer, resolve, timer: null };
        const closeOn = opts.closeOn ?? 'tap';
        if (closeOn === 'tap') hit.on('pointertap', teardown);
        if (typeof opts.autoCloseMs === 'number') {
          current.timer = setTimeout(teardown, opts.autoCloseMs);
        }
      });
    },
    close(): void { teardown(); },
  };

  return {
    overlay,
    resize(w: number, h: number): void {
      if (!current) return;
      const hit = current.layer.getChildAt(0) as Graphics;
      hit.clear().rect(0, 0, w, h).fill({ color: 0x000000, alpha: hit.alpha });
    },
    destroy(): void { teardown(); },
  };
}
