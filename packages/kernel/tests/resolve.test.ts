import { describe, expect, it } from 'vitest';
import { resolvePlan } from '@/resolve/resolve';
import { toSnapshot } from '@/resolve/snapshot';
import type { ProjectDoc } from '@/resolve/types';
import type { Contribution, PluginManifest } from '@/manifest/types';

const noop: Contribution['create'] = async () => () => null;

function reelSystem(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: '@e8/reel-system',
    version: '1.0.0',
    engine: '^0.1.0',
    points: {
      'reel.feature': {
        phase: 'runtime',
        arity: 'many',
        schema: { enabled: { kind: 'boolean', default: true }, priority: { kind: 'number', default: 0 } },
        doc: 'A behaviour layered onto the reels.',
      },
    },
    contributes: {
      'reel.feature': [
        {
          id: 'expandingWild',
          schema: { holdSpins: { kind: 'number', default: 1, min: 1, max: 10 } },
          doc: 'Wild expands to fill its reel.',
          create: noop,
        },
      ],
    },
    ...over,
  };
}

function project(over: Partial<ProjectDoc['plugins']> = {}): ProjectDoc {
  return { plugins: { '@e8/reel-system': { version: '^1.0.0' }, ...over } };
}

const launch = { url: 'https://game.example/play' };
const KERNEL = '0.1.0';

describe('resolvePlan', () => {
  it('registers a point and its contribution with a merged, validated settings object', () => {
    const { plan, diagnostics } = resolvePlan({
      project: project(),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });

    expect(diagnostics).toEqual([]);
    expect(Object.keys(plan.points)).toEqual(['reel.feature']);
    expect(plan.contributions).toHaveLength(1);

    const c = plan.contributions[0];
    expect(c.key).toBe('reel.feature:expandingWild');
    expect(Object.keys(c.schema)).toEqual(['enabled', 'priority', 'holdSpins']);
    expect(c.settings).toEqual({ enabled: true, priority: 0, holdSpins: 1 });
    expect(c.active).toBe(true);
  });

  it('applies project settings over the schema defaults', () => {
    const { plan } = resolvePlan({
      project: project({
        '@e8/reel-system': {
          version: '^1.0.0',
          contributions: { 'reel.feature:expandingWild': { settings: { holdSpins: 4 } } },
        },
      }),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions[0].settings.holdSpins).toBe(4);
  });

  it('applies a contribution defaults override before validation', () => {
    const manifest = reelSystem();
    manifest.contributes!['reel.feature'][0].defaults = { priority: 10 };
    const { plan } = resolvePlan({ project: project(), manifests: [manifest], launch, kernelVersion: KERNEL });
    expect(plan.contributions[0].settings.priority).toBe(10);
  });

  it('carries a settings diagnostic through, tagged with its plugin and contribution', () => {
    const { diagnostics } = resolvePlan({
      project: project({
        '@e8/reel-system': {
          version: '^1.0.0',
          contributions: { 'reel.feature:expandingWild': { settings: { holdSpins: 'many' } } },
        },
      }),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({
      code: 'schema/type-mismatch',
      pluginId: '@e8/reel-system',
      contributionId: 'expandingWild',
    });
  });

  it('marks a disabled contribution inactive but keeps it in the plan', () => {
    const { plan } = resolvePlan({
      project: project({
        '@e8/reel-system': {
          version: '^1.0.0',
          contributions: { 'reel.feature:expandingWild': { enabled: false } },
        },
      }),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions[0].enabled).toBe(false);
    expect(plan.contributions[0].active).toBe(false);
  });

  it('drops a plugin the project disabled', () => {
    const { plan } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '^1.0.0', enabled: false } } },
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toHaveLength(0);
    expect(plan.order).toEqual([]);
  });

  it('rejects a plugin whose version does not satisfy the project range', () => {
    const { diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '^2.0.0' } } },
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/version-mismatch' });
  });

  it('rejects a plugin that needs a different kernel', () => {
    const { diagnostics } = resolvePlan({
      project: project(),
      manifests: [reelSystem({ engine: '^9.0.0' })],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/engine-mismatch' });
    expect(diagnostics[0].message).toContain('0.1.0');
  });

  it('reports a project entry with no installed manifest', () => {
    const { diagnostics } = resolvePlan({
      project: { plugins: { 'ghost-plugin': { version: '^1.0.0' } } },
      manifests: [],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/plugin-not-found' });
  });

  it('reports a contribution to a point nobody declared', () => {
    const orphan: PluginManifest = {
      id: 'orphan',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { 'nowhere.point': [{ id: 'x', doc: 'x', create: noop }] },
    };
    const { diagnostics } = resolvePlan({
      project: { plugins: { orphan: { version: '^1.0.0' } } },
      manifests: [orphan],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/unknown-point' });
  });

  it('reports two plugins declaring the same point differently', () => {
    const other = reelSystem({ id: 'other' });
    other.points!['reel.feature'].arity = 'one';
    other.contributes = undefined;
    const { diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '*' }, other: { version: '*' } } },
      manifests: [reelSystem(), other],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.some((d) => d.code === 'resolve/point-conflict')).toBe(true);
  });

  it('lets an identical duplicate point declaration pass', () => {
    const twin = reelSystem({ id: 'twin', contributes: undefined });
    const { diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '*' }, twin: { version: '*' } } },
      manifests: [reelSystem(), twin],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.filter((d) => d.code === 'resolve/point-conflict')).toEqual([]);
  });

  it('orders contributions by plugin order, then by declaration order', () => {
    const core = reelSystem();
    const extra: PluginManifest = {
      id: 'acme-extra',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { '@e8/reel-system': '^1.0.0' },
      contributes: {
        'reel.feature': [
          { id: 'cascadingWild', doc: 'Third-party.', create: noop },
          { id: 'creepingWild', doc: 'Third-party.', create: noop },
        ],
      },
    };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '*' }, 'acme-extra': { version: '*' } } },
      manifests: [extra, core],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics).toEqual([]);
    expect(plan.contributions.map((c) => c.id)).toEqual(['expandingWild', 'cascadingWild', 'creepingWild']);
  });
});

