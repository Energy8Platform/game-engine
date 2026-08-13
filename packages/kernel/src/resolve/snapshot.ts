import { cloneValue } from '../schema/validate';
import type { ResolvedContribution, ResolvedPlan } from './types';

/** A ResolvedContribution minus its factory — plain JSON. */
export type ContributionSnapshot = Omit<ResolvedContribution, 'create'>;

/**
 * The plan as data. `ResolvedPlan` holds `create` functions and therefore is not JSON; this is what
 * travels to the IDE over RPC and what the agent reads. Both read exactly what the game runs — one
 * description of the composition, not three.
 *
 * Every container here is a fresh structural copy, made with the same depth-capped `cloneValue`
 * `schema/validate.ts` uses for settings defaults — nothing PLAIN is shared by reference with the
 * live `ResolvedPlan`, up to `MAX_SCHEMA_DEPTH` (32) levels of nesting; `cloneValue` returns anything
 * past that cap by reference, the same cap-then-alias behavior it has everywhere else in this
 * package. That matters even though the plan's own values are already "fresh at the source" in their
 * own right: `validate()` hands back a new settings object per contribution, but `mergeSchemas`
 * deliberately SHARES `FieldSchema` field objects between every sibling contribution to the same
 * point (a schema is a declaration authored once, not per-caller state — see Task 3's ruling). A
 * shallow re-export of the plan would still hand the IDE those very `schema` objects, so an edit made
 * through the snapshot could corrupt every other contribution's effective schema. An actual copy
 * severs that, within the same depth this package already treats as the boundary of a realistic
 * schema. This is what makes "the plan is serializable" true of the runtime path — not merely
 * something one test happens to observe by round-tripping the result through JSON once.
 */
export type PlanSnapshot = Omit<ResolvedPlan, 'contributions'> & {
  contributions: ContributionSnapshot[];
};

export function toSnapshot(plan: ResolvedPlan): PlanSnapshot {
  return {
    plugins: plan.plugins.map((p) => ({
      id: p.id,
      version: p.version,
      settings: cloneValue(p.settings),
    })),
    points: Object.fromEntries(
      Object.entries(plan.points).map(([pointId, point]) => [
        pointId,
        { ...point, schema: cloneValue(point.schema) },
      ]),
    ),
    contributions: plan.contributions.map(({ create: _create, schema, settings, ...rest }) => ({
      ...rest,
      schema: cloneValue(schema),
      settings: cloneValue(settings),
    })),
    order: [...plan.order],
    hooks: Object.fromEntries(Object.entries(plan.hooks).map(([hook, ids]) => [hook, [...ids]])),
  };
}
