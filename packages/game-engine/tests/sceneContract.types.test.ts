import { describe, it, expect } from 'vitest';
import type { SlotSceneController, SceneApi } from '@/host/sceneController';
import type { SlotSpinResultBase } from '@energy8platform/platform-core/slot-result';

describe('scene contract shape', () => {
  it('a minimal scene implements onSpin and compiles', () => {
    const scene: SlotSceneController<SlotSpinResultBase> = {
      async onSpin(result, ctx) { void result; void ctx.bet; void ctx.signal; },
    };
    expect(typeof scene.onSpin).toBe('function');
  });
  it('SceneApi exposes playback-only audio (no setVolume)', () => {
    // @ts-expect-error setVolume must NOT exist on the scene's audio handle
    const bad: SceneApi['audio']['setVolume'] = undefined;
    void bad;
  });
});
