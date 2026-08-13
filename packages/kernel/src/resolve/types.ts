import type { Schema } from '../schema/types';
import type { Arity, Contribution, Phase, PluginManifest, PointId } from '../manifest/types';

/**
 * Launch-time context and the declarative matcher that reads it. The rest of this file is written
 * in the task that introduces plan resolution.
 */

export interface LaunchContext {
  /** The full launch URL, including its query string. */
  url: string;
  /** The build target this bundle was produced for, e.g. 'stake' or 'artube'. */
  buildTarget?: string;
  /** Environment values the host chose to expose. */
  env?: Record<string, string>;
}

/**
 * Which launch a contribution is for. Declarative on purpose: the IDE must be able to SHOW when a
 * given session provider or boot overlay takes over, which it cannot do with an opaque predicate.
 * Every present condition must hold. `match` exists for genuinely irregular cases and is declared
 * in the manifest so the IDE at least knows an opaque rule is in play.
 */
export interface Matcher {
  /** Matches when this query parameter is present in the launch URL. */
  urlParam?: string;
  /** Matches when the build target equals this value. */
  buildTarget?: string;
  /** Marks the fallback used when no other candidate matches. */
  default?: true;
  /** Escape hatch for rules the declarative fields cannot express. */
  match?: (ctx: LaunchContext) => boolean;
}

/** How a project addresses one contribution's settings: `${pointId}:${contributionId}`. */
export type ContributionKey = string;

export interface ContributionSettings {
  /** Default true. */
  enabled?: boolean;
  settings?: Record<string, unknown>;
}

export interface PluginEntry {
  /** Semver range the project accepts for this plugin. */
  version: string;
  /** Default true. */
  enabled?: boolean;
  /** Settings of the plugin itself. */
  settings?: Record<string, unknown>;
  /** Per-contribution settings, keyed by ContributionKey. */
  contributions?: Record<ContributionKey, ContributionSettings>;
}

/** The part of `project.json` the kernel reads. */
export interface ProjectDoc {
  plugins: Record<string, PluginEntry>;
}

export interface ResolvedPlugin {
  id: string;
  version: string;
  /** Validated plugin-level settings. */
  settings: Record<string, unknown>;
}

export interface ResolvedPoint {
  pointId: PointId;
  /** Which plugin opened this point. */
  pluginId: string;
  phase: Phase;
  arity: Arity;
  schema: Schema;
  doc: string;
}

export interface ResolvedContribution {
  key: ContributionKey;
  pluginId: string;
  pointId: PointId;
  id: string;
  /** The project's choice. */
  enabled: boolean;
  /** Enabled AND, on an `arity: 'one'` point, the winner of activation. */
  active: boolean;
  /** Human sentence describing when this contribution activates, for the IDE. */
  activationLabel: string;
  /** Effective schema: point fields then contribution fields. */
  schema: Schema;
  /** Validated settings — every schema key present. */
  settings: Record<string, unknown>;
  doc: string;
  create: Contribution['create'];
}

export interface ResolvedPlan {
  plugins: ResolvedPlugin[];
  points: Record<PointId, ResolvedPoint>;
  /** Ordered: by plugin activation order, then by declaration order within a plugin. */
  contributions: ResolvedContribution[];
  /** Plugin ids, dependencies first. */
  order: string[];
  /** Hook id → plugin ids that declared it. */
  hooks: Record<string, string[]>;
}

export interface ResolveInput {
  project: ProjectDoc;
  manifests: readonly PluginManifest[];
  launch: LaunchContext;
  /** Usually KERNEL_VERSION. Passed in so tests can pin it. */
  kernelVersion: string;
  /** When given, a hook a plugin declares that is not in this list is an error. */
  hookIds?: readonly string[];
}
