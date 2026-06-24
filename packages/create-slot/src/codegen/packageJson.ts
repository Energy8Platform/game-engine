import type { Answers } from '../answers';

export interface DepVersions {
  'platform-core': string; 'game-engine': string; 'stake-kit': string; 'stake-bridge': string;
  'stake-math-tools': string;
}

export function genPackageJson(a: Answers, v: DepVersions): string {
  const scripts: Record<string, string> = {
    dev: 'vite',
    build: 'tsc --noEmit && vite build',
    postbuild: `rm -f ${a.id}.zip && cd dist && zip -r ../${a.id}.zip .`,
    typecheck: 'tsc --noEmit',
    smoke: 'tsx smoke.ts',
    sim: 'e8-math sim --config ./math.config.ts',
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
  const pkg = {
    name: a.id,
    private: true,
    type: 'module',
    scripts,
    dependencies: {
      '@energy8platform/platform-core': v['platform-core'],
      '@energy8platform/game-engine': v['game-engine'],
      ...(a.stake ? { '@energy8platform/stake-kit': v['stake-kit'], '@energy8platform/stake-bridge': v['stake-bridge'] } : { '@energy8platform/stake-kit': v['stake-kit'] }),
      'pixi.js': '^8.16.0',
      zod: '^3.23.0',
    },
    devDependencies: {
      '@energy8platform/stake-math-tools': v['stake-math-tools'],
      '@types/node': '^20.0.0',
      tsx: '^4.21.0',
      typescript: '^5.6.0',
      vite: '^6.0.0',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}
