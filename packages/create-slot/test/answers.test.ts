import { describe, it, expect } from 'vitest';
import { parseFlags, applyDefaults, validate } from '../src/answers';

describe('parseFlags', () => {
  it('parses id/mechanic/grid + --no-stake', () => {
    const a = parseFlags(['--id', 'moon-spice', '--mechanic', 'cascade', '--grid', '6x6', '--no-stake']);
    expect(a).toEqual({ id: 'moon-spice', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: false });
  });
  it('parses the --flag=value equals form too', () => {
    expect(parseFlags(['--id=moon-spice', '--grid=7x7', '--mechanic=lines'])).toEqual({
      id: 'moon-spice', grid: { cols: 7, rows: 7 }, mechanic: 'lines',
    });
  });
});

describe('applyDefaults', () => {
  it('fills title (Title-case), default grid for mechanic, stake=true', () => {
    const a = applyDefaults({ id: 'moon-spice', mechanic: 'cascade' });
    expect(a.title).toBe('Moon Spice');
    expect(a.grid).toEqual({ cols: 6, rows: 6 });
    expect(a.stake).toBe(true);
  });
  it('lines mechanic defaults to a 5x3 grid', () => {
    expect(applyDefaults({ id: 'g', mechanic: 'lines' }).grid).toEqual({ cols: 5, rows: 3 });
  });
});

describe('validate', () => {
  it('rejects a non-kebab id', () => {
    expect(() => validate(applyDefaults({ id: 'Moon Spice', mechanic: 'cascade' }))).toThrow(/id/);
  });
  it('rejects a bad mechanic', () => {
    expect(() => validate({ ...applyDefaults({ id: 'g' }), mechanic: 'plinko' as any })).toThrow(/mechanic/);
  });
});