describe('resolvePlan — arity "one"', () => {
  function provider(id: string, activateWhen: Contribution['activateWhen']): PluginManifest {
    return {
      id,
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { 'session.provider': [{ id, activateWhen, doc: `${id} session.`, create: noop }] },
    };
  }

  const host: PluginManifest = {
    id: 'host',
    version: '1.0.0',
    engine: '^0.1.0',
    points: {
      'session.provider': { phase: 'runtime', arity: 'one', schema: {}, doc: 'Where rounds come from.' },
    },
  };

  const all = {
    plugins: { host: { version: '*' }, stake: { version: '*' }, artube: { version: '*' }, dev: { version: '*' } },
  };

  it('activates the candidate whose matcher fires', () => {
    const { plan, diagnostics } = resolvePlan({
      project: all,
      manifests: [host, provider('stake', { buildTarget: 'stake' }), provider('artube', { urlParam: 'sessionId' }), provider('dev', { default: true })],
      launch: { url: 'https://g/play', buildTarget: 'stake' },
      kernelVersion: KERNEL,
    });
    expect(diagnostics).toEqual([]);
    expect(plan.contributions.filter((c) => c.active).map((c) => c.id)).toEqual(['stake']);
  });

  it('falls back to the default candidate when none match', () => {
    const { plan } = resolvePlan({
      project: all,
      manifests: [host, provider('stake', { buildTarget: 'stake' }), provider('artube', { urlParam: 'sessionId' }), provider('dev', { default: true })],
      launch: { url: 'https://g/play' },
      kernelVersion: KERNEL,
    });
    expect(plan.contributions.filter((c) => c.active).map((c) => c.id)).toEqual(['dev']);
  });

  it('reports two matching candidates and activates neither', () => {
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, stake: { version: '*' }, artube: { version: '*' } } },
      manifests: [host, provider('stake', { buildTarget: 'stake' }), provider('artube', { buildTarget: 'stake' })],
      launch: { url: 'https://g/play', buildTarget: 'stake' },
      kernelVersion: KERNEL,
    });
    expect(plan.contributions.filter((c) => c.active)).toHaveLength(0);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/ambiguous-activation' });
    expect(diagnostics[0].message).toContain('stake');
    expect(diagnostics[0].message).toContain('artube');
  });

  it('reports no candidate at all', () => {
    const { diagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, stake: { version: '*' } } },
      manifests: [host, provider('stake', { buildTarget: 'stake' })],
      launch: { url: 'https://g/play' },
      kernelVersion: KERNEL,
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/no-activation' });
  });

  it('records a human sentence describing when each candidate activates', () => {
    const { plan } = resolvePlan({
      project: { plugins: { host: { version: '*' }, artube: { version: '*' } } },
      manifests: [host, provider('artube', { urlParam: 'sessionId' })],
      launch: { url: 'https://g/play?sessionId=1' },
      kernelVersion: KERNEL,
    });
    expect(plan.contributions[0].activationLabel).toBe('when ?sessionId is present');
  });

  it('reports a required point whose only candidates are all disabled, not silence', () => {
    const { plan, diagnostics } = resolvePlan({
      project: {
        plugins: {
          host: { version: '*' },
          stake: { version: '*', contributions: { 'session.provider:stake': { enabled: false } } },
          artube: { version: '*', contributions: { 'session.provider:artube': { enabled: false } } },
        },
      },
      manifests: [host, provider('stake', { buildTarget: 'stake' }), provider('artube', { urlParam: 'sessionId' })],
      launch: { url: 'https://g/play', buildTarget: 'stake' },
      kernelVersion: KERNEL,
    });
    expect(plan.contributions.filter((c) => c.active)).toHaveLength(0);
    expect(diagnostics.some((d) => d.code === 'resolve/no-activation')).toBe(true);
  });
});

