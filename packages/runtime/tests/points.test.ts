import { describe, expect, it } from 'vitest';
import { checkManifestShape } from '@energy8engine/kernel';
import { HOOK_IDS, POINT_BUILD_TARGET, POINT_SESSION_PROVIDER, hostPlugin } from '@/points';

describe('the host plugin', () => {
  it('is a structurally valid manifest', () => {
    expect(checkManifestShape(hostPlugin)).toEqual([]);
  });

  it('declares session.provider as a single-winner runtime point', () => {
    const point = hostPlugin.points?.[POINT_SESSION_PROVIDER];
    expect(point).toBeDefined();
    expect(point!.phase).toBe('runtime');
    expect(point!.arity).toBe('one');
    expect(point!.doc.length).toBeGreaterThan(20);
  });

  it('declares build.target as a many-filler build point', () => {
    const point = hostPlugin.points?.[POINT_BUILD_TARGET];
    expect(point).toBeDefined();
    expect(point!.phase).toBe('build');
    expect(point!.arity).toBe('many');
  });

  it('contributes nothing itself — it only opens the doors', () => {
    expect(hostPlugin.contributes).toBeUndefined();
  });

  it('names the game-domain hooks the kernel refuses to name', () => {
    expect(HOOK_IDS).toContain('beforeSpin');
    expect(HOOK_IDS).toContain('afterSpin');
    expect(new Set(HOOK_IDS).size).toBe(HOOK_IDS.length);
  });

  it('does not put a field named "enabled" in any point schema', () => {
    // `enabled` is the structural contribution flag in project.json; the kernel warns about the
    // collision, and a point that trips its own engine's warning is a bad example to ship.
    for (const [id, point] of Object.entries(hostPlugin.points ?? {})) {
      expect(Object.keys(point.schema), `point ${id}`).not.toContain('enabled');
    }
  });
});
