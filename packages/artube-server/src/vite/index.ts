/**
 * `@energy8platform/artube-server/vite` — the dev-time half of this package.
 *
 * It sits next to the service it spawns for the same reason `spinPlugin`
 * sits inside `platform-core` next to `e8-server`: the plugin and the process
 * share a CLI contract, and splitting them across packages would let the two
 * drift. A *game* consumes this entry only from `vite.config.ts`, so it is a
 * Node-side devDependency — nothing here is ever bundled into the game.
 */
export {
  artubePlugin,
  resolveExternalTarget,
  resolveSpawnConfig,
  resolveCliEntry,
  buildChildArgs,
  buildChildEnv,
  describeStartFailure,
  SANDBOX_GAMES_API_URL,
  SANDBOX_GAME_ID,
  DEFAULT_ARTUBE_DEV_PORT,
} from './devPlugin.js';
export type { ArtubePluginOptions, ResolvedSpawnConfig } from './devPlugin.js';
