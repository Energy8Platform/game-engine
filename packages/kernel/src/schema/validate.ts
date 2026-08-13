import { type Diagnostic, error, warning } from '../diagnostics';
import type { EnumOption, FieldSchema, Schema } from './types';

export interface ValidateResult {
  /** Every key of the schema, always present: valid input, or the field's default. */
  value: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

/** Deepest nesting `defaultOf`/`validate` will walk. A schema this deep is a construction bug —
 *  almost certainly a cycle — and the cap turns unbounded recursion into a diagnostic. */
export const MAX_SCHEMA_DEPTH = 32;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

/** True for values whose structure this module is willing to copy: plain objects and arrays.
 *  A Date, a RegExp, a Map or a class instance is NOT plain — rebuilding it from its entries
 *  would destroy it, so it is passed through by reference instead. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True for a value that is at least shaped like a `FieldSchema` — a plain object carrying a
 *  string `kind`. This is deliberately shallow (it does not check `kind` is one of the known
 *  variants): its only job is to make it safe to read `field.kind` and friends. A manifest author
 *  writing `schema: { speed: null }`, or a `list`/`object` field whose `of`/`fields` is likewise
 *  malformed, must degrade to a diagnostic here rather than crash — `checkManifestShape` reports
 *  the same shape at the manifest boundary, but this is the guard that keeps `defaultOf` and
 *  `validateField` never-throwing regardless of whether that boundary check ran. */
export function isUsableField(field: unknown): field is FieldSchema {
  return isPlainObject(field) && typeof (field as { kind?: unknown }).kind === 'string';
}

/** Structural copy of a default value.
 *
 *  Defaults live on a shared Schema object, so handing a caller a reference into one would let a
 *  mutation of resolved settings corrupt every other contribution's defaults.
 *
 *  CONTRACT: schema defaults must be JSON-shaped data. `Schema` travels inside `PlanSnapshot`,
 *  which the IDE and the agent read over RPC and which is required to survive a JSON round trip —
 *  so a Date, a Map or a cycle in a default is already outside the contract. This function's job
 *  is to copy what is in contract and to neither crash nor destroy what is not: non-plain values
 *  pass through by reference, and recursion stops at MAX_SCHEMA_DEPTH.
 */
export function cloneValue<T>(value: T, depth = 0): T {
  if (depth >= MAX_SCHEMA_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => cloneValue(item, depth + 1)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneValue(v, depth + 1);
    return out as T;
  }
  return value;
}

/**
 * An `enum` field's usable options: a real array, filtered down to elements shaped like
 * `{ value: string }`.
 *
 * `options` is typed as required on every `enum` field, but nothing enforces that at the manifest
 * boundary. `{ kind: 'enum' }` with no `options` at all, `options: null`, or `options: 'abc'` all
 * reach here as ordinary manifest data — most plausibly from a plain typo (`option:` for
 * `options:`) in a point schema, a contribution schema, or `manifest.settings`. A non-array
 * `options` is silently treated as an empty option set here (the caller decides whether that is
 * worth a diagnostic); an unusable ELEMENT inside a genuine array (`options: [null]`) is dropped
 * rather than crashing every other option alongside it. Never throws for any input.
 */
function enumOptionsOf(options: unknown): EnumOption[] {
  if (!Array.isArray(options)) return [];
  return options.filter((o): o is EnumOption => isPlainObject(o) && typeof o.value === 'string');
}

/** The value a field falls back to: its declared default, or the zero value of its kind. */
export function defaultOf(field: FieldSchema, depth = 0, diagnostics?: Diagnostic[], path?: string): unknown {
  // A field that is not even shaped like a FieldSchema (null, a string, an array, an object with
  // no `kind`) cannot be defaulted meaningfully. Report it where there is somewhere to report it,
  // and fall back to the same '' every unrecognized kind already falls back to below — but do so
  // BEFORE any `field.kind` read, since that is exactly what a null/undefined field would crash on.
  if (!isUsableField(field)) {
    if (diagnostics && path !== undefined) {
      diagnostics.push(error('schema/bad-field', `Schema field "${path}" is not a usable field definition.`, { path }));
    }
    return '';
  }

  if (depth >= MAX_SCHEMA_DEPTH) {
    // Stop descending to prevent unbounded recursion from cycles.
    if (diagnostics && path !== undefined) {
      diagnostics.push(error('schema/too-deep', `Schema nesting exceeds ${MAX_SCHEMA_DEPTH} levels — this is usually a cycle.`, { path }));
    }
    if (field.kind === 'object') return {};
    if (field.kind === 'list') return [];
    return '';
  }

  if (field.kind === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(field.fields ?? {})) out[key] = defaultOf(sub, depth + 1, diagnostics, path ? `${path}.${key}` : key);
    return out;
  }
  if (field.kind === 'list') return field.default ? cloneValue(field.default, depth) : [];
  if (field.default !== undefined) return cloneValue(field.default, depth);
  if (field.kind === 'number') return 0;
  if (field.kind === 'boolean') return false;
  if (field.kind === 'enum') {
    // A non-array `options` (absent, null, a string, ...) is reported here — never thrown on — when
    // there is somewhere to report it. `checkManifestShape` reports the identical condition at the
    // manifest boundary (see `checkSchemaFields` in manifest/define.ts); this is the guard that keeps
    // this function never-throwing regardless of whether that boundary check ran.
    if (!Array.isArray(field.options) && diagnostics && path !== undefined) {
      diagnostics.push(
        error('schema/bad-enum-options', `Enum field "${path}" has no usable "options" array.`, {
          path,
          fix: 'Add `options: [{ value: "...", label: "..." }, ...]` to the field.',
        }),
      );
    }
    return enumOptionsOf(field.options)[0]?.value ?? '';
  }
  return '';
}

