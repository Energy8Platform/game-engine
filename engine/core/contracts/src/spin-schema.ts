/**
 * The shape a `.spin` declares, as a vocabulary. Nothing here decides
 * anything: parsing lives in `@energy8engine/spin-parser`, and judging a
 * schema (does this action name a stage that exists?) lives in the host.
 */
export type FieldType =
  | { kind: 'int' }
  | { kind: 'float' }
  | { kind: 'bool' }
  | { kind: 'str' }
  | { kind: 'list'; of: FieldType }
  | { kind: 'array'; of: FieldType; length: number }
  | { kind: 'record'; name: string }
  | { kind: 'optional'; of: FieldType };

export type RecordShape = Record<string, FieldType>;

export interface ActionDef {
  name: string;
  stage: string;
  cost: number;
  session?: boolean;
  /** `extends = <Vars field>` — spins added mid-session. */
  extendsVar?: string;
  /** `ends when <Vars field>` — the bool that force-closes the session. */
  endsWhenVar?: string;
  /**
   * `opens = <action> count <Vars field> [when <condition>]` — a list, not
   * a single entry: one action can open more than one follow-up action
   * (kitsune-wrath's `spin` opens both `free_spin` unconditionally and
   * `spirit_gate` guarded by a `when`). `when`, when present, is kept as
   * the raw condition text rather than parsed into structure — every
   * consumer this plan has needs only to show or re-evaluate it as an
   * expression, never to take it apart.
   */
  opens?: { action: string; countVar: string; when?: string }[];
  feature?: Record<string, number>;
}

/**
 * One declaration a reading of a `.spin` could not recover.
 *
 * A `SpinSchema` is the shape a math file DECLARES. A parser hands back
 * the shape it managed to READ, and those are not the same thing: a
 * missing brace, an unreadable field type, a repeated name each cost the
 * reading something the file itself states perfectly well. Without a
 * record of what was lost, a consumer cannot tell "the math does not
 * declare `lines`" from "we could not read the line where it does" — and
 * the first of those is a false accusation to put in front of a person
 * whose file is fine.
 *
 * So the partiality travels with the schema. Each gap names WHERE the
 * loss landed, as precisely as the reading could tell:
 *
 *  - `in` — which of the schema's two shape maps the loss belongs to.
 *  - `name` — the stage or record entry, or `null` when the reading lost
 *    the name as well (a whole `enum` block dropped, say, so nothing
 *    downstream can say which names it would have declared). A `null`
 *    name covers EVERY entry of that map.
 *  - `field` — the field that was dropped, or `null` when the loss cannot
 *    be pinned to one field (a dropped block, a repeated declaration,
 *    unreadable text carrying no field name of its own). A `null` field
 *    covers EVERY field of the entry.
 *
 * `null` is therefore always the WIDER claim, never the vaguer one: it
 * says "this reading cannot rule the loss out here", which is exactly
 * what a consumer needs in order to stay quiet rather than guess.
 *
 * A gap is not a diagnostic and does not replace one. The parser reports
 * every loss as a `Diagnostic` too, and that is what a person reads; a
 * gap is the machine-readable half, for a consumer deciding whether its
 * OWN complaint would be true.
 */
export interface SchemaGap {
  in: 'stages' | 'records';
  name: string | null;
  field: string | null;
}

