import { describe, expect, it } from 'vitest';
import { activateOne, activatePoint } from '@/runtime/activate';
import { resolvePlan } from '@/resolve/resolve';
import type { Contribution, Factory, PluginManifest } from '@/manifest/types';
import type { ResolvedPlan } from '@/resolve/types';

function host(list: Contribution[]): PluginManifest {
  return {
    id: 'host',
    version: '1.0.0',
    engine: '*',
    points: {
      'reel.feature': {
        phase: 'runtime',
        arity: 'many',
        schema: { power: { kind: 'number', default: 1 } },
        doc: 'A reel behaviour.',
      },
    },
    contributes: { 'reel.feature': list },
  };
}

function planFor(list: Contribution[]) {
  const { plan } = resolvePlan({
    project: { plugins: { host: { version: '*' } } },
    manifests: [host(list)],
    launch: { url: 'https://g/play' },
    kernelVersion: '0.1.0',
  });
  return plan;
}

describe('activatePoint', () => {
  it('calls the factory with the validated settings', async () => {
    let seen: unknown = null;
    const plan = planFor([
      {
        id: 'a',
        doc: 'A.',
        create: async () => (settings) => {
          seen = settings;
          return 'made-a';
        },
      },
    ]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(diagnostics).toEqual([]);
    expect(instances).toEqual([{ key: 'reel.feature:a', pluginId: 'host', contributionId: 'a', value: 'made-a' }]);
    expect(seen).toEqual({ power: 1 });
  });

  it('accepts a module with a default export, so a bare dynamic import works', async () => {
    const plan = planFor([{ id: 'a', doc: 'A.', create: async () => ({ default: () => 'from-default' }) }]);
    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances[0].value).toBe('from-default');
  });

  it('awaits an async factory', async () => {
    const plan = planFor([{ id: 'a', doc: 'A.', create: async () => async () => 'async-value' }]);
    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances[0].value).toBe('async-value');
  });

  it('skips contributions the project disabled', async () => {
    const { plan } = resolvePlan({
      project: {
        plugins: {
          host: { version: '*', contributions: { 'reel.feature:b': { enabled: false } } },
        },
      },
      manifests: [
        host([
          { id: 'a', doc: 'A.', create: async () => () => 'a' },
          { id: 'b', doc: 'B.', create: async () => () => 'b' },
        ]),
      ],
      launch: { url: 'https://g/play' },
      kernelVersion: '0.1.0',
    });
    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances.map((i) => i.value)).toEqual(['a']);
  });

  it('isolates a factory that throws and keeps the others alive', async () => {
    const plan = planFor([
      { id: 'good1', doc: 'Fine.', create: async () => () => 'one' },
      {
        id: 'broken',
        doc: 'Explodes.',
        create: async () => () => {
          throw new Error('boom');
        },
      },
      { id: 'good2', doc: 'Fine.', create: async () => () => 'two' },
    ]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances.map((i) => i.value)).toEqual(['one', 'two']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'activate/factory-failed',
      contributionId: 'broken',
    });
    expect(diagnostics[0].message).toContain('boom');
  });

  it('isolates a create() whose import rejects', async () => {
    const plan = planFor([
      {
        id: 'missing',
        doc: 'Module is gone.',
        create: async () => {
          throw new Error('Cannot find module');
        },
      },
    ]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/load-failed' });
  });

  it('reports a module that resolves to something other than a factory', async () => {
    const plan = planFor([
      { id: 'weird', doc: 'Not a factory.', create: async () => ({ nope: 1 }) as unknown as never },
    ]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/not-a-factory' });
  });

  it('returns nothing for a point with no contributions', async () => {
    const plan = planFor([]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

// ── Hostile input: the plan and pointId arguments themselves ────────────────────────────────────
//
// `activatePoint` is documented (and typed) to take the `ResolvedPlan` `resolvePlan` produces, but
// nothing stops a caller from handing it something else — a stale object, a JSON round trip that lost
// its shape, a straight-up bug. None of these may ever throw or reject; `resolvePlan`'s own defensive
// posture at its input boundary (see `resolve.ts`'s `projectPlugins`) is the precedent this follows.
describe('activatePoint hostile plan/pointId input (never rejects)', () => {
  it('treats plan: null as an unusable plan, with a diagnostic', async () => {
    const { instances, diagnostics } = await activatePoint(null as unknown as ResolvedPlan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'activate/invalid-plan' })]);
  });

  it('treats plan: undefined the same way', async () => {
    const { instances, diagnostics } = await activatePoint(undefined as unknown as ResolvedPlan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/invalid-plan' });
  });

  it('treats a plan with no "contributions" key the same way', async () => {
    const { instances, diagnostics } = await activatePoint({} as unknown as ResolvedPlan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/invalid-plan' });
  });

  it('treats plan.contributions: null the same way', async () => {
    const bad = { contributions: null } as unknown as ResolvedPlan;
    const { instances, diagnostics } = await activatePoint(bad, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/invalid-plan' });
  });

  it('treats plan.contributions: "nope" (not an array) the same way', async () => {
    const bad = { contributions: 'nope' } as unknown as ResolvedPlan;
    const { instances, diagnostics } = await activatePoint(bad, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/invalid-plan' });
  });

  it('skips a null element inside an otherwise-usable contributions array, without a diagnostic', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => () => 'ok' }]);
    const hostile = { ...plan, contributions: [null, ...plan.contributions] } as unknown as ResolvedPlan;
    const { instances, diagnostics } = await activatePoint<string>(hostile, 'reel.feature');
    expect(instances.map((i) => i.value)).toEqual(['ok']);
    expect(diagnostics).toEqual([]);
  });

  it('pointId: "" simply matches no contribution', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => () => 'ok' }]);
    const { instances, diagnostics } = await activatePoint(plan, '');
    expect(instances).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('pointId: null simply matches no contribution', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => () => 'ok' }]);
    const { instances, diagnostics } = await activatePoint(plan, null as unknown as string);
    expect(instances).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it('pointId: a Symbol simply matches no contribution, and does not throw building a diagnostic', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => () => 'ok' }]);
    const { instances, diagnostics } = await activatePoint(plan, Symbol('reel.feature') as unknown as string);
    expect(instances).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

