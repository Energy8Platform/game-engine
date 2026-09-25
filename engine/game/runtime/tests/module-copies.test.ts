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
    markModuleCopy('@energy8engine/tween', 'file:///project/node_modules/@energy8engine/tween/src/index.ts');
    game = await boot();
    expect(copyWarnings(game)).toEqual([
      {
        severity: 'warning',
        plugin: 'runtime',
        where: 'modules',
        message:
          'two copies of @energy8engine/tween are loaded — file:///engine/tween/src/index.ts, file:///project/node_modules/@energy8engine/tween/src/index.ts: its module state (tweens, caches, classes) exists twice',
        fix: `make the project resolve the engine's copy: declare it "*" or match the engine's version`,
      },
    ]);
  });

  it('one url, marked again by a second compose on the same page, says nothing', async () => {
    markModuleCopy('@energy8engine/tween', 'file:///engine/tween/src/index.ts');
    markModuleCopy('@energy8engine/tween', 'file:///engine/tween/src/index.ts');
    game = await boot();
    expect(copyWarnings(game)).toEqual([]);
  });
});
