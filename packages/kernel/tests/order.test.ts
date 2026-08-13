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
  it('keeps the first duplicate by position regardless of other duplicates', () => {
    const dupA = { id: 'dup', version: '1.0.0', engine: '*', dependsOn: { other: '*' } };
    const dupB = { id: 'dup', version: '1.0.0', engine: '*' };
    const other = p('other');

    // dupA is first in both cases (different positions for dupB)
    const case1 = orderPlugins([dupA, dupB, other]);
    const case2 = orderPlugins([dupA, other, dupB]);

    expect(case1.order).toEqual(case2.order);
    expect(case1.order).toContain('dup');
    expect(case1.order).toContain('other');
    expect(case1.diagnostics.some((d) => d.code === 'resolve/duplicate-plugin-id')).toBe(true);
  });

  it('keeps the first duplicate even when duplicates tie on dependency count', () => {
    const a = { id: 'dup', version: '1.0.0', engine: '*', dependsOn: { x: '*' } };
    const b = { id: 'dup', version: '1.0.0', engine: '*', dependsOn: { y: '*' } };
    const x = p('x');

    const forward = orderPlugins([a, b, x]);
    const backward = orderPlugins([x, b, a]);

    // a is first in forward (uses a's deps), b is first in backward (uses b's deps)
    expect(forward.order).toEqual(['x', 'dup']);
    expect(backward.order).toEqual(['dup', 'x']);

    // Both report duplicate, backward also reports missing-dependency
    expect(forward.diagnostics.some((d) => d.code === 'resolve/duplicate-plugin-id')).toBe(true);
    expect(backward.diagnostics.some((d) => d.code === 'resolve/duplicate-plugin-id')).toBe(true);
    expect(backward.diagnostics.some((d) => d.code === 'resolve/missing-dependency')).toBe(true);
  });

  it('says what it actually knows about an un-orderable set', () => {
    const { order, diagnostics } = orderPlugins([
      p('a', { b: '*' }),
      p('b', { a: '*' }),
      p('c', { d: '*' }),
      p('d', { c: '*' }),
      p('solo'),
    ]);
    expect(order).toEqual(['solo']);
    expect(diagnostics[0].message).not.toContain('depend on each other');
    for (const id of ['a', 'b', 'c', 'd']) expect(diagnostics[0].message).toContain(id);
  });

  it('ignores a non-object dependsOn without inventing dependencies', () => {
    expect(orderPlugins([{ id: 'a', version: '1.0.0', engine: '*', dependsOn: 'b' } as never]).diagnostics).toEqual([]);
    expect(orderPlugins([{ id: 'a', version: '1.0.0', engine: '*', dependsOn: ['b', 'c'] } as never]).diagnostics).toEqual([]);
  });

  it('still orders a manifest that lacks version or engine', () => {
    const { order } = orderPlugins([{ id: 'b', dependsOn: { a: '*' } } as never, { id: 'a' } as never]);
    expect(order).toEqual(['a', 'b']);
  });

  it('drops an unusable manifest with a diagnostic, not in silence', () => {
    const { order, diagnostics } = orderPlugins([null as never, { id: '' } as never, p('ok')]);
    expect(order).toEqual(['ok']);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
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
});
