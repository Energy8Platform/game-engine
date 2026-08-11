/**
 * Интеграция с Artube.
 *
 * Task 13 scaffold placeholder: only the leaf `detect` module exists so far.
 * `ArtubeBridge` (the actual game-sdk translation layer) lands in Task 15 and
 * will replace this file's contents — this re-export exists purely so the
 * package's "." entry point (promised by `package.json`'s `exports`) has
 * something to bundle before then.
 */

export { isArtubeLaunch, parseArtubeUrl, type ArtubeUrlParams } from './detect';