export interface SpinSchema {
  gameId: string;
  betLevels: number[];
  maxWin: number;
  vars: RecordShape;
  globals?: RecordShape;
  /**
   * From `enum SpinData tag stage { … }` — one entry per variant. Some real
   * `.spin` files skip that construct and point `data =` at a flat
   * `record` instead; the parser derives an entry per stage NAME an
   * `action` actually declares in that case, but every derived entry
   * shares the exact same `RecordShape` (there is only the one record to
   * draw from — see `@energy8engine/spin-parser`'s `parseStages` for the
   * full reasoning). **Consumer warning:** when every entry here is
   * `===`-identical, a shape check against this map can confirm a field
   * exists on SOME stage this game has, but cannot tell "this field is
   * specific to `free_spins`" apart from "this field happens to be
   * declared at all" — the source file itself doesn't distinguish
   * per-stage shape in that dialect, so nothing built on top of this type
   * can recover it either.
   */
  stages: Record<string, RecordShape>;
  /** Every `record` declared, so a field of kind `record` can be followed. */
  records: Record<string, RecordShape>;
  actions: ActionDef[];
  /**
   * Everything the reading that produced this schema dropped — empty when
   * nothing was. Required, not optional: a producer that has not thought
   * about its own losses cannot compile, and a consumer never has to
   * treat "absent" and "nothing lost" as the same answer. See `SchemaGap`.
   *
   * `vars` and `globals` carry no gaps of their own because they are not
   * declarations of their own: each is a copy of a `records` entry the
   * game block named, so a loss inside one appears as a `records` gap
   * under that record's name.
   */
  gaps: SchemaGap[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isNumber);
}

function isFieldType(value: unknown): value is FieldType {
  if (!isPlainObject(value) || !isString(value.kind)) return false;
  switch (value.kind) {
    case 'int':
    case 'float':
    case 'bool':
    case 'str':
      return true;
    case 'list':
      return isFieldType(value.of);
    case 'array':
      return isFieldType(value.of) && isNumber(value.length);
    case 'record':
      return isString(value.name);
    case 'optional':
      return isFieldType(value.of);
    default:
      return false;
  }
}

function isRecordShape(value: unknown): value is RecordShape {
  return isPlainObject(value) && Object.values(value).every(isFieldType);
}

function isStagesMap(value: unknown): value is Record<string, RecordShape> {
  return isPlainObject(value) && Object.values(value).every(isRecordShape);
}

function isOpensEntry(
  value: unknown,
): value is { action: string; countVar: string; when?: string } {
  if (!isPlainObject(value) || !isString(value.action) || !isString(value.countVar)) return false;
  if (value.when !== undefined && !isString(value.when)) return false;
  return true;
}

function isFeatureMap(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every(isNumber);
}

function isSchemaGap(value: unknown): value is SchemaGap {
  if (!isPlainObject(value)) return false;
  if (value.in !== 'stages' && value.in !== 'records') return false;
  if (value.name !== null && !isString(value.name)) return false;
  if (value.field !== null && !isString(value.field)) return false;
  return true;
}

function isActionDef(value: unknown): value is ActionDef {
  if (!isPlainObject(value)) return false;
  if (!isString(value.name) || !isString(value.stage) || !isNumber(value.cost)) return false;
  if (value.session !== undefined && typeof value.session !== 'boolean') return false;
  if (value.extendsVar !== undefined && !isString(value.extendsVar)) return false;
  if (value.endsWhenVar !== undefined && !isString(value.endsWhenVar)) return false;
  if (
    value.opens !== undefined &&
    (!Array.isArray(value.opens) || !value.opens.every(isOpensEntry))
  )
    return false;
  if (value.feature !== undefined && !isFeatureMap(value.feature)) return false;
  return true;
}

/**
 * Checks a value has the shape of a `SpinSchema` — nothing more. Whether an
 * action names a stage the schema actually declares, or a record referenced
 * by a field actually exists in `records`, is a judgement about meaning, not
 * shape, and is left to whoever consumes the schema (the host, task 3).
 */
export function isSpinSchema(value: unknown): value is SpinSchema {
  if (!isPlainObject(value)) return false;
  if (!isString(value.gameId)) return false;
  if (!isNumberArray(value.betLevels)) return false;
  if (!isNumber(value.maxWin)) return false;
  if (!isRecordShape(value.vars)) return false;
  if (value.globals !== undefined && !isRecordShape(value.globals)) return false;
  if (!isStagesMap(value.stages)) return false;
  if (!isStagesMap(value.records)) return false;
  if (!Array.isArray(value.actions) || !value.actions.every(isActionDef)) return false;
  if (!Array.isArray(value.gaps) || !value.gaps.every(isSchemaGap)) return false;
  return true;
}
