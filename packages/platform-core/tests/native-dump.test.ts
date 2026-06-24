import { describe, it, expect } from 'vitest';
import { buildNativeArgs, requireNativeBinary } from '../src/simulation/NativeSimulationRunner';

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
});

describe('requireNativeBinary', () => {
  it('throws a helpful error when no binary is found', () => {
    // inject a finder that always returns null to force the not-found path
    expect(() => requireNativeBinary(() => null)).toThrow(/native simulation binary/i);
  });
});
