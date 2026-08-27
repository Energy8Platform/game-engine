import { useEffect, useState, type ChangeEvent } from 'react';

/** The parts of a rebuilt schemastery schema the form reads. */
export interface SchemaNode {
  type: string;
  value?: unknown;
  list?: SchemaNode[];
  dict?: Record<string, SchemaNode>;
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

export function Field({ id, node, value, onChange }: FieldProps) {
  const current = value ?? node.meta?.default;

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
    return <NumberField id={id} node={node} value={value} onChange={onChange} />;
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
      <input
        id={id}
        type="text"
        value={current === undefined ? '' : String(current)}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      />
    );
  }

  // Any field kind Slice 0 has no editor for (object, array, a non-string
  // union, …). Rendering it editable would let a keystroke silently replace
  // a structured value with a plain string — read-only-and-labelled is the
  // honest gap; a later task can upgrade it to a real editor.
  return <UnsupportedField id={id} node={node} value={current} />;
}

/**
 * A number field buffers the raw input text in local state instead of
 * deriving it straight from `value`/`node.meta.default`. `Number('')` is
 * `0`, so a naively controlled input would commit `0` the instant the user
 * selects-all-deletes to type a fresh number, and — because the parent's
 * `value` prop would then equal that committed `0` — the field could never
 * actually show empty. Buffering locally and only calling `onChange` once
 * the buffer parses to a real number keeps "empty" a reachable, typable
 * state.
 */
function NumberField({ id, node, value, onChange }: FieldProps) {
  const current = value ?? node.meta?.default;
  const [raw, setRaw] = useState(current === undefined ? '' : String(current));

  // Re-sync when the committed value changes for a reason other than this
  // field's own edit (e.g. the surrounding form resets it) — but not on
  // every render, so an in-progress empty buffer isn't clobbered back to
  // the last committed number.
  useEffect(() => {
    setRaw(current === undefined ? '' : String(current));
    // Intentionally keyed on `value` (the committed prop), not `current`
    // (which also depends on `node.meta?.default`) — re-deriving `current`
    // here just reads the same `value` this effect already depends on.
  }, [value]);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setRaw(next);
    if (next === '') return; // cleared — do not commit anything yet
    const parsed = Number(next);
    if (Number.isNaN(parsed)) return; // not a parseable number yet
    onChange(parsed);
  };

  return (
    <input
      id={id}
      type="number"
      value={raw}
      min={node.meta?.min}
      max={node.meta?.max}
      step={node.meta?.step}
      onChange={handleChange}
    />
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