// ── Fix round 1: throwing property accessors must not reject activatePoint ──────────────────────
//
// Everything above defends against the WRONG SHAPE (null, missing, non-array). None of it defends
// against a right-shaped value whose property access itself throws — an IDE that wraps a live plan
// in a Proxy to instrument or lazily hydrate it is exactly the audience for this package, and every
// read `activatePoint` performs before reaching a plugin's own create()/factory is a candidate.
describe('activatePoint fix round 1 — throwing property accessors never reject', () => {
  it('does not reject when plan.contributions is a throwing accessor', async () => {
    const plan = {} as ResolvedPlan;
    Object.defineProperty(plan, 'contributions', {
      get(): never {
        throw new Error('boom');
      },
    });
    const { instances, diagnostics } = await activatePoint(plan, 'p');
    expect(instances).toEqual([]);
    expect(diagnostics.some((d) => d.code === 'activate/invalid-plan')).toBe(true);
  });

  it('does not let a broken UNRELATED contribution abort another point', async () => {
    const healthy = {
      key: 'p:ok',
      pluginId: 'x',
      pointId: 'p',
      id: 'ok',
      enabled: true,
      active: true,
      activationLabel: 'always',
      schema: {},
      settings: {},
      doc: 'd',
      create: async () => () => 'made',
    };
    const rotten: Record<string, unknown> = { key: 'other:bad', pluginId: 'y', id: 'bad', active: true };
    Object.defineProperty(rotten, 'pointId', {
      get(): never {
        throw new Error('boom');
      },
    });
    const plan = { contributions: [rotten, healthy] } as unknown as ResolvedPlan;
    const { instances, diagnostics } = await activatePoint<string>(plan, 'p');
    expect(instances.map((i) => i.value)).toEqual(['made']);
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it('tags the diagnostic for that unrelated contribution as activate/bad-contribution, recovering what it safely can', async () => {
    const rotten: Record<string, unknown> = { key: 'other:bad', pluginId: 'y', id: 'bad', active: true };
    Object.defineProperty(rotten, 'pointId', {
      get(): never {
        throw new Error('boom');
      },
    });
    const plan = { contributions: [rotten] } as unknown as ResolvedPlan;
    const { instances, diagnostics } = await activatePoint(plan, 'p');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'activate/bad-contribution',
      pluginId: 'y',
      contributionId: 'bad',
    });
  });

  it('does not reject when a matching contribution has a throwing pluginId', async () => {
    const rotten: Record<string, unknown> = {
      key: 'p:bad',
      pointId: 'p',
      id: 'bad',
      active: true,
      create: async () => () => 'x',
    };
    Object.defineProperty(rotten, 'pluginId', {
      get(): never {
        throw new Error('boom');
      },
    });
    const plan = { contributions: [rotten] } as unknown as ResolvedPlan;
    await expect(activatePoint(plan, 'p')).resolves.toBeDefined();
  });

  it('reports a throwing pluginId as its own load-failed diagnostic', async () => {
    const rotten: Record<string, unknown> = {
      key: 'p:bad',
      pointId: 'p',
      id: 'bad',
      active: true,
      create: async () => () => 'x',
    };
    Object.defineProperty(rotten, 'pluginId', {
      get(): never {
        throw new Error('boom');
      },
    });
    const plan = { contributions: [rotten] } as unknown as ResolvedPlan;
    const { instances, diagnostics } = await activatePoint(plan, 'p');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/load-failed', contributionId: 'bad' });
  });

  // Found while fixing the three cases above, same class, not named in the review: `contribution.key`
  // is read directly (outside any guard) in the not-a-factory message and in the factory-failed
  // catch's own message. A throwing `.key` at either site would reject exactly like the named cases.
  it('does not reject when a would-be not-a-factory contribution has a throwing key', async () => {
    const rotten: Record<string, unknown> = {
      pluginId: 'x',
      pointId: 'p',
      id: 'bad',
      active: true,
      create: async () => ({}) as unknown as never, // resolves to something that is not a factory
    };
    Object.defineProperty(rotten, 'key', {
      get(): never {
        throw new Error('key boom');
      },
    });
    const plan = { contributions: [rotten] } as unknown as ResolvedPlan;
    const { instances, diagnostics } = await activatePoint(plan, 'p');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ code: 'activate/not-a-factory' });
  });

  it('does not reject when a contribution whose factory throws also has a throwing key', async () => {
    const rotten: Record<string, unknown> = {
      pluginId: 'x',
      pointId: 'p',
      id: 'bad',
      active: true,
      settings: {},
      create: async () => () => {
        throw new Error('factory boom');
      },
    };
    Object.defineProperty(rotten, 'key', {
      get(): never {
        throw new Error('key boom');
      },
    });
    const plan = { contributions: [rotten] } as unknown as ResolvedPlan;
    const { instances, diagnostics } = await activatePoint(plan, 'p');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ code: 'activate/factory-failed' });
  });
});

