/**
 * @energy8engine/kernel — the plugin kernel.
 *
 * Everything here is a pure function over plain data. The kernel knows nothing about renderers,
 * slots, spins or the DOM; it knows only how plugins declare extension points, how contributions
 * plug into them, and how a project's choices resolve into a plan.
 *
 * This barrel is the entire public surface: every name below is what `@energy8engine/kernel`
 * exports, and nothing outside `src/` is imported to build it (see `tests/purity.test.ts`).
 */

/** Kernel version. Plugin manifests declare the range they need via `engine`. */
export const KERNEL_VERSION = '0.1.0';

// Diagnostics
export { describeError, error, hasErrors, warning } from './diagnostics';
export type { Diagnostic, Severity } from './diagnostics';

// Schema
export { STRING_KINDS } from './schema/types';
export type { AssetKind, EnumOption, FieldBase, FieldSchema, Schema } from './schema/types';
export { cloneValue, defaultOf, isPlainObject, isUsableField, MAX_SCHEMA_DEPTH, validate } from './schema/validate';
export type { ValidateResult } from './schema/validate';
export { mergeSchemas } from './schema/merge';
export type { MergeContext, MergeResult } from './schema/merge';

// Manifest
export { checkManifestShape, definePlugin } from './manifest/define';
export type {
  Arity,
  Contribution,
  Factory,
  Phase,
  PluginManifest,
  PointDef,
  PointId,
} from './manifest/types';

// Resolution
export { isValidRange, parseVersion, satisfies } from './resolve/semver';
export type { Version } from './resolve/semver';
export { orderPlugins } from './resolve/order';
export type { OrderResult } from './resolve/order';
export { describeMatcher, isDefaultMatcher, matches } from './resolve/match';
export { resolvePlan } from './resolve/resolve';
export type { ResolveOutput } from './resolve/resolve';
export { toSnapshot } from './resolve/snapshot';
export type { ContributionSnapshot, PlanSnapshot } from './resolve/snapshot';
export type {
  ContributionKey,
  ContributionSettings,
  LaunchContext,
  Matcher,
  PluginEntry,
  ProjectDoc,
  ResolveInput,
  ResolvedContribution,
  ResolvedPlan,
  ResolvedPlugin,
  ResolvedPoint,
} from './resolve/types';

// Runtime
export { activateOne, activatePoint } from './runtime/activate';
export type { Activated, ActivateResult } from './runtime/activate';
export { createHookBus, declaredFromPlan, MAX_HOOK_DEPTH } from './runtime/hooks';
export type { HookBus, HookBusOptions, HookFn } from './runtime/hooks';
