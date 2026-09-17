import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';

/**
 * When a text-like field hands its value up. `'change'` — every keystroke
 * (the IDE's own rows: an `update` frame over the socket is cheap).
 * `'blur'` — a draft while focused, one `onChange` on blur or Enter when
 * the value differs (a GAME row: each commit is a `PUT`, and on a cold row
 * a preview reload — typing `480` must not be three of them).
 * Boolean, union and dict fields are unaffected: a click is already one
 * commit, and the dict commits on blur regardless.
 */
export type CommitMode = 'change' | 'blur';

/** The parts of a rebuilt schemastery schema the form reads. */
export interface SchemaNode {
  type: string;
  value?: unknown;
  list?: SchemaNode[];
  dict?: Record<string, SchemaNode>;
  /** A `dict` node's value schema, or an `array` node's item schema. */
  inner?: SchemaNode;
  meta?: {
    default?: unknown;
    description?: string;
    min?: number;
    max?: number;
    step?: number;
    extra?: { applies?: 'restart' };
  };
}

export interface FieldProps {
  id: string;
  node: SchemaNode;
  value: unknown;
  onChange: (next: unknown) => void;
  commit: CommitMode;
  /** For a control with no `<label for>` of its own — a string item in an array. */
  ariaLabel?: string;
}

export function label(node: SchemaNode, key: string): string {
  return node.meta?.description ?? key;
}

export function needsRestart(node: SchemaNode): boolean {
  return node.meta?.extra?.applies === 'restart';
}

/** Union of constants — the only union shape Slice 0 renders. */
function constants(node: SchemaNode): string[] | null {
  if (node.type !== 'union' || !node.list) return null;
  const values = node.list.map((member) => member.value);
  return values.every((value) => typeof value === 'string') ? (values as string[]) : null;
}

/**
 * One labelled field per entry of an `object` node's `dict` — the body of
 * `SchemaForm`, and of every nested object inside it. Emits the WHOLE
 * `value` with the one key replaced, never a copy schemastery has filled
 * with defaults: the host replaces the row's config with what it is
 * handed, so what goes out is what the user has, plus the edit.
 */
export function ObjectFields({
  idPrefix,
  node,
  value,
  onChange,
  commit,
}: {
  idPrefix: string;
  node: SchemaNode;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  commit: CommitMode;
}) {
  // A dict entry can point at a uid that isn't in the graph's `refs` (a
  // dangling reference from a truncated or hand-edited schema) — rebuilding
  // then leaves that entry `undefined` rather than dropping the key. Reading
  // it as a live SchemaNode further down (`label()` etc.) would throw, so
  // filter those out here and render every entry that actually resolved.
  const fields = Object.entries(node.dict ?? {}).filter(
    (entry): entry is [string, SchemaNode] => entry[1] != null,
  );
  return (
    <>
      {fields.map(([key, child]) => {
        const id = `${idPrefix}-${key}`;
        const nested = child.type === 'object' && child.dict;
        const control = (
          <Field
            id={id}
            node={child}
            value={value[key]}
            onChange={(next) => onChange({ ...value, [key]: next })}
            commit={commit}
          />
        );
        // A nested object, a dict or an array is a group of its own fields,
        // so its name goes on a `<legend>` rather than a `<label for>` —
        // there is no single control for the label to point at.
        return (
          <div className="e8-field" key={key}>
            {nested || child.type === 'dict' || child.type === 'array' ? (
              <fieldset className="e8-field-group" id={id}>
                <legend>{label(child, key)}</legend>
                {control}
              </fieldset>
            ) : (
              <>
                <label htmlFor={id}>{label(child, key)}</label>
                {control}
              </>
            )}
            {/* This badge reflects what the plugin declared via
                `extra: { applies: 'restart' }` — not a difference in host
                behaviour: the host decides `reload` from the row's `hot`
                and the changed top-level keys (see `runtime-assets.ts`). */}
            {needsRestart(child) ? <span className="e8-badge">restart</span> : null}
          </div>
        );
      })}
    </>
  );
}

