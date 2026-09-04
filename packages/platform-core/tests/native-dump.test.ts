import { describe, it, expect } from 'vitest';
import { buildNativeArgs, requireE8Binary } from '../src/simulation/NativeSimulationRunner';

describe('NativeSimulationRunner dump', () => {
  it('adds -dump <path> to the args when dump is set', () => {
    const args = buildNativeArgs({ configPath: '/tmp/c.json', iterations: 1000, bet: 1, action: 'spin', dump: '/tmp/books.jsonl' });
    expect(args).toContain('-dump');
    expect(args[args.indexOf('-dump') + 1]).toBe('/tmp/books.jsonl');
  });
  it('omits -dump when not set', () => {
    const args = buildNativeArgs({ configPath: '/tmp/c.json', iterations: 1000, bet: 1, action: 'spin' });
    expect(args).not.toContain('-dump');
  });

  // Two-pass book build: the light pass writes CSV only, the heavy pass filters
  // the JSONL dump by round list. Neither flag may leak into an ordinary run.
  it('adds -dump-csv and -only-rounds when set', () => {
    const args = buildNativeArgs({
      configPath: '/tmp/c.json', iterations: 1000, bet: 1, action: 'spin',
      dump: '/tmp/books.jsonl.gz', dumpCsv: '/tmp/pool.csv', onlyRounds: '/tmp/only.txt',
    });
    expect(args[args.indexOf('-dump-csv') + 1]).toBe('/tmp/pool.csv');
    expect(args[args.indexOf('-only-rounds') + 1]).toBe('/tmp/only.txt');
  });

  it('omits both when not set', () => {
    const args = buildNativeArgs({ configPath: '/tmp/c.json', iterations: 1000, bet: 1, action: 'spin' });
    expect(args).not.toContain('-dump-csv');
    expect(args).not.toContain('-only-rounds');
  });
});

describe('requireE8Binary', () => {
  it('throws a helpful error when no binary is found', () => {
    // inject a finder that always returns null to force the not-found path
    expect(() => requireE8Binary(() => null)).toThrow(/e8 engine binary/i);
  });
});
