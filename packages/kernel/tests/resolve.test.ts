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

  it('does alias the live plan past cloneValue’s depth cap — documented, not a silent bug (fix round 1)', () => {
    // The doc comment on PlanSnapshot claims cloneValue's cap, not an unqualified "never shared by
    // reference". Pinned here so nobody "fixes" toSnapshot into an unbounded recursion later, and so
    // the comment's claim is something this suite actually checks rather than only asserts in prose.
    type DeepField = { kind: 'object'; fields: { child: DeepField | { kind: 'text'; default: string } } };
    function buildDeepSchema(depth: number): DeepField | { kind: 'text'; default: string } {
      let field: DeepField | { kind: 'text'; default: string } = { kind: 'text', default: 'leaf' };
      for (let i = 0; i < depth; i++) field = { kind: 'object', fields: { child: field } };
      return field;
    }
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { p: { phase: 'runtime', arity: 'many', schema: { root: buildDeepSchema(40) as never }, doc: 'd' } },
    };
    const { plan } = resolvePlan({ project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL });
    const snapshot = toSnapshot(plan);

    expect(snapshot.points.p.schema.root).not.toBe(plan.points.p.schema.root); // shallow levels: copied
    let live: unknown = plan.points.p.schema.root;
    let snap: unknown = snapshot.points.p.schema.root;
    let aliasedSomewhere = false;
    for (let i = 0; i < 40 && !aliasedSomewhere; i++) {
      if (live === snap) aliasedSomewhere = true;
      const liveField = live as DeepField;
      const snapField = snap as DeepField;
      live = liveField.fields ? liveField.fields.child : undefined;
      snap = snapField.fields ? snapField.fields.child : undefined;
    }
    expect(aliasedSomewhere).toBe(true); // deep enough that cloneValue's cap is reached
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

  it('produces a byte-identical DIAGNOSTICS ARRAY across permutations when the project has several diagnostics of different kinds (fix round 1)', () => {
    // The test above resolves to zero diagnostics, so it cannot catch a diagnostics ARRAY that is
    // still ordered by push order (a pure function of manifest declaration order) even though its
    // CONTENTS as a set are already permutation-independent. This project is built to produce five
    // diagnostics of five different kinds, so a comparator bug shows up as a different array even
    // though every element in it is identical.
    const badVersion: PluginManifest = { id: 'bad-version', version: 'not-semver', engine: '^0.1.0' };
    const badField: PluginManifest = {
      id: 'bad-field',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { pt: { phase: 'runtime', arity: 'many', schema: { x: null as never }, doc: 'd' } },
    };
    const orphanContribution: PluginManifest = {
      id: 'orphan',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { 'nowhere.point': [{ id: 'x', doc: 'd', create: noop }] },
    };
    const badHook: PluginManifest = { id: 'bad-hook', version: '1.0.0', engine: '^0.1.0', hooks: ['unknownHook'] };
    const ghostOnly = { version: '^1.0.0' }; // references a plugin id with no matching manifest below

    const project: ProjectDoc = {
      plugins: {
        'bad-version': { version: '*' },
        'bad-field': { version: '*' },
        orphan: { version: '*' },
        'bad-hook': { version: '*' },
        'ghost-plugin': ghostOnly,
      },
    };

    const orders = [
      [badVersion, badField, orphanContribution, badHook],
      [badHook, orphanContribution, badField, badVersion],
      [orphanContribution, badVersion, badHook, badField],
      [badField, badHook, badVersion, orphanContribution],
    ];

    const results = orders.map((ms) => {
      const { plan, diagnostics } = resolvePlan({ project, manifests: ms, launch, kernelVersion: KERNEL, hookIds: ['onSpin'] });
      return { serialized: JSON.stringify({ snapshot: toSnapshot(plan), diagnostics }), count: diagnostics.length };
    });

    // Sanity: this scenario really does produce more than one diagnostic, of more than one kind —
    // otherwise the test would pass trivially, exactly the failure mode being fixed.
    expect(results[0].count).toBeGreaterThan(1);
    const firstDiagnostics = JSON.parse(results[0].serialized).diagnostics as Array<{ code: string }>;
    expect(new Set(firstDiagnostics.map((d) => d.code)).size).toBeGreaterThan(1);

    for (const r of results) expect(r.serialized).toBe(results[0].serialized);
  });

  it('sorts by severity, then code, then plugin/point/contribution/path, then message', () => {
    // Direct unit check of the comparator's tie-break order, independent of the permutation test
    // above (which proves invariance but not which order was chosen).
    const a: PluginManifest = { id: 'a', version: 'nope', engine: '^0.1.0' }; // manifest/bad-version
    const z: PluginManifest = { id: 'z', version: 'nope', engine: '^0.1.0' }; // manifest/bad-version
    const { diagnostics } = resolvePlan({
      project: { plugins: { a: { version: '*' }, z: { version: '*' } } },
      manifests: [z, a], // deliberately reversed
      launch,
      kernelVersion: KERNEL,
    });
    const badVersions = diagnostics.filter((d) => d.code === 'manifest/bad-version');
    expect(badVersions.map((d) => d.pluginId)).toEqual(['a', 'z']); // alphabetical by pluginId, not push order
  });
});

