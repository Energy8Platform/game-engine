import { describe, it, expect } from 'vitest';
import { resolveStartScene } from '../../src/host/sceneStart';
import type { SceneRegistration } from '../../src/host/types';

const scene = {} as SceneRegistration['scene'];
const SCENES: SceneRegistration[] = [
  { key: 'intro', scene, skipOnReplay: true },
  { key: 'game', scene },
];

describe('resolveStartScene', () => {
  it('starts on the first scene in base mode', () => {
    expect(resolveStartScene(SCENES, false)).toBe('intro');
  });

  it('skips a leading skipOnReplay scene on a replay launch', () => {
    expect(resolveStartScene(SCENES, true)).toBe('game');
  });

  it('honours an explicit startScene when it is eligible', () => {
    expect(resolveStartScene(SCENES, false, 'game')).toBe('game');
  });

  it('ignores an explicit startScene that is skipped on replay, falling to the first eligible', () => {
    expect(resolveStartScene(SCENES, true, 'intro')).toBe('game');
  });

  it('falls back to the first scene when nothing is eligible (degenerate)', () => {
    const allSkipped: SceneRegistration[] = [{ key: 'intro', scene, skipOnReplay: true }];
    expect(resolveStartScene(allSkipped, true)).toBe('intro');
  });
});
