import { type Diagnostic, error } from '../diagnostics';
import type { PluginManifest } from '../manifest/types';

export interface OrderResult {
  /** Plugin ids, dependencies first. Excludes any plugin caught in a cycle. */
  order: string[];
  diagnostics: Diagnostic[];
}

/**
 * Kahn's algorithm with the ready set kept sorted by id.
 *
 * The sort is not cosmetic: the same project must always produce the same plan, or a snapshot the
 * IDE saved and a snapshot the build computed would differ for no reason.
 *
 * A cycle does not abort the resolution. The plugins outside it are still usable, and the player
 * sees one precise error instead of a blank screen.
 */
export function orderPlugins(manifests: readonly PluginManifest[]): OrderResult {
  const diagnostics: Diagnostic[] = [];

  // Guard against non-array input
  if (!Array.isArray(manifests)) {
    return { order: [], diagnostics };
  }

  // Group items by id. First pass collects items and validates ids.
  const byIdGroups = new Map<string, PluginManifest[]>();
  for (const item of manifests) {
    // Skip non-objects and null
    if (!item || typeof item !== 'object') {
      continue;
    }

    // Check if id is a non-empty string
    if (!('id' in item) || typeof item.id !== 'string' || item.id.length === 0) {
      diagnostics.push(
        error('resolve/invalid-manifest', `A manifest has an invalid or missing id and was dropped.`, {
          fix: 'Each manifest must have a non-empty string id.',
        }),
      );
      continue;
    }

    const id = item.id;
    if (!byIdGroups.has(id)) {
      byIdGroups.set(id, []);
    }
    byIdGroups.get(id)!.push(item as PluginManifest);
  }

  // Resolve duplicates by picking the one with the most dependencies (most information).
  // This makes the choice deterministic and independent of input order.
  const byId = new Map<string, PluginManifest>();
  for (const [id, group] of byIdGroups) {
    if (group.length === 1) {
      byId.set(id, group[0]);
    } else {
      // Sort by number of dependencies (descending), pick first
      const winner = group.sort(
        (a, b) => Object.keys(b.dependsOn ?? {}).length - Object.keys(a.dependsOn ?? {}).length,
      )[0];
      byId.set(id, winner);
      // Emit a diagnostic for the collision (one per id, not per duplicate)
      diagnostics.push(
        error('resolve/duplicate-plugin-id', `Plugin id "${id}" is declared by more than one manifest; only the first is used.`, {
          pluginId: id,
          fix: 'Remove the duplicate, or give one of them a distinct id.',
        }),
      );
    }
  }

  const deps = new Map<string, string[]>();
  for (const manifest of byId.values()) {
    const present: string[] = [];
    const dependsOnRecord = manifest.dependsOn;

    // Guard against dependsOn being null, not an object, or an array
    if (dependsOnRecord && typeof dependsOnRecord === 'object' && !Array.isArray(dependsOnRecord)) {
      for (const depId of Object.keys(dependsOnRecord)) {
        if (!byId.has(depId)) {
          diagnostics.push(
            error('resolve/missing-dependency', `Plugin "${manifest.id}" depends on "${depId}", which is not installed.`, {
              pluginId: manifest.id,
              fix: `Add "${depId}" to the project, or drop the dependency.`,
            }),
          );
          continue;
        }
        present.push(depId);
      }
    }
    deps.set(manifest.id, present);
  }

  const remaining = new Set(byId.keys());
  const order: string[] = [];

  for (;;) {
    const ready = [...remaining]
      .filter((id) => (deps.get(id) ?? []).every((d) => !remaining.has(d)))
      .sort();
    if (ready.length === 0) break;
    for (const id of ready) {
      order.push(id);
      remaining.delete(id);
    }
  }

  if (remaining.size > 0) {
    const cycle = [...remaining].sort();
    diagnostics.push(
      error('resolve/dependency-cycle', `These plugins could not be ordered because of a dependency cycle among them or on one: ${cycle.join(', ')}.`, {
        fix: 'Inspect their dependsOn entries and break the loop.',
      }),
    );
  }

  return { order, diagnostics };
}
