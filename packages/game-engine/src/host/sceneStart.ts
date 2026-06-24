import type { SceneRegistration } from './types';

/**
 * Pick the scene to START with, given the registered scenes (in order) and the launch mode.
 *
 * Rules:
 *  - On a replay launch, scenes flagged `skipOnReplay` are NOT eligible to start (they stay
 *    registered for `goto`, they just aren't auto-started) — so a leading intro is skipped and
 *    the game scene starts directly.
 *  - An explicit `startScene` wins, but only if that scene is itself eligible; otherwise the first
 *    eligible scene wins.
 *  - Falls back to the first scene unconditionally if nothing is eligible (degenerate config).
 */
export function resolveStartScene(
  scenes: SceneRegistration[],
  isReplay: boolean,
  explicitStart?: string,
): string {
  const eligible = scenes.filter((s) => !(isReplay && s.skipOnReplay));
  if (explicitStart) {
    const ok = eligible.find((s) => s.key === explicitStart);
    if (ok) return ok.key;
  }
  return eligible[0]?.key ?? scenes[0]?.key;
}
