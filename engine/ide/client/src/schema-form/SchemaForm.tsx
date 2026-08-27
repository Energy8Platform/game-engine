import Schema from 'schemastery';
import { Field, label, needsRestart, type SchemaNode } from './fields';

export interface SchemaFormProps {
  /**
   * The row this form belongs to (`CompositionRow.id`). Mixed into every
   * field's DOM id so two rows whose schemas both declare a field of the
   * same name (e.g. two plugins each with a `speed`) don't collide —
   * without this, both would render `id="field-speed"`, the second
   * `<label>` would steal focus onto the first row's `<input>`, and
   * Playwright's `getByLabel` (what the e2e suite uses) would go ambiguous
   * under strict mode.
   */
  rowId: string;
  /**
   * The raw `toJSON()` output from `CompositionRow.schema` — schemastery's
   * deduped `{ uid, refs }` reference graph, not the flat `{ type, dict,
   * meta }` tree `fields.tsx` walks. Rebuilding it with `new Schema(json)`
   * restores the flat shape (`.dict`, `.meta`, `.list`) that reading it
   * directly would leave `undefined`.
   */
  schema: unknown;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}

/**
 * Rebuilds the reference-graph JSON into a schemastery `Schema` instance.
 * A row can legitimately carry `schema: null`, and a schema authored by a
 * plugin nobody has ever seen can be malformed — both must render nothing
 * rather than throw.
 */
function rebuild(schema: unknown): SchemaNode | null {
  if (schema == null) return null;
  try {
    return new Schema(schema as never) as unknown as SchemaNode;
  } catch {
    return null;
  }
}

export function SchemaForm({ rowId, schema, value, onChange }: SchemaFormProps) {
  const node = rebuild(schema);
  if (!node?.dict) return null;

  // A dict entry can point at a uid that isn't in the graph's `refs` (a
  // dangling reference from a truncated or hand-edited schema) — rebuilding
  // then leaves that entry `undefined` rather than dropping the key. Reading
  // it as a live SchemaNode further down (`label()` etc.) would throw, so
  // filter those out here and render every entry that actually resolved.
  const fields = Object.entries(node.dict).filter(
    (entry): entry is [string, SchemaNode] => entry[1] != null,
  );

  return (
    <div className="e8-schema-form">
      {fields.map(([key, child]) => {
        const id = `field-${rowId}-${key}`;
        return (
          <div className="e8-field" key={key}>
            <label htmlFor={id}>{label(child, key)}</label>
            <Field
              id={id}
              node={child}
              value={value[key]}
              onChange={(next) => onChange({ ...value, [key]: next })}
            />
            {/* This badge reflects what the plugin declared via
                `extra: { applies: 'restart' }` — not a difference in host
                behaviour. The host currently tears down and re-applies the
                fiber for every edit, flagged field or not (see
                `composition.ts`'s `update()`), so the badge marks the
                plugin author's stated intent, not a distinct code path
                today. */}
            {needsRestart(child) ? <span className="e8-badge">перезапуск</span> : null}
          </div>
        );
      })}
    </div>
  );
}
