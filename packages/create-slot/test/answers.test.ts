import { describe, it, expect } from 'vitest';
import { parseFlags, applyDefaults, validate, seedFromArgv } from '../src/answers';

describe('parseFlags --dir', () => {
  it('parses --dir value', () => {
    expect(parseFlags(['my-game', '--dir', 'games/foo']).dir).toBe('games/foo');
  });
  it('parses --dir=value form', () => {
    expect(parseFlags(['my-game', '--dir=../foo']).dir).toBe('../foo');
  });
  it('omits dir when absent', () => {
    expect(parseFlags(['my-game']).dir).toBeUndefined();
  });
  it('does not treat the --dir value as the positional id', () => {
    // seedFromArgv must skip the --dir value when scanning for a positional id
    const seed = seedFromArgv(['cosmic', '--dir', 'games/foo']);
    expect(seed.id).toBe('cosmic');
    expect(seed.dir).toBe('games/foo');
  });
});

describe('parseFlags', () => {
  it('parses id/mechanic/grid + --no-stake', () => {
    const a = parseFlags(['--id', 'moon-spice', '--mechanic', 'cluster', '--grid', '7x7', '--no-stake']);
    expect(a).toEqual({ id: 'moon-spice', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: false });
  });
  it('parses the --flag=value equals form too', () => {
    expect(parseFlags(['--id=moon-spice', '--grid=7x7', '--mechanic=lines'])).toEqual({
      id: 'moon-spice', grid: { cols: 7, rows: 7 }, mechanic: 'lines',
    });
  });
});

describe('applyDefaults', () => {
  it('fills title (Title-case), default grid for mechanic, stake=true', () => {
    const a = applyDefaults({ id: 'moon-spice', mechanic: 'cluster' });
    expect(a.title).toBe('Moon Spice');
    expect(a.grid).toEqual({ cols: 7, rows: 7 });
    expect(a.stake).toBe(true);
  });
  it('lines mechanic defaults to a 5x3 grid', () => {
    expect(applyDefaults({ id: 'g', mechanic: 'lines' }).grid).toEqual({ cols: 5, rows: 3 });
  });
  it('anywhere mechanic defaults to a 5x4 grid', () => {
    expect(applyDefaults({ id: 'g', mechanic: 'anywhere' }).grid).toEqual({ cols: 5, rows: 4 });
  });
  it('custom mechanic defaults to a 6x6 grid', () => {
    expect(applyDefaults({ id: 'g', mechanic: 'custom' }).grid).toEqual({ cols: 6, rows: 6 });
  });
  it('default mechanic is cluster', () => {
    expect(applyDefaults({ id: 'g' }).mechanic).toBe('cluster');
  });
});

describe('validate', () => {
  it('rejects a non-kebab id', () => {
    expect(() => validate(applyDefaults({ id: 'Moon Spice', mechanic: 'cluster' }))).toThrow(/id/);
  });
  it('rejects a bad mechanic', () => {
    expect(() => validate({ ...applyDefaults({ id: 'g' }), mechanic: 'plinko' as any })).toThrow(/mechanic/);
  });
  it('accepts all valid mechanics', () => {
    for (const m of ['lines', 'ways', 'cluster', 'anywhere', 'custom'] as const) {
      expect(() => validate(applyDefaults({ id: 'g', mechanic: m }))).not.toThrow();
    }
  });
});

describe('seedFromArgv', () => {
  it('(a) bare positional becomes the id', () => {
    expect(seedFromArgv(['my-game'])).toMatchObject({ id: 'my-game' });
  });

  it('(b) explicit --id wins over a positional', () => {
    const seed = seedFromArgv(['--id', 'x', 'y']);
    expect(seed.id).toBe('x');
  });

  it('(c) flag value must NOT become the id (--mechanic cluster → no id)', () => {
    const seed = seedFromArgv(['--mechanic', 'cluster']);
    expect(seed.id).toBeUndefined();
    expect(seed.mechanic).toBe('cluster');
  });

  it('(d) positional + another flag co-exist correctly', () => {
    const seed = seedFromArgv(['my-game', '--mechanic', 'lines']);
    expect(seed).toMatchObject({ id: 'my-game', mechanic: 'lines' });
  });
});

describe('cluster mechanic + cascades flag', () => {
  it('cluster defaults to a 7x7 grid', () => {
    expect(applyDefaults({ id: 'g', mechanic: 'cluster' }).grid).toEqual({ cols: 7, rows: 7 });
  });
  it('cascades defaults true for cluster/ways/anywhere/custom, false for lines', () => {
    expect(applyDefaults({ id: 'g', mechanic: 'cluster' }).cascades).toBe(true);
    expect(applyDefaults({ id: 'g', mechanic: 'ways' }).cascades).toBe(true);
    expect(applyDefaults({ id: 'g', mechanic: 'anywhere' }).cascades).toBe(true);
    expect(applyDefaults({ id: 'g', mechanic: 'custom' }).cascades).toBe(true);
    expect(applyDefaults({ id: 'g', mechanic: 'lines' }).cascades).toBe(false);
  });
  it('--cascades / --no-cascades override', () => {
    expect(parseFlags(['--no-cascades']).cascades).toBe(false);
    expect(parseFlags(['--cascades']).cascades).toBe(true);
  });
  it('validate accepts cluster', () => {
    expect(() => validate(applyDefaults({ id: 'g', mechanic: 'cluster' }))).not.toThrow();
  });
});
