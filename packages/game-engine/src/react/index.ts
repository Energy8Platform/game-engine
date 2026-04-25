// Auto-activate JSX.IntrinsicElements augmentation. Side-effect import only —
// brings the `declare module 'react'` block into the TS resolution graph so
// consumers get fully-typed <flexContainer>, <button>, <label>, etc. without
// writing their own shim.
import './jsx-runtime';

// Core
export { createPixiRoot } from './createPixiRoot';
export type { PixiRoot } from './createPixiRoot';

// Catalogue
export { extend } from './catalogue';
export { extendPixiElements, extendUIElements, extendCustomElements } from './extendAll';

// Scene
export { ReactScene } from './ReactScene';

// Context & Hooks
export { EngineContext, useEngine } from './EngineContext';
export type { EngineContextValue } from './EngineContext';
export {
  useSDK,
  useAudio,
  useInput,
  useViewport,
  useBalance,
  useSession,
  useGameConfig,
} from './hooks';
