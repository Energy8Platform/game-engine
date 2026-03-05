import type { EasingFunction } from '../types';

/**
 * Collection of easing functions for use with Tween and Timeline.
 *
 * All functions take a progress value t (0..1) and return the eased value.
 */
export const Easing: Record<string, EasingFunction> & {
  readonly linear: EasingFunction;
  readonly easeInQuad: EasingFunction;
  readonly easeOutQuad: EasingFunction;
  readonly easeInOutQuad: EasingFunction;
  readonly easeInCubic: EasingFunction;
  readonly easeOutCubic: EasingFunction;
  readonly easeInOutCubic: EasingFunction;
  readonly easeInQuart: EasingFunction;
  readonly easeOutQuart: EasingFunction;
  readonly easeInOutQuart: EasingFunction;
  readonly easeInSine: EasingFunction;
  readonly easeOutSine: EasingFunction;
  readonly easeInOutSine: EasingFunction;
  readonly easeInExpo: EasingFunction;
  readonly easeOutExpo: EasingFunction;
  readonly easeInOutExpo: EasingFunction;
  readonly easeInBack: EasingFunction;
  readonly easeOutBack: EasingFunction;
  readonly easeInOutBack: EasingFunction;
  readonly easeOutBounce: EasingFunction;
  readonly easeInBounce: EasingFunction;
  readonly easeInOutBounce: EasingFunction;
  readonly easeOutElastic: EasingFunction;
  readonly easeInElastic: EasingFunction;
} = {
  linear: (t: number) => t,

  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => t * (2 - t),
  easeInOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),

  easeInCubic: (t: number) => t * t * t,
  easeOutCubic: (t: number) => --t * t * t + 1,
  easeInOutCubic: (t: number) =>
    t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  easeInQuart: (t: number) => t * t * t * t,
  easeOutQuart: (t: number) => 1 - --t * t * t * t,
  easeInOutQuart: (t: number) =>
    t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t,

  easeInSine: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  easeOutSine: (t: number) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,

  easeInExpo: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * t - 10)),
  easeOutExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutExpo: (t: number) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? Math.pow(2, 20 * t - 10) / 2
          : (2 - Math.pow(2, -20 * t + 10)) / 2,

  easeInBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  },
  easeOutBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  easeInOutBack: (t: number) => {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },

  easeOutBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },

  easeInBounce: (t: number) => 1 - Easing.easeOutBounce(1 - t),

  easeInOutBounce: (t: number) =>
    t < 0.5
      ? (1 - Easing.easeOutBounce(1 - 2 * t)) / 2
      : (1 + Easing.easeOutBounce(2 * t - 1)) / 2,

  easeOutElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0
      ? 0
      : t === 1
        ? 1
        : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },

  easeInElastic: (t: number) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0
      ? 0
      : t === 1
        ? 1
        : -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
  },
};
