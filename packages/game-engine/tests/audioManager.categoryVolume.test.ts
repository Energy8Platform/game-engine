// @vitest-environment jsdom
// (init() wires a mobile-unlock listener on window; in the bare `node` env that throws and the
// manager degrades to its silent no-op mode, which would make every assertion below vacuous.)
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * The shell's Music and SFX sliders must actually move the volume.
 *
 * The chain is: menu slider → `ShellController.setMenuValue` → `setVolume` →
 * `settingChange {key:'music'|'sfx'}` → createSlotGame → `AudioManager.setVolume(category, v)`.
 * Everything up to that last call was verified by hand; these tests pin the last link, because
 * that is where it broke: `setVolume` stored the new category volume and then called
 * `applyVolumes()`, which only ever wrote the MASTER gain to the global bus. Nothing pushed the
 * category volume at the sounds already playing.
 *
 * @pixi/sound resolves a playing instance's gain as
 *     instanceVolume × soundVolume × globalVolume        (WebAudioInstance.refresh)
 * so the fake below models exactly that, and each test asserts the audible gain rather than any
 * internal bookkeeping.
 */

interface FakeInstance {
  volume: number;
  loop: boolean;
}

/** Minimal @pixi/sound stand-in: one Sound per alias, each with its live instances. */
const fake = vi.hoisted(() => {
  interface FakeSound {
    volume: number;
    instances: FakeInstance[];
  }
  const sounds = new Map<string, FakeSound>();
  const api = {
    /** context.volume — what `sound.volumeAll = x` writes. */
    volumeAll: 1,
    muted: false,
    find(alias: string): FakeSound {
      if (!sounds.has(alias)) sounds.set(alias, { volume: 1, instances: [] });
      return sounds.get(alias)!;
    },
    exists: (alias: string) => sounds.has(alias),
    play(alias: string, opts?: { volume?: number; loop?: boolean }): FakeInstance {
      const s = api.find(alias);
      const inst: FakeInstance = { volume: opts?.volume ?? 1, loop: opts?.loop ?? false };
      s.instances.push(inst);
      return inst;
    },
    /** SoundLibrary.volume(alias, v) — writes the SOUND layer, which refreshes live instances. */
    volume(alias: string, v?: number): number {
      const s = api.find(alias);
      if (v !== undefined) s.volume = v;
      return s.volume;
    },
    stop(alias: string): void {
      api.find(alias).instances.length = 0;
    },
    stopAll(): void {
      sounds.forEach((s) => (s.instances.length = 0));
    },
    muteAll(): void {
      api.muted = true;
    },
    unmuteAll(): void {
      api.muted = false;
    },
    /** The audible gain of the first live instance of `alias`, or null when nothing is playing. */
    gain(alias: string): number | null {
      const s = sounds.get(alias);
      const inst = s?.instances[0];
      if (!s || !inst) return null;
      return inst.volume * s.volume * api.volumeAll * (api.muted ? 0 : 1);
    },
    reset(): void {
      sounds.clear();
      api.volumeAll = 1;
      api.muted = false;
    },
  };
  return api;
});

vi.mock('@pixi/sound', () => ({ sound: fake, default: { sound: fake } }));

const { AudioManager } = await import('@/audio/AudioManager');

/** A manager with no persistence, already initialised against the fake module. */
async function manager(cfg?: Record<string, number>) {
  const a = new AudioManager({ persist: false, ...cfg } as never);
  await a.init();
  return a;
}

beforeEach(() => {
  fake.reset();
});

describe('AudioManager — the Music slider moves music that is already playing', () => {
  it('applies a new music volume to the running loop', async () => {
    const a = await manager({ music: 0.5 });
    a.playMusic('mus_base', 0); // no crossfade → instant switch
    expect(fake.gain('mus_base')).toBeCloseTo(0.5);

    a.setVolume('music', 0.2);

    // Was 0.5: the slider only took effect on the NEXT playMusic (i.e. a mode change).
    expect(fake.gain('mus_base')).toBeCloseTo(0.2);
  });

  it('silences the running loop at 0 and brings it back', async () => {
    const a = await manager({ music: 0.8 });
    a.playMusic('mus_base', 0);

    a.setVolume('music', 0);
    expect(fake.gain('mus_base')).toBeCloseTo(0);

    a.setVolume('music', 0.6);
    expect(fake.gain('mus_base')).toBeCloseTo(0.6);
  });

  it('carries the new volume into the next track', async () => {
    const a = await manager({ music: 0.5 });
    a.playMusic('mus_base', 0);
    a.setVolume('music', 0.3);
    a.playMusic('mus_bonus', 0);
    expect(fake.gain('mus_bonus')).toBeCloseTo(0.3);
  });
});