describe('resolvePlan — dependencies and hooks', () => {
  it('reports an installed dependency whose version does not satisfy the range', () => {
    const core: PluginManifest = { id: 'core', version: '1.0.0', engine: '^0.1.0' };
    const dependent: PluginManifest = {
      id: 'dependent',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { core: '^2.0.0' },
    };
    const { diagnostics } = resolvePlan({
      project: { plugins: { core: { version: '*' }, dependent: { version: '*' } } },
      manifests: [core, dependent],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'resolve/dependency-version', pluginId: 'dependent' }),
    );
  });

  it('does not report a dependency whose installed version satisfies the range', () => {
    const core: PluginManifest = { id: 'core', version: '1.2.0', engine: '^0.1.0' };
    const dependent: PluginManifest = {
      id: 'dependent',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { core: '^1.0.0' },
    };
    const { diagnostics } = resolvePlan({
      project: { plugins: { core: { version: '*' }, dependent: { version: '*' } } },
      manifests: [core, dependent],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.filter((d) => d.code === 'resolve/dependency-version')).toEqual([]);
  });

  it('aggregates declared hooks by hook id, in plugin order', () => {
    const first: PluginManifest = { id: 'first', version: '1.0.0', engine: '^0.1.0', hooks: ['onSpinStart'] };
    const second: PluginManifest = {
      id: 'second',
      version: '1.0.0',
      engine: '^0.1.0',
      hooks: ['onSpinStart', 'onSpinEnd'],
    };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { first: { version: '*' }, second: { version: '*' } } },
      manifests: [first, second],
      launch,
      kernelVersion: KERNEL,
      hookIds: ['onSpinStart', 'onSpinEnd'],
    });
    expect(diagnostics).toEqual([]);
    expect(plan.hooks).toEqual({ onSpinStart: ['first', 'second'], onSpinEnd: ['second'] });
  });

  it('rejects a hook that is not in the known list', () => {
    const rogue: PluginManifest = { id: 'rogue', version: '1.0.0', engine: '^0.1.0', hooks: ['onMadeUp'] };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { rogue: { version: '*' } } },
      manifests: [rogue],
      launch,
      kernelVersion: KERNEL,
      hookIds: ['onSpinStart'],
    });
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/unknown-hook', pluginId: 'rogue' });
    expect(plan.hooks).toEqual({});
  });

  it('accepts any hook name when hookIds is not given at all', () => {
    const anything: PluginManifest = { id: 'anything', version: '1.0.0', engine: '^0.1.0', hooks: ['whatever'] };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { anything: { version: '*' } } },
      manifests: [anything],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics).toEqual([]);
    expect(plan.hooks).toEqual({ whatever: ['anything'] });
  });
});

