import { Tween } from './Tween';
import type { EasingFunction } from '../types';
import { Easing } from './Easing';

interface TimelineStep {
  fn: () => Promise<void>;
}

/**
 * Sequential/parallel animation timeline built on top of Tween.
 *
 * @example
 * ```ts
 * const timeline = new Timeline();
 *
 * // Sequential: one after another
 * timeline
 *   .to(sprite1, { alpha: 1 }, 300)
 *   .to(sprite2, { x: 200 }, 500)
 *   .delay(200)
 *   .call(() => console.log('done'));
 *
 * // Parallel: all at once
 * timeline.parallel(
 *   () => Tween.to(sprite1, { x: 100 }, 300),
 *   () => Tween.to(sprite2, { y: 200 }, 300),
 * );
 *
 * await timeline.play();
 * ```
 */
export class Timeline {
  private _steps: TimelineStep[] = [];
  private _playing = false;
  private _cancelled = false;

  /**
   * Add a tween step (animate to target values).
   */
  to(
    target: any,
    props: Record<string, number>,
    duration: number,
    easing?: EasingFunction,
  ): this {
    this._steps.push({
      fn: () => Tween.to(target, props, duration, easing),
    });
    return this;
  }

  /**
   * Add a tween step (animate from given values).
   */
  from(
    target: any,
    props: Record<string, number>,
    duration: number,
    easing?: EasingFunction,
  ): this {
    this._steps.push({
      fn: () => Tween.from(target, props, duration, easing),
    });
    return this;
  }

  /**
   * Add a delay step.
   */
  delay(ms: number): this {
    this._steps.push({
      fn: () => Tween.delay(ms),
    });
    return this;
  }

  /**
   * Add a callback step.
   */
  call(fn: () => void | Promise<void>): this {
    this._steps.push({
      fn: async () => {
        await fn();
      },
    });
    return this;
  }

  /**
   * Add a parallel step — all functions run simultaneously,
   * step completes when all are done.
   */
  parallel(...fns: Array<() => Promise<void>>): this {
    this._steps.push({
      fn: () => Promise.all(fns.map((f) => f())).then(() => {}),
    });
    return this;
  }

  /**
   * Play the timeline from start.
   * Returns a promise that resolves when all steps complete.
   */
  async play(): Promise<void> {
    if (this._playing) return;
    this._playing = true;
    this._cancelled = false;

    for (const step of this._steps) {
      if (this._cancelled) break;
      await step.fn();
    }

    this._playing = false;
  }

  /**
   * Cancel the timeline.
   */
  cancel(): void {
    this._cancelled = true;
  }

  /**
   * Clear all steps.
   */
  clear(): this {
    this._steps.length = 0;
    this._cancelled = false;
    this._playing = false;
    return this;
  }

  /** Whether the timeline is currently playing */
  get isPlaying(): boolean {
    return this._playing;
  }
}
