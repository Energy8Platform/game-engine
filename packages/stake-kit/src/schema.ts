import type { ZodTypeAny } from 'zod';

/**
 * Walk a zod schema and collect the property names whose schema is an array,
 * at any depth. Drives `coerceLuaArrays` so games never hand-maintain an
 * array-field list — the payload schema is the single source of truth.
 *
 * Touches zod's `_def` (semi-internal); isolated here so a zod upgrade only
 * affects this file. Pinned to zod v3.
 */
export function deriveArrayFields(schema: ZodTypeAny): Set<string> {
  const out = new Set<string>();

  const unwrap = (s: any): any => {
    let cur = s;
    while (cur && cur._def) {
      const tn = cur._def.typeName;
      if (tn === 'ZodOptional' || tn === 'ZodNullable' || tn === 'ZodDefault') cur = cur._def.innerType;
      else if (tn === 'ZodEffects') cur = cur._def.schema;
      else break;
    }
    return cur;
  };

  const visit = (s: any): void => {
    const node = unwrap(s);
    const tn = node && node._def && node._def.typeName;
    if (tn === 'ZodObject') {
      const shape = typeof node._def.shape === 'function' ? node._def.shape() : node.shape;
      for (const [key, child] of Object.entries(shape as Record<string, unknown>)) {
        const c = unwrap(child);
        if (c && c._def && c._def.typeName === 'ZodArray') {
          out.add(key);
          visit(c._def.type);
        } else {
          visit(c);
        }
      }
    } else if (tn === 'ZodArray') {
      visit(node._def.type);
    }
  };

  visit(schema);
  return out;
}