/**
 * Validate a settings object against a schema. Never throws: bad input yields the field's default
 * plus a diagnostic, so a mistyped setting degrades one control instead of failing a whole game.
 */
export function validate(input: unknown, schema: Schema, base = '', depth = 0): ValidateResult {
  const diagnostics: Diagnostic[] = [];
  const source = isRecord(input) ? input : {};
  // `schema` is typed as required, but a hostile call site can still hand this a null/non-object
  // value — most reachably `field.fields` on a malformed `object`-kind field (`fields: null`).
  // Normalizing once here, rather than at every call site, is what keeps that reachable without a
  // throw regardless of which of the two Object.entries(schema) branches below runs.
  const safeSchema: Schema = isPlainObject(schema) ? schema : {};

  if (depth >= MAX_SCHEMA_DEPTH) {
    diagnostics.push(
      error('schema/too-deep', `Schema nesting exceeds ${MAX_SCHEMA_DEPTH} levels — this is usually a cycle.`, {
        path: base || undefined,
      }),
    );
    const value: Record<string, unknown> = {};
    for (const [key] of Object.entries(safeSchema)) {
      value[key] = defaultOf(safeSchema[key], depth);
    }
    return { value, diagnostics };
  }

  if (input !== undefined && input !== null && !isRecord(input)) {
    diagnostics.push(
      error('schema/not-an-object', `Expected an object of settings, got ${typeName(input)}.`, {
        path: base || undefined,
      }),
    );
  }

  const value: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(safeSchema)) {
    const path = base ? `${base}.${key}` : key;
    value[key] = key in source ? validateField(source[key], field, path, diagnostics, depth) : defaultOf(field, depth, diagnostics, path);
  }

  for (const key of Object.keys(source)) {
    if (key in safeSchema) continue;
    diagnostics.push(
      warning('schema/unknown-field', `Unknown setting "${key}" — it will be ignored.`, {
        path: base ? `${base}.${key}` : key,
        fix: `Remove it, or declare "${key}" in the schema of the plugin that owns this setting.`,
      }),
    );
  }

  return { value, diagnostics };
}

