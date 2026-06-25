import { describe, it, expect } from 'vitest';
import type { SlotSceneController, SceneApi } from '@/host/sceneController';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

describe('scene contract shape', () => {
  it('a scene implementing the required core lifecycle hooks compiles', () => {
    const scene: SlotSceneController<SlotSpinResultBase> = {
      onCreate(_api) { /* grab capabilities */ },
      onSpinStart() {},
      async onSpin(result, ctx) { void result; void ctx.bet; void ctx.signal; },
      async onEnterMode(_r, _ctx) {},
      async onExitMode(_r, _ctx) {},
      onSpinEnd(_r, _ctx) {},
    };
    expect(typeof scene.onSpin).toBe('function');
    expect(typeof scene.onCreate).toBe('function');
    expect(typeof scene.onSpinEnd).toBe('function');
  });
  it('SceneApi exposes playback-only audio (no setVolume)', () => {
    // @ts-expect-error setVolume must NOT exist on the scene's audio handle
    const bad: SceneApi['audio']['setVolume'] = undefined;
    void bad;
  });
});
