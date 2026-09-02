/**
 * The layering RULE for `e8.profile.yml` + `e8.patch.yml`: bundles in
 * profile order, then the profile's own patch, then the home patch, then
 * `--patch` from the CLI. A pure function — no `fs`, no `cordis`, no
 * `yaml`. Reading files and deciding which patch layers exist is the
 * host's job, three tasks later; this only knows how to combine what it is
 * handed.
 *
 * Failures are data: a missing bundle, a patch addressing a row that does
 * not exist, or two bundles claiming the same id are each a `Diagnostic`
 * in the returned array, never a throw. The function always returns the
 * best composition it could build.
 */
import {
  type Diagnostic,
  diagnostic,
  type PatchRow,
  type Profile,
  type ResolvedComposition,
  type ResolvedRow,
} from '@energy8engine/contracts';

/** One bundle's rows, as `e8.bundle.yml` (or the fixture standing in for it) declares them. */
export interface Bundle {
  name: string;
  rows: { id: string; name: string; config?: Record<string, unknown> }[];
}

export function resolveComposition(input: {
  profile: Profile;
  bundles: Map<string, Bundle>;
  patches: { layer: string; rows: PatchRow[] }[];
}): { composition: ResolvedComposition; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const rows = new Map<string, ResolvedRow>();

  for (const bundleName of input.profile.bundles) {
    const bundle = input.bundles.get(bundleName);
    if (bundle === undefined) {
      diagnostics.push(
        diagnostic(
          'error',
          bundleName,
          'profile',
          `the profile lists bundle "${bundleName}", but it was not found`,
          `remove "${bundleName}" from e8.profile.yml, or install it`,
        ),
      );
      continue;
    }

    for (const row of bundle.rows) {
      if (rows.has(row.id)) {
        diagnostics.push(
          diagnostic(
            'error',
            row.id,
            'profile',
            `row "${row.id}" is placed by more than one bundle; "${bundleName}" wins`,
            `give one of the bundles placing "${row.id}" a different row id`,
          ),
        );
      }
      rows.set(row.id, {
        id: row.id,
        name: row.name,
        config: row.config ?? {},
        from: `bundle:${bundleName}`,
      });
    }
  }

  for (const { layer, rows: patchRows } of input.patches) {
    for (const patchRow of patchRows) {
      if (patchRow.remove === true) {
        rows.delete(patchRow.id);
        continue;
      }

      const existing = rows.get(patchRow.id);
      if (existing === undefined && patchRow.name === undefined) {
        diagnostics.push(
          diagnostic(
            'error',
            patchRow.id,
            layer,
            `patch addresses row "${patchRow.id}", which no bundle placed, and gives no "name" to insert it`,
            `add a "name" to insert "${patchRow.id}" as a new row, or fix the id`,
          ),
        );
        continue;
      }

      rows.set(patchRow.id, {
        id: patchRow.id,
        name: patchRow.name ?? existing!.name,
        config: patchRow.config ?? {},
        from: layer,
      });
    }
  }

  return { composition: { rows: [...rows.values()] }, diagnostics };
}
