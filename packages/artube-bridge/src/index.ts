/**
 * Интеграция с Artube.
 *
 * Игре на `@energy8platform/game-engine` руками этот мост поднимать не нужно:
 * хост выбирает платформу сам, надо только включить путь Artube —
 *
 * ```ts
 * createSlotGame({ …, artube: {} });
 * ```
 *
 * Хост сам классифицирует запуск (`classifyArtubeLaunch`), отказывается
 * стартовать на испорченном, лениво импортирует мост и ждёт `ready()`.
 * Прямое использование ниже — для игр, которые говорят с `CasinoGameSDK`
 * напрямую, без game-engine:
 *
 * ```ts
 * import { classifyArtubeLaunch } from '@energy8platform/artube-bridge/detect';
 *
 * const launch = classifyArtubeLaunch(location.href);
 * if (launch === 'blocked') throw new Error('испорченный запуск: пустой sessionId');
 * const isArtube = launch === 'artube';
 * if (isArtube) {
 *   const { ArtubeBridge } = await import('@energy8platform/artube-bridge');
 *   const bridge = new ArtubeBridge({ devMode: true, gameId: 'sweet-bonanza' });
 *   await bridge.ready();
 * }
 * const sdk = new CasinoGameSDK({ devMode: isArtube });
 * ```
 */

export { ArtubeBridge, betIndexOf } from './bridge';
export {
  isArtubeLaunch, classifyArtubeLaunch, parseArtubeUrl,
  type ArtubeUrlParams, type ArtubeLaunchKind,
} from './detect';
export { ArtubeClient, ArtubeBackendError, type PlayArgs } from './client';
export type {
  ArtubeBridgeOptions, ServerInit, ServerResult, ServerInitConfig,
} from './types';
