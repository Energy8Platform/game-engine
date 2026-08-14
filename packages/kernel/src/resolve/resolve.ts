import { type Diagnostic, describeError, error, warning } from '../diagnostics';
import { checkManifestShape } from '../manifest/define';
import type { Contribution, PluginManifest } from '../manifest/types';
import { mergeSchemas } from '../schema/merge';
import { isPlainObject, validate } from '../schema/validate';
import { describeMatcher, isDefaultMatcher, isUnreachableMatcher, matches } from './match';
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
      error('resolve/invalid-project', 'The project data must be an object with a "plugins" object.', {
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

/** Plain ordinal (code-unit) comparison — not `localeCompare`, which is locale- and
 *  Intl-implementation-dependent. "Same input → identical diagnostics" must hold regardless of the
 *  runtime's locale, so the tie-break itself must not be able to vary with it. */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Total order over diagnostics, so the returned ARRAY — not just its contents as a set — is a pure
 *  function of the resolved plan, independent of which step happened to push a given diagnostic
 *  first. Severity/code group the same kind of problem together; the rest breaks ties in the order a
 *  person would naturally narrow one down (which plugin, which point, which contribution, which
 *  field, and only then the prose). */
function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  return (
    compareOrdinal(a.severity, b.severity) ||
    compareOrdinal(a.code, b.code) ||
    compareOrdinal(a.pluginId ?? '', b.pluginId ?? '') ||
    compareOrdinal(a.pointId ?? '', b.pointId ?? '') ||
    compareOrdinal(a.contributionId ?? '', b.contributionId ?? '') ||
    compareOrdinal(a.path ?? '', b.path ?? '') ||
    compareOrdinal(a.message, b.message)
  );
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
          // describeError, not String(): manifest.version/entry.version are untrusted data (manifest
          // and project.json respectively) that can reach here as anything, including a null-prototype
          // value or a throwing Symbol.toStringTag getter — both of which String() throws on.
          `"${pluginId}" is installed at ${describeError(manifest.version)}, which does not satisfy ${entry.version === undefined ? '<missing>' : describeError(entry.version)}.`,
          { pluginId, fix: `Change the range in project.json, or install a matching version.` },
        ),
      );
      continue;
    }
    if (!satisfies(kernelVersion, manifest.engine)) {
      diagnostics.push(
        error(
          'resolve/engine-mismatch',
          `"${pluginId}" needs kernel ${describeError(manifest.engine)}, but this kernel is ${describeError(kernelVersion)}.`,
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
            `"${manifest.id}" needs "${depId}" ${describeError(range)}, but ${describeError(dep.version)} is installed.`,
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
  // activateWhen is captured here, per contribution, rather than re-derived in step 6 by looking the
  // id back up in the raw manifest. Two contributions from the same plugin to the same point CAN
  // share an id — checkManifestShape already flags that as manifest/duplicate-contribution but does
  // not stop resolution over it — and a re-lookup keyed by (pluginId, pointId, contributionId) would
  // then have Array#find return its FIRST match for BOTH resolved entries, silently pairing the
  // second contribution with the first one's activateWhen. Keying by the exact ResolvedContribution
  // object instead is correct by construction: each is built and paired with its own activateWhen
  // exactly once, so there is nothing left to look up incorrectly.
  const activateWhenOf = new Map<ResolvedContribution, Contribution['activateWhen']>();
  // The first plugin to produce a given `${pointId}:${contributionId}` key owns it; a second plugin
  // landing on the same key is a real authoring collision project.json cannot address unambiguously
  // (see resolve/contribution-key-collision below) — this is tracked across the whole loop, not
  // reset per manifest, since the collision is by definition between two DIFFERENT manifests.
  const keyOwner = new Map<string, string>();

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
      if (!Array.isArray(list)) continue; // checkManifestShape already reported manifest/bad-contribution-list

      for (const contribution of list as Contribution[]) {
        if (!isPlainObject(contribution)) continue; // checkManifestShape already reported manifest/bad-contribution

        // A hostile id (missing, a Symbol, a null-prototype object, a number) must not reach a
        // template literal unguarded: implicit coercion throws on a Symbol, and String() throws in
        // turn on a null-prototype value or a throwing Symbol.toStringTag getter — describeError is
        // the one of the three that is actually total. Normalizing once here means every downstream
        // read of ResolvedContribution.id — including every .join() below — is already safe, rather
        // than needing its own guard.
        const contributionId = typeof contribution.id === 'string' ? contribution.id : describeError(contribution.id);
        const key = `${pointId}:${contributionId}`;
        const tag = { pluginId: manifest.id, pointId, contributionId };

        const owner = keyOwner.get(key);
        if (owner === undefined) {
          keyOwner.set(key, manifest.id);
        } else if (owner !== manifest.id) {
          diagnostics.push(
            error(
              'resolve/contribution-key-collision',
              `"${owner}" and "${manifest.id}" both contribute "${contributionId}" to "${pointId}", so project.json cannot address them separately as "${key}".`,
              { ...tag, fix: 'Give one of the two contributions a different id.' },
            ),
          );
        }

        const merged = mergeSchemas(point.schema, contribution.schema, tag);
        diagnostics.push(...merged.diagnostics);

        const chosen = entry.contributions?.[key];
        const raw = { ...(contribution.defaults ?? {}), ...(chosen?.settings ?? {}) };
        const validated = validate(raw, merged.schema);
        diagnostics.push(...validated.diagnostics.map((d) => ({ ...d, ...tag })));

        // A point with arity 'one' activates by matching or by a `default: true` fallback; neither
        // path can ever pick a contribution whose activateWhen has no evaluable condition at all —
        // that covers not just `activateWhen: undefined` but also `{}`, a typo'd key, or an explicit
        // `default: false` (isUnreachableMatcher, see resolve/match.ts). describeMatcher would say
        // 'always' for every one of those, which is true for an arity:'many' point but false —
        // misleadingly so — here.
        const activationLabel =
          point.arity === 'one' && isUnreachableMatcher(contribution.activateWhen)
            ? 'never — a point with arity "one" only activates a contribution whose activateWhen has an evaluable condition or is the default, and this one has neither'
            : describeMatcher(contribution.activateWhen);

        const resolved: ResolvedContribution = {
          key,
          pluginId: manifest.id,
          pointId,
          id: contributionId,
          enabled: chosen?.enabled !== false,
          active: false, // decided in step 6
          activationLabel,
          schema: merged.schema,
          settings: validated.value,
          doc: contribution.doc,
          create: contribution.create,
        };
        activateWhenOf.set(resolved, contribution.activateWhen);
        contributions.push(resolved);
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

    // matches() is handed a LOCAL sink and the result re-tagged with this exact candidate's
    // pluginId/pointId/contributionId, rather than passing `diagnostics` straight through — every
    // other diagnostic built in this function is tagged, and with two candidates on the same point
    // both holding a `match` predicate, an untagged match/predicate-threw diagnostic could not say
    // which one broke.
    const matchesTagged = (c: ResolvedContribution): boolean => {
      const local: Diagnostic[] = [];
      const ok = matches(activateWhenOf.get(c), launch, local);
      diagnostics.push(...local.map((d) => ({ ...d, pluginId: c.pluginId, pointId, contributionId: c.id })));
      return ok;
    };

    const matched = candidates.filter(matchesTagged);
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

    const fallbacks = candidates.filter((c) => isDefaultMatcher(activateWhenOf.get(c)));
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
    } else {
      // Nothing contributes to this point at all — not "disabled", not "doesn't match this launch",
      // just absent. This is the white-screen case the spec (§9) exists to prevent: a host can
      // declare a required arity:'one' point (`ui.shell`, `session.provider`, ...) and, if the
      // plugin that was meant to fill it is simply missing from project.json, every branch above
      // stays silent because each of them only fires once at least one contribution was declared.
      diagnostics.push(
        error(
          'resolve/no-activation',
          `Point "${pointId}" needs exactly one contribution, but nothing contributes to it.`,
          { pointId, fix: `Install a plugin that contributes to "${pointId}".` },
        ),
      );
    }
  }

  // ── 7. Hooks ──────────────────────────────────────────────────────────────
  // A hook id is manifest data — a plugin can declare a hook literally named '__proto__',
  // 'constructor' or 'toString'. On an ordinary `{}`, `(hooks[hook] ??= []).push(...)` for any of
  // those three reads back an INHERITED value (Object.prototype's own __proto__ setter/getter, or
  // the Object constructor, or Function.prototype.toString) instead of `undefined`, so `??=` never
  // assigns and the following `.push` throws `TypeError: ... .push is not a function` — confirmed by
  // running it, not assumed. `runtime/hooks.ts` sidesteps this the same class of bug by keying a Map
  // instead of a plain object; a Map is not an option here because `plan.hooks` must stay a plain
  // JSON-serializable record (it travels inside `PlanSnapshot`, see resolve/snapshot.ts). A
  // null-prototype object is: it has no inherited `__proto__`/`constructor`/`toString` to shadow an
  // own property, so every hook id becomes a genuine own property and `??=` behaves exactly as
  // written. It is also already this package's own definition of "plain" — `schema/validate.ts`'s
  // `isPlainObject` explicitly accepts `Object.getPrototypeOf(value) === null` alongside
  // `Object.prototype` — and `JSON.stringify`/`Object.entries`/`Object.fromEntries` (the operations
  // `toSnapshot` and `declaredFromPlan` actually perform on this record) all work identically on a
  // null-prototype object, so nothing downstream needs to change.
  const hooks: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  const knownHooks = Array.isArray(input?.hookIds) ? input.hookIds : undefined;
  for (const manifest of ordered) {
    const declaredHooks = Array.isArray(manifest.hooks) ? manifest.hooks : [];
    for (const hook of declaredHooks) {
      // A non-string hook (null, a number, an object) would otherwise become a garbage object key
      // (`hooks[42]` → the key '42') with nothing to say why — or, for a Symbol specifically, throw
      // in the template literal below. Refused with a diagnostic instead, the same posture as every
      // other malformed-manifest-data case in this function.
      if (typeof hook !== 'string' || hook.length === 0) {
        diagnostics.push(
          error('resolve/bad-hook', `"${manifest.id}" declares a hook that is not a usable string: ${describeError(hook)}.`, {
            pluginId: manifest.id,
            fix: 'Hook ids must be non-empty strings.',
          }),
        );
        continue;
      }
      if (knownHooks && !knownHooks.includes(hook)) {
        diagnostics.push(
          error('resolve/unknown-hook', `"${manifest.id}" declares hook "${hook}", which does not exist.`, {
            pluginId: manifest.id,
            // `.map(String)` — not `.map((h) => describeError(h))` — was the bug: `knownHooks` is
            // `input.hookIds`, a public ResolveInput field only checked to be an array, never that
            // its elements are strings, so a hostile element here reached String() point-free. A text
            // sweep for the literal substring `String(` misses this shape entirely, because the call
            // is `String)`, not `String(...)` — found by sweeping every `.map(`/`.forEach(`/etc. call
            // in src for a bare coercion function passed by reference, not by grepping for `String(`.
            fix: `Known hooks: ${knownHooks.map((h) => describeError(h)).join(', ')}.`,
          }),
        );
        continue;
      }
      (hooks[hook] ??= []).push(manifest.id);
    }
  }

  // ── 8. Deterministic order ────────────────────────────────────────────────
  // The plan and the diagnostic MULTISET are already independent of input order by this point, but
  // the ARRAY order is not: it is push order, which tracks manifest declaration order. Two runs of
  // the same project with its manifests supplied in a different order can therefore still produce a
  // different diagnostics ARRAY even though every other observable is identical — and for an IDE
  // rendering this as a list, discovery order is a worse default than a stable one anyway. Sorted
  // once, immediately before returning, rather than keeping every push site order-aware.
  diagnostics.sort(compareDiagnostics);

  return { plan: { plugins, points, contributions, order: ordering.order, hooks }, diagnostics };
}
