import { describe, expect, it } from 'vitest';
import { checkManifestShape } from '@/manifest/define';
import type { PluginManifest } from '@/manifest/types';

describe('checkManifestShape - hostile input (never throws)', () => {
  it('handles null manifest gracefully', () => {
    const result = checkManifestShape(null as any);
    expect(result).toBeInstanceOf(Array);
    expect(result[0]?.code).toBe('manifest/invalid');
  });

  it('handles empty object gracefully', () => {
    const result = checkManifestShape({} as any);
    expect(result).toBeInstanceOf(Array);
    expect(result.some((d) => d.code === 'manifest/missing-id')).toBe(true);
  });

  it('handles points set to null gracefully', () => {
    const result = checkManifestShape({
      id: 'test',
      version: '1.0.0',
      engine: '^0.1.0',
      points: null,
    } as any);
    expect(result).toBeInstanceOf(Array);
    // null points is treated as {} via nullish coalescing, so no error
  });

  it('handles contributes set to string gracefully', () => {
    const result = checkManifestShape({
      id: 'test',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: 'invalid',
    } as any);
    expect(result).toBeInstanceOf(Array);
    // string contributes is treated as {} via Object.entries
  });

  it('handles contribution list not array gracefully', () => {
    const result = checkManifestShape({
      id: 'test',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { p: {} },
    } as any);
    expect(result).toBeInstanceOf(Array);
    expect(result[0]?.code).toBe('manifest/bad-contributions');
  });

  it('handles id as a Symbol gracefully', () => {
    const result = checkManifestShape({
      id: Symbol('test'),
      version: '1.0.0',
      engine: '^0.1.0',
    } as any);
    expect(result).toBeInstanceOf(Array);
    // Symbol id is not a string, so it's treated as missing
    expect(result.some((d) => d.code === 'manifest/missing-id')).toBe(true);
  });
});
