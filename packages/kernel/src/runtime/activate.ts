import { type Diagnostic, error } from '../diagnostics';
import type { Factory } from '../manifest/types';
import { cloneValue, isPlainObject } from '../schema/validate';
import type { ResolvedContribution, ResolvedPlan } from '../resolve/types';

export interface Activated<T> {
  key: string;
  pluginId: string;
  contributionId: string;
  value: T;
}

export interface ActivateResult<T> {
  instances: Activated<T>[];
  diagnostics: Diagnostic[];
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

/**
 * Instantiate every active contribution to a point, in plan order.
 *
 * This is the only asynchronous part of the kernel, and the only place a plugin's own code runs.
 * Each contribution is isolated: a module that fails to load, a value that is not a factory, or a
 * factory that throws costs exactly that one contribution. One broken third-party reel feature must
 * not be able to take a live game down.
 *
 * Never rejects, even when `plan` is not the shape `resolvePlan` produces. `resolvePlan` itself is
 * defensive at its own input boundary (a malformed `project.plugins` becomes one diagnostic and an
 * empty set, not a throw — see `projectPlugins` in `resolve.ts`); this is the same posture applied to
 * `activatePoint`'s own boundary, since nothing stops a caller from handing it a stale or malformed
 * plan.
 */
export async function activatePoint<T = unknown>(plan: ResolvedPlan, pointId: string): Promise<ActivateResult<T>> {
  const instances: Activated<T>[] = [];
  const diagnostics: Diagnostic[] = [];

  const rawContributions = plan?.contributions;
  if (!Array.isArray(rawContributions)) {
    diagnostics.push(
      error('activate/invalid-plan', `plan.contributions must be an array; got ${typeName(rawContributions)}.`, {
        fix: 'Pass the ResolvedPlan returned by resolvePlan().',
      }),
    );
    return { instances, diagnostics };
  }

  // An element that is not itself a usable object cannot be attributed to any point — resolvePlan
  // never produces one, so this only matters for a hand-built or corrupted plan, and there is nothing
  // to tag a diagnostic with. Dropped silently, the same way resolvePlan drops a manifest element that
  // failed its own shape check.
  const wanted = rawContributions.filter(
    (c): c is ResolvedContribution => isPlainObject(c) && c.pointId === pointId && c.active === true,
  );

  for (const contribution of wanted) {
    const tag = {
      pluginId: contribution.pluginId,
      pointId: contribution.pointId,
      contributionId: contribution.id,
    };

    let loaded: unknown;
    try {
      loaded = await contribution.create();
    } catch (err) {
      diagnostics.push(
        error('activate/load-failed', `Could not load "${contribution.key}": ${messageOf(err)}`, {
          ...tag,
          fix: 'Check the create() import path in the plugin manifest.',
        }),
      );
      continue;
    }

    const factory = pickFactory<T>(loaded);
    if (!factory) {
      diagnostics.push(
        error('activate/not-a-factory', `"${contribution.key}" did not resolve to a factory function.`, {
          ...tag,
          fix: 'create() must resolve to a function, or to a module whose default export is one.',
        }),
      );
      continue;
    }

    try {
      // A clone, not the live settings object: every other contribution already gets its own
      // distinct settings object (`validate()` allocates one per contribution in resolvePlan), so the
      // one remaining path back into the plan is a factory mutating the very object it was handed and
      // that mutation surviving on `contribution.settings` for anyone who reads the plan afterward —
      // a second activation, the IDE, a snapshot. Cloning here closes that path without changing what
      // the factory sees on this call.
      const value = await factory(cloneValue(contribution.settings));
      instances.push({
        key: contribution.key,
        pluginId: contribution.pluginId,
        contributionId: contribution.id,
        value: value as T,
      });
    } catch (err) {
      diagnostics.push(error('activate/factory-failed', `"${contribution.key}" failed to start: ${messageOf(err)}`, tag));
    }
  }

  return { instances, diagnostics };
}

function pickFactory<T>(loaded: unknown): Factory<T> | null {
  if (typeof loaded === 'function') return loaded as Factory<T>;
  if (loaded && typeof loaded === 'object') {
    const candidate = (loaded as { default?: unknown }).default;
    if (typeof candidate === 'function') return candidate as Factory<T>;
  }
  return null;
}

/** Convenience for `arity: 'one'` points: the single active instance, or null. */
export async function activateOne<T = unknown>(
  plan: ResolvedPlan,
  pointId: string,
): Promise<{ instance: Activated<T> | null; diagnostics: Diagnostic[] }> {
  const { instances, diagnostics } = await activatePoint<T>(plan, pointId);
  return { instance: instances[0] ?? null, diagnostics };
}