// ── Hostile input: what create() resolves to ─────────────────────────────────────────────────────
describe('activatePoint hostile create()/factory shapes', () => {
  it('reports create missing entirely', async () => {
    const plan = planFor([{ id: 'a', doc: 'd' } as unknown as Contribution]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/load-failed', contributionId: 'a' });
  });

  it('reports create: null', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: null as unknown as Contribution['create'] }]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/load-failed' });
  });

  it('reports create: not a function (a plain string)', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: 'nope' as unknown as Contribution['create'] }]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/load-failed' });
  });

  it('isolates a create getter that throws when read', async () => {
    // Built by hand, bypassing resolvePlan: resolvePlan's own contribution-building step does a bare
    // `create: contribution.create` property read with no try/catch, so a throwing getter reaching it
    // from a manifest would fail inside resolvePlan itself, not inside activatePoint. What this task
    // owns is activatePoint's handling of a ResolvedPlan whose create is already a throwing getter,
    // however it got that way.
    const contribution: Record<string, unknown> = {
      key: 'reel.feature:x',
      pluginId: 'host',
      pointId: 'reel.feature',
      id: 'x',
      enabled: true,
      active: true,
      activationLabel: 'always',
      schema: {},
      settings: {},
      doc: 'd',
    };
    Object.defineProperty(contribution, 'create', {
      get(): never {
        throw new Error('getter boom');
      },
      enumerable: true,
    });
    const plan = { plugins: [], points: {}, contributions: [contribution], order: [], hooks: {} } as unknown as ResolvedPlan;
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/load-failed' });
    expect(diagnostics[0].message).toContain('getter boom');
  });

  it('reports create() resolving to undefined', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => undefined as unknown as Factory<string> }]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/not-a-factory' });
  });

  it('reports create() resolving to null', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => null as unknown as Factory<string> }]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/not-a-factory' });
  });

  it('reports a module whose default is present but not callable', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => ({ default: 'nope' }) as unknown as never }]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/not-a-factory' });
  });

  it('prefers a callable module over its own .default when both are present', async () => {
    const callable = Object.assign(() => 'from-callable', { default: () => 'from-default' }) as Factory<string> & {
      default: Factory<string>;
    };
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => callable }]);
    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances[0].value).toBe('from-callable');
  });

  it('accepts a null-prototype module object with a callable default', async () => {
    const mod = Object.create(null) as { default: Factory<string> };
    mod.default = () => 'from-null-proto';
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => mod }]);
    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances[0].value).toBe('from-null-proto');
  });

  it('reports a null-prototype module with no usable default', async () => {
    const mod = Object.create(null) as Record<string, unknown>;
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => mod as unknown as never }]);
    const { instances, diagnostics } = await activatePoint(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/not-a-factory' });
  });
});

