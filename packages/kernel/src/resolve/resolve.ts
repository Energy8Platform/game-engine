import { type Diagnostic, error, warning } from '../diagnostics';
import { checkManifestShape } from '../manifest/define';
import type { Contribution, PluginManifest } from '../manifest/types';
import { mergeSchemas } from '../schema/merge';
import { isPlainObject, validate } from '../schema/validate';
import { describeMatcher, isDefaultMatcher, matches } from './match';
import { orderPlugins } from './order';
import { satisfies } from './semver';
import type {
  LaunchContext,
  PluginEntry,
  ResolveInput,
  ResolvedContribution,
  ResolvedPlan,
  ResolvedPlugin,
  ResolvedPoint,
} from './types';

export interface ResolveOutput {
  plan: ResolvedPlan;
  diagnostics: Diagnostic[];
}

/** A `PluginEntry` for a plugin the project did not mention or described unusably.
 *  `version` is required by the type but this sentinel deliberately has none: it stands in for
 *  data that failed the runtime shape check below, and every read of it is written to tolerate
 *  `version` being `undefined` in practice (`satisfies(x, undefined)` is false, not a throw). */
const EMPTY_ENTRY = {} as unknown as PluginEntry;

/** `Boolean` guard the manifest.id is a non-empty string, without trusting the declared type. */
function usableId(manifest: unknown): manifest is { id: string } {
  return isPlainObject(manifest) && typeof manifest.id === 'string' && manifest.id.length > 0;
}

/**
 * `project.plugins`, defensively. Anything short of a plain object is reported once and treated as
 * empty — the rest of resolution then runs its ordinary "nothing requested" path instead of a
 * special case for every step.
 */
function projectPlugins(project: unknown, diagnostics: Diagnostic[]): Record<string, unknown> {
  if (!isPlainObject(project) || !isPlainObject((project as { plugins?: unknown }).plugins)) {
    diagnostics.push(
      error('resolve/invalid-project', 'The project document must be an object with a "plugins" object.', {
        fix: 'Provide { plugins: { "plugin-id": { version: "^1.0.0" } } }.',
      }),
    );
    return {};
  }
  return (project as { plugins: Record<string, unknown> }).plugins;
}

/** Two schemas are the same declaration when they serialize identically. A schema that cannot be
 *  serialized (a manifest author's cyclic literal) is conservatively treated as different — this
 *  package would rather flag a point conflict a human can dismiss than silently trust two things
 *  it could not actually compare. */
