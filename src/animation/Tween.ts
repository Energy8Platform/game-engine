import { Ticker } from 'pixi.js';
import type { EasingFunction } from '../types';
import { Easing } from './Easing';

interface ActiveTween {
  target: any;
  from: Record<string, number>;
  to: Record<string, number>;
  duration: number;
  easing: EasingFunction;
  elapsed: number;
  delay: number;
  resolve: () => void;
  onUpdate?: (progress: number) => void;
}

/**
 * Lightweight tween system integrated with PixiJS Ticker.
 * Zero external dependencies — no GSAP required.
 *
 * All tweens return a Promise that resolves on completion.
 *
 * @example
 * ```ts
 * // Fade in a sprite
 * await Tween.to(sprite, { alpha: 1, y: 100 }, 500, Easing.easeOutBack);
 *
 * // Move and wait
 * await Tween.to(sprite, { x: 500 }, 300);
 *
 * // From a starting value
 * await Tween.from(sprite, { scale: 0, alpha: 0 }, 400);
 * ```
 */
export class Tween {
  private static _tweens: ActiveTween[] = [];
  private static _tickerAdded = false;

  /**
   * Animate properties from current values to target values.
   *
   * @param target - Object to animate (Sprite, Container, etc.)
   * @param props - Target property values
   * @param duration - Duration in milliseconds
   * @param easing - Easing function (default: easeOutQuad)
   * @param onUpdate - Progress callback (0..1)
   */
  static to(
    target: any,
    props: Record<string, number>,
    duration: number,
    easing?: EasingFunction,
    onUpdate?: (progress: number) => void,
  ): Promise<void> {
    return new Promise((resolve) => {
      // Capture starting values
      const from: Record<string, number> = {};
      for (const key of Object.keys(props)) {
        from[key] = Tween.getProperty(target, key);
      }

      const tween: ActiveTween = {
        target,
        from,
        to: { ...props },
        duration: Math.max(1, duration),
        easing: easing ?? Easing.easeOutQuad,
        elapsed: 0,
        delay: 0,
        resolve,
        onUpdate,
      };

      Tween._tweens.push(tween);
      Tween.ensureTicker();
    });
  }

  /**
   * Animate properties from given values to current values.
   */
  static from(
    target: any,
    props: Record<string, number>,
    duration: number,
    easing?: EasingFunction,
    onUpdate?: (progress: number) => void,
  ): Promise<void> {
    // Capture current values as "to"
    const to: Record<string, number> = {};
    for (const key of Object.keys(props)) {
      to[key] = Tween.getProperty(target, key);
      Tween.setProperty(target, key, props[key]);
    }

    return Tween.to(target, to, duration, easing, onUpdate);
  }

  /**
   * Animate from one set of values to another.
   */
  static fromTo(
    target: any,
    fromProps: Record<string, number>,
    toProps: Record<string, number>,
    duration: number,
    easing?: EasingFunction,
    onUpdate?: (progress: number) => void,
  ): Promise<void> {
    // Set starting values
    for (const key of Object.keys(fromProps)) {
      Tween.setProperty(target, key, fromProps[key]);
    }

    return Tween.to(target, toProps, duration, easing, onUpdate);
  }

  /**
   * Wait for a given duration (useful in timelines).
   * Uses PixiJS Ticker for consistent timing with other tweens.
   */
  static delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let elapsed = 0;
      const onTick = (ticker: Ticker) => {
        elapsed += ticker.deltaMS;
        if (elapsed >= ms) {
          Ticker.shared.remove(onTick);
          resolve();
        }
      };
      Ticker.shared.add(onTick);
    });
  }

  /**
   * Kill all tweens on a target.
   */
  static killTweensOf(target: any): void {
    Tween._tweens = Tween._tweens.filter((tw) => {
      if (tw.target === target) {
        tw.resolve();
        return false;
      }
      return true;
    });
  }

  /**
   * Kill all active tweens.
   */
  static killAll(): void {
    for (const tw of Tween._tweens) {
      tw.resolve();
    }
    Tween._tweens.length = 0;
  }

  /** Number of active tweens */
  static get activeTweens(): number {
    return Tween._tweens.length;
  }

  /**
   * Reset the tween system — kill all tweens and remove the ticker.
   * Useful for cleanup between game instances, tests, or hot-reload.
   */
  static reset(): void {
    for (const tw of Tween._tweens) {
      tw.resolve();
    }
    Tween._tweens.length = 0;
    if (Tween._tickerAdded) {
      Ticker.shared.remove(Tween.tick);
      Tween._tickerAdded = false;
    }
  }

  // ─── Internal ──────────────────────────────────────────

  private static ensureTicker(): void {
    if (Tween._tickerAdded) return;
    Tween._tickerAdded = true;
    Ticker.shared.add(Tween.tick);
  }

  private static tick = (ticker: Ticker): void => {
    const dt = ticker.deltaMS;
    const completed: ActiveTween[] = [];

    for (const tw of Tween._tweens) {
      tw.elapsed += dt;

      if (tw.elapsed < tw.delay) continue;

      const raw = Math.min((tw.elapsed - tw.delay) / tw.duration, 1);
      const t = tw.easing(raw);

      // Interpolate each property
      for (const key of Object.keys(tw.to)) {
        const start = tw.from[key];
        const end = tw.to[key];
        const value = start + (end - start) * t;
        Tween.setProperty(tw.target, key, value);
      }

      tw.onUpdate?.(raw);

      if (raw >= 1) {
        completed.push(tw);
      }
    }

    // Remove completed tweens
    for (const tw of completed) {
      const idx = Tween._tweens.indexOf(tw);
      if (idx !== -1) Tween._tweens.splice(idx, 1);
      tw.resolve();
    }

    // Remove ticker when no active tweens
    if (Tween._tweens.length === 0 && Tween._tickerAdded) {
      Ticker.shared.remove(Tween.tick);
      Tween._tickerAdded = false;
    }
  };

  /**
   * Get a potentially nested property (supports 'scale.x', 'position.y', etc.)
   */
  private static getProperty(target: any, key: string): number {
    const parts = key.split('.');
    let obj = target;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]];
    }
    return obj[parts[parts.length - 1]] ?? 0;
  }

  /**
   * Set a potentially nested property.
   */
  private static setProperty(target: any, key: string, value: number): void {
    const parts = key.split('.');
    let obj = target;
    for (let i = 0; i < parts.length - 1; i++) {
      obj = obj[parts[i]];
    }
    obj[parts[parts.length - 1]] = value;
  }
}