function validateField(raw: unknown, field: FieldSchema, path: string, out: Diagnostic[], depth = 0): unknown {
  // Same guard as defaultOf, checked first: field.kind is read unconditionally a few lines down
  // (the switch), so a null/malformed field must be caught before that, not inside defaultOf's own
  // fallback path (which would double-report — defaultOf calls below assume `field` already passed
  // this check).
  if (!isUsableField(field)) {
    out.push(error('schema/bad-field', `Schema field "${path}" is not a usable field definition.`, { path }));
    return '';
  }

  if (raw === undefined || raw === null) return defaultOf(field, depth, out, path);

  if (depth >= MAX_SCHEMA_DEPTH) {
    out.push(error('schema/too-deep', `Schema nesting exceeds ${MAX_SCHEMA_DEPTH} levels — this is usually a cycle.`, { path }));
    return defaultOf(field, depth);
  }

  switch (field.kind) {
    case 'number': {
      if (typeof raw !== 'number' || Number.isNaN(raw)) {
        out.push(error('schema/type-mismatch', `Expected a number, got ${typeName(raw)}.`, { path }));
        return defaultOf(field, depth, out, path);
      }
      let n = raw;
      if (field.min !== undefined && n < field.min) {
        out.push(
          warning('schema/out-of-range', `${n} is below the minimum ${field.min}; clamped.`, { path }),
        );
        n = field.min;
      }
      if (field.max !== undefined && n > field.max) {
        out.push(
          warning('schema/out-of-range', `${n} is above the maximum ${field.max}; clamped.`, { path }),
        );
        n = field.max;
      }
      return n;
    }

    case 'boolean': {
      if (typeof raw !== 'boolean') {
        out.push(error('schema/type-mismatch', `Expected true or false, got ${typeName(raw)}.`, { path }));
        return defaultOf(field, depth, out, path);
      }
      return raw;
    }

    case 'enum': {
      // A non-array `options` is reported here, once, as its own diagnostic — distinct from
      // schema/not-an-option below, which is about the VALUE being wrong, not the options list
      // itself being unusable. The fallback to defaultOf() below deliberately omits `out`/`path`
      // (the same idiom `validate()` uses at MAX_SCHEMA_DEPTH): defaultOf's own enum branch would
      // otherwise re-detect this exact non-array `options` and push a second, duplicate diagnostic.
      if (!Array.isArray(field.options)) {
        out.push(
          error('schema/bad-enum-options', `Enum field "${path}" has no usable "options" array.`, {
            path,
            fix: 'Add `options: [{ value: "...", label: "..." }, ...]` to the field.',
          }),
        );
        return defaultOf(field, depth);
      }
      const allowed = enumOptionsOf(field.options).map((o) => o.value);
      if (typeof raw !== 'string' || !allowed.includes(raw)) {
        out.push(
          error('schema/not-an-option', `"${String(raw)}" is not one of: ${allowed.join(', ')}.`, {
            path,
            fix: `Use one of: ${allowed.join(', ')}.`,
          }),
        );
        return defaultOf(field, depth, out, path);
      }
      return raw;
    }

    case 'object': {
      const nested = validate(raw, field.fields, path, depth + 1);
      out.push(...nested.diagnostics);
      return nested.value;
    }

    case 'list': {
      if (!Array.isArray(raw)) {
        out.push(error('schema/type-mismatch', `Expected a list, got ${typeName(raw)}.`, { path }));
        return defaultOf(field, depth, out, path);
      }
      return raw.map((item, i) => validateField(item, field.of, `${path}[${i}]`, out, depth + 1));
    }

    default: {
      // Every remaining kind is a plain string here; its meaning belongs to a higher layer.
      if (typeof raw !== 'string') {
        out.push(error('schema/type-mismatch', `Expected a string, got ${typeName(raw)}.`, { path }));
        return defaultOf(field, depth, out, path);
      }
      return raw;
    }
  }
}
