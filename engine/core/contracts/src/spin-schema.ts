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

function isOpensEntry(value: unknown): value is { action: string; countVar: string; when?: string } {
  if (!isPlainObject(value) || !isString(value.action) || !isString(value.countVar)) return false;
  if (value.when !== undefined && !isString(value.when)) return false;
  return true;
}

function isFeatureMap(value: unknown): value is Record<string, number> {
  return isPlainObject(value) && Object.values(value).every(isNumber);
}

function isActionDef(value: unknown): value is ActionDef {
  if (!isPlainObject(value)) return false;
  if (!isString(value.name) || !isString(value.stage) || !isNumber(value.cost)) return false;
  if (value.session !== undefined && typeof value.session !== 'boolean') return false;
  if (value.extendsVar !== undefined && !isString(value.extendsVar)) return false;
  if (value.endsWhenVar !== undefined && !isString(value.endsWhenVar)) return false;
  if (value.opens !== undefined && (!Array.isArray(value.opens) || !value.opens.every(isOpensEntry))) return false;
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
  return true;
}