function sameSchema(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Turn a project's choices plus the installed manifests into a plan.
 *
 * Never throws. Every refusal is a diagnostic, so a broken project produces a precise list a person
 * can act on instead of a blank screen. The plan is still returned: whatever resolved cleanly is
 * usable, and the caller decides whether the errors are fatal.
 */
export function resolvePlan(input: ResolveInput): ResolveOutput {
  const diagnostics: Diagnostic[] = [];
  const launch = (input?.launch ?? {}) as LaunchContext;
  const kernelVersion = input?.kernelVersion as string;
  const rawManifests: readonly unknown[] = Array.isArray(input?.manifests) ? input.manifests : [];
  const rawPlugins = projectPlugins(input?.project, diagnostics);

  // ── 1. Which manifests are in play ────────────────────────────────────────
  // First occurrence wins for a repeated id — the same convention `orderPlugins` uses, so a plugin
  // that is physically installed twice resolves to one deterministic winner instead of whichever
  // copy happened to load last. This is also the ONLY place in the pipeline that can see a raw
  // duplicate: by the time `orderPlugins` runs below it is handed `admitted`, which is built from
  // `projectEntries` (one manifest per distinct project.plugins key) and therefore can never itself
  // contain two manifests sharing an id. So this step owns `resolve/duplicate-plugin-id`, and
  // `orderPlugins`'s own copy of that check is simply never reached from this call path.
  const byId = new Map<string, PluginManifest>();
  for (const manifest of rawManifests) {
    diagnostics.push(...checkManifestShape(manifest as PluginManifest));
    if (!usableId(manifest)) continue; // checkManifestShape already reported the missing/bad id
    if (byId.has(manifest.id)) {
      diagnostics.push(
        error(
          'resolve/duplicate-plugin-id',
          `Plugin id "${manifest.id}" is declared by more than one manifest; only the first is used.`,
          { pluginId: manifest.id, fix: 'Remove the duplicate, or give one of them a distinct id.' },
        ),
      );
      continue;
    }
    byId.set(manifest.id, manifest as PluginManifest);
  }

  const projectEntries = new Map<string, PluginEntry>();
  for (const [pluginId, raw] of Object.entries(rawPlugins)) {
    projectEntries.set(pluginId, isPlainObject(raw) ? (raw as unknown as PluginEntry) : EMPTY_ENTRY);
  }

  const admitted: PluginManifest[] = [];
  for (const [pluginId, entry] of projectEntries) {
    const manifest = byId.get(pluginId);
    if (!manifest) {
      diagnostics.push(
        error('resolve/plugin-not-found', `The project uses "${pluginId}", but it is not installed.`, {
          pluginId,
          fix: `Install ${pluginId}, or remove it from project.json.`,
        }),
      );
      continue;
    }
    if (entry.enabled === false) continue;

    if (!satisfies(manifest.version, entry.version)) {
      diagnostics.push(
        error(
          'resolve/version-mismatch',
          `"${pluginId}" is installed at ${manifest.version}, which does not satisfy ${entry.version ?? '<missing>'}.`,
          { pluginId, fix: `Change the range in project.json, or install a matching version.` },
        ),
      );
      continue;
    }
    if (!satisfies(kernelVersion, manifest.engine)) {
      diagnostics.push(
        error(
          'resolve/engine-mismatch',
          `"${pluginId}" needs kernel ${manifest.engine}, but this kernel is ${kernelVersion}.`,
          { pluginId, fix: 'Upgrade the kernel, or use a build of the plugin that fits it.' },
        ),
      );
      continue;
    }
    admitted.push(manifest);
  }

  for (const manifest of byId.values()) {
    if (!projectEntries.has(manifest.id)) {
      diagnostics.push(
        warning('resolve/not-in-project', `"${manifest.id}" is installed but not listed in the project; ignored.`, {
          pluginId: manifest.id,
          fix: `Add "${manifest.id}" to project.json to use it.`,
        }),
      );
    }
  }

  // ── 2. Dependencies and order ─────────────────────────────────────────────
  const ordering = orderPlugins(admitted);
  diagnostics.push(...ordering.diagnostics);

  const admittedById = new Map(admitted.map((m) => [m.id, m]));
  for (const manifest of admitted) {
    const dependsOn = isPlainObject(manifest.dependsOn) ? manifest.dependsOn : {};
    for (const [depId, range] of Object.entries(dependsOn)) {
      const dep = admittedById.get(depId);
      if (dep && !satisfies(dep.version, range as string)) {
        diagnostics.push(
          error(
            'resolve/dependency-version',
            `"${manifest.id}" needs "${depId}" ${String(range)}, but ${dep.version} is installed.`,
            { pluginId: manifest.id },
          ),
        );
      }
    }
  }

  const ordered = ordering.order
    .map((id) => admittedById.get(id))
    .filter((m): m is PluginManifest => m !== undefined);

  // ── 3. Points ─────────────────────────────────────────────────────────────
  const points: Record<string, ResolvedPoint> = {};
  for (const manifest of ordered) {
    for (const [pointId, def] of Object.entries(manifest.points ?? {})) {
      if (!isPlainObject(def)) continue; // checkManifestShape already reported manifest/bad-point-schema

      const existing = points[pointId];
      if (existing) {
        const same =
          existing.phase === def.phase && existing.arity === def.arity && sameSchema(existing.schema, def.schema);
        if (!same) {
          diagnostics.push(
            error(
              'resolve/point-conflict',
              `Point "${pointId}" is declared differently by "${existing.pluginId}" and "${manifest.id}".`,
              { pluginId: manifest.id, pointId, fix: 'Only one plugin should own a point; align or rename.' },
            ),
          );
        }
        continue;
      }
      points[pointId] = {
        pointId,
        pluginId: manifest.id,
        phase: def.phase as ResolvedPoint['phase'],
        arity: def.arity as ResolvedPoint['arity'],
        schema: (def.schema ?? {}) as ResolvedPoint['schema'],
        doc: (def.doc ?? '') as string,
      };
    }
  }

  // ── 4. Plugin-level settings ──────────────────────────────────────────────
  const plugins: ResolvedPlugin[] = [];
  for (const manifest of ordered) {
    const entry = projectEntries.get(manifest.id) ?? EMPTY_ENTRY;
    const result = validate(entry.settings ?? {}, manifest.settings ?? {});
    diagnostics.push(...result.diagnostics.map((d) => ({ ...d, pluginId: manifest.id })));
    plugins.push({ id: manifest.id, version: manifest.version, settings: result.value });
  }

  // ── 5. Contributions ──────────────────────────────────────────────────────
  const contributions: ResolvedContribution[] = [];
  for (const manifest of ordered) {
    const entry = projectEntries.get(manifest.id) ?? EMPTY_ENTRY;
    for (const [pointId, list] of Object.entries(manifest.contributes ?? {})) {
      const point = points[pointId];
      if (!point) {
        diagnostics.push(
          error('resolve/unknown-point', `"${manifest.id}" contributes to "${pointId}", which no plugin declares.`, {
            pluginId: manifest.id,
            pointId,
            fix: 'Install the plugin that opens this point, or fix the point id.',
          }),
        );
        continue;
      }
      if (!Array.isArray(list)) continue; // checkManifestShape already reported manifest/bad-contributions

      for (const contribution of list as Contribution[]) {
        if (!isPlainObject(contribution)) continue; // checkManifestShape already reported manifest/bad-contribution

        const key = `${pointId}:${contribution.id}`;
        const tag = { pluginId: manifest.id, pointId, contributionId: contribution.id };

        const merged = mergeSchemas(point.schema, contribution.schema, tag);
        diagnostics.push(...merged.diagnostics);

        const chosen = entry.contributions?.[key];
        const raw = { ...(contribution.defaults ?? {}), ...(chosen?.settings ?? {}) };
        const validated = validate(raw, merged.schema);
        diagnostics.push(...validated.diagnostics.map((d) => ({ ...d, ...tag })));

        contributions.push({
          key,
          pluginId: manifest.id,
          pointId,
          id: contribution.id,
          enabled: chosen?.enabled !== false,
          active: false, // decided in step 6
          activationLabel: describeMatcher(contribution.activateWhen),
          schema: merged.schema,
          settings: validated.value,
          doc: contribution.doc,
          create: contribution.create,
        });
      }
    }
  }

  // ── 6. Activation ─────────────────────────────────────────────────────────
  for (const [pointId, point] of Object.entries(points)) {
    const declared = contributions.filter((c) => c.pointId === pointId);
    const candidates = declared.filter((c) => c.enabled);

    if (point.arity === 'many') {
      for (const c of candidates) c.active = true;
      continue;
    }

    const manifestOf = (c: ResolvedContribution) =>
      admittedById
        .get(c.pluginId)
        ?.contributes?.[pointId]?.find((x): x is Contribution => isPlainObject(x) && x.id === c.id);

    const matched = candidates.filter((c) => matches(manifestOf(c)?.activateWhen, launch, diagnostics));
    if (matched.length === 1) {
      matched[0].active = true;
      continue;
    }
    if (matched.length > 1) {
      diagnostics.push(
        error(
          'resolve/ambiguous-activation',
          `Point "${pointId}" allows one contribution, but these all match this launch: ${matched.map((c) => c.id).join(', ')}.`,
          { pointId, fix: 'Narrow the activateWhen matchers so exactly one fits.' },
        ),
      );
      continue;
    }

    const fallbacks = candidates.filter((c) => isDefaultMatcher(manifestOf(c)?.activateWhen));
    if (fallbacks.length === 1) {
      fallbacks[0].active = true;
      continue;
    }
    if (fallbacks.length > 1) {
      diagnostics.push(
        error(
          'resolve/ambiguous-activation',
          `Point "${pointId}" has more than one default: ${fallbacks.map((c) => c.id).join(', ')}.`,
          { pointId, fix: 'Exactly one contribution may be the default.' },
        ),
      );
      continue;
    }
    if (candidates.length > 0) {
      diagnostics.push(
        error(
          'resolve/no-activation',
          `Point "${pointId}" needs one contribution, but none matches this launch. Candidates: ${candidates.map((c) => `${c.id} (${c.activationLabel})`).join(', ')}.`,
          { pointId, fix: 'Add a contribution with `activateWhen: { default: true }`.' },
        ),
      );
    } else if (declared.length > 0) {
      // Every candidate exists but the project disabled all of them. Silence here would mean a
      // required point can go completely unfilled with nothing in `diagnostics` to explain why.
      diagnostics.push(
        error(
          'resolve/no-activation',
          `Point "${pointId}" needs one contribution, but every declared candidate is disabled: ${declared.map((c) => c.id).join(', ')}.`,
          { pointId, fix: 'Enable one of these contributions in project.json.' },
        ),
      );
    }
  }

  // ── 7. Hooks ──────────────────────────────────────────────────────────────
  const hooks: Record<string, string[]> = {};
  const knownHooks = Array.isArray(input?.hookIds) ? input.hookIds : undefined;
  for (const manifest of ordered) {
    const declaredHooks = Array.isArray(manifest.hooks) ? manifest.hooks : [];
    for (const hook of declaredHooks) {
      if (knownHooks && !knownHooks.includes(hook)) {
        diagnostics.push(
          error('resolve/unknown-hook', `"${manifest.id}" declares hook "${hook}", which does not exist.`, {
            pluginId: manifest.id,
            fix: `Known hooks: ${knownHooks.join(', ')}.`,
          }),
        );
        continue;
      }
      (hooks[hook] ??= []).push(manifest.id);
    }
  }

  return { plan: { plugins, points, contributions, order: ordering.order, hooks }, diagnostics };
}