describe('AudioManager — the SFX slider', () => {
  it('applies to sounds played after the change', async () => {
    const a = await manager({ sfx: 1 });
    a.setVolume('sfx', 0.25);
    a.play('sfx_spin', 'sfx');
    expect(fake.gain('sfx_spin')).toBeCloseTo(0.25);
  });

  it('scales a per-call volume rather than replacing it', async () => {
    const a = await manager({ sfx: 0.5 });
    a.play('sfx_land', 'sfx', { volume: 0.4 });
    expect(fake.gain('sfx_land')).toBeCloseTo(0.2);
  });

  it('does not leak the sfx volume into music', async () => {
    const a = await manager({ music: 0.5, sfx: 1 });
    a.playMusic('mus_base', 0);
    a.setVolume('sfx', 0.1);
    expect(fake.gain('mus_base')).toBeCloseTo(0.5);
  });
});

describe('AudioManager — a crossfade must end audible', () => {
  // The scene switches tracks with `api.audio.playMusic(alias)` and no explicit duration, so every
  // switch after the first takes the crossfade branch. That branch starts the new track at INSTANCE
  // volume 0 and then fades the SOUND-level volume up — two different layers, and the gain is their
  // product, so the track stayed at zero for its whole life. Base → bonus went silent.
  it('leaves the new track at the music volume, not zero', async () => {
    const a = await manager({ music: 0.5 });
    a.playMusic('mus_base', 0); // first switch: no current track → instant branch
    a.playMusic('mus_bonus', 30); // every later switch: crossfade branch
    await new Promise((r) => setTimeout(r, 90));
    expect(fake.gain('mus_bonus')).toBeCloseTo(0.5);
  });
});

describe('AudioManager — ducking', () => {
  it('restores the music volume after unduck', async () => {
    const a = await manager({ music: 0.5 });
    a.playMusic('mus_base', 0);
    a.duckMusic(0.3);
    expect(fake.gain('mus_base')).toBeCloseTo(0.15);
    a.unduckMusic();
    // Ducking wrote `category × factor` to the SOUND layer while the instance already carried the
    // category volume, so unducking left `category²` behind — 0.25 instead of 0.5.
    expect(fake.gain('mus_base')).toBeCloseTo(0.5);
  });

  it('keeps the slider live while ducked', async () => {
    const a = await manager({ music: 0.8 });
    a.playMusic('mus_base', 0);
    a.duckMusic(0.5);
    a.setVolume('music', 0.4);
    expect(fake.gain('mus_base')).toBeCloseTo(0.2); // 0.4 × 0.5
    a.unduckMusic();
    expect(fake.gain('mus_base')).toBeCloseTo(0.4);
  });
});

describe('AudioManager — muting must be reversible', () => {
  // The sound toggle is the global context mute. A track that started while muted used to never
  // start at all (playMusic returned early), so unmuting brought back silence until the next mode
  // change happened to switch tracks.
  it('brings music back when the player unmutes', async () => {
    const a = await manager({ music: 0.6 });
    a.muteAll();
    a.playMusic('mus_base', 0);
    expect(fake.gain('mus_base')).toBeCloseTo(0); // context muted → inaudible, as it should be
    a.unmuteAll();
    expect(fake.gain('mus_base')).toBeCloseTo(0.6);
  });

  it('honours a muted music CATEGORY without killing the track', async () => {
    const a = await manager({ music: 0.6 });
    a.playMusic('mus_base', 0);
    a.muteCategory('music');
    expect(fake.gain('mus_base')).toBeCloseTo(0);
    a.unmuteCategory('music');
    expect(fake.gain('mus_base')).toBeCloseTo(0.6);
  });
});

describe('AudioManager — master gain is applied exactly once', () => {
  it('does not square the master into a playing track', async () => {
    const a = await manager({ music: 1 });
    a.playMusic('mus_base', 0);
    a.setMasterVolume(0.5);
    // Master lives on the global bus; folding it into the instance volume too would give 0.25.
    expect(fake.gain('mus_base')).toBeCloseTo(0.5);
  });

  it('does not square the master into an sfx', async () => {
    const a = await manager({ sfx: 1 });
    a.setMasterVolume(0.5);
    a.play('sfx_click', 'sfx');
    expect(fake.gain('sfx_click')).toBeCloseTo(0.5);
  });
});
