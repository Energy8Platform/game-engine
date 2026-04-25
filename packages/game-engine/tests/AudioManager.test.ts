import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mock @pixi/sound ──────────────────────────────────────
// Model volumeAll and context.muted as independent fields,
// matching @pixi/sound's real IMediaContext behavior.
const soundMock = {
  _volumeAll: 1,
  context: { muted: false, audioContext: { state: 'running', resume: vi.fn() } },
  get volumeAll() {
    return this._volumeAll;
  },
  set volumeAll(v: number) {
    this._volumeAll = v;
  },
  muteAll: vi.fn(() => {
    soundMock.context.muted = true;
  }),
  unmuteAll: vi.fn(() => {
    soundMock.context.muted = false;
  }),
  play: vi.fn(),
  stop: vi.fn(),
  stopAll: vi.fn(),
  removeAll: vi.fn(),
  volume: vi.fn(),
};

vi.mock('@pixi/sound', () => ({ sound: soundMock }));

// ─── Mock localStorage (node env) ──────────────────────────
const storage: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in storage ? storage[k] : null),
  setItem: (k: string, v: string) => {
    storage[k] = v;
  },
  removeItem: (k: string) => {
    delete storage[k];
  },
  clear: () => {
    for (const k of Object.keys(storage)) delete storage[k];
  },
};

(globalThis as any).document = {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

import { AudioManager } from '../src/audio/AudioManager';

function resetSound() {
  soundMock._volumeAll = 1;
  soundMock.context.muted = false;
  soundMock.muteAll.mockClear();
  soundMock.unmuteAll.mockClear();
}

describe('AudioManager', () => {
  beforeEach(() => {
    (globalThis as any).localStorage.clear();
    resetSound();
  });

  it('unmute works after reload with persisted muted state', async () => {
    // Session 1: mute and persist
    const a1 = new AudioManager({ persist: true });
    await a1.init();
    a1.muteAll();
    expect(a1.muted).toBe(true);

    // Simulate reload — clear in-memory @pixi/sound state, keep localStorage
    resetSound();

    // Session 2: restore persisted muted state, then unmute
    const a2 = new AudioManager({ persist: true });
    await a2.init();
    expect(a2.muted).toBe(true);
    // @pixi/sound's own mute flag must be synced with restored state,
    // not encoded as volumeAll=0 (which unmuteAll cannot undo).
    expect(soundMock.context.muted).toBe(true);

    a2.toggleMute();
    expect(a2.muted).toBe(false);
    expect(soundMock.context.muted).toBe(false);
    expect(soundMock.volumeAll).toBe(1);
  });

  it('muteAll/unmuteAll round-trip keeps volumeAll at 1', async () => {
    const a = new AudioManager({ persist: false });
    await a.init();

    a.muteAll();
    expect(soundMock.context.muted).toBe(true);
    a.unmuteAll();
    expect(soundMock.context.muted).toBe(false);
    expect(soundMock.volumeAll).toBe(1);
  });

  it('fresh init with no persisted state leaves audio audible', async () => {
    const a = new AudioManager({ persist: true });
    await a.init();
    expect(a.muted).toBe(false);
    expect(soundMock.context.muted).toBe(false);
    expect(soundMock.volumeAll).toBe(1);
  });
});
