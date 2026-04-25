// LoadingScene is pixi-specific and stays in game-engine.
// CSSPreloader and the Energy8 SVG logo live in platform-core so any
// renderer (Pixi, Phaser, Three.js) shows the same brand frame.
export { LoadingScene } from './LoadingScene';
export {
  createCSSPreloader,
  removeCSSPreloader,
  buildLogoSVG,
  LOADER_BAR_MAX_WIDTH,
} from '@energy8platform/platform-core/loading';
