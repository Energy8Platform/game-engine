/**
 * `@energy8platform/artube-server/vite` — the Vite-side half of this package.
 *
 * It sits next to the service it spawns for the same reason `spinPlugin`
 * sits inside `platform-core` next to `e8-server`: the plugin and the process
 * share a CLI contract, and splitting them across packages would let the two
 * drift. The build half is here for a stronger version of the same reason —
 * it emits a `package.json` pinning this package and copies this package's
 * own `Dockerfile.template`, so the artifact and the server it runs are
 * versioned together by construction.
 *
 * A *game* consumes this entry only from `vite.config.ts`, so it is a
 * Node-side devDependency — nothing here is ever bundled into the game.
 */
export { artubePlugin } from './plugin.js';
export { artubeBuildPlugin } from './buildPlugin.js';
/**
 * Artube's own branded loading screen, VENDORED from `@artube/loader` 2.1.0 —
 * see the provenance header in `partnerLoader.ts`. It lives here, and not in a
 * dependency of the game, so that a studio needs no account on Artube's private
 * registry: the Vite half is Node-side, exactly like everything else on this
 * entry. The browser half is `@energy8platform/artube-bridge/loader`.
 */
export {
  artubePartnerLoader,
  artubeLoader,
  ARTUBE_LOADER_ELEMENT_IDS,
  type PartnerLoaderOptions,
} from './partnerLoader.js';
export {
  artubeDevPlugin,
  resolveExternalTarget,
  resolveSpawnConfig,
  resolveSpinPath,
  resolveCliEntry,
  buildChildArgs,
  buildChildEnv,
  describeStartFailure,
  SANDBOX_GAMES_API_URL,
  SANDBOX_GAME_ID,
  DEFAULT_ARTUBE_DEV_PORT,
} from './devPlugin.js';
export {
  emitServerArtifact,
  renderEntry,
  renderPackageJson,
  renderReadme,
  resolveServerSpec,
  resolvePackageFile,
  readGameName,
  sanitizePackageName,
  ARTIFACT_SPIN_NAME,
  DEFAULT_SERVER_OUT_DIR,
} from './emitServer.js';
export type { ArtubePluginOptions, ResolvedSpawnConfig } from './devPlugin.js';
export type { EmitOptions, EmitResult, PackageJsonOptions, ReadmeOptions } from './emitServer.js';
