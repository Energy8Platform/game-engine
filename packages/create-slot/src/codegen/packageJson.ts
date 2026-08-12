import type { Answers } from '../answers';

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
    // Artube's CI builds with `npm run build` and deploys `dist/` — so the Artube build TARGETS
    // `dist` (see vite.config.ts), not a `dist-artube` the pipeline would never look at. The two
    // builds are byte-equivalent (the DevBridge bootstrapper comes from a dev-server-only plugin,
    // so no build carries one), so `rm -rf dist` is hygiene against a previous build's stale hashed
    // assets riding along to the CDN — not protection from mixing two different artifacts. Setting
    // BUILD_TARGET=artube in CI is likewise optional today; the script names the target.
    scripts['dev:artube'] = 'BUILD_TARGET=artube vite';
    scripts['build:artube'] = 'rm -rf dist && BUILD_TARGET=artube vite build';
    scripts['bundle:artube'] =
      `rm -f ${a.id}-artube.zip && npm run build:artube && cd dist && zip -r ../${a.id}-artube.zip . && cd .. && echo 'Artube artifact: dist/ (what the client-repo CI deploys) + ${a.id}-artube.zip'`;
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
      ...(a.artube ? { '@energy8platform/artube-bridge': v['artube-bridge'] } : {}),
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
