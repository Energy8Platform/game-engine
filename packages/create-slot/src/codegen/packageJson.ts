import type { Answers } from '../answers';

export interface DepVersions {
  'platform-core': string; 'game-engine': string; 'stake-kit': string; 'stake-bridge': string;
}

export function genPackageJson(a: Answers, v: DepVersions): string {
  const pkg = {
    name: a.id,
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      typecheck: 'tsc --noEmit',
      smoke: 'tsx smoke.ts',
      sim: 'e8-math sim --config ./math.config.ts',
      pool: 'e8-math pool --config ./math.config.ts',
      curate: 'e8-math curate --config ./math.config.ts',
      math: 'e8-math all --config ./math.config.ts',
    },
    dependencies: {
      '@energy8platform/platform-core': v['platform-core'],
      '@energy8platform/game-engine': v['game-engine'],
      ...(a.stake ? { '@energy8platform/stake-kit': v['stake-kit'], '@energy8platform/stake-bridge': v['stake-bridge'] } : { '@energy8platform/stake-kit': v['stake-kit'] }),
      'pixi.js': '^8.16.0',
      zod: '^3.23.0',
    },
    devDependencies: {
      '@energy8platform/stake-math-tools': '^0.1.0',
      '@types/node': '^20.0.0',
      tsx: '^4.21.0',
      typescript: '^5.6.0',
      vite: '^6.0.0',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}
