import { afterEach, describe, expect, it } from 'vitest';
import { markModuleCopy } from '@energy8engine/contracts';
import { fakeFetch } from './helpers';
import { createGame, type GameApp } from '../src/index';

const KEY = Symbol.for('energy8engine.moduleCopies');
let game: GameApp | undefined;

afterEach(async () => {
  await game?.stop();
  game = undefined;
  delete (globalThis as Record<symbol, unknown>)[KEY];
});

const boot = () => createGame({ loader: { fetchFn: fakeFetch({ rows: [], diagnostics: [] }) } });
const copyWarnings = (app: GameApp) => app.diagnostics.filter((d) => d.where === 'modules');

describe('createGame — a second copy of a stateful engine module', () => {
  it('is one warning naming both urls', async () => {
    markModuleCopy('@energy8engine/tween', 'file:///engine/tween/src/index.ts');
    markModuleCopy(
      '@energy8engine/tween',
      'file:///project/node_modules/@energy8engine/tween/src/index.ts',
    );
    game = await boot();
    expect(copyWarnings(game)).toEqual([
      {
        severity: 'warning',
        plugin: 'runtime',
        where: 'modules',
        message:
          '2 copies of @energy8engine/tween are loaded — file:///engine/tween/src/index.ts, file:///project/node_modules/@energy8engine/tween/src/index.ts: its module state (tweens, caches, classes) exists more than once',
        fix: "the IDE host's diagnostics name which project location resolves its own copy; declare the package the way the engine does, or remove the project's copy",
      },
    ]);
  });

  it('three urls are still one warning, and it counts them', async () => {
    for (const where of ['engine', 'project', 'plugin']) {
      markModuleCopy('@energy8engine/reel-core', `file:///${where}/reel-core/src/index.ts`);
    }
    game = await boot();
    expect(copyWarnings(game).map((d) => d.message)).toEqual([
      '3 copies of @energy8engine/reel-core are loaded — file:///engine/reel-core/src/index.ts, file:///project/reel-core/src/index.ts, file:///plugin/reel-core/src/index.ts: its module state (tweens, caches, classes) exists more than once',
    ]);
  });

  it('one url, marked again by a second compose on the same page, says nothing', async () => {
    markModuleCopy('@energy8engine/tween', 'file:///engine/tween/src/index.ts');
    markModuleCopy('@energy8engine/tween', 'file:///engine/tween/src/index.ts');
    game = await boot();
    expect(copyWarnings(game)).toEqual([]);
  });
});
