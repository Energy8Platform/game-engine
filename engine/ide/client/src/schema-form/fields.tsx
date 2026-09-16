import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

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
  /** A `dict` node's value schema. */
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
        // A nested object or a dict is a group of its own fields, so its
        // name goes on a `<legend>` rather than a `<label for>` — there is
        // no single control for the label to point at.
        return (
          <div className="e8-field" key={key}>
            {nested || child.type === 'dict' ? (
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

export function Field({ id, node, value, onChange, commit }: FieldProps) {
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
    return <StringField id={id} node={node} value={value} onChange={onChange} commit={commit} />;
  }

  // Any field kind this form has no editor for (`any`, an array, a dict
  // of non-strings, a non-string union, …). Rendering it editable would let a keystroke silently replace
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

function StringField({ id, node, value, onChange, commit }: FieldProps) {
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
 * key of its own — and a blur commits the whole object, minus rows whose
 * key is still empty. Only string values, per Slice 0's scope; a dict of
 * anything else stays `UnsupportedField`.
 */
function DictField({ id, node, value, onChange }: FieldProps) {
  const current = (value ?? node.meta?.default ?? {}) as Record<string, string>;
  const toRows = (source: Record<string, string>) =>
    Object.entries(source).map(([key, entry]) => ({ key, value: String(entry ?? '') }));
  const [rows, setRows] = useState(() => toRows(current));

  // Re-sync on a committed value that changed for a reason other than this
  // field's own edit — the same rule `NumberField` follows.
  useEffect(() => {
    setRows(toRows(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const build = (from: typeof rows) =>
    Object.fromEntries(from.filter((row) => row.key !== '').map((row) => [row.key, row.value]));
  const commit = (from: typeof rows) => {
    const next = build(from);
    if (JSON.stringify(next) !== JSON.stringify(current)) onChange(next);
  };
  const edit = (index: number, patch: Partial<{ key: string; value: string }>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="e8-dict">
      {rows.map((row, index) => (
        <div className="e8-dict-row" key={index}>
          <input
            type="text"
            data-dict="key"
            aria-label="key"
            value={row.key}
            onChange={(e: ChangeEvent<HTMLInputElement>) => edit(index, { key: e.target.value })}
            onBlur={() => commit(rows)}
          />
          <span className="e8-dict-arrow">→</span>
          <input
            type="text"
            data-dict="value"
            aria-label="value"
            value={row.value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => edit(index, { value: e.target.value })}
            onBlur={() => commit(rows)}
          />
          <button
            type="button"
            aria-label="×"
            title="remove"
            onClick={() => {
              const next = rows.filter((_, i) => i !== index);
              setRows(next);
              commit(next);
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
        onClick={() => setRows((prev) => [...prev, { key: '', value: '' }])}
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
