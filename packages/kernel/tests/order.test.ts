import { describe, expect, it } from 'vitest';
import { orderPlugins } from '@/resolve/order';
import type { PluginManifest } from '@/manifest/types';

function p(id: string, dependsOn?: Record<string, string>): PluginManifest {
  return { id, version: '1.0.0', engine: '*', ...(dependsOn ? { dependsOn } : {}) };
}

describe('orderPlugins', () => {
  it('sorts independent plugins by id so the plan is reproducible', () => {
    const { order, diagnostics } = orderPlugins([p('zeta'), p('alpha'), p('mid')]);
    expect(order).toEqual(['alpha', 'mid', 'zeta']);
    expect(diagnostics).toEqual([]);
  });

  it('places a dependency before its dependent', () => {
    const { order } = orderPlugins([p('game', { reels: '^1.0.0' }), p('reels')]);
    expect(order).toEqual(['reels', 'game']);
  });

  it('orders a chain transitively', () => {
    const { order } = orderPlugins([p('c', { b: '*' }), p('b', { a: '*' }), p('a')]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by id at every level', () => {
    const { order } = orderPlugins([p('x', { core: '*' }), p('b', { core: '*' }), p('core')]);
    expect(order).toEqual(['core', 'b', 'x']);
  });

  it('reports a cycle and still returns the plugins outside it', () => {
    const { order, diagnostics } = orderPlugins([p('a', { b: '*' }), p('b', { a: '*' }), p('free')]);
    expect(order).toEqual(['free']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/dependency-cycle' });
    expect(diagnostics[0].message).toContain('a');
    expect(diagnostics[0].message).toContain('b');
  });

  it('reports a dependency that is not installed', () => {
    const { order, diagnostics } = orderPlugins([p('game', { missing: '^1.0.0' })]);
    expect(order).toEqual(['game']);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'resolve/missing-dependency',
      pluginId: 'game',
    });
  });
});

describe('orderPlugins survives hostile input', () => {
  it('never throws on malformed input', () => {
    const cases: unknown[] = [
      [],
      [null],
      [undefined],
      ['a string'],
      [{ id: 'a' }],
      [{ id: '', version: '1.0.0', engine: '*' }],
      [{ id: 'a', version: '1.0.0', engine: '*', dependsOn: null }],
      [{ id: 'a', version: '1.0.0', engine: '*', dependsOn: 'b' }],
    ];
    for (const input of cases) {
      expect(() => orderPlugins(input as never)).not.toThrow();
    }
  });

  it('reports a plugin that depends on itself as a cycle', () => {
    const { order, diagnostics } = orderPlugins([p('a', { a: '*' }), p('b')]);
    expect(order).toEqual(['b']);
    expect(diagnostics.some((d) => d.code === 'resolve/dependency-cycle')).toBe(true);
  });

  it('is insensitive to the order of the input array', () => {
    const forward = orderPlugins([p('a'), p('b', { a: '*' }), p('c', { b: '*' })]).order;
    const backward = orderPlugins([p('c', { b: '*' }), p('b', { a: '*' }), p('a')]).order;
    expect(forward).toEqual(backward);
    expect(forward).toEqual(['a', 'b', 'c']);
  });

  it('does not lose a plugin when two share an id', () => {
    const { order } = orderPlugins([p('dup'), p('dup'), p('other')]);
    expect(order).toContain('other');
  });
});
