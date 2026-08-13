import { type Diagnostic, error } from '../diagnostics';
import type { Schema } from './types';

export interface MergeContext {
  pluginId: string;
  pointId: string;
  contributionId: string;
}

export interface MergeResult {
  schema: Schema;
  diagnostics: Diagnostic[];
}

/**
 * Effective schema = point schema + contribution schema.
 *
 * A contribution may ADD fields but may not redefine one the point already owns. Allowing that
 * would let a single plugin quietly change the meaning of a setting shared by every other
 * contribution to the same point — the IDE would render one control whose behaviour depends on
 * which contribution is selected.
 */
export function mergeSchemas(
  point: Schema,
  contribution: Schema | undefined,
  ctx: MergeContext,
): MergeResult {
  const diagnostics: Diagnostic[] = [];
  const schema: Schema = { ...point };

  for (const [key, field] of Object.entries(contribution ?? {})) {
    if (key in point) {
      diagnostics.push(
        error('schema/field-conflict', `Field "${key}" is already defined by point "${ctx.pointId}".`, {
          ...ctx,
          path: key,
          fix: `Rename the contribution's field, or drop it and use the point's.`,
        }),
      );
      continue;
    }
    schema[key] = field;
  }

  return { schema, diagnostics };
}
