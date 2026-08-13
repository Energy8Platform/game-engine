import { type Diagnostic, error } from '../diagnostics';
import { isPlainObject } from '../schema/validate';
import type { PluginManifest } from './types';

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Identity helper. Exists so plugin authors get inference and autocomplete on the manifest shape. */
export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest;
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
  if (!SEMVER.test(manifest.version ?? '')) {
    out.push(
      error('manifest/bad-version', `Version "${manifest.version}" is not semver (major.minor.patch).`, {
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

      if (seen.has(contribution.id)) {
        out.push(
          error('manifest/duplicate-contribution', `Two contributions to "${pointId}" share the id "${contribution.id}".`, {
            pluginId,
            pointId,
            contributionId: contribution.id,
          }),
        );
      }
      seen.add(contribution.id);

      if (!contribution.doc) {
        out.push(
          error('manifest/missing-doc', `Contribution "${contribution.id}" has no documentation.`, {
            pluginId,
            pointId,
            contributionId: contribution.id,
            fix: 'Describe what it does — the IDE and the agent both read this text.',
          }),
        );
      }
    }
  }

  return out;
}
