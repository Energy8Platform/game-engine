import { describe, it, expect, vi } from 'vitest';
import { createSceneAudio } from '../../src/host/sceneAudio';

function fakeManager() {
  return {
    play: vi.fn(), playMusic: vi.fn(), stopMusic: vi.fn(),
    duckMusic: vi.fn(), unduckMusic: vi.fn(),
  };
}

describe('createSceneAudio', () => {
  it('routes play through the sfx category', () => {
    const m = fakeManager();
    const a = createSceneAudio(m as any);
    a.play('coin', { volume: 0.5 });
    expect(m.play).toHaveBeenCalledWith('coin', 'sfx', { volume: 0.5 });
  });
  it('maps music + duck verbs', () => {
    const m = fakeManager();
    const a = createSceneAudio(m as any);
    a.playMusic('bgm_free', 800); a.stopMusic(); a.duck(0.3); a.unduck();
    expect(m.playMusic).toHaveBeenCalledWith('bgm_free', 800);
    expect(m.stopMusic).toHaveBeenCalled();
    expect(m.duckMusic).toHaveBeenCalledWith(0.3);
    expect(m.unduckMusic).toHaveBeenCalled();
  });
  it('does not expose volume/mute', () => {
    const a = createSceneAudio(fakeManager() as any);
    expect((a as Record<string, unknown>).setVolume).toBeUndefined();
    expect((a as Record<string, unknown>).muteAll).toBeUndefined();
  });
});
