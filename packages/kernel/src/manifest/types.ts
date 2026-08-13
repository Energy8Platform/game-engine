import type { Schema } from '../schema/types';
import type { Matcher } from '../resolve/types';

export type PointId = string;

/** A point belongs to exactly one phase. A plugin needing two phases contributes to two points. */
export type Phase = 'runtime' | 'build' | 'editor';

/** 'one' — exactly one contribution is active (a shell, a renderer). 'many' — all enabled ones are. */
export type Arity = 'one' | 'many';

/**
 * What a contribution's lazily-loaded module ultimately provides: a function from validated
 * settings to a live instance.
 */
export type Factory<T = unknown> = (settings: Record<string, unknown>) => T | Promise<T>;

/** An extension point. Declared by a plugin — the kernel owns no list of points. */
export interface PointDef {
  phase: Phase;
  arity: Arity;
  /** Settings schema shared by every contribution to this point. */
  schema: Schema;
  /** Documentation for the IDE and the agent. Required: an undocumented point is unusable by both. */
  doc: string;
}

/** One extension plugged into a point. */
export interface Contribution<T = unknown> {
  /** Unique within its plugin and point. */
  id: string;
  /** Fields this contribution adds on top of the point's schema. */
  schema?: Schema;
  /** Overrides for the point schema's defaults, applied before validation. */
  defaults?: Record<string, unknown>;
  /** For `arity: 'one'` points with several candidates. Ignored on `arity: 'many'`. */
  activateWhen?: Matcher;
  /**
   * Lazily loads the implementation. Both shapes work, so a bare dynamic import is enough:
   *   create: () => import('./features/expandingWild')   // module with a default export
   *   create: async () => myFactory                      // the factory itself
   */
  create: () => Promise<Factory<T> | { default: Factory<T> }>;
  /** Documentation for the IDE and the agent. Required. */
  doc: string;
}

/**
 * A plugin manifest. Free of side effects and heavy imports so the IDE, the build and the agent can
 * read the full composition of a game in Node without starting it.
 */
export interface PluginManifest {
  id: string;
  /** This plugin's own version, semver. */
  version: string;
  /** Kernel version range this plugin needs, e.g. '^0.1.0'. */
  engine: string;
  /** Other plugins this one needs, id → semver range. Also fixes activation order. */
  dependsOn?: Record<string, string>;
  /** New extension points this plugin opens. */
  points?: Record<PointId, PointDef>;
  /** Extensions this plugin plugs into points — its own or another plugin's. */
  contributes?: Record<PointId, Contribution[]>;
  /** Hooks this plugin uses. Undeclared hooks are refused at registration. */
  hooks?: string[];
  /** Settings of the plugin itself, as opposed to those of any one contribution. */
  settings?: Schema;
}
