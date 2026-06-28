// packages/game-engine/src/slot/anim/easing-map.ts
import { Easing } from '../../animation';
import type { EasingFunction } from '../../types';

/** Resolve a descriptor's string easing name to the engine's easing function. */
export const EASING_BY_NAME: Record<string, EasingFunction> = {
  linear: Easing.linear,
  easeInQuad: Easing.easeInQuad,
  easeOutQuad: Easing.easeOutQuad,
  easeInOutQuad: Easing.easeInOutQuad,
  easeInCubic: Easing.easeInCubic,
  easeOutCubic: Easing.easeOutCubic,
  easeInOutCubic: Easing.easeInOutCubic,
  easeInBack: Easing.easeInBack,
  easeOutBack: Easing.easeOutBack,
  easeInOutBack: Easing.easeInOutBack,
  easeOutBounce: Easing.easeOutBounce,
  easeInBounce: Easing.easeInBounce,
  easeOutElastic: Easing.easeOutElastic,
  easeInSine: Easing.easeInSine,
  easeOutSine: Easing.easeOutSine,
  easeInOutSine: Easing.easeInOutSine,
};

/** Resolve an easing name to a function, falling back to easeOutQuad. */
export function easingByName(name?: string): EasingFunction {
  return (name && EASING_BY_NAME[name]) || Easing.easeOutQuad;
}
