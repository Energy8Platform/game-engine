/**
 * `flow-fx`: three flow node kinds — `tween` (moves a scene node through
 * the legacy `Tween`), `sound` (plays a file through `@pixi/sound`, with
 * category/fade) and `audio` (sets a category's volume, ducking every live
 * instance) — registered on `@energy8engine/flow`'s `flowNodes` by the
 * `fx1` row (`./runtime`). `sound` and `audio` share one `AudioState`
 * (`./audio-state`) per row.
 */
export { createTween, type TweenProps, type TweenDeps } from './tween';
export {
  createSound,
  type SoundProps,
  type SoundDeps,
  type SoundLike,
  type SoundInstance,
  type SoundKind,
} from './sound';
export { createAudio, type AudioProps } from './audio';
export {
  createAudioState,
  type AudioState,
  type AudioStateDeps,
  type Clock,
  type LiveInstance,
} from './audio-state';