describe('CRITICAL fix round 1 — a null schema field must not crash resolvePlan', () => {
  it('does not throw for a null field in a point schema, and reports manifest/bad-field-schema', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { pt: { phase: 'runtime', arity: 'many', schema: { speed: null as never }, doc: 'd' } },
    };
    expect(() =>
      resolvePlan({ project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { x: { version: '*' } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.some((d) => d.code === 'manifest/bad-field-schema' && d.path === 'speed')).toBe(true);
    expect(plan.points.pt).toBeDefined();
  });

  it('does not throw for a null field in a contribution schema', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { pt: { phase: 'runtime', arity: 'many', schema: {}, doc: 'd' } },
      contributes: { pt: [{ id: 'c', schema: { speed: null as never }, doc: 'd', create: noop }] },
    };
    expect(() =>
      resolvePlan({ project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan } = resolvePlan({
      project: { plugins: { x: { version: '*' } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    // The manifest boundary AND schema/validate.ts both catch it; the contribution still resolves
    // (with the bad field settled to a safe '' value) rather than being dropped from the plan.
    expect(plan.contributions[0].settings.speed).toBe('');
  });

  it('does not throw for a null field in manifest.settings, reachable with no contribution at all', () => {
    const manifest: PluginManifest = { id: 'x', version: '1.0.0', engine: '^0.1.0', settings: { speed: null as never } };
    expect(() =>
      resolvePlan({ project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { x: { version: '*' } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.plugins[0].settings.speed).toBe('');
    expect(diagnostics.some((d) => d.code === 'manifest/bad-field-schema' && d.pluginId === 'x')).toBe(true);
  });

  it('does not throw for a null field nested inside an object field', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: {
        pt: {
          phase: 'runtime',
          arity: 'many',
          schema: { motion: { kind: 'object', fields: { speed: null as never } } },
          doc: 'd',
        },
      },
    };
    expect(() =>
      resolvePlan({ project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
  });

  it('does not throw for a null list.of once a project supplies a value for that list', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      settings: { stops: { kind: 'list', of: null as never } },
    };
    expect(() =>
      resolvePlan({
        project: { plugins: { x: { version: '*', settings: { stops: [1, 2] } } } },
        manifests: [manifest],
        launch,
        kernelVersion: KERNEL,
      }),
    ).not.toThrow();
    const { plan } = resolvePlan({
      project: { plugins: { x: { version: '*', settings: { stops: [1, 2] } } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.plugins[0].settings.stops).toEqual(['', '']);
  });
});

describe('IMPORTANT fix round 1 — arity "one" activation must not mix up two same-id contributions', () => {
  it('activates the correct one of two contributions sharing an id within one plugin, and labels each correctly', () => {
    const host: PluginManifest = {
      id: 'host',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { sp: { phase: 'runtime', arity: 'one', schema: {}, doc: 'x' } },
    };
    // A manifest bug (checkManifestShape flags it as manifest/duplicate-contribution) that must
    // still resolve CORRECTLY rather than picking the wrong activateWhen for one of the two.
    const twoSame: PluginManifest = {
      id: 'twoSame',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: {
        sp: [
          { id: 'same', activateWhen: { default: true }, doc: 'd1', create: noop },
          { id: 'same', activateWhen: { buildTarget: 'stake' }, doc: 'd2', create: noop },
        ],
      },
    };
    const { plan } = resolvePlan({
      project: { plugins: { host: { version: '*' }, twoSame: { version: '*' } } },
      manifests: [host, twoSame],
      launch: { url: 'https://g/play', buildTarget: 'stake' },
      kernelVersion: KERNEL,
    });
    expect(plan.contributions).toHaveLength(2);
    expect(plan.contributions[0].activationLabel).toBe('when nothing else matches');
    expect(plan.contributions[1].activationLabel).toBe('when the build target is "stake"');
    // Exactly the buildTarget-matching one is active — not both, not neither, not the default one.
    expect(plan.contributions[0].active).toBe(false);
    expect(plan.contributions[1].active).toBe(true);
  });

  it('falls back to the default one of the two when the launch does not match the other', () => {
    const host: PluginManifest = {
      id: 'host',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { sp: { phase: 'runtime', arity: 'one', schema: {}, doc: 'x' } },
    };
    const twoSame: PluginManifest = {
      id: 'twoSame',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: {
        sp: [
          { id: 'same', activateWhen: { default: true }, doc: 'd1', create: noop },
          { id: 'same', activateWhen: { buildTarget: 'stake' }, doc: 'd2', create: noop },
        ],
      },
    };
    const { plan } = resolvePlan({
      project: { plugins: { host: { version: '*' }, twoSame: { version: '*' } } },
      manifests: [host, twoSame],
      launch: { url: 'https://g/play' }, // no buildTarget — the second contribution cannot match
      kernelVersion: KERNEL,
    });
    expect(plan.contributions[0].active).toBe(true); // the default one
    expect(plan.contributions[1].active).toBe(false);
  });
});

describe('IMPORTANT fix round 1 — match/predicate-threw is tagged with which contribution threw', () => {
  it('tags two throwing predicates from two different plugins with their own identity, not the point only', () => {
    const host: PluginManifest = {
      id: 'host',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { sp: { phase: 'runtime', arity: 'one', schema: {}, doc: 'x' } },
    };
    const p1: PluginManifest = {
      id: 'p1',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: {
        sp: [
          {
            id: 'p1',
            activateWhen: {
              match: () => {
                throw new Error('boom1');
              },
            },
            doc: 'x',
            create: noop,
          },
        ],
      },
    };
    const p2: PluginManifest = {
      id: 'p2',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: {
        sp: [
          {
            id: 'p2',
            activateWhen: {
              match: () => {
                throw new Error('boom2');
              },
            },
            doc: 'x',
            create: noop,
          },
        ],
      },
    };
    const { diagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, p1: { version: '*' }, p2: { version: '*' } } },
      manifests: [host, p1, p2],
      launch,
      kernelVersion: KERNEL,
    });
    const thrown = diagnostics.filter((d) => d.code === 'match/predicate-threw');
    expect(thrown).toHaveLength(2);
    expect(thrown).toContainEqual(expect.objectContaining({ pluginId: 'p1', pointId: 'sp', contributionId: 'p1' }));
    expect(thrown).toContainEqual(expect.objectContaining({ pluginId: 'p2', pointId: 'sp', contributionId: 'p2' }));
  });
});

describe('IMPORTANT fix round 1 — contribution key collisions across plugins are reported', () => {
  it('reports resolve/contribution-key-collision when two plugins produce the same key, naming both', () => {
    const host: PluginManifest = {
      id: 'host',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { sp: { phase: 'runtime', arity: 'many', schema: {}, doc: 'x' } },
    };
    const a: PluginManifest = {
      id: 'a',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { sp: [{ id: 'shared', doc: 'x', create: noop }] },
    };
    const b: PluginManifest = {
      id: 'b',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { sp: [{ id: 'shared', doc: 'x', create: noop }] },
    };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, a: { version: '*' }, b: { version: '*' } } },
      manifests: [host, a, b],
      launch,
      kernelVersion: KERNEL,
    });
    // Both contributions still resolve and function (the key is only ambiguous for project.json
    // addressing, not for the plan itself) — but the collision is now visible as a diagnostic.
    expect(plan.contributions.map((c) => c.key)).toEqual(['sp:shared', 'sp:shared']);
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'resolve/contribution-key-collision',
        pluginId: 'b',
        pointId: 'sp',
        contributionId: 'shared',
      }),
    );
  });

  it('does not report a collision for the ordinary case of one plugin, one contribution, one key', () => {
    const { diagnostics } = resolvePlan({ project: project(), manifests: [reelSystem()], launch, kernelVersion: KERNEL });
    expect(diagnostics.filter((d) => d.code === 'resolve/contribution-key-collision')).toEqual([]);
  });

  it('does not report a collision for the SAME plugin declaring a duplicate id to itself (manifest/duplicate-contribution owns that case)', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { sp: { phase: 'runtime', arity: 'many', schema: {}, doc: 'x' } },
      contributes: {
        sp: [
          { id: 'same', doc: 'd1', create: noop },
          { id: 'same', doc: 'd2', create: noop },
        ],
      },
    };
    const { diagnostics } = resolvePlan({
      project: { plugins: { x: { version: '*' } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.filter((d) => d.code === 'resolve/contribution-key-collision')).toEqual([]);
    expect(diagnostics.some((d) => d.code === 'manifest/duplicate-contribution')).toBe(true);
  });
});

describe('MINOR fix round 1 — activationLabel must not claim "always" for a contribution that can never win', () => {
  it('labels a contribution with no activateWhen on an arity "one" point as never, not always', () => {
    const host: PluginManifest = {
      id: 'host',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { sp: { phase: 'runtime', arity: 'one', schema: {}, doc: 'x' } },
    };
    const noRule: PluginManifest = {
      id: 'noRule',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { sp: [{ id: 'noRule', doc: 'x', create: noop }] }, // no activateWhen at all
    };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, noRule: { version: '*' } } },
      manifests: [host, noRule],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions[0].activationLabel).not.toBe('always');
    expect(plan.contributions[0].activationLabel).toContain('never');
    expect(plan.contributions[0].active).toBe(false);
    expect(diagnostics.some((d) => d.code === 'resolve/no-activation')).toBe(true);
  });

  it('keeps "always" for a no-activateWhen contribution on an arity "many" point, where it is true', () => {
    const { plan } = resolvePlan({ project: project(), manifests: [reelSystem()], launch, kernelVersion: KERNEL });
    expect(plan.contributions[0].activationLabel).toBe('always');
    expect(plan.contributions[0].active).toBe(true);
  });
});

