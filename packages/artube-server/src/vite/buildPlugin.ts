/**
 * `artubeBuildPlugin` — the build-mode half of {@link artubePlugin}.
 *
 * An Artube game is two deployables, and until now `vite build` produced
 * exactly one of them. The other — the backend image — needed the game's
 * `.spin`, which lives in the client repo, so a studio hand-carried it into a
 * separate server repo. The plugin already knows that path (it is the same
 * one it hands the dev backend on every `npm run dev:artube`), so it is the
 * one place that cannot get it wrong: this half writes the whole deployable
 * directory, math included.
 *
 * `apply: 'build'` is the mirror of the dev half's `apply: 'serve'`: neither
 * can run in the other's mode. And a game that never targets Artube never
 * reaches either, because `vite.config.ts` imports this package *dynamically,
 * inside the Artube branch* — an Energy8/Stake-only build does not resolve it
 * at all.
 */
import { isAbsolute, resolve as resolvePath } from 'node:path';
import type { Plugin } from 'vite';
import { resolveSpinPath, type ArtubePluginOptions } from './devPlugin.js';
import { DEFAULT_SERVER_OUT_DIR, emitServerArtifact } from './emitServer.js';

export function artubeBuildPlugin(opts: ArtubePluginOptions = {}): Plugin {
  let root = process.cwd();

  return {
    name: 'artube:server-artifact',
    apply: 'build',

    configResolved(config) {
      root = config.root;
    },

    /**
     * `closeBundle`, not `writeBundle`: the artifact is a directory beside the
     * frontend bundle, not part of it, so it is written once the frontend
     * build has finished rather than per output chunk. A throw here fails
     * `vite build` — which is the point. An Artube build that quietly skipped
     * the backend would ship a frontend against yesterday's math.
     */
    closeBundle() {
      if (opts.emitServer === false) return;

      const spinPath = resolveSpinPath(opts, process.env, root);
      const rawOut = opts.serverOutDir ?? DEFAULT_SERVER_OUT_DIR;
      const outDir = isAbsolute(rawOut) ? rawOut : resolvePath(root, rawOut);

      const result = emitServerArtifact({ root, spinPath, outDir, serverSpec: opts.serverSpec });
      console.log(
        `[artube] backend artifact → ${rawOut}/ ` +
          `(${result.files.join(', ')}; @energy8platform/artube-server@${result.serverSpec})\n` +
          `[artube]   math copied from ${spinPath}\n` +
          `[artube]   \`docker build\` it as-is, or commit it into your server repo — see ${rawOut}/README.md`,
      );
    },
  };
}
