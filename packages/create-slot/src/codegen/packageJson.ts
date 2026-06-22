import type { Answers } from '../answers';

export interface DepVersions {
  'platform-core': string; 'game-engine': string; 'stake-kit': string; 'stake-bridge': string;
}

export function genPackageJson(a: Answers, v: DepVersions): string {
  const simulate: Record<string, string> = {};
  // one simulate:* script per non-base/free action would be derived from the spec at build;
  // emit the canonical base sim here (author adds buy modes after editing the spec).
  simulate['simulate'] = 'platform-core-simulate --config ./dev.config.ts --action spin';

  const pkg = {
    name: a.id,
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      typecheck: 'tsc --noEmit',
      smoke: 'tsx smoke.ts',
      ...simulate,
    },
    dependencies: {
      '@energy8platform/platform-core': v['platform-core'],
      '@energy8platform/game-engine': v['game-engine'],
      ...(a.stake ? { '@energy8platform/stake-kit': v['stake-kit'], '@energy8platform/stake-bridge': v['stake-bridge'] } : { '@energy8platform/stake-kit': v['stake-kit'] }),
      'pixi.js': '^8.16.0',
      ...(a.stake ? { zod: '^3.23.0' } : {}),
    },
    devDependencies: {
      '@types/node': '^20.0.0',
      tsx: '^4.21.0',
      typescript: '^5.6.0',
      vite: '^6.0.0',
    },
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}
