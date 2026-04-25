import { EventEmitter } from '../core/EventEmitter';

interface InputEvents {
  tap: { x: number; y: number };
  press: { x: number; y: number };
  release: { x: number; y: number };
  move: { x: number; y: number };
  swipe: { direction: 'up' | 'down' | 'left' | 'right'; velocity: number };
  keydown: { key: string; code: string };
  keyup: { key: string; code: string };
}

/**
 * Unified input manager for touch, mouse, and keyboard.
 *
 * Features:
 * - Unified pointer events (works with touch + mouse)
 * - Swipe gesture detection
 * - Keyboard input with isKeyDown state
 * - Input locking (block input during animations)
 *
 * @example
 * ```ts
 * const input = new InputManager(app.canvas);
 *
 * input.on('tap', ({ x, y }) => console.log('Tapped at', x, y));
 * input.on('swipe', ({ direction }) => console.log('Swiped', direction));
 * input.on('keydown', ({ key }) => {
 *   if (key === ' ') spin();
 * });
 *
 * // Block input during animations
 * input.lock();
 * await playAnimation();
 * input.unlock();
 * ```
 */
export class InputManager extends EventEmitter<InputEvents> {
  private _canvas: HTMLCanvasElement;
  private _locked = false;
  private _keysDown = new Set<string>();
  private _destroyed = false;

  // Viewport transform (set by ViewportManager via setViewportTransform)
  private _viewportScale = 1;
  private _viewportOffsetX = 0;
  private _viewportOffsetY = 0;

  // Gesture tracking
  private _pointerStart: { x: number; y: number; time: number } | null = null;
  private _swipeThreshold = 50; // minimum distance in px
  private _swipeMaxTime = 300; // max ms for swipe gesture

  constructor(canvas: HTMLCanvasElement) {
    super();
    this._canvas = canvas;
    this.setupPointerEvents();
    this.setupKeyboardEvents();
  }

  /** Whether input is currently locked */
  get locked(): boolean {
    return this._locked;
  }

  /** Lock all input (e.g., during animations) */
  lock(): void {
    this._locked = true;
  }

  /** Unlock input */
  unlock(): void {
    this._locked = false;
  }

  /** Check if a key is currently pressed */
  isKeyDown(key: string): boolean {
    return this._keysDown.has(key.toLowerCase());
  }

  /**
   * Update the viewport transform used for DOM→world coordinate mapping.
   * Called automatically by GameApplication when ViewportManager emits resize.
   */
  setViewportTransform(scale: number, offsetX: number, offsetY: number): void {
    this._viewportScale = scale;
    this._viewportOffsetX = offsetX;
    this._viewportOffsetY = offsetY;
  }

  /**
   * Convert a DOM canvas position to game-world coordinates,
   * accounting for viewport scaling and offset.
   */
  getWorldPosition(canvasX: number, canvasY: number): { x: number; y: number } {
    return {
      x: (canvasX - this._viewportOffsetX) / this._viewportScale,
      y: (canvasY - this._viewportOffsetY) / this._viewportScale,
    };
  }

  /** Destroy the input manager */
  destroy(): void {
    this._destroyed = true;
    this._canvas.removeEventListener('pointerdown', this.onPointerDown);
    this._canvas.removeEventListener('pointerup', this.onPointerUp);
    this._canvas.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    this._keysDown.clear();
    this.removeAllListeners();
  }

  // ─── Private: Pointer ──────────────────────────────────

  private setupPointerEvents(): void {
    this._canvas.addEventListener('pointerdown', this.onPointerDown);
    this._canvas.addEventListener('pointerup', this.onPointerUp);
    this._canvas.addEventListener('pointermove', this.onPointerMove);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this._locked || this._destroyed) return;

    const pos = this.getCanvasPosition(e);
    this._pointerStart = { ...pos, time: Date.now() };
    this.emit('press', pos);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this._locked || this._destroyed) return;

    const pos = this.getCanvasPosition(e);
    this.emit('release', pos);

    // Check for tap vs swipe
    if (this._pointerStart) {
      const dx = pos.x - this._pointerStart.x;
      const dy = pos.y - this._pointerStart.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const elapsed = Date.now() - this._pointerStart.time;

      if (dist > this._swipeThreshold && elapsed < this._swipeMaxTime) {
        // Swipe detected
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);
        let direction: 'up' | 'down' | 'left' | 'right';

        if (absDx > absDy) {
          direction = dx > 0 ? 'right' : 'left';
        } else {
          direction = dy > 0 ? 'down' : 'up';
        }

        this.emit('swipe', { direction, velocity: dist / elapsed });
      } else if (dist < 10) {
        // Tap (minimal movement)
        this.emit('tap', pos);
      }
    }

    this._pointerStart = null;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this._locked || this._destroyed) return;
    this.emit('move', this.getCanvasPosition(e));
  };

  private getCanvasPosition(e: PointerEvent): { x: number; y: number } {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  // ─── Private: Keyboard ─────────────────────────────────

  private setupKeyboardEvents(): void {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this._locked || this._destroyed) return;
    this._keysDown.add(e.key.toLowerCase());
    this.emit('keydown', { key: e.key, code: e.code });
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this._destroyed) return;
    this._keysDown.delete(e.key.toLowerCase());
    if (this._locked) return;
    this.emit('keyup', { key: e.key, code: e.code });
  };
}
