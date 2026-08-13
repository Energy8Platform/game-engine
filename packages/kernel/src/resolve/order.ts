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

  // Guard against non-array input and non-manifest items
  if (!Array.isArray(manifests)) {
    return { order: [], diagnostics };
  }

  // Filter out null, undefined, and non-objects; validate basic shape
  const validManifests: PluginManifest[] = [];
  for (const item of manifests) {
    if (
      item &&
      typeof item === 'object' &&
      'id' in item &&
      typeof item.id === 'string' &&
      item.id.length > 0 &&
      'version' in item &&
      'engine' in item
    ) {
      validManifests.push(item as PluginManifest);
    }
  }

  const byId = new Map(validManifests.map((m) => [m.id, m]));

  const deps = new Map<string, string[]>();
  for (const manifest of validManifests) {
    const present: string[] = [];
    const dependsOnRecord = manifest.dependsOn;

    // Guard against dependsOn being null or not an object
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
      error('resolve/dependency-cycle', `These plugins depend on each other in a cycle: ${cycle.join(' → ')}.`, {
        fix: 'Break the cycle by removing one of the dependsOn entries.',
      }),
    );
  }

  return { order, diagnostics };
}