describe('MINOR fix round 1 — non-string hook entries are refused with a diagnostic, not silently keyed', () => {
  it('refuses null, a number, an object, and a Symbol; still registers the real hook alongside them', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      hooks: [null as never, 42 as never, {} as never, Symbol('bad') as never, 'realHook'],
    };
    expect(() =>
      resolvePlan({ project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { x: { version: '*' } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.hooks).toEqual({ realHook: ['x'] });
    const badHooks = diagnostics.filter((d) => d.code === 'resolve/bad-hook');
    expect(badHooks).toHaveLength(4);
    expect(badHooks.every((d) => d.pluginId === 'x')).toBe(true);
  });

  it('refuses an empty string as a hook id', () => {
    const manifest: PluginManifest = { id: 'x', version: '1.0.0', engine: '^0.1.0', hooks: [''] };
    const { plan, diagnostics } = resolvePlan({
      project: { plugins: { x: { version: '*' } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.hooks).toEqual({});
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'resolve/bad-hook' });
  });
});

describe('MINOR fix round 1 — String() consistency: hostile non-string data must not crash a template literal', () => {
  it('does not throw when manifest.version, manifest.engine, or kernelVersion is a Symbol', () => {
    const bySymbolVersion: PluginManifest = { id: 'a', version: Symbol('v') as never, engine: '^0.1.0' };
    const bySymbolEngine: PluginManifest = { id: 'b', version: '1.0.0', engine: Symbol('e') as never };
    for (const [manifests, kv] of [
      [[bySymbolVersion], KERNEL],
      [[bySymbolEngine], KERNEL],
      [[{ id: 'c', version: '1.0.0', engine: '^0.1.0' } as PluginManifest], Symbol('kv') as never],
    ] as const) {
      const project: ProjectDoc = { plugins: Object.fromEntries(manifests.map((m) => [m.id, { version: '*' }])) };
      expect(() => resolvePlan({ project, manifests, launch, kernelVersion: kv })).not.toThrow();
    }
  });

  it('does not throw when a dependency version or an entry.version is a Symbol', () => {
    const core: PluginManifest = { id: 'core', version: Symbol('sym') as never, engine: '^0.1.0' };
    const dep: PluginManifest = { id: 'dep', version: '1.0.0', engine: '^0.1.0', dependsOn: { core: '^1.0.0' } };
    expect(() =>
      resolvePlan({
        project: { plugins: { core: { version: '*' }, dep: { version: '*' } } },
        manifests: [core, dep],
        launch,
        kernelVersion: KERNEL,
      }),
    ).not.toThrow();

    expect(() =>
      resolvePlan({
        project: { plugins: { '@e8/reel-system': { version: Symbol('v') as never } } },
        manifests: [reelSystem()],
        launch,
        kernelVersion: KERNEL,
      }),
    ).not.toThrow();
  });

  it('does not throw when a contribution id is a Symbol', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { p: { phase: 'runtime', arity: 'many', schema: {}, doc: 'd' } },
      contributes: { p: [{ id: Symbol('weird') as never, doc: 'd', create: noop }] },
    };
    expect(() =>
      resolvePlan({ project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL }),
    ).not.toThrow();
    const { plan } = resolvePlan({
      project: { plugins: { x: { version: '*' } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    expect(plan.contributions[0].id).toBe('Symbol(weird)');
    expect(plan.contributions[0].key).toBe('p:Symbol(weird)');
  });

  it('does not throw when activateWhen.buildTarget or .urlParam is a Symbol', () => {
    const host: PluginManifest = {
      id: 'host',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { sp: { phase: 'runtime', arity: 'one', schema: {}, doc: 'x' } },
    };
    const weird: PluginManifest = {
      id: 'weird',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: { sp: [{ id: 'weird', activateWhen: { buildTarget: Symbol('bt') as never }, doc: 'x', create: noop }] },
    };
    expect(() =>
      resolvePlan({
        project: { plugins: { host: { version: '*' }, weird: { version: '*' } } },
        manifests: [host, weird],
        launch,
        kernelVersion: KERNEL,
      }),
    ).not.toThrow();
  });
});

describe('Task 11 hardening (a) — an enum field with malformed options never throws through resolvePlan', () => {
  const malformedShapes: Array<[string, unknown]> = [
    ['no options key at all (e.g. a option: typo)', undefined],
    ['options: null', null],
    ["options: 'abc'", 'abc'],
    ['options: []', []],
    ['options: [null]', [null]],
  ];

  for (const [label, options] of malformedShapes) {
    it(`does not throw end to end when a point schema has an enum field with ${label}`, () => {
      const manifest: PluginManifest = {
        id: 'x',
        version: '1.0.0',
        engine: '^0.1.0',
        points: {
          p: {
            phase: 'runtime',
            arity: 'many',
            schema: { direction: { kind: 'enum', options } as never },
            doc: 'd',
          },
        },
        // defaults supplies an actual value, so resolution reaches validateField's enum branch
        // (field.options.map(...) in the pre-fix source) and not only defaultOf's.
        contributes: { p: [{ id: 'c', doc: 'd', create: noop, defaults: { direction: 'vertical' } }] },
      };
      const input = { project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL };
      expect(() => resolvePlan(input)).not.toThrow();

      const { plan, diagnostics } = resolvePlan(input);
      expect(plan.contributions[0].settings.direction).toBe('');
      expect(diagnostics.length).toBeGreaterThan(0);
    });
  }

  it('surfaces manifest/bad-enum-options from the boundary check, reachable through resolvePlan', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { p: { phase: 'runtime', arity: 'many', schema: { direction: { kind: 'enum' } as never }, doc: 'd' } },
    };
    const { diagnostics } = resolvePlan({
      project: { plugins: { x: { version: '*' } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    expect(diagnostics.some((d) => d.code === 'manifest/bad-enum-options' && d.path === 'direction')).toBe(true);
  });
});

describe('Task 11 hardening (b) — a prototype-shaped hook id does not throw in resolvePlan', () => {
  // Pre-fix, `resolvePlan` built `plan.hooks` as `(hooks[hook] ??= []).push(manifest.id)` on an
  // ordinary `{}`. For hook = '__proto__' (or 'constructor', or 'toString'), `hooks[hook]` reads back
  // an INHERITED value instead of `undefined`, so `??=` never assigns and `.push` throws
  // `TypeError: ... .push is not a function` — confirmed against the pre-fix source, not assumed.
  it('registers hooks named __proto__, constructor and toString as genuine own entries, alongside an ordinary one', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      hooks: ['__proto__', 'constructor', 'toString', 'normalHook'],
    };
    const input = { project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL };
    expect(() => resolvePlan(input)).not.toThrow();

    const { plan, diagnostics } = resolvePlan(input);
    expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(Object.hasOwn(plan.hooks, '__proto__')).toBe(true);
    expect(Object.hasOwn(plan.hooks, 'constructor')).toBe(true);
    expect(Object.hasOwn(plan.hooks, 'toString')).toBe(true);
    expect(plan.hooks['__proto__']).toEqual(['x']);
    expect(plan.hooks.constructor).toEqual(['x']);
    expect(plan.hooks.toString).toEqual(['x']);
    expect(plan.hooks.normalHook).toEqual(['x']);
  });

  it('accumulates the same prototype-shaped hook id declared by two different plugins, in order', () => {
    const a: PluginManifest = { id: 'a', version: '1.0.0', engine: '^0.1.0', hooks: ['__proto__'] };
    const b: PluginManifest = { id: 'b', version: '1.0.0', engine: '^0.1.0', hooks: ['__proto__'] };
    const input = {
      project: { plugins: { a: { version: '*' }, b: { version: '*' } } },
      manifests: [a, b],
      launch,
      kernelVersion: KERNEL,
    };
    expect(() => resolvePlan(input)).not.toThrow();
    expect(resolvePlan(input).plan.hooks['__proto__']).toEqual(['a', 'b']);
  });

  it('toSnapshot still JSON-round-trips a plan whose hooks used prototype-shaped ids, as genuine own properties', () => {
    const manifest: PluginManifest = { id: 'x', version: '1.0.0', engine: '^0.1.0', hooks: ['__proto__', 'constructor'] };
    const { plan } = resolvePlan({
      project: { plugins: { x: { version: '*' } } },
      manifests: [manifest],
      launch,
      kernelVersion: KERNEL,
    });
    const snap = toSnapshot(plan);
    expect(() => JSON.stringify(snap)).not.toThrow();
    // Not compared via `toEqual({ __proto__: [...] })`: that object LITERAL would itself set the
    // prototype instead of creating an own property (the exact trap this fix avoids), so a round trip
    // must be read back with hasOwn/bracket access instead — the same technique
    // runtime/hooks.test.ts's declaredFromPlan coverage already uses for the identical reason.
    const roundTripped = JSON.parse(JSON.stringify(snap)) as { hooks: Record<string, string[]> };
    expect(Object.hasOwn(roundTripped.hooks, '__proto__')).toBe(true);
    expect(Object.hasOwn(roundTripped.hooks, 'constructor')).toBe(true);
    expect(roundTripped.hooks['__proto__']).toEqual(['x']);
    expect(roundTripped.hooks['constructor']).toEqual(['x']);
  });
});

// Task 11 review round 1: `String()` — reused throughout resolve.ts to describe untrusted manifest/
// project data in diagnostic messages — is not total. It throws for a null-prototype value and for a
// value with a throwing `Symbol.toStringTag` getter, the same two hostile shapes `describeError`
// exists to survive. `describeMatcher(contribution.activateWhen)` runs unconditionally in step 5, for
// EVERY contribution to an `arity:'one'` point that declares one — not a rare branch — so this made
// `resolvePlan` itself throw. Confirmed against the pre-fix source before fixing, not assumed.
describe('Task 11 review round 1 — describeError, not String(): resolvePlan must not crash on unstringifiable data', () => {
  it('resolves a plan whose activateWhen carries an unstringifiable urlParam, instead of throwing', () => {
    const host: PluginManifest = {
      id: 'host',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { sp: { phase: 'runtime', arity: 'one', schema: {}, doc: 'x' } },
    };
    const weird: PluginManifest = {
      id: 'weird',
      version: '1.0.0',
      engine: '^0.1.0',
      contributes: {
        sp: [{ id: 'weird', activateWhen: { urlParam: Object.create(null) as never }, doc: 'x', create: noop }],
      },
    };
    const input = {
      project: { plugins: { host: { version: '*' }, weird: { version: '*' } } },
      manifests: [host, weird],
      launch,
      kernelVersion: KERNEL,
    };
    expect(() => resolvePlan(input)).not.toThrow();
    const { plan } = resolvePlan(input);
    // Not matched (the urlParam is absent from `launch.url`), so it falls through to activationLabel
    // via describeMatcher — the exact call that threw pre-fix — without resolution itself aborting.
    expect(typeof plan.contributions[0].activationLabel).toBe('string');
  });

  it('reports resolve/version-mismatch without throwing when manifest.version or the project range is unstringifiable', () => {
    const manifest: PluginManifest = { id: 'x', version: Object.create(null) as never, engine: '^0.1.0' };
    const input1 = { project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL };
    expect(() => resolvePlan(input1)).not.toThrow();

    const ok: PluginManifest = { id: 'y', version: '1.0.0', engine: '^0.1.0' };
    const input2 = {
      project: { plugins: { y: { version: Object.create(null) as never } } },
      manifests: [ok],
      launch,
      kernelVersion: KERNEL,
    };
    expect(() => resolvePlan(input2)).not.toThrow();
  });

  it('reports resolve/engine-mismatch without throwing when manifest.engine or kernelVersion is unstringifiable', () => {
    const manifest: PluginManifest = { id: 'x', version: '1.0.0', engine: Object.create(null) as never };
    const input1 = { project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL };
    expect(() => resolvePlan(input1)).not.toThrow();

    const ok: PluginManifest = { id: 'y', version: '1.0.0', engine: '^0.1.0' };
    const input2 = {
      project: { plugins: { y: { version: '*' } } },
      manifests: [ok],
      launch,
      kernelVersion: Object.create(null) as never,
    };
    expect(() => resolvePlan(input2)).not.toThrow();
  });

  it('reports resolve/dependency-version without throwing when the range or the dependency version is unstringifiable', () => {
    const core: PluginManifest = { id: 'core', version: Object.create(null) as never, engine: '^0.1.0' };
    const dep: PluginManifest = { id: 'dep', version: '1.0.0', engine: '^0.1.0', dependsOn: { core: '^1.0.0' } };
    expect(() =>
      resolvePlan({
        project: { plugins: { core: { version: '*' }, dep: { version: '*' } } },
        manifests: [core, dep],
        launch,
        kernelVersion: KERNEL,
      }),
    ).not.toThrow();

    const core2: PluginManifest = { id: 'core2', version: '1.0.0', engine: '^0.1.0' };
    const dep2: PluginManifest = {
      id: 'dep2',
      version: '1.0.0',
      engine: '^0.1.0',
      dependsOn: { core2: Object.create(null) as never },
    };
    expect(() =>
      resolvePlan({
        project: { plugins: { core2: { version: '*' }, dep2: { version: '*' } } },
        manifests: [core2, dep2],
        launch,
        kernelVersion: KERNEL,
      }),
    ).not.toThrow();
  });

  it('reports resolve/bad-hook without throwing when the hook id is unstringifiable', () => {
    const manifest: PluginManifest = { id: 'x', version: '1.0.0', engine: '^0.1.0', hooks: [Object.create(null) as never] };
    const input = { project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL };
    expect(() => resolvePlan(input)).not.toThrow();
    const { diagnostics } = resolvePlan(input);
    expect(diagnostics.some((d) => d.code === 'resolve/bad-hook')).toBe(true);
  });

  it('does not throw when a contribution id is unstringifiable (null-prototype, not just a Symbol)', () => {
    const manifest: PluginManifest = {
      id: 'x',
      version: '1.0.0',
      engine: '^0.1.0',
      points: { p: { phase: 'runtime', arity: 'many', schema: {}, doc: 'd' } },
      contributes: { p: [{ id: Object.create(null) as never, doc: 'd', create: noop }] },
    };
    const input = { project: { plugins: { x: { version: '*' } } }, manifests: [manifest], launch, kernelVersion: KERNEL };
    expect(() => resolvePlan(input)).not.toThrow();
    const { plan } = resolvePlan(input);
    expect(typeof plan.contributions[0].id).toBe('string');
  });
});

// Task 11 review round 2: `knownHooks.map(String)` — point-free, so a text search for the literal
// substring `String(` misses it entirely (the call reads `String)`, not `String(...)`). `knownHooks`
// is `input.hookIds`, a public ResolveInput field checked only to be an array — never that its
// elements are strings — so a hostile element reaches this exact point-free String() call while
// building the resolve/unknown-hook diagnostic's `fix` text. Now `.map((h) => describeError(h))`.
describe('Task 11 review round 2 — describeError, not point-free String(): resolve/unknown-hook must not crash on an unstringifiable candidate', () => {
  it('describes unknown-hook candidates that cannot be stringified', () => {
    const rogue: PluginManifest = { id: 'rogue', version: '1.0.0', engine: '^0.1.0', hooks: ['onMadeUp'] };
    const input = {
      project: { plugins: { rogue: { version: '*' } } },
      manifests: [rogue],
      launch,
      kernelVersion: KERNEL,
      hookIds: ['realHook', Object.create(null) as string],
    };
    expect(() => resolvePlan(input)).not.toThrow();
    const { diagnostics } = resolvePlan(input);
    expect(diagnostics.some((d) => d.code === 'resolve/unknown-hook')).toBe(true);
  });

  it('does not throw when a knownHooks candidate has a throwing Symbol.toStringTag getter', () => {
    const rogue: PluginManifest = { id: 'rogue', version: '1.0.0', engine: '^0.1.0', hooks: ['onMadeUp'] };
    const hostile = {
      get [Symbol.toStringTag]() {
        throw new Error('boom');
      },
    };
    const input = {
      project: { plugins: { rogue: { version: '*' } } },
      manifests: [rogue],
      launch,
      kernelVersion: KERNEL,
      hookIds: ['realHook', hostile as unknown as string],
    };
    expect(() => resolvePlan(input)).not.toThrow();
    expect(resolvePlan(input).diagnostics.some((d) => d.code === 'resolve/unknown-hook')).toBe(true);
  });
});
