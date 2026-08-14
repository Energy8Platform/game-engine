import { type Diagnostic, describeError, error, warning } from '../diagnostics';
import { isPlainObject, isUsableField, MAX_SCHEMA_DEPTH } from '../schema/validate';
import type { Arity, Phase, PluginManifest } from './types';

const SEMVER = /^\d+\.\d+\.\d+$/;

// The runtime mirror of the `Phase`/`Arity` union types: `PointDef` types them, but a type is erased
// at runtime and enforces nothing against a manifest built from data (JSON, a hand-written literal
// with a typo, a value that drifted). Without this, a bad or missing `phase`/`arity` reached
// resolvePlan unchecked — a capitalization typo like `arity: 'Many'` fell through resolve.ts's arity
// check into the arity-ONE branch, which deactivated every contribution and reported only a
// misleading resolve/no-activation, never naming the real problem.
const VALID_PHASES: readonly Phase[] = ['runtime', 'build', 'editor'];
const VALID_ARITIES: readonly Arity[] = ['one', 'many'];

/** Identity helper. Exists so plugin authors get inference and autocomplete on the manifest shape. */
export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest;
}

/**
 * Walk a schema object (a point's, a contribution's, or a plugin's `settings`) and report every
 * field that is not a usable field definition — `null`, a string, an array, or an object with no
 * `kind`. `schema/validate.ts` defends itself against exactly this shape at runtime (never throws,
 * degrades one field to a diagnostic), but a malformed manifest should be refused here, at the
 * boundary, with a diagnostic that names which plugin and which field — not merely survived deep
 * inside resolution. The depth cap mirrors `MAX_SCHEMA_DEPTH` so a cyclic schema literal cannot spin
 * this into infinite recursion; it stops silently past the cap rather than reporting again, since
 * `schema/validate.ts`'s own `schema/too-deep` diagnostic already covers a schema that deep.
 */
function checkSchemaFields(
  schema: unknown,
  out: Diagnostic[],
  tag: Partial<Diagnostic>,
  code: string,
  depth = 0,
): void {
  if (depth >= MAX_SCHEMA_DEPTH || !isPlainObject(schema)) return;

  for (const [key, field] of Object.entries(schema)) {
    if (!isUsableField(field)) {
      out.push(error(code, `Field "${key}" is not a usable field definition.`, { ...tag, path: key }));
      continue;
    }
    if (field.kind === 'object') {
      checkSchemaFields(field.fields, out, tag, code, depth + 1);
    } else if (field.kind === 'list') {
      if (!isUsableField(field.of)) {
        out.push(error(code, `Field "${key}"'s list item type is not a usable field definition.`, { ...tag, path: `${key}[]` }));
      } else if (field.of.kind === 'object') {
        checkSchemaFields(field.of.fields, out, tag, code, depth + 1);
      } else if (field.of.kind === 'enum' && !Array.isArray(field.of.options)) {
        out.push(
          error('manifest/bad-enum-options', `Field "${key}"'s list item type is an enum with no usable "options" array.`, {
            ...tag,
            path: `${key}[]`,
          }),
        );
      }
    } else if (field.kind === 'enum' && !Array.isArray(field.options)) {
      // `schema/validate.ts` already tolerates a non-array `options` at runtime (never throws,
      // degrades to an empty option set) — this is the boundary check that turns the same condition
      // into a diagnostic a plugin author sees immediately, the same division of labour
      // `isUsableField` already has with `defaultOf`/`validateField`. Most plausibly reached from a
      // plain typo: `option:` for `options:`.
      out.push(
        error('manifest/bad-enum-options', `Field "${key}" is an enum with no usable "options" array.`, {
          ...tag,
          path: key,
        }),
      );
    }
  }
}

/**
 * Structural check of a single manifest, run before anything else looks at it. Collects every
 * problem rather than stopping at the first, because an author fixing a manifest wants the whole
 * list, not one error per round trip.
 */