describe('resolvePlan passes its diagnostics sink to matches', () => {
  const host: PluginManifest = {
    id: 'host',
    version: '1.0.0',
    engine: '^0.1.0',
    points: { 'session.provider': { phase: 'runtime', arity: 'one', schema: {}, doc: 'Where rounds come from.' } },
  };

  it('surfaces a throwing activateWhen predicate as a diagnostic instead of letting it vanish into a false match', () => {
    const broken: PluginManifest = {
      id: 'broken',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: {
        'session.provider': [
          {
            id: 'broken',
            activateWhen: {
              match: () => {
                throw new Error('boom');
              },
            },
            doc: 'A provider whose rule is broken.',
            create: noop,
          },
        ],
      },
    };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, broken: { version: '*' } } },
      manifests: [host, broken],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.some((d) => d.code === 'match/predicate-threw' && d.message.includes('boom'))).toBe(true);
    // The broken predicate must not silently win activation just because it threw.
    expect(plan.contributions.filter((c) => c.active)).toHaveLength(0);
  });

  it('still activates a healthy default when a sibling candidate on the same point throws', () => {
    const broken: PluginManifest = {
      id: 'broken',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: {
        'session.provider': [
          {
            id: 'broken',
            activateWhen: {
              match: () => {
                throw new Error('boom');
              },
            },
            doc: 'A provider whose rule is broken.',
            create: noop,
          },
        ],
      },
    };
    const dev: PluginManifest = {
      id: 'dev',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { 'session.provider': [{ id: 'dev', activateWhen: { default: true }, doc: 'Dev fallback.', create: noop }] },
    };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, broken: { version: '*' }, dev: { version: '*' } } },
      manifests: [host, broken, dev],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.some((d) => d.code === 'match/predicate-threw')).toBe(true);
    expect(plan.contributions.filter((c) => c.active).map((c) => c.id)).toEqual(['dev']);
  });
});

