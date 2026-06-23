/** Lua empty tables decode as {} — turn a possibly-{} value into a real array. */
export function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Apply asArray() to the named fields of a record (Lua {} → []). Optional helper for a game's normalizer. */
export function coerceLuaArrays<T extends Record<string, unknown>>(obj: T, fields: string[]): T {
  const out: Record<string, unknown> = { ...obj };
  for (const f of fields) out[f] = asArray(out[f]);
  return out as T;
}
