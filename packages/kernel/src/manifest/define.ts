import { type Diagnostic, error } from '../diagnostics';
import { isPlainObject, isUsableField, MAX_SCHEMA_DEPTH } from '../schema/validate';
import type { PluginManifest } from './types';

const SEMVER = /^\d+\.\d+\.\d+$/;

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
      }
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
  // String(), not the raw value or `?? ''`: RegExp#test and a template literal both call the engine's
  // internal ToString on their argument, which THROWS for a Symbol (`manifest.version` is untrusted
  // manifest data, so this is reachable). String() is ToString's non-throwing cousin — same text for
  // every value that was already safe (including `undefined`, which stringifies to "undefined" either
  // way), and no crash for the one value shape that was not.
  const versionText = String(manifest.version);
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
    }
  }

  for (const [pointId, list] of Object.entries(manifest.contributes ?? {})) {
    // Defensive: list may not be iterable
    if (!Array.isArray(list)) {
      out.push(
        error('manifest/bad-contributions', `Contributions to "${pointId}" must be an array.`, {
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
      // Symbol id would otherwise throw inside the very first template literal that names it.
      const contributionId = typeof contribution.id === 'string' ? contribution.id : String(contribution.id);

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

      if (contribution.schema !== undefined) {
        checkSchemaFields(
          contribution.schema,
          out,
          { pluginId, pointId, contributionId },
          'manifest/bad-field-schema',
        );
      }
    }
  }

  return out;
}
