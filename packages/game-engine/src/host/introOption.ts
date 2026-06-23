import type { SceneConstructor } from '../types';
import { IntroScene, type IntroSceneConfig } from '../scenes/IntroScene';

export type IntroOption = IntroSceneConfig | { scene: SceneConstructor; data?: unknown };

/** Resolve the intro option into a scene ctor + start data. null when no intro. */
export function resolveIntro(opt: IntroOption | undefined): { ctor: SceneConstructor; data: unknown } | null {
  if (!opt) return null;
  if ('scene' in opt && typeof opt.scene === 'function') return { ctor: opt.scene, data: opt.data };
  return { ctor: IntroScene as unknown as SceneConstructor, data: opt };
}
