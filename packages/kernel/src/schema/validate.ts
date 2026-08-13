import { type Diagnostic, error, warning } from '../diagnostics';
import type { FieldSchema, Schema } from './types';

export interface ValidateResult {
  /** Every key of the schema, always present: valid input, or the field's default. */
  value: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

/** The value a field falls back to: its declared default, or the zero value of its kind. */
export function defaultOf(field: FieldSchema): unknown {
  if (field.kind === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, sub] of Object.entries(field.fields)) out[key] = defaultOf(sub);
    return out;
  }
  if (field.kind === 'list') return field.default ? [...field.default] : [];
  if (field.default !== undefined) return field.default;
  if (field.kind === 'number') return 0;
  if (field.kind === 'boolean') return false;
  if (field.kind === 'enum') return field.options[0]?.value ?? '';
  return '';
}

/**
 * Validate a settings object against a schema. Never throws: bad input yields the field's default
 * plus a diagnostic, so a mistyped setting degrades one control instead of failing a whole game.
 */
export function validate(input: unknown, schema: Schema, base = ''): ValidateResult {
  const diagnostics: Diagnostic[] = [];
  const source = isRecord(input) ? input : {};

  if (input !== undefined && input !== null && !isRecord(input)) {
    diagnostics.push(
      error('schema/not-an-object', `Expected an object of settings, got ${typeName(input)}.`, {
        path: base || undefined,
      }),
    );
  }

  const value: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const path = base ? `${base}.${key}` : key;
    value[key] = key in source ? validateField(source[key], field, path, diagnostics) : defaultOf(field);
  }

  for (const key of Object.keys(source)) {
    if (key in schema) continue;
    diagnostics.push(
      warning('schema/unknown-field', `Unknown setting "${key}" — it will be ignored.`, {
        path: base ? `${base}.${key}` : key,
        fix: `Remove it, or declare "${key}" in the schema of the plugin that owns this setting.`,
      }),
    );
  }

  return { value, diagnostics };
}

function validateField(raw: unknown, field: FieldSchema, path: string, out: Diagnostic[]): unknown {
  if (raw === undefined || raw === null) return defaultOf(field);

  switch (field.kind) {
    case 'number': {
      if (typeof raw !== 'number' || Number.isNaN(raw)) {
        out.push(error('schema/type-mismatch', `Expected a number, got ${typeName(raw)}.`, { path }));
        return defaultOf(field);
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
        return defaultOf(field);
      }
      return raw;
    }

    case 'enum': {
      const allowed = field.options.map((o) => o.value);
      if (typeof raw !== 'string' || !allowed.includes(raw)) {
        out.push(
          error('schema/not-an-option', `"${String(raw)}" is not one of: ${allowed.join(', ')}.`, {
            path,
            fix: `Use one of: ${allowed.join(', ')}.`,
          }),
        );
        return defaultOf(field);
      }
      return raw;
    }

    case 'object': {
      const nested = validate(raw, field.fields, path);
      out.push(...nested.diagnostics);
      return nested.value;
    }

    case 'list': {
      if (!Array.isArray(raw)) {
        out.push(error('schema/type-mismatch', `Expected a list, got ${typeName(raw)}.`, { path }));
        return defaultOf(field);
      }
      return raw.map((item, i) => validateField(item, field.of, `${path}[${i}]`, out));
    }

    default: {
      // Every remaining kind is a plain string here; its meaning belongs to a higher layer.
      if (typeof raw !== 'string') {
        out.push(error('schema/type-mismatch', `Expected a string, got ${typeName(raw)}.`, { path }));
        return defaultOf(field);
      }
      return raw;
    }
  }
}