export function Field({ id, node, value, onChange, commit, ariaLabel }: FieldProps) {
  const current = value ?? node.meta?.default;

  if (node.type === 'object' && node.dict) {
    return (
      <ObjectFields
        idPrefix={id}
        node={node}
        value={(value ?? {}) as Record<string, unknown>}
        onChange={onChange}
        commit={commit}
      />
    );
  }

  if (node.type === 'dict' && node.inner?.type === 'string') {
    return <DictField id={id} node={node} value={value} onChange={onChange} commit={commit} />;
  }

  if (node.type === 'array' && node.inner) {
    return <ArrayField id={id} node={node} value={value} onChange={onChange} commit={commit} />;
  }

  if (node.type === 'dict' && node.inner) {
    return (
      <DictObjectField id={id} node={node} value={value} onChange={onChange} commit={commit} />
    );
  }

  const options = constants(node);
  if (options) {
    return (
      <select
        id={id}
        value={String(current ?? '')}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (node.type === 'number') {
    return <NumberField id={id} node={node} value={value} onChange={onChange} commit={commit} />;
  }

  if (node.type === 'boolean') {
    return (
      <input
        id={id}
        type="checkbox"
        checked={current === true}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
    );
  }

  if (node.type === 'string') {
    return (
      <StringField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        commit={commit}
        ariaLabel={ariaLabel}
      />
    );
  }

  // Any field kind this form has no editor for (`any`, a non-string union,
  // …). Rendering it editable would let a keystroke silently replace
  // a structured value with a plain string — read-only-and-labelled is the
  // honest gap; a later task can upgrade it to a real editor.
  return <UnsupportedField id={id} node={node} value={current} />;
}

/**
 * The draft behind a text-like field. Buffers the raw input text in local
 * state instead of deriving it straight from `value`/`node.meta.default`:
 * `Number('')` is `0`, so a naively controlled number input would commit
 * `0` the instant the user selects-all-deletes to type a fresh number, and
 * — because the parent's `value` prop would then equal that committed `0`
 * — the field could never actually show empty.
 *
 * Three facts ride alongside the draft. `committed` — what this field
 * last handed up (or the latest `value` prop, whichever moved last), so a
 * blur followed by Enter before an async `PUT` answer lands is one commit,
 * not two, and a blur commits only what differs from the LATEST prop.
 * `focused` — while the field has focus, an external `value` change
 * (another tab's frame) updates `committed` but does NOT touch the draft:
 * the keystrokes are the user's, and the blur decides. `dirty` — whether
 * the user typed since focusing; a focus-and-blur with no typing commits
 * nothing and re-syncs the draft to the latest prop on the way out.
 */
function useDraft<T>({
  dep,
  current,
  show,
  parse,
  onChange,
  commit,
}: {
  /** The committed prop, for the re-sync effect's dependency (not `current`, which also depends on the default). */
  dep: unknown;
  current: T;
  show: (value: T) => string;
  /** `null` when the draft is not committable (a cleared number, or not parseable yet). */
  parse: (raw: string) => T | null;
  onChange: (next: T) => void;
  commit: CommitMode;
}) {
  const [raw, setRaw] = useState(show(current));
  const committed = useRef(current);
  const focused = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    committed.current = current;
    if (focused.current) return;
    setRaw(show(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  const flush = () => {
    if (!dirty.current) return;
    const parsed = parse(raw);
    if (parsed === null || parsed === committed.current) return;
    committed.current = parsed;
    onChange(parsed);
  };

  return {
    raw,
    onFocus: () => {
      focused.current = true;
      dirty.current = false;
    },
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setRaw(e.target.value);
      dirty.current = true;
      if (commit !== 'change') return;
      const parsed = parse(e.target.value);
      if (parsed !== null) onChange(parsed);
    },
    onBlur: () => {
      focused.current = false;
      if (commit === 'blur') flush();
      if (!dirty.current) setRaw(show(current));
    },
    onKeyDown:
      commit === 'blur'
        ? (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); // cheap insurance against a future `<form>`
            flush();
          }
        : undefined,
  };
}

function NumberField({ id, node, value, onChange, commit }: FieldProps) {
  const draft = useDraft<number | undefined>({
    dep: value,
    current: (value ?? node.meta?.default) as number | undefined,
    show: (v) => (v === undefined ? '' : String(v)),
    parse: (text) => {
      if (text === '') return null;
      const parsed = Number(text);
      return Number.isNaN(parsed) ? null : parsed;
    },
    onChange,
    commit,
  });
  return (
    <input
      id={id}
      type="number"
      value={draft.raw}
      min={node.meta?.min}
      max={node.meta?.max}
      step={node.meta?.step}
      onFocus={draft.onFocus}
      onChange={draft.onChange}
      onBlur={draft.onBlur}
      onKeyDown={draft.onKeyDown}
    />
  );
}

function StringField({ id, node, value, onChange, commit, ariaLabel }: FieldProps) {
  const current = value ?? node.meta?.default;
  const draft = useDraft<string>({
    dep: value,
    current: current === undefined ? '' : String(current),
    show: (v) => v,
    parse: (text) => text,
    onChange,
    commit,
  });
  return (
    <input
      id={id}
      type="text"
      aria-label={ariaLabel}
      value={draft.raw}
      onFocus={draft.onFocus}
      onChange={draft.onChange}
      onBlur={draft.onBlur}
      onKeyDown={draft.onKeyDown}
    />
  );
}

/**
 * A dict of strings (`mechanics1`'s `stages`): one key → value row per
 * entry, `+` adds an empty row, `×` removes one. Rows are buffered locally
 * — a key typed one character at a time must not commit each prefix as a
 * key of its own — and leaving the dict (focus moves outside it) commits
 * the rows the user touched, minus those whose key is still empty. Only
 * string values; a dict of anything else is `DictObjectField` below.
 *
 * The same focused rule as `useDraft`: while focus is inside the dict, an
 * external `value` change (another tab's frame) leaves the rows alone.
 * A commit is the touched rows MERGED over the LATEST value — each dirty
 * row drops the key it came from (`origin`) and sets its current key —
 * so a sibling another tab changed meanwhile is kept, not overwritten by
 * a stale copy. An untouched focus-and-leave commits nothing and re-syncs.
 * A `commit` of `'change'` is not honoured here: a key is only meaningful
 * whole, so the dict commits on leave in either mode.
 */
interface DictRow {
  key: string;
  value: string;
  /** The key this row came from in the committed value; `null` for a `+` row. */
  origin: string | null;
  /** Touched by the user since the last sync. */
  dirty: boolean;
}

function DictField({ id, node, value, onChange }: FieldProps) {
  const current = (value ?? node.meta?.default ?? {}) as Record<string, string>;
  const toRows = (source: Record<string, string>): DictRow[] =>
    Object.entries(source).map(([key, entry]) => ({
      key,
      value: String(entry ?? ''),
      origin: key,
      dirty: false,
    }));
  const [rows, setRows] = useState(() => toRows(current));
  const container = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setRows(toRows(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /** The dirty rows over the latest value; `null` when that changes nothing. */
  const merge = (from: DictRow[]): Record<string, string> | null => {
    const next = { ...current };
    for (const row of from) {
      if (!row.dirty) continue;
      if (row.origin !== null) delete next[row.origin];
      if (row.key !== '') next[row.key] = row.value;
    }
    return JSON.stringify(next) === JSON.stringify(current) ? null : next;
  };
  const edit = (index: number, patch: Partial<Pick<DictRow, 'key' | 'value'>>) =>
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch, dirty: true } : row)),
    );
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && container.current?.contains(e.relatedTarget)) return;
    focused.current = false;
    const next = merge(rows);
    if (next) onChange(next);
    // Re-sync either way, keeping any `+` row still waiting for a key. After
    // a commit the baseline is what was just sent — the caller's `value`
    // may not have round-tripped yet (a PUT is async), and a no-op
    // focus/blur before it does must not re-send the same delta; with no
    // commit, the rows may be stale against a change that landed while
    // focused.
    setRows([
      ...toRows(next ?? current),
      ...rows.filter((row) => row.origin === null && row.key === ''),
    ]);
  };

  return (
    <div
      className="e8-dict"
      ref={container}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={leave}
    >
      {rows.map((row, index) => (
        <div className="e8-dict-row" key={index}>
          <input
            type="text"
            data-dict="key"
            aria-label="key"
            value={row.key}
            onChange={(e: ChangeEvent<HTMLInputElement>) => edit(index, { key: e.target.value })}
          />
          <span className="e8-dict-arrow">→</span>
          <input
            type="text"
            data-dict="value"
            aria-label="value"
            value={row.value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => edit(index, { value: e.target.value })}
          />
          <button
            type="button"
            aria-label="×"
            title="remove"
            onClick={() => {
              const removed = rows[index];
              setRows(rows.filter((_, i) => i !== index));
              if (removed.origin === null) return; // never committed — nothing to remove
              const next = { ...current };
              delete next[removed.origin];
              onChange(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label="+"
        title="add"
        onClick={() =>
          setRows((prev) => [...prev, { key: '', value: '', origin: null, dirty: false }])
        }
      >
        +
      </button>
    </div>
  );
}

/**
 * What a fresh item of `node` starts as: for an object, its children's
 * declared defaults (a required child with none stays absent — the user
 * fills it in); for a primitive, its own default, else an empty string.
 */
function defaults(node: SchemaNode): unknown {
  if (node.type === 'object' && node.dict) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.dict)) {
      if (child?.meta?.default !== undefined) out[key] = child.meta.default;
    }
    return out;
  }
  return node.meta?.default ?? '';
}

/**
 * An array (`stage1`'s `layers: array(object{id,z})`, a scene's `layers:
 * array(string)`): one row per item, each a nested `Field` of the item
 * schema — so an object item shows its children's labels — with up/down/
 * remove, and `add` after the rows. Structural changes commit at once with
 * the whole array; an edit inside a row goes through the inner field,
 * which already buffers under `commit: 'blur'` and keeps its draft across
 * an external change while focused. The rows render from `value`, but
 * every commit builds on `latest` — what this field last handed up, or
 * the latest prop, whichever moved last: a structural click right after
 * typing blurs the input first (its flush is one commit) and the click is
 * a second, and the host's `value` only moves when the PUT lands, so the
 * second must not be built from the prop or it drops the first.
 */
function ArrayField({ id, node, value, onChange, commit }: FieldProps) {
  const items = (value ?? node.meta?.default ?? []) as unknown[];
  const inner = node.inner!;
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const send = (next: unknown[]) => {
    latest.current = next;
    onChange(next);
  };
  const swap = (a: number, b: number) => {
    const next = [...latest.current];
    [next[a], next[b]] = [next[b], next[a]];
    send(next);
  };
  return (
    <div className="e8-array" data-testid={`array-${id}`}>
      {items.map((item, i) => (
        <div className="e8-array-row" data-testid={`array-row-${id}-${i}`} key={i}>
          <Field
            id={`${id}-${i}`}
            node={inner}
            value={item}
            onChange={(next) => send(latest.current.map((it, j) => (j === i ? next : it)))}
            commit={commit}
            ariaLabel={inner.type === 'string' ? `item ${i + 1}` : undefined}
          />
          <span className="e8-array-tools">
            <button
              type="button"
              aria-label="up"
              title="up"
              disabled={i === 0}
              onClick={() => swap(i, i - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="down"
              title="down"
              disabled={i === items.length - 1}
              onClick={() => swap(i, i + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="remove"
              title="remove"
              onClick={() => send(latest.current.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        </div>
      ))}
      <button
        type="button"
        aria-label="add"
        title="add"
        onClick={() => send([...latest.current, defaults(inner)])}
      >
        +
      </button>
    </div>
  );
}

/**
 * A dict whose values are not plain strings (`stage1`'s `scenes:
 * dict(object{…})`): a `key` input plus a nested `Field` of the value
 * schema per entry. Only the KEY is buffered here — typed one character at
 * a time, it must not commit each prefix as an entry of its own — and it
 * lands when its input blurs, renaming the entry (the old key dropped).
 * Value edits go straight through as the whole dict with that entry
 * replaced; the inner fields buffer themselves under `commit: 'blur'`.
 * `add` appends a row with an empty key and the inner defaults, not an
 * entry until the key is non-empty on blur; `remove` commits at once.
 *
 * Same focused rule as `DictField`: while focus is inside, an external
 * `value` change leaves the rows alone; leaving re-syncs to `baseline`.
 * Every commit builds on `baseline` too — the last commit, or the latest
 * prop, whichever moved last — never on the `value` prop: the host's
 * value only moves when a PUT lands, and two commits in a row (a key
 * blur then a click, or two keys typed back to back) must stack, not
 * have the second drop the first.
 */
interface DictObjectRow {
  key: string;
  value: unknown;
  origin: string | null;
  /** The key was edited since the last sync. */
  dirty: boolean;
}

function DictObjectField({ id, node, value, onChange, commit }: FieldProps) {
  const current = (value ?? node.meta?.default ?? {}) as Record<string, unknown>;
  const inner = node.inner!;
  const toRows = (source: Record<string, unknown>): DictObjectRow[] =>
    Object.entries(source).map(([key, entry]) => ({
      key,
      value: entry,
      origin: key,
      dirty: false,
    }));
  const pending = (from: DictObjectRow[]) =>
    from.filter((row) => row.origin === null && row.key === '');
  const [rows, setRows] = useState(() => toRows(current));
  const container = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const baseline = useRef(current);

  useEffect(() => {
    baseline.current = current;
    if (focused.current) return;
    setRows(toRows(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commitRows = (next: Record<string, unknown>) => {
    baseline.current = next;
    onChange(next);
  };
  const patch = (index: number, changes: Partial<DictObjectRow>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  const editValue = (index: number, next: unknown) => {
    patch(index, { value: next });
    const row = rows[index];
    if (row.origin !== null) commitRows({ ...baseline.current, [row.origin]: next });
  };
  const leaveKey = (index: number) => {
    const row = rows[index];
    if (!row.dirty) return;
    const base = baseline.current;
    const next = { ...base };
    if (row.origin !== null) delete next[row.origin];
    if (row.key !== '') next[row.key] = row.value;
    if (JSON.stringify(next) !== JSON.stringify(base)) commitRows(next);
    setRows([...toRows(next), ...pending(rows)]);
  };
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && container.current?.contains(e.relatedTarget)) return;
    focused.current = false;
    setRows((prev) => [...toRows(baseline.current), ...pending(prev)]);
  };

  return (
    <div
      className="e8-dict"
      ref={container}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={leave}
    >
      {rows.map((row, index) => (
        <div className="e8-array-row" key={index}>
          <input
            type="text"
            data-dict="key"
            aria-label="key"
            value={row.key}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              patch(index, { key: e.target.value, dirty: true })
            }
            onBlur={() => leaveKey(index)}
          />
          <Field
            id={`${id}-${index}`}
            node={inner}
            value={row.value}
            onChange={(next) => editValue(index, next)}
            commit={commit}
          />
          <button
            type="button"
            aria-label="remove"
            title="remove"
            onClick={() => {
              setRows(rows.filter((_, i) => i !== index));
              if (row.origin === null) return; // never committed — nothing to remove
              const next = { ...baseline.current };
              delete next[row.origin];
              commitRows(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label="add"
        title="add"
        onClick={() =>
          setRows((prev) => [
            ...prev,
            { key: '', value: defaults(inner), origin: null, dirty: false },
          ])
        }
      >
        +
      </button>
    </div>
  );
}

/** Read-only stand-in for a field kind the form does not know how to edit. */
function UnsupportedField({ id, node, value }: { id: string; node: SchemaNode; value: unknown }) {
  const display =
    value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return (
    <span className="e8-unsupported">
      <input id={id} type="text" value={display} readOnly aria-readonly="true" />
      <em className="e8-unsupported-note"> unsupported ({node.type})</em>
    </span>
  );
}
