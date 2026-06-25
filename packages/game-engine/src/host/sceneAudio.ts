import type { AudioManager } from '../audio/AudioManager';
import type { SceneAudio } from './sceneController';

/** Wrap the engine's AudioManager into the playback-only handle a scene receives. Volume/mute are
 *  deliberately omitted — those are driven by the shell's settingChange → host. */
export function createSceneAudio(audio: AudioManager): SceneAudio {
  return {
    play: (alias, opts) => audio.play(alias, 'sfx', opts),
    playMusic: (alias, fadeMs) => audio.playMusic(alias, fadeMs),
    stopMusic: () => audio.stopMusic(),
    duck: (factor) => audio.duckMusic(factor),
    unduck: () => audio.unduckMusic(),
  };
}