export function checkManifestShape(manifest: PluginManifest): Diagnostic[] {
  const out: Diagnostic[] = [];

  // Defensive: manifest may be null, missing, or not a plain object
  if (!isPlainObject(manifest)) {
    return [
      error('manifest/invalid', 'A plugin manifest must be a plain object.', {
        fix: 'Check that the manifest export is a valid object.',
      }),
    ];
  }

  const pluginId = (typeof manifest.id === 'string' ? manifest.id : '') || '<unnamed>';

  if (!manifest.id || typeof manifest.id !== 'string') {
    out.push(error('manifest/missing-id', 'A plugin manifest needs an id.', { fix: `Add \`id: '@scope/name'\`.` }));
  }
  // describeError(), not the raw value, `?? ''`, or String(): RegExp#test and a template literal both
  // call the engine's internal ToString on their argument, which THROWS for a Symbol (`manifest.version`
  // is untrusted manifest data, so this is reachable). String() is not the fix either — it throws in
  // turn for a null-prototype value and for a value with a throwing `Symbol.toStringTag` getter, both
  // equally reachable here. describeError is the one of the three that is actually total: same text as
  // String() for every value that was already safe (including `undefined`, which stringifies to
  // "undefined" either way), and no crash for the value shapes that were not.
  const versionText = describeError(manifest.version);
  if (!SEMVER.test(versionText)) {
    out.push(
      error('manifest/bad-version', `Version "${versionText}" is not semver (major.minor.patch).`, {
        pluginId,
      }),
    );
  }
  if (!manifest.engine) {
    out.push(
      error('manifest/missing-engine', 'A plugin must declare the kernel range it needs.', {
        pluginId,
        fix: `Add \`engine: '^0.1.0'\`.`,
      }),
    );
  }

  // Plugin-level settings reach schema/validate.ts with no contribution involved at all, so a bad
  // field here is checked independently of the points/contributes loops below.
  if (manifest.settings !== undefined) {
    checkSchemaFields(manifest.settings, out, { pluginId }, 'manifest/bad-field-schema');
  }

  for (const [pointId, point] of Object.entries(manifest.points ?? {})) {
    // Defensive: point may be null or not a plain object
    if (!isPlainObject(point)) {
      out.push(
        error('manifest/bad-point-schema', `Point "${pointId}" has no usable schema.`, {
          pluginId,
          pointId,
          fix: 'Declare a schema object (an empty `{}` is legal — a point may take no settings).',
        }),
      );
      continue;
    }

    if (!point.doc) {
      out.push(
        error('manifest/missing-doc', `Point "${pointId}" has no documentation.`, {
          pluginId,
          pointId,
          fix: 'Describe what plugs in here — the IDE and the agent both read this text.',
        }),
      );
    }

    // describeError(), not the raw value: a hostile phase/arity (a Symbol, a null-prototype value)
    // must not throw inside the message below, for the same reason manifest.version is describeError'd
    // above. Comparing the DESCRIBED text against VALID_PHASES/VALID_ARITIES is safe regardless of the
    // original value's type, and a missing phase/arity (`undefined`) is refused the same way a wrong
    // one is — spec §5.2(4) says a point belongs to exactly one phase; "unspecified" is not a phase.
    const phaseText = describeError(point.phase);
    if (!VALID_PHASES.includes(phaseText as Phase)) {
      out.push(
        error(
          'manifest/bad-phase',
          `Point "${pointId}" has phase "${phaseText}", which is not one of: ${VALID_PHASES.join(', ')}.`,
          { pluginId, pointId, fix: `Set phase to one of: ${VALID_PHASES.join(', ')}.` },
        ),
      );
    }

    const arityText = describeError(point.arity);
    if (!VALID_ARITIES.includes(arityText as Arity)) {
      out.push(
        error(
          'manifest/bad-arity',
          `Point "${pointId}" has arity "${arityText}", which is not one of: ${VALID_ARITIES.join(', ')}.`,
          { pluginId, pointId, fix: `Set arity to one of: ${VALID_ARITIES.join(', ')}.` },
        ),
      );
    }

    // Check schema specifically - must be a plain object
    if (!isPlainObject(point.schema)) {
      out.push(
        error('manifest/bad-point-schema', `Point "${pointId}" has no usable schema.`, {
          pluginId,
          pointId,
          fix: 'Declare a schema object (an empty `{}` is legal — a point may take no settings).',
        }),
      );
    } else {
      checkSchemaFields(point.schema, out, { pluginId, pointId }, 'manifest/bad-field-schema');
      if (Object.hasOwn(point.schema, 'enabled')) {
        out.push(
          warning(
            'manifest/enabled-collision',
            `Point "${pointId}"'s schema declares a field named "enabled", which collides with the structural per-contribution "enabled" flag project.json already uses to switch a contribution on or off.`,
            {
              pluginId,
              pointId,
              path: 'enabled',
              fix: 'Rename this field (e.g. to "autoTrigger") — "enabled" already means something else.',
            },
          ),
        );
      }
    }
  }

  for (const [pointId, list] of Object.entries(manifest.contributes ?? {})) {
    // Defensive: list may not be iterable. Named manifest/bad-contribution-LIST, deliberately not
    // manifest/bad-contributionS (a former one-character difference from the ELEMENT-shaped code just
    // below) — the two report unrelated conditions (the whole list vs. one entry in it) and should not
    // be distinguishable only by a reader noticing a missing "s".
    if (!Array.isArray(list)) {
      out.push(
        error('manifest/bad-contribution-list', `Contributions to "${pointId}" must be an array.`, {
          pluginId,
          pointId,
          fix: 'Change it to an array of contribution objects.',
        }),
      );
      continue;
    }

    const seen = new Set<string>();
    for (const contribution of list) {
      // Defensive: contribution may be null or not a plain object
      if (!isPlainObject(contribution)) {
        out.push(
          error('manifest/bad-contribution', `Contribution in "${pointId}" is not a valid contribution object.`, {
            pluginId,
            pointId,
            fix: 'Ensure all contributions are plain objects with an id, doc, and create function.',
          }),
        );
        continue;
      }

      // Same reasoning as manifest.version above: contribution.id is untrusted manifest data, and a
      // Symbol id would otherwise throw inside the very first template literal that names it — as
      // would a null-prototype id or one with a throwing Symbol.toStringTag getter, which is why this
      // is describeError() rather than String().
      const contributionId = typeof contribution.id === 'string' ? contribution.id : describeError(contribution.id);

      if (seen.has(contributionId)) {
        out.push(
          error('manifest/duplicate-contribution', `Two contributions to "${pointId}" share the id "${contributionId}".`, {
            pluginId,
            pointId,
            contributionId,
          }),
        );
      }
      seen.add(contributionId);

      if (!contribution.doc) {
        out.push(
          error('manifest/missing-doc', `Contribution "${contributionId}" has no documentation.`, {
            pluginId,
            pointId,
            contributionId,
            fix: 'Describe what it does — the IDE and the agent both read this text.',
          }),
        );
      }

      // `create` is the one EXECUTABLE requirement on a Contribution — everything else here is
      // metadata. Pre-fix, a missing or non-function `create` passed both this check and resolvePlan
      // with zero diagnostics, appeared in the plan and the snapshot as an ordinary valid entry, and
      // only failed once `activatePoint` actually tried to call it. `doc` (prose) was validated above;
      // the thing that actually has to run was not.
      if (typeof contribution.create !== 'function') {
        out.push(
          error(
            'manifest/bad-create',
            `Contribution "${contributionId}" has no create() function.`,
            {
              pluginId,
              pointId,
              contributionId,
              fix: "Add `create: () => import('./yourModule')` (or an equivalent lazy factory loader).",
            },
          ),
        );
      }

      if (contribution.schema !== undefined) {
        checkSchemaFields(
          contribution.schema,
          out,
          { pluginId, pointId, contributionId },
          'manifest/bad-field-schema',
        );
        if (isPlainObject(contribution.schema) && Object.hasOwn(contribution.schema, 'enabled')) {
          out.push(
            warning(
              'manifest/enabled-collision',
              `Contribution "${contributionId}"'s schema declares a field named "enabled", which collides with the structural per-contribution "enabled" flag project.json already uses to switch a contribution on or off.`,
              {
                pluginId,
                pointId,
                contributionId,
                path: 'enabled',
                fix: 'Rename this field (e.g. to "autoTrigger") — "enabled" already means something else.',
              },
            ),
          );
        }
      }
    }
  }

  return out;
}
