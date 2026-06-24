// packages/game-engine/src/slot/anim/easing-map.ts
import { Easing } from '../../animation';
import type { EasingFunction } from '../../types';

/** Resolve a descriptor's string easing name to the engine's easing function. */
export const EASING_BY_NAME: Record<string, EasingFunction> = {
  linear: Easing.linear,
  easeOutQuad: Easing.easeOutQuad,
  easeOutCubic: Easing.easeOutCubic,
  easeOutBack: Easing.easeOutBack,
  easeOutBounce: Easing.easeOutBounce,
  easeInBack: Easing.easeInBack,
  easeInOutCubic: Easing.easeInOutCubic,
};
