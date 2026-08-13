/**
 * The schema language every contribution must speak.
 *
 * These kinds are deliberately DOMAIN-aware rather than generic JSON Schema types: `asset` becomes
 * an asset picker in the IDE, `symbol` a list drawn from the game spec, `spinPath` a picker over
 * the spin schema. That difference is what separates configuration through the UI from a form of
 * fifteen text inputs. Conversion to JSON Schema, for the marketplace and the agent, comes later.
 */

export interface FieldBase {
  /** Control label. Defaults to the field's key when absent. */
  label?: string;
  /** One-line help text shown next to the control, and read by the agent. */
  doc?: string;
}

export interface EnumOption {
  value: string;
  label: string;
}

export type AssetKind = 'image' | 'audio' | 'atlas' | 'any';

export type FieldSchema =
  | (FieldBase & { kind: 'number'; default?: number; min?: number; max?: number; step?: number })
  | (FieldBase & { kind: 'text'; default?: string; multiline?: boolean })
  | (FieldBase & { kind: 'boolean'; default?: boolean })
  | (FieldBase & { kind: 'color'; default?: string })
  | (FieldBase & { kind: 'enum'; default?: string; options: EnumOption[] })
  | (FieldBase & { kind: 'asset'; default?: string; accept?: AssetKind })
  | (FieldBase & { kind: 'symbol'; default?: string })
  | (FieldBase & { kind: 'spinPath'; default?: string; stage?: string })
  | (FieldBase & { kind: 'nodeRef'; default?: string })
  | (FieldBase & { kind: 'sound'; default?: string })
  | (FieldBase & { kind: 'object'; fields: Schema })
  | (FieldBase & { kind: 'list'; of: FieldSchema; default?: unknown[] });

export type Schema = Record<string, FieldSchema>;

/**
 * Kinds the kernel validates as a plain string. Their MEANING — does this asset exist, is this a
 * real path into the spin data — is resolved by higher layers. The kernel knows no assets, no
 * symbols and no spin schema, and must not pretend to.
 */
export const STRING_KINDS = [
  'text',
  'color',
  'asset',
  'symbol',
  'spinPath',
  'nodeRef',
  'sound',
] as const;
