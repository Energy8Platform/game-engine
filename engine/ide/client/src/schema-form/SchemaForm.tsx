import Schema from 'schemastery';
import {
  FormOptions,
  ObjectFields,
  Pickers,
  type CommitMode,
  type FieldProps,
  type SchemaNode,
} from './fields';

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
  /**
   * A field whose key is `Object.hasOwn` in its parent object VALUE (not
   * merely "not undefined" — a patch that explicitly sets `null`/`0`/
   * `false` still counts) gets a `set in the patch` marker and a `reset`
   * button that writes the parent object without that key; a group
   * (nested object/dict/array) resets the same way via its legend. See
   * `ObjectFields`/`FormOptions`. Default `false` — an editor row's own
   * config (Composition's editor tab) isn't reset this way, only a GAME
   * row's is.
   */
  resettable?: boolean;
  /**
   * Render only the object at this top-level schema key — its fields
   * directly, with no `<legend>` for the key itself (a Reels document row
   * whose whole `config` is one grid or win block). `onChange` still
   * receives the WHOLE value with that key replaced; a missing object at
   * `root` reads as `{}`. A `root` whose schema key isn't itself an
   * object renders nothing, same as a malformed schema elsewhere in this
   * file.
   */
  root?: string;
  /**
   * A custom editor for a NON-union node, keyed by its dotted path from
   * this form's value ROOT — stable regardless of `root` trimming what
   * renders, so `win.frameShake.onlyOnSymbols` still names that field
   * even when `root: 'win'`. A union at that path (a literal-or-value
   * switch, say) still draws its own switch; the override only replaces
   * the value member's editor. See `Field`. The override is handed the RAW
   * `value` (`undefined` when unset) and the `node`: applying
   * `node.meta.default` to an unset value is its own job, same as every
   * stock editor does for itself.
   */
  fieldOverrides?: Record<string, (props: FieldProps) => JSX.Element>;
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
const NO_OVERRIDES: Record<string, (props: FieldProps) => JSX.Element> = {};

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
  resettable = false,
  root,
  fieldOverrides = NO_OVERRIDES,
}: SchemaFormProps) {
  const node = rebuild(schema);
  if (!node?.dict) return null;

  // `root`: draw `node.dict[root]`'s fields as if THEY were the form's own
  // top level (no legend for `root` itself), but `onChange` still replaces
  // the whole value, and every field's `path` still starts with `root` —
  // `fieldOverrides` is keyed from the value ROOT, not from what's drawn.
  const rootNode = root ? node.dict?.[root] : node;
  if (!rootNode?.dict) return null;
  const rootValue = root ? ((value[root] ?? {}) as Record<string, unknown>) : value;
  const rootOnChange = root
    ? (next: Record<string, unknown>) => onChange({ ...value, [root]: next })
    : onChange;

  return (
    <div className="e8-schema-form">
      <Pickers.Provider value={pickers}>
        <FormOptions.Provider value={{ resettable, fieldOverrides }}>
          <ObjectFields
            idPrefix={`field-${safeId(rowId)}`}
            node={rootNode}
            value={rootValue}
            onChange={rootOnChange}
            commit={commit}
            path={root ?? ''}
          />
        </FormOptions.Provider>
      </Pickers.Provider>
    </div>
  );
}
