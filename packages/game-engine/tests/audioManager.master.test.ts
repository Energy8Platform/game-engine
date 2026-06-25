import { describe, it, expect } from 'vitest';
import { AudioManager } from '@/audio/AudioManager';

describe('AudioManager master volume', () => {
  it('defaults to 1 and clamps 0..1', () => {
    const a = new AudioManager();
    expect(a.getMasterVolume()).toBe(1);
    a.setMasterVolume(0.5);
    expect(a.getMasterVolume()).toBe(0.5);
    a.setMasterVolume(2);
    expect(a.getMasterVolume()).toBe(1);
    a.setMasterVolume(-1);
    expect(a.getMasterVolume()).toBe(0);
  });
  it('is a no-op-safe call before init (no @pixi/sound)', () => {
    const a = new AudioManager();
    expect(() => a.setMasterVolume(0.3)).not.toThrow();
  });
});
