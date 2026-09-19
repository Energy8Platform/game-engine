/**
 * `flow-fx`: two flow node kinds — `tween` (moves a scene node through the
 * legacy `Tween`) and `sound` (plays a file through `@pixi/sound`) —
 * registered on `@energy8engine/flow`'s `flowNodes` by the `fx1` row
 * (`./runtime`).
 */
export { createTween, type TweenProps, type TweenDeps } from './tween';
export {
  createSound,
  type SoundProps,
  type SoundDeps,
  type SoundLike,
  type SoundKind,
} from './sound';
