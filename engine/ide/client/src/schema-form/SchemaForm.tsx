import Schema from 'schemastery';
import { ObjectFields, Pickers, type CommitMode, type SchemaNode } from './fields';

export interface SchemaFormProps {
  /**
   * The row this form belongs to (`CompositionRow.id`, a symbol id, …).
   * Mixed into every field's DOM id so two rows whose schemas both declare
   * a field of the same name (e.g. two plugins each with a `speed`) don't
   * collide — without this, both would render `id="field-speed"`, the
   * second `<label>` would steal focus onto the first row's `<input>`, and
   * Playwright's `getByLabel` (what the e2e suite uses) would go ambiguous
   * under strict mode. Sanitised before use (see `safeId`) — a symbol id
   * may legally carry a space or other punctuation a file stem allows,
   * which a raw DOM id must not.
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
  /** When number/string fields hand their value up — see `CommitMode`. Default `'change'`. */
  commit?: CommitMode;
  /**
   * By `meta.pick` name (`.extra('pick', 'scene')` on a string field), the
   * ids to offer: such a field renders as a `<select>` of them instead of a
   * text input. `asset` is called with the field's `meta.asset` extensions
   * (`.extra('asset', ['png'])`) and answers the project's file paths. A
   * field with no picker here stays a text input.
   */
  pickers?: Record<string, (arg?: unknown) => string[]>;
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

const NO_PICKERS: Record<string, () => string[]> = {};

/**
 * `rowId` becomes every field's id prefix (`id="field-<rowId>-<key>"`,
 * `aria-describedby="field-<rowId>-<key>-hint"`). A symbol id or node id
 * can carry any character a file stem allows, a space included — and a
 * literal space inside one DOM id makes `aria-describedby` parse as TWO
 * ids, breaking the hint's association for every field on the row. Replace
 * every character outside the id-safe set so this can't happen.
 */
function safeId(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, '_');
}

export function SchemaForm({
  rowId,
  schema,
  value,
  onChange,
  commit = 'change',
  pickers = NO_PICKERS,
}: SchemaFormProps) {
  const node = rebuild(schema);
  if (!node?.dict) return null;

  return (
    <div className="e8-schema-form">
      <Pickers.Provider value={pickers}>
        <ObjectFields
          idPrefix={`field-${safeId(rowId)}`}
          node={node}
          value={value}
          onChange={onChange}
          commit={commit}
        />
      </Pickers.Provider>
    </div>
  );
}
