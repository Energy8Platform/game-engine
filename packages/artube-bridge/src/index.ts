/**
 * Интеграция с Artube.
 *
 * ```ts
 * import { isArtubeLaunch } from '@energy8platform/artube-bridge/detect';
 *
 * const isArtube = isArtubeLaunch(location.href);
 * if (isArtube) {
 *   const { ArtubeBridge } = await import('@energy8platform/artube-bridge');
 *   new ArtubeBridge({ devMode: true, gameId: 'sweet-bonanza' });
 * }
 * const sdk = new CasinoGameSDK({ devMode: isArtube });
 * ```
 */

export { ArtubeBridge, betIndexOf } from './bridge';
export { isArtubeLaunch, parseArtubeUrl, type ArtubeUrlParams } from './detect';
export { ArtubeClient, ArtubeBackendError, type PlayArgs } from './client';
export type {
  ArtubeBridgeOptions, ServerInit, ServerResult, ServerInitConfig,
} from './types';
