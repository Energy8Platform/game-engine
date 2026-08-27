import type { ChangeEvent } from 'react';

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
      <select id={id} value={String(current ?? '')} onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (node.type === 'number') {
    return (
      <input
        id={id}
        type="number"
        value={current === undefined ? '' : String(current)}
        min={node.meta?.min}
        max={node.meta?.max}
        step={node.meta?.step}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(Number(e.target.value))}
      />
    );
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

  return (
    <input
      id={id}
      type="text"
      value={current === undefined ? '' : String(current)}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}
