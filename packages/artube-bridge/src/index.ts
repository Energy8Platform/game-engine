/**
 * Интеграция с Artube.
 *
 * Игре на `@energy8platform/game-engine` руками этот мост поднимать не нужно:
 * хост выбирает платформу сам, надо только дать ему, чем грузить пакет —
 *
 * ```ts
 * createSlotGame({ …, artube: { load: () => import('@energy8platform/artube-bridge') } });
 * ```
 *
 * Импорт передаёт ИГРА, а не хост: голый `import('@energy8platform/artube-bridge')`
 * внутри game-engine бандлеры резолвят статически, и он ломал бы сборку играм,
 * которые пакет не ставили. Дальше хост сам классифицирует запуск
 * (`classifyArtubeLaunch` лежит в том же модуле, что и мост), отказывается
 * стартовать на испорченном, создаёт мост и ждёт `ready()`.
 *
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
