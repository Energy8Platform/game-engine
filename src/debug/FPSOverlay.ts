import { Container, Text } from 'pixi.js';
import type { Application, Ticker } from 'pixi.js';

/**
 * FPS overlay for debugging performance.
 *
 * Shows FPS, frame time, and draw call count in the corner of the screen.
 *
 * @example
 * ```ts
 * const fps = new FPSOverlay(app);
 * fps.show();
 * ```
 */
export class FPSOverlay {
  private _app: Application;
  private _container: Container;
  private _fpsText: Text;
  private _visible = false;
  private _samples: number[] = [];
  private _maxSamples = 60;
  private _lastUpdate = 0;
  private _tickFn: ((ticker: Ticker) => void) | null = null;

  constructor(app: Application) {
    this._app = app;

    this._container = new Container();
    this._container.label = 'FPSOverlay';
    this._container.zIndex = 99999;

    this._fpsText = new Text({
      text: 'FPS: --',
      style: {
        fontFamily: 'monospace',
        fontSize: 14,
        fill: 0x00ff00,
        stroke: { color: 0x000000, width: 2 },
      },
    });
    this._fpsText.x = 8;
    this._fpsText.y = 8;

    this._container.addChild(this._fpsText);
  }

  /** Show the FPS overlay */
  show(): void {
    if (this._visible) return;
    this._visible = true;

    this._app.stage.addChild(this._container);

    this._tickFn = (ticker: Ticker) => {
      this._samples.push(ticker.FPS);
      if (this._samples.length > this._maxSamples) {
        this._samples.shift();
      }

      // Update display every ~500ms
      const now = Date.now();
      if (now - this._lastUpdate > 500) {
        const avg = this._samples.reduce((a, b) => a + b, 0) / this._samples.length;
        const min = Math.min(...this._samples);
        this._fpsText.text = [
          `FPS: ${Math.round(avg)} (min: ${Math.round(min)})`,
          `Frame: ${ticker.deltaMS.toFixed(1)}ms`,
        ].join('\n');
        this._lastUpdate = now;
      }
    };

    this._app.ticker.add(this._tickFn);
  }

  /** Hide the FPS overlay */
  hide(): void {
    if (!this._visible) return;
    this._visible = false;

    this._container.removeFromParent();
    if (this._tickFn) {
      this._app.ticker.remove(this._tickFn);
      this._tickFn = null;
    }
  }

  /** Toggle visibility */
  toggle(): void {
    if (this._visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /** Destroy the overlay */
  destroy(): void {
    this.hide();
    this._container.destroy({ children: true });
  }
}
