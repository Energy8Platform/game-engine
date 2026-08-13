import { type Diagnostic, describeError, error } from '../diagnostics';
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

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

/**
 * Reads a property defensively. Everything this module reads off a plan or a contribution is,
 * ordinarily, a plain value straight from `resolvePlan`'s own construction — but `activatePoint`'s
 * contract is a *shape* (`ResolvedPlan`), not a promise that the object was built by `resolvePlan`.
 * An IDE that wraps a live plan in a `Proxy` to instrument or lazily hydrate it — exactly the
 * audience this package is for — can legitimately make any one of these reads throw. That must cost
 * a diagnostic, never the whole call.
 */
function safeGet(obj: unknown, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

interface Tag {
  pluginId?: string;
  pointId?: string;
  contributionId?: string;
}

/** Best-effort identity for a diagnostic, built entirely from `safeGet`: even when ONE field's
 *  accessor throws, the others are still worth reporting, and this itself never throws. */
function safeTag(contribution: unknown): Tag {
  const pluginId = safeGet(contribution, 'pluginId');
  const pointId = safeGet(contribution, 'pointId');
  const id = safeGet(contribution, 'id');
  return {
    pluginId: typeof pluginId === 'string' ? pluginId : undefined,
    pointId: typeof pointId === 'string' ? pointId : undefined,
    contributionId: typeof id === 'string' ? id : undefined,
  };
}

/** Best-effort `key` for a diagnostic message. Never throws. */
function safeKey(contribution: unknown): string {
  const key = safeGet(contribution, 'key');
  return typeof key === 'string' ? key : '<unreadable>';
}

/**
 * Instantiate every active contribution to a point, in plan order.
 *
 * This is the only asynchronous part of the kernel, and the only place a plugin's own code runs.
 * Each contribution is isolated: a module that fails to load, a value that is not a factory, or a
 * factory that throws costs exactly that one contribution. One broken third-party reel feature must
 * not be able to take a live game down.
 *
 * Never rejects. This holds for a `plan` that is not the shape `resolvePlan` produces (null,
 * undefined, a non-array `contributions`) and for a `plan` whose shape is right but whose fields are
 * live accessors that throw when read — a throwing accessor anywhere in that chain becomes a
 * diagnostic, never a rejection, including one that belongs to a contribution for a DIFFERENT point
 * than the one being activated: a broken contribution to point A must not be able to abort activation
 * of point B.
 *
 * It does NOT bound a factory that never settles: such a factory stalls this call — and every
 * contribution after it — indefinitely, because activation is sequential so that ordering guarantees
 * hold. A caller needing a time bound must wrap this call in its own timeout.
 */
export async function activatePoint<T = unknown>(plan: ResolvedPlan, pointId: string): Promise<ActivateResult<T>> {
  const instances: Activated<T>[] = [];
  const diagnostics: Diagnostic[] = [];

  let rawContributions: unknown;
  try {
    rawContributions = plan?.contributions;
  } catch (err) {
    // plan is a right-shaped-looking object whose `contributions` accessor itself throws (a live
    // Proxy, not merely a wrong value) — optional chaining only guards null/undefined `plan`, not a
    // throwing getter on a non-null one.
    diagnostics.push(
      error('activate/invalid-plan', `Could not read plan.contributions: ${describeError(err)}`, {
        fix: 'Pass the ResolvedPlan returned by resolvePlan().',
      }),
    );
    return { instances, diagnostics };
  }

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
  //
  // An element that IS an object but whose pointId/active accessor THROWS is different: unlike a
  // plain null, this is an active signal something is wrong, and it may belong to a completely
  // different point than the one being activated right now. It is still dropped — one broken
  // contribution to point A must not stop point B's activation — but it is not silent, since (unlike
  // the null case) there really was something here that failed.
  const wanted = rawContributions.filter((c): c is ResolvedContribution => {
    if (!isPlainObject(c)) return false;
    try {
      return c.pointId === pointId && c.active === true;
    } catch (err) {
      diagnostics.push(
        error('activate/bad-contribution', `A contribution in the plan could not be read: ${describeError(err)}`, {
          ...safeTag(c),
          fix: 'Check the plan for a contribution whose fields are not plain values.',
        }),
      );
      return false;
    }
  });

  for (const contribution of wanted) {
    let tag: Tag;
    let loaded: unknown;
    try {
      // Tag construction shares this try with create(): a throwing pluginId/pointId/id accessor is
      // exactly as much "this contribution failed to load" as create() itself throwing, and the two
      // must not be distinguishable by whether the call site 30 lines down can find `tag` at all.
      tag = {
        pluginId: contribution.pluginId,
        pointId: contribution.pointId,
        contributionId: contribution.id,
      };
      loaded = await contribution.create();
    } catch (err) {
      diagnostics.push(
        error('activate/load-failed', `Could not load "${safeKey(contribution)}": ${describeError(err)}`, {
          ...safeTag(contribution),
          fix: 'Check the create() import path in the plugin manifest.',
        }),
      );
      continue;
    }

    const factory = pickFactory<T>(loaded);
    if (!factory) {
      diagnostics.push(
        error('activate/not-a-factory', `"${safeKey(contribution)}" did not resolve to a factory function.`, {
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
      diagnostics.push(
        error('activate/factory-failed', `"${safeKey(contribution)}" failed to start: ${describeError(err)}`, tag),
      );
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
