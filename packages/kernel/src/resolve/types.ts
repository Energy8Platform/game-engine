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