// ── Hostile input: what the factory itself does when it runs ────────────────────────────────────
describe('activatePoint hostile factory execution', () => {
  it('isolates a factory that returns a rejected promise', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => () => Promise.reject(new Error('rejected')) }]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0]).toMatchObject({ severity: 'error', code: 'activate/factory-failed' });
    expect(diagnostics[0].message).toContain('rejected');
  });

  it('isolates a factory that throws a plain string', async () => {
    const plan = planFor([
      {
        id: 'a',
        doc: 'd',
        create: async () => () => {
          throw 'string boom';
        },
      },
    ]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0].code).toBe('activate/factory-failed');
    expect(diagnostics[0].message).toContain('string boom');
  });

  it('isolates a factory that throws a Symbol', async () => {
    const plan = planFor([
      {
        id: 'a',
        doc: 'd',
        create: async () => () => {
          throw Symbol('sym boom');
        },
      },
    ]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0].code).toBe('activate/factory-failed');
    expect(diagnostics[0].message).toContain('Symbol(sym boom)');
  });

  it('isolates a factory that throws undefined', async () => {
    const plan = planFor([
      {
        id: 'a',
        doc: 'd',
        create: async () => () => {
          // eslint-disable-next-line no-throw-literal
          throw undefined;
        },
      },
    ]);
    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances).toEqual([]);
    expect(diagnostics[0].code).toBe('activate/factory-failed');
    expect(diagnostics[0].message).toContain('undefined');
  });

  // Explicitly NOT given a timeout — see the task brief. This test proves, rather than assumes, what
  // actually happens: it races the outer activatePoint() promise against a short real delay and
  // checks it has not settled. It does not await the hung factory itself, so it cannot hang the run.
  it('documents that a factory which never resolves stalls activatePoint itself, forever', async () => {
    const plan = planFor([{ id: 'hangs', doc: 'd', create: async () => () => new Promise<string>(() => {}) }]);
    let settled = false;
    void activatePoint<string>(plan, 'reel.feature').then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(settled).toBe(false);
  });

  // A factory receives an object, not a copy, unless activatePoint defends against exactly this.
  // Two things must both hold: the mutation must not leak to a SIBLING contribution's settings (that
  // part is already true for free, since `validate()` allocates a fresh settings object per
  // contribution), and it must not leak back into the plan's own copy of THIS contribution's
  // settings, which is the part that is not free.
  it('does not let a factory mutate its settings argument back into the plan', async () => {
    const plan = planFor([
      {
        id: 'mutator',
        doc: 'd',
        create: async () => (settings) => {
          (settings as Record<string, unknown>).power = 999;
          (settings as Record<string, unknown>).extra = 'leaked';
          return 'ok';
        },
      },
    ]);
    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances[0].value).toBe('ok');
    expect(plan.contributions[0].settings).toEqual({ power: 1 });
  });

  it('does not let one contribution mutating its settings affect a sibling contribution', async () => {
    const plan = planFor([
      {
        id: 'mutator',
        doc: 'd',
        create: async () => (settings) => {
          (settings as Record<string, unknown>).power = 999;
          return 'mutator-done';
        },
      },
      { id: 'innocent', doc: 'd', create: async () => (settings) => settings.power },
    ]);
    const { instances } = await activatePoint<number | string>(plan, 'reel.feature');
    expect(instances.map((i) => i.value)).toEqual(['mutator-done', 1]);
  });
});