describe('toSnapshot', () => {
  it('produces a plan that survives a JSON round trip', () => {
    const { plan } = resolvePlan({
      project: project(),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    const snapshot = toSnapshot(plan);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(snapshot.contributions[0]).not.toHaveProperty('create');
    expect(snapshot.contributions[0].key).toBe('reel.feature:expandingWild');
  });

  it('does not let a deep mutation of the snapshot reach the live plan', () => {
    const { plan } = resolvePlan({
      project: project(),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    const snapshot = toSnapshot(plan);

    // Mutate every level: top-level arrays, nested settings values, and nested schema field objects.
    (snapshot.contributions[0].settings as Record<string, unknown>).holdSpins = 999;
    (snapshot.contributions[0].schema.holdSpins as { default?: unknown }).default = 999;
    (snapshot.points['reel.feature'].schema.priority as { default?: unknown }).default = 999;
    (snapshot.plugins[0].settings as Record<string, unknown>).intruder = 'x';
    snapshot.order.push('intruder');
    snapshot.contributions.push({ ...snapshot.contributions[0], id: 'intruder' });
    (snapshot.hooks['nonexistent'] ??= []).push('intruder');

    expect(plan.contributions[0].settings.holdSpins).toBe(1);
    expect((plan.contributions[0].schema.holdSpins as { default?: unknown }).default).toBe(1);
    expect((plan.points['reel.feature'].schema.priority as { default?: unknown }).default).toBe(0);
    expect(plan.plugins[0].settings).not.toHaveProperty('intruder');
    expect(plan.order).not.toContain('intruder');
    expect(plan.contributions).toHaveLength(1);
    expect(plan.hooks).not.toHaveProperty('nonexistent');
  });

  it('does not share the schema object between two contributions to the same point', () => {
    // mergeSchemas intentionally shares FieldSchema field objects between sibling contributions
    // (Task 3's ruling). toSnapshot must sever that sharing so the IDE cannot corrupt a sibling.
    const manifest = reelSystem();
    manifest.contributes!['reel.feature'].push({
      id: 'creepingWild',
      doc: 'Another feature on the same point.',
      create: noop,
    });
    const { plan } = resolvePlan({ project: project(), manifests: [manifest], launch, kernelVersion: KERNEL });
    const snapshot = toSnapshot(plan);
    expect(snapshot.contributions[0].schema).not.toBe(snapshot.contributions[1].schema);
    expect(snapshot.contributions[0].schema.enabled).not.toBe(snapshot.contributions[1].schema.enabled);
  });
});

describe('resolvePlan survives hostile input — top-level shape', () => {
  it('does not throw when project is null', () => {
    expect(() =>
      resolvePlan({ project: null as never, manifests: [reelSystem()], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
  });

  it('reports an invalid project instead of silently producing an empty plan', () => {
    const { plan, diagnostics } = resolvePlan({
      project: null as never,
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toEqual([]);
    expect(diagnostics.some((d) => d.code === 'resolve/invalid-project')).toBe(true);
  });

  it('does not throw when project.plugins is null', () => {
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: null as never },
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toEqual([]);
    expect(diagnostics.some((d) => d.code === 'resolve/invalid-project')).toBe(true);
  });

  it('does not throw when project.plugins is a string', () => {
    expect(() =>
      resolvePlan({ project: { plugins: 'nope' as never }, manifests: [reelSystem()], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { diagnostics } = resolvePlan({
      project: { plugins: 'nope' as never },
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.some((d) => d.code === 'resolve/invalid-project')).toBe(true);
  });

  it('does not throw when project.plugins is an array', () => {
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: ['@e8/reel-system'] as never },
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toEqual([]);
    expect(diagnostics.some((d) => d.code === 'resolve/invalid-project')).toBe(true);
  });

  it('does not throw when a project plugin entry itself is null', () => {
    expect(() =>
      resolvePlan({
        project: { plugins: { '@e8/reel-system': null as never } },
        manifests: [reelSystem()],
        launch,
        kernelVersion: KERNEL,
      }),
    ).not.toThrow();
  });

  it('does not throw when manifests is null', () => {
    const { plan, diagnostics } = resolvePlan({
      project: project(),
      manifests: null as never,
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toEqual([]);
    expect(diagnostics.some((d) => d.code === 'resolve/plugin-not-found')).toBe(true);
  });

  it('does not throw when manifests contains null', () => {
    expect(() =>
      resolvePlan({ project: project(), manifests: [null as never, reelSystem()], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan } = resolvePlan({
      project: project(),
      manifests: [null as never, reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toHaveLength(1);
  });

  it('does not throw for a manifest with no points and no contributes', () => {
    const bare: PluginManifest = { id: 'bare', version: '1.0.0', engine: '^0.1.0' };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { bare: { version: '*' } } },
      manifests: [bare],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics).toEqual([]);
    expect(plan.plugins).toEqual([{ id: 'bare', version: '1.0.0', settings: {} }]);
    expect(plan.contributions).toEqual([]);
  });

  it('does not throw when launch is null', () => {
    expect(() =>
      resolvePlan({ project: project(), manifests: [reelSystem()], launch: null as never, kernelVersion: KERNEL }),
    ).not.toThrow();
  });

  it('does not throw when kernelVersion is an empty string or garbage', () => {
    for (const bad of ['', 'garbage', undefined as never, 123 as never]) {
      expect(() =>
        resolvePlan({ project: project(), manifests: [reelSystem()], launch, kernelVersion: bad }),
      ).not.toThrow();
      const { diagnostics } = resolvePlan({ project: project(), manifests: [reelSystem()], launch, kernelVersion: bad });
      expect(diagnostics.some((d) => d.code === 'resolve/engine-mismatch')).toBe(true);
    }
  });
});

describe('resolvePlan survives hostile input — malformed manifest internals', () => {
  it('does not throw when a point definition is null', () => {
    const bad: PluginManifest = {
      id: 'bad',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { p: null as never },
    };
    expect(() =>
      resolvePlan({ project: { plugins: { bad: { version: '*' } } }, manifests: [bad], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { bad: { version: '*' } } },
      manifests: [bad],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.points).toEqual({});
    expect(diagnostics.some((d) => d.code === 'manifest/bad-point-schema')).toBe(true);
  });

  it('does not throw when a contributes list is not an array', () => {
    const bad: PluginManifest = {
      id: 'bad',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { 'nowhere.point': 'nope' as never },
    };
    expect(() =>
      resolvePlan({ project: { plugins: { bad: { version: '*' } } }, manifests: [bad], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan } = resolvePlan({
      project: { plugins: { bad: { version: '*' } } },
      manifests: [bad],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toEqual([]);
  });

  it('does not throw when a contributes list contains null', () => {
    const manifest = reelSystem();
    manifest.contributes!['reel.feature'].unshift(null as never);
    expect(() =>
      resolvePlan({ project: project(), manifests: [manifest], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan } = resolvePlan({ project: project(), manifests: [manifest], launch, kernelVersion: KERNEL });
    expect(plan.contributions.map((c) => c.id)).toEqual(['expandingWild']);
  });

  it('does not throw when hooks is not an array', () => {
    const bad: PluginManifest = { id: 'bad', version: '1.0.0', engine: '^0.1.0', hooks: { x: 1 } as never };
    expect(() =>
      resolvePlan({ project: { plugins: { bad: { version: '*' } } }, manifests: [bad], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan } = resolvePlan({
      project: { plugins: { bad: { version: '*' } } },
      manifests: [bad],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.hooks).toEqual({});
  });

  it('does not throw when an arity: "one" point looks up activateWhen through a contributes list that has a leading null', () => {
    // Distinct from the step-5 element guard above: this exercises manifestOf()'s raw re-lookup
    // into manifest.contributes[pointId], a SEPARATE Array#find over the SAME hostile list.
    const host: PluginManifest = {
      id: 'host',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { sp: { phase: 'runtime', arity: 'one', schema: {}, doc: 'x' } },
    };
    const p: PluginManifest = {
      id: 'p',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { sp: [null as never, { id: 'p', activateWhen: { default: true }, doc: 'x', create: noop }] },
    };
    expect(() =>
      resolvePlan({ project: { plugins: { host: { version: '*' }, p: { version: '*' } } }, manifests: [host, p], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan } = resolvePlan({
      project: { plugins: { host: { version: '*' }, p: { version: '*' } } },
      manifests: [host, p],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions.filter((c) => c.active).map((c) => c.id)).toEqual(['p']);
  });

  it('does not throw when hookIds is not an array', () => {
    const withHook: PluginManifest = { id: 'h', version: '1.0.0', engine: '^0.1.0', hooks: ['onSpin'] };
    expect(() =>
      resolvePlan({
        project: { plugins: { h: { version: '*' } } },
        manifests: [withHook],
        launch,
        kernelVersion: KERNEL,
        hookIds: 'onSpin' as never,
      }),
    ).not.toThrow();
  });

  it('reports, rather than crashes on, a self-referential point schema colliding with another plugin', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const a: PluginManifest = {
      id: 'a',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { p: { phase: 'runtime', arity: 'many', schema: cyclic as never, doc: 'x' } },
    };
    const b: PluginManifest = {
      id: 'b',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { p: { phase: 'runtime', arity: 'many', schema: { other: { kind: 'boolean' } }, doc: 'x' } },
    };
    expect(() =>
      resolvePlan({
        project: { plugins: { a: { version: '*' }, b: { version: '*' } } },
        manifests: [a, b],
        launch,
        kernelVersion: KERNEL,
      }),
    ).not.toThrow();
  });
});

describe('resolvePlan survives hostile input — contribution create is not activation-time', () => {
  it('resolves fine when create is missing', () => {
    const manifest = reelSystem();
    delete (manifest.contributes!['reel.feature'][0] as { create?: unknown }).create;
    const { plan, diagnostics } = resolvePlan({ project: project(), manifests: [manifest], launch, kernelVersion: KERNEL });
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(plan.contributions[0].create).toBeUndefined();
  });

  it('resolves fine when create is not a function', () => {
    const manifest = reelSystem();
    (manifest.contributes!['reel.feature'][0] as { create: unknown }).create = 'not-a-function';
    const { plan, diagnostics } = resolvePlan({ project: project(), manifests: [manifest], launch, kernelVersion: KERNEL });
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(plan.contributions[0].create).toBe('not-a-function');
  });
});

describe('resolvePlan survives hostile input — point declarations', () => {
  it('passes an identical duplicate point declaration silently', () => {
    const twin = reelSystem({ id: 'twin', contributes: undefined });
    const { diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '*' }, twin: { version: '*' } } },
      manifests: [reelSystem(), twin],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics).toEqual([]);
  });

  it('flags exactly one point-conflict for a differing duplicate, naming both plugins', () => {
    const other = reelSystem({ id: 'other' });
    other.points!['reel.feature'].arity = 'one';
    other.contributes = undefined;
    const { diagnostics } = resolvePlan({
      project: { plugins: { '@e8/reel-system': { version: '*' }, other: { version: '*' } } },
      manifests: [reelSystem(), other],
      launch,
      kernelVersion: KERNEL,
    });
    const conflicts = diagnostics.filter((d) => d.code === 'resolve/point-conflict');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].message).toContain('@e8/reel-system');
    expect(conflicts[0].message).toContain('other');
  });
});

describe('resolvePlan survives hostile input — orphan project contribution keys', () => {
  it('does not throw or invent a contribution when project.json names one nobody declares', () => {
    const { plan, diagnostics } = resolvePlan({
      project: project({
        '@e8/reel-system': {
          version: '^1.0.0',
          contributions: { 'reel.feature:doesNotExist': { settings: { anything: 1 } } },
        },
      }),
      manifests: [reelSystem()],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toHaveLength(1);
    expect(plan.contributions[0].id).toBe('expandingWild');
    expect(diagnostics).toEqual([]);
  });
});

describe('resolvePlan survives hostile input — duplicate plugin ids across manifests', () => {
  function twoVersions(): [PluginManifest, PluginManifest] {
    const a: PluginManifest = {
      id: 'dup',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { onlyInA: { phase: 'runtime', arity: 'many', schema: {}, doc: 'From A.' } },
    };
    const b: PluginManifest = {
      id: 'dup',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { onlyInB: { phase: 'runtime', arity: 'many', schema: {}, doc: 'From B.' } },
    };
    return [a, b];
  }

  it('keeps the first manifest and reports the duplicate', () => {
    const [a, b] = twoVersions();
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { dup: { version: '*' } } },
      manifests: [a, b],
      launch,
      kernelVersion: KERNEL,
    });
    expect(Object.keys(plan.points)).toEqual(['onlyInA']);
    expect(diagnostics.filter((d) => d.code === 'resolve/duplicate-plugin-id')).toHaveLength(1);
  });

  it('is a pure function of which manifest is first, regardless of how many trailing duplicates exist', () => {
    const [a, b] = twoVersions();
    const c: PluginManifest = { ...b, version: '1.0.0' };
    const withTwoTrailing = resolvePlan({
      project: { plugins: { dup: { version: '*' } } },
      manifests: [a, b, c],
      launch,
      kernelVersion: KERNEL,
    });
    const withOneTrailing = resolvePlan({
      project: { plugins: { dup: { version: '*' } } },
      manifests: [a, b],
      launch,
      kernelVersion: KERNEL,
    });
    expect(Object.keys(withTwoTrailing.plan.points)).toEqual(Object.keys(withOneTrailing.plan.points));
    expect(Object.keys(withTwoTrailing.plan.points)).toEqual(['onlyInA']);
  });

  it('does not double-report through orderPlugins, because orderPlugins only ever sees the deduplicated set', () => {
    const [a, b] = twoVersions();
    const { diagnostics } = resolvePlan({
      project: { plugins: { dup: { version: '*' } } },
      manifests: [a, b],
      launch,
      kernelVersion: KERNEL,
    });
    // Exactly one duplicate-id diagnostic total — not one from resolve.ts and a second from orderPlugins.
    expect(diagnostics.filter((d) => d.code === 'resolve/duplicate-plugin-id')).toHaveLength(1);
  });
});

describe('resolvePlan determinism', () => {
  function bigProject() {
    const core: PluginManifest = {
      id: 'core',
      version: '1.0.0',
      engine: '^0.1.0',
      points: {
        'reel.feature': {
          phase: 'runtime',
          arity: 'many',
          schema: { enabled: { kind: 'boolean', default: true } },
          doc: 'Reel behaviours.',
        },
        'session.provider': { phase: 'runtime', arity: 'one', schema: {}, doc: 'Where rounds come from.' },
      },
    };
    const featureA: PluginManifest = {
      id: 'feature-a',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { core: '^1.0.0' },
      contributes: { 'reel.feature': [{ id: 'a', doc: 'A.', create: noop }] },
    };
    const featureB: PluginManifest = {
      id: 'feature-b',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { core: '^1.0.0' },
      contributes: { 'reel.feature': [{ id: 'b', doc: 'B.', create: noop }] },
    };
    const provider: PluginManifest = {
      id: 'provider',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { core: '^1.0.0' },
      contributes: { 'session.provider': [{ id: 'p', activateWhen: { default: true }, doc: 'P.', create: noop }] },
    };
    return { core, featureA, featureB, provider };
  }

  it('produces a byte-identical snapshot regardless of manifests array order and project.plugins key order', () => {
    const { core, featureA, featureB, provider } = bigProject();
    const manifestOrders = [
      [core, featureA, featureB, provider],
      [provider, featureB, featureA, core],
      [featureA, provider, core, featureB],
      [featureB, core, provider, featureA],
    ];
    const pluginKeyOrders: ProjectDoc['plugins'][] = [
      { core: { version: '*' }, 'feature-a': { version: '*' }, 'feature-b': { version: '*' }, provider: { version: '*' } },
      { provider: { version: '*' }, 'feature-b': { version: '*' }, 'feature-a': { version: '*' }, core: { version: '*' } },
      { 'feature-a': { version: '*' }, provider: { version: '*' }, core: { version: '*' }, 'feature-b': { version: '*' } },
    ];

    const results: string[] = [];
    for (const manifests of manifestOrders) {
      for (const plugins of pluginKeyOrders) {
        const { plan, diagnostics } = resolvePlan({ project: { plugins }, manifests, launch, kernelVersion: KERNEL });
        results.push(JSON.stringify({ snapshot: toSnapshot(plan), diagnostics }));
      }
    }

    const [first, ...rest] = results;
    for (const r of rest) expect(r).toBe(first);
  });
});
