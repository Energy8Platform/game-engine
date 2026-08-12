import type { Answers } from '../answers';

/** Artube's own loading screen. Not an @energy8platform package (so it isn't in `DepVersions`,
 *  which tracks the workspace) — it is published to Artube's private GitLab registry and versioned
 *  by them. Bump when Artube ships a loader whose controller/plugin API moves. */
const ARTUBE_LOADER_VERSION = '^2.1.0';

export interface DepVersions {
  'platform-core': string; 'game-engine': string; 'stake-kit': string; 'stake-bridge': string;
  'stake-math-tools': string; 'harness': string; 'artube-bridge': string; 'artube-server': string;
}

export function genPackageJson(a: Answers, v: DepVersions): string {
  const scripts: Record<string, string> = {
    dev: 'vite',
    build: 'tsc --noEmit && vite build',
    postbuild: `rm -f ${a.id}.zip && cd dist && zip -r ../${a.id}.zip .`,
    typecheck: 'tsc --noEmit',
    smoke: 'tsx smoke.ts',
    'export:e8': 'tsx export.e8.ts',
    sim: 'e8-math sim --config ./math.config.ts',
    'math:smoke': 'e8-math sim --config ./math.config.ts --iterations 2000',
    pool: 'e8-math pool --config ./math.config.ts',
    curate: 'e8-math curate --config ./math.config.ts',
    math: 'e8-math all --config ./math.config.ts',
  };
  if (a.stake) {
    scripts['dev:stake'] = 'BUILD_TARGET=stake vite';
    scripts['build:stake'] = 'BUILD_TARGET=stake vite build';
    scripts['stake'] = 'BUILD_TARGET=stake-harness vite';
    scripts['stake:bundle'] =
      `rm -rf dist-stake stake-math ${a.id}-stake.zip stake-math.zip && npm run build:stake && npm run math && cd dist-stake && zip -r ../${a.id}-stake.zip . && cd ../stake-math && zip -r ../stake-math.zip . && cd .. && echo 'Stake artifacts: ${a.id}-stake.zip + stake-math.zip'`;
  }
  if (a.artube) {
    // `build:artube` produces BOTH of Artube's deployables: the frontend in `dist-artube` (its own
    // folder, like `dist-stake`, so no target can silently ship another's bytes) and the backend in
    // `dist-artube-server` (emitted by artubePlugin's build half — with this game's `.spin` in it).
    // Both are wiped first so a previous build's stale hashed assets can't ride along to the CDN.
    //
    // CONSEQUENCE: Artube's CI pipeline deploys the repo's `dist` folder, so point the pipeline at
    // `dist-artube` (change the job's artifact path, or copy the folder in CI). That is the accepted
    // trade for keeping the targets separate.
    scripts['dev:artube'] = 'BUILD_TARGET=artube vite';
    scripts['build:artube'] =
      'rm -rf dist-artube dist-artube-server && BUILD_TARGET=artube vite build';
    scripts['bundle:artube'] =
      `rm -f ${a.id}-artube.zip && npm run build:artube && cd dist-artube && zip -r ../${a.id}-artube.zip . && cd .. && echo 'Artube artifacts: dist-artube/ (point the CI pipeline here) + ${a.id}-artube.zip, and dist-artube-server/ (docker build it)'`;
  }
  const pkg = {
    name: a.id,
    private: true,
    type: 'module',
    scripts,
    dependencies: {
      '@energy8platform/platform-core': v['platform-core'],
      '@energy8platform/game-engine': v['game-engine'],
      '@energy8platform/harness': v['harness'],
      ...(a.stake ? { '@energy8platform/stake-kit': v['stake-kit'], '@energy8platform/stake-bridge': v['stake-bridge'] } : { '@energy8platform/stake-kit': v['stake-kit'] }),
      // The host lazy-imports the bridge, but the bundler still has to resolve it at build time —
      // so the BRIDGE is a runtime dependency. The SERVER is not: see devDependencies below.
      //
      // `@artube/loader` is Artube's branded loading screen: the Vite plugin half injects it into
      // index.html and `src/main.ts` imports the controller, so it is a runtime dependency too.
      // It lives on ARTUBE'S PRIVATE REGISTRY — `npm install` needs the `@artube` registry line and
      // a token (see README/CLAUDE.md). That is why nothing in @energy8platform depends on it: the
      // engine only describes the controller's SHAPE, and this game supplies the instance.
      ...(a.artube
        ? {
            '@energy8platform/artube-bridge': v['artube-bridge'],
            '@artube/loader': ARTUBE_LOADER_VERSION,
          }
        : {}),
      'pixi.js': '^8.16.0',
      '@pixi/sound': '^6.0.0',
      '@esotericsoftware/spine-pixi-v8': '~4.2.0',
      zod: '^3.23.0',
    },
    devDependencies: {
      // `dev:artube` starts the game's backend itself (artubePlugin in vite.config.ts). It is a
      // DEV dependency and nothing else: Node-side, imported only from vite.config.ts, and never
      // part of any bundle — an Energy8/Stake-only build must not have to resolve it, which is why
      // vite.config.ts imports it dynamically inside the Artube branch.
      ...(a.artube ? { '@energy8platform/artube-server': v['artube-server'] } : {}),
      '@energy8platform/stake-math-tools': v['stake-math-tools'],
      '@types/node': '^20.0.0',
      tsx: '^4.21.0',
      typescript: '^5.6.0',
      vite: '^6.0.0',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}