// ── Ordering ──────────────────────────────────────────────────────────────────────────────────────
describe('activatePoint ordering', () => {
  it('returns instances in plan order — plugin order, then declaration order within a plugin', async () => {
    const alpha: PluginManifest = {
      id: 'alpha',
      version: '1.0.0',
      engine: '*',
      contributes: { 'reel.feature': [{ id: 'a1', doc: 'd', create: async () => () => 'alpha-1' }] },
    };
    const zeta: PluginManifest = {
      id: 'zeta',
      version: '1.0.0',
      engine: '*',
      contributes: {
        'reel.feature': [
          { id: 'z1', doc: 'd', create: async () => () => 'zeta-1' },
          { id: 'z2', doc: 'd', create: async () => () => 'zeta-2' },
        ],
      },
    };
    const { plan, diagnostics: resolveDiagnostics } = resolvePlan({
      project: { plugins: { host: { version: '*' }, alpha: { version: '*' }, zeta: { version: '*' } } },
      manifests: [host([]), alpha, zeta],
      launch: { url: 'https://g/play' },
      kernelVersion: '0.1.0',
    });
    expect(resolveDiagnostics).toEqual([]);
    // No dependsOn anywhere, so orderPlugins breaks the tie alphabetically: alpha, host, zeta.
    expect(plan.order).toEqual(['alpha', 'host', 'zeta']);

    const { instances } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances.map((i) => i.value)).toEqual(['alpha-1', 'zeta-1', 'zeta-2']);
  });

  it('keeps survivors in cross-plugin plan order when a contribution in the middle fails', async () => {
    const alpha: PluginManifest = {
      id: 'alpha',
      version: '1.0.0',
      engine: '*',
      contributes: { 'reel.feature': [{ id: 'a1', doc: 'd', create: async () => () => 'alpha-1' }] },
    };
    const mid: PluginManifest = {
      id: 'mid',
      version: '1.0.0',
      engine: '*',
      contributes: {
        'reel.feature': [
          {
            id: 'boom',
            doc: 'd',
            create: async () => () => {
              throw new Error('mid boom');
            },
          },
        ],
      },
    };
    const zeta: PluginManifest = {
      id: 'zeta',
      version: '1.0.0',
      engine: '*',
      contributes: { 'reel.feature': [{ id: 'z1', doc: 'd', create: async () => () => 'zeta-1' }] },
    };
    const { plan } = resolvePlan({
      project: { plugins: { host: { version: '*' }, alpha: { version: '*' }, mid: { version: '*' }, zeta: { version: '*' } } },
      manifests: [host([]), alpha, mid, zeta],
      launch: { url: 'https://g/play' },
      kernelVersion: '0.1.0',
    });
    expect(plan.order).toEqual(['alpha', 'host', 'mid', 'zeta']);

    const { instances, diagnostics } = await activatePoint<string>(plan, 'reel.feature');
    expect(instances.map((i) => i.value)).toEqual(['alpha-1', 'zeta-1']);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'activate/factory-failed', pluginId: 'mid', contributionId: 'boom' });
  });
});

describe('activateOne', () => {
  it('returns the single active instance for a point with one contribution', async () => {
    const plan = planFor([{ id: 'a', doc: 'd', create: async () => () => 'solo' }]);
    const { instance, diagnostics } = await activateOne<string>(plan, 'reel.feature');
    expect(diagnostics).toEqual([]);
    expect(instance).toEqual({ key: 'reel.feature:a', pluginId: 'host', contributionId: 'a', value: 'solo' });
  });

  it('returns the first activated instance, in plan order, when several are active', async () => {
    const ran: string[] = [];
    const plan = planFor([
      {
        id: 'a',
        doc: 'd',
        create: async () => () => {
          ran.push('a');
          return 'first';
        },
      },
      {
        id: 'b',
        doc: 'd',
        create: async () => () => {
          ran.push('b');
          return 'second';
        },
      },
    ]);
    const { instance, diagnostics } = await activateOne<string>(plan, 'reel.feature');
    expect(diagnostics).toEqual([]);
    expect(instance?.value).toBe('first');
    // activateOne truncates the RESULT to the first instance; it does not short-circuit activation
    // itself — every active contribution's factory still runs.
    expect(ran).toEqual(['a', 'b']);
  });

  it('returns null, with no diagnostics, for a point with no active contributions', async () => {
    const plan = planFor([]);
    const { instance, diagnostics } = await activateOne(plan, 'reel.feature');
    expect(instance).toBeNull();
    expect(diagnostics).toEqual([]);
  });
});
