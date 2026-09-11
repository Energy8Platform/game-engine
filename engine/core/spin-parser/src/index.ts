/**
 * Reads the declarative section a `.spin` file already states — the
 * `record`/`enum SpinData tag stage`/`game`/`action` blocks — into a
 * `SpinSchema`. Everything else in the file (`const`, `fn`, the body of
 * `execute`) is math, not shape, and is skipped rather than parsed.
 *
 * Pure: a string in, a schema and diagnostics out. No `fs`, no cordis — the
 * host (a later task) reads the file and calls this. And it never throws:
 * a file it cannot make sense of yields `schema: null` plus a diagnostic
 * naming what was missing. Below "no game block" (the only failure that
 * aborts the whole parse), every declaration parses independently — a
 * broken record, stage variant, field, action or clause is dropped **on
 * its own**, with its own diagnostic, never taking the rest of the file
 * down with it. Silent loss is worse than a parse error: a schema that
 * looks complete gets trusted.
 *
 * That guarantee covers four failure shapes. Three of them are resolved
 * in exactly ONE place each, so a new block kind, a new name-keyed
 * collection or a new field type inherits the guarantee by construction
 * rather than by a future author remembering to reimplement it:
 *
 *  1. **An unterminated block** (a `{` with no matching `}` — an ordinary
 *     missing-brace typo, not an exotic input) is diagnosed by
 *     `findBlocks` itself, the single function every block form goes
 *     through.
 *  2. **A name an author repeated** (two `record Vars`, two `base_game`
 *     variants in one enum) is diagnosed by `NamedCollection`, the single
 *     type every name-keyed accumulator is built on. `actions` needs
 *     neither — it's an array, so a repeated action name is just two
 *     entries, not a collision.
 *  3. **A dangling record reference** in a field's TYPE is collected by
 *     `parseFieldList` (the single function every field in the file goes
 *     through, via `collectRecordRefs`, which recurses into
 *     list/array/optional) and resolved by `checkReferences` once the
 *     whole file has been read — a forward reference is legal, so there
 *     is no earlier honest moment.
 *  4. **A dangling reference in a game CLAUSE** (`vars = Varz`,
 *     `globals = Nope`) is also diagnosed by `checkReferences`, but from
 *     a hand-written list of the two clauses that carry a record name.
 *     This is the one case with no structural guarantee: a THIRD such
 *     clause added to `GAME_KEYS` later inherits nothing and has to be
 *     added to that list by hand. Said plainly rather than left to be
 *     discovered — see the report.
 *
 * A repeated `game { }` block goes the same way as a repeated name (first
 * kept, rest diagnosed), decided in `parseGame`, which is the only place
 * that reads one.
 *
 * Where attribution can still point at a NEIGHBOR rather than the exact
 * culprit (garbage text with no field-name colon of its own, glued onto
 * whichever field precedes it) the loss is still visible as SOME
 * diagnostic on SOME field, never zero diagnostics — see `parseFieldList`.
 *
 * Every one of those losses is reported twice, in two registers. A
 * `Diagnostic` says it in words, for a person. A `SchemaGap` on the
 * returned schema's `gaps` says it in a form a consumer can act on: which
 * map, which entry, which field, with `null` meaning "wider than that".
 * The second register exists because the first cannot be read by a
 * machine without guessing — and the consumer that guessed wrong told a
 * developer their math did not declare a field their math declares. A new
 * loss added here owes both.
 */
import {
  type Diagnostic,
  diagnostic,
  type Severity,
  type ActionDef,
  type FieldType,
  type RecordShape,
  type SchemaGap,
  type SpinSchema,
} from '@energy8engine/contracts';

const PLUGIN = 'spin-parser';

/**
 * `diagnostic()`, plus the line stamped into `at` — the structured twin an
 * editor reads instead of parsing `where`'s `line ${line}` prose back (see
 * `Diagnostic.at`'s doc comment for why that parse-back is the one thing
 * this must never become). Every call site below that already knows a line
 * number goes through this one function instead of `diagnostic()` directly,
 * so `where`'s prose and `at`'s number can't drift apart at one site while
 * staying in sync at the rest.
 */
function lineDiagnostic(
  severity: Severity,
  line: number,
  message: string,
  fix?: string,
): Diagnostic {
  return { ...diagnostic(severity, PLUGIN, `line ${line}`, message, fix), at: { line } };
}

/**
 * Strips `.spin`'s only comment form (`-- ...` to end of line) before any
 * block-scanning runs, so a `--` inside a comment never gets mistaken for
 * syntax. `.spin` has no block comments and no string literals that could
 * contain `--`, so a line-oriented strip is safe.
 */
function stripComments(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The 1-based line `offset` falls on in `text`. A block's body is a slice
 * of the file, so a mistake inside it is on `bodyLine + lineAt(body, k) -
 * 1` — every site below that knows an offset into a body counts this way,
 * instead of stamping the block's own header line onto a mistake five
 * lines further down.
 */
function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

/**
 * Finds every top-level `keyword ... { ... }` block by keyword, respecting
 * brace nesting so a block's own nested `{ }` (e.g. a stage variant inside
 * `enum SpinData tag stage { ... }`) doesn't end the match early. Returns
 * each match's header (between the keyword and the opening brace) and body
 * (between the matched braces), plus the 1-based line the block starts on
 * (for diagnostics).
 *
 * `diagnostics` is REQUIRED, not optional — every one of this function's
 * two silent-skip paths (no `{` at all after the keyword; a `{` that never
 * finds its matching `}`) used to just `continue`, dropping the block
 * without a trace. An unterminated block is an ordinary typo (one missing
 * `}`), not an exotic input, and every block form (`record`, `enum`,
 * `game`, `action`, the inline `feature { ... }`) flows through this one
 * function, which is what made it the systemic instance of the "silent
 * loss" defect rather than a one-off. Making the parameter required means
 * a caller literally cannot compile without deciding where its
 * diagnostics go — it does not, on its own, stop a future name-keyed
 * collection from being built without this function at all; see
 * `NamedCollection` below and the report for the honest boundary of what
 * "structural" means here.
 */
function findBlocks(
  source: string,
  keyword: string,
  diagnostics: Diagnostic[],
): { header: string; body: string; line: number; bodyLine: number }[] {
  const results: { header: string; body: string; line: number; bodyLine: number }[] = [];
  const re = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const afterKeyword = match.index + match[0].length;
    const line = source.slice(0, match.index).split('\n').length;
    // The keyword is being used as a CLAUSE KEY, not opening a block:
    // `feature = Feat` is the game block's own legal clause form, and no
    // block header in this grammar is ever followed by an `=` (they are
    // bare names — `Vars`, `"demo"`, `SpinData tag stage`, an action's
    // name, or `feature`'s empty one). Without this, the clause form was
    // scanned for a `{` arbitrarily far ahead and, finding none, reported
    // as a BROKEN BLOCK — `parseInlineFeature` running over
    // `action other { … feature = Feat }` produced `"feature" block has
    // no "{" — nothing to parse` against a file with nothing wrong with
    // it. `(?!=)` excludes a `==` comparison, the same exclusion (and for
    // the same reason) that `findClauses`' boundary pattern makes.
    //
    // Silent, and deliberately so: this is not a block that got dropped,
    // it is text that was never a block. An unrecognized clause is
    // already ignored by `findClauses`/`parseActions` (see "an
    // unrecognized clause between two known ones…" in the tests) and this
    // changes nothing about that.
    //
    // Here rather than in `parseInlineFeature` for the same reason the
    // unterminated-block diagnostic is here: this is the ONE function
    // every block form goes through, so a block keyword added later that
    // also has a clause form inherits the distinction by construction.
    if (/^\s*=(?!=)/.test(source.slice(afterKeyword))) continue;
    const braceStart = source.indexOf('{', afterKeyword);
    if (braceStart === -1) {
      diagnostics.push(
        lineDiagnostic('error', line, `"${keyword}" block has no "{" — nothing to parse`),
      );
      continue;
    }
    const header = source.slice(afterKeyword, braceStart).trim();
    const label = header === '' ? `"${keyword}"` : `"${keyword} ${header}"`;
    const bodyEnd = requireMatchingBrace(source, braceStart, label, line, diagnostics);
    if (bodyEnd === null) continue;
    const body = source.slice(braceStart + 1, bodyEnd);
    // The body's first character may sit on a later line than the keyword
    // (`record Vars\n{`), so its line is counted from the brace, not
    // reused from the header.
    results.push({ header, body, line, bodyLine: lineAt(source, braceStart + 1) });
    re.lastIndex = bodyEnd + 1;
  }
  return results;
}

/**
 * Finds the `}` matching the `{` at `braceStart`, diagnosing (and
 * returning `null` instead of throwing or silently skipping) if the
 * source ends before one closes. `label` names what was being scanned
 * (e.g. `"record Broken"`, `stage variant "base_game"`) so the diagnostic
 * points at what an author would actually recognize, not just a byte
 * offset. Shared by `findBlocks` and the tagged-enum's own stage-variant
 * scanner below (which can't go through `findBlocks` — a stage variant has
 * no keyword to anchor on — but hits the exact same unterminated-brace
 * failure mode and deserves the exact same diagnostic).
 */
function requireMatchingBrace(
  source: string,
  braceStart: number,
  label: string,
  line: number,
  diagnostics: Diagnostic[],
): number | null {
  const end = matchingBrace(source, braceStart);
  if (end === -1) {
    diagnostics.push(
      lineDiagnostic('error', line, `${label}: unterminated block — no matching "}" found`),
    );
    return null;
  }
  return end;
}

/** Given the index of an opening `{`, returns the index of its matching `}`. */
function matchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Parses one field type: `int`, `float`, `bool`, `str`, `RecordName`,
 * `[T]` (list), `[T; N]` (fixed-size array), any of the above followed by
 * `?` (optional). Returns `null` for anything else, rather than guessing.
 */
function parseFieldType(text: string): FieldType | null {
  const t = text.trim();
  if (t.endsWith('?')) {
    const inner = parseFieldType(t.slice(0, -1));
    return inner === null ? null : { kind: 'optional', of: inner };
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const inside = t.slice(1, -1);
    const semi = topLevelSemicolon(inside);
    if (semi !== -1) {
      const of = parseFieldType(inside.slice(0, semi));
      const length = Number(inside.slice(semi + 1).trim());
      if (of === null || !Number.isFinite(length)) return null;
      return { kind: 'array', of, length };
    }
    const of = parseFieldType(inside);
    return of === null ? null : { kind: 'list', of };
  }
  switch (t) {
    case 'int':
      return { kind: 'int' };
    case 'float':
      return { kind: 'float' };
    case 'bool':
      return { kind: 'bool' };
    case 'str':
      return { kind: 'str' };
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return { kind: 'record', name: t };
  return null;
}

/**
 * One place a field named a RECORD type, remembered so the reference can
 * be checked once every `record` block in the file has been read.
 *
 * It cannot be checked where it is parsed: a forward reference is legal
 * (`positions: [CellPos]` may precede `record CellPos`), so the only
 * honest moment is after the whole file. Collected here rather than
 * re-derived by walking the finished schema so the OWNER and the LINE
 * survive — a `RecordShape` is a bare `{ field: FieldType }` and carries
 * neither, and "somewhere in this file, something points at NoSuchRecord"
 * is a much worse diagnostic than one that names the block and the line.
 */
interface RecordRef {
  /** The record type named — the thing that may not exist. */
  name: string;
  /** The `record` or stage-variant block the field belongs to. */
  owner: string;
  field: string;
  line: number;
}

/** Every `record` type inside `type`, however deeply nested in list/array/optional. */
function collectRecordRefs(
  type: FieldType,
  owner: string,
  field: string,
  line: number,
  refs: RecordRef[],
): void {
  switch (type.kind) {
    case 'record':
      refs.push({ name: type.name, owner, field, line });
      return;
    case 'list':
    case 'array':
    case 'optional':
      collectRecordRefs(type.of, owner, field, line, refs);
      return;
    default:
      return;
  }
}

/** Index of the `;` that separates a `[T; N]` array's element type from its
 *  length — the top-level one, not one nested inside an element type that
 *  is itself a `[T; N]` array. */
function topLevelSemicolon(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') depth++;
    else if (text[i] === ']') depth--;
    else if (text[i] === ';' && depth === 0) return i;
  }
  return -1;
}

/**
 * Parses a `name: Type` field list. Each field is found independently by
 * scanning for `identifier :` boundaries, so the amount of whitespace or
 * how many fields share a line never matters — one field's value simply
 * runs from its own colon to the START of the next field's name (or the
 * end of the body).
 *
 * Two ways a field can fail, and both are diagnosed and dropped rather
 * than silently vanishing (Critical C): a field whose type text doesn't
 * parse (`broken: ` with nothing after the colon, or garbage that isn't
 * any known type), and text that never became a field at all because it
 * had no colon (a bare identifier, or other leading noise before the
 * first real field). Every other field in the same block still parses —
 * this never drops the whole block for one bad field.
 */
function parseFieldList(
  body: string,
  blockName: string,
  bodyLine: number,
  diagnostics: Diagnostic[],
  refs: RecordRef[],
): { shape: RecordShape; unread: (string | null)[] } {
  // `bodyLine` is where `body[0]` sits in the file; each field's own line
  // is counted from there, so the marker lands on the field, not the
  // block header.
  const lineOf = (offset: number) => bodyLine + lineAt(body, offset) - 1;
  const shape: RecordShape = {};
  const unread: (string | null)[] = [];
  const fieldRe = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  const boundaries: { name: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(body)) !== null) {
    boundaries.push({ name: match[1], start: match.index, end: fieldRe.lastIndex });
  }

  const leadingEnd = boundaries[0]?.start ?? body.length;
  const leading = body.slice(0, leadingEnd).trim();
  if (leading !== '') {
    // `null`, not a name: this text never became a field, so nothing here
    // knows which field it was going to be. The gap is therefore the wide
    // one — "some field of this block may be missing" — which is the only
    // true thing that can be said about it.
    unread.push(null);
    diagnostics.push(
      lineDiagnostic(
        'error',
        lineOf(body.slice(0, leadingEnd).search(/\S/)),
        `block "${blockName}": unreadable declaration "${leading}" (expected "name: Type")`,
      ),
    );
  }

  for (let i = 0; i < boundaries.length; i++) {
    const { name, start, end } = boundaries[i];
    const line = lineOf(start);
    const valueEnd = boundaries[i + 1]?.start ?? body.length;
    const typeText = body.slice(end, valueEnd).trim();
    const type = typeText === '' ? null : parseFieldType(typeText);
    if (type === null) {
      unread.push(name);
      diagnostics.push(
        lineDiagnostic(
          'error',
          line,
          `block "${blockName}": field "${name}" has an unreadable type "${typeText === '' ? '(empty)' : typeText}"`,
        ),
      );
      continue;
    }
    shape[name] = type;
    collectRecordRefs(type, blockName, name, line, refs);
  }

  return { shape, unread };
}

/**
 * Builds a `Record<string, T>` where a duplicate name is impossible to
 * insert silently. `records` (two `record Vars { ... }` blocks) and stage
 * variants (two `base_game { ... }` inside one tagged enum) are both
 * keyed by an author-chosen name that nothing stops an author from
 * repeating — unlike `actions`, which is an array and so has no
 * "overwrite" failure mode to begin with. The ONE place either of them
 * resolves a collision is `.insert()`: the map itself is private, there
 * is no `[name] = value` escape hatch on this type, so a caller can only
 * add an entry through the method that diagnoses a collision. A THIRD
 * name-keyed collection built later inherits the guarantee by using this
 * type — see the report for how far that promise actually reaches (it is
 * not enforced against a caller who reaches for a plain `{}` instead).
 *
 * Policy on a collision: keep the FIRST declaration, diagnose and drop
 * the repeat. `SpinSchema.records`/`.stages` are dictionaries (task 1's
 * vocabulary, already relied on elsewhere), not arrays — "keep both" is
 * not a shape either of them can hold, so this is the one available rule,
 * applied identically to both callers below rather than invented per-site.
 *
 * **Not `@energy8engine/registry`, and that was decided rather than
 * overlooked.** That package is the same first-wins-and-diagnose rule for
 * the three LIVE registries, two of which cite this class as their
 * precedent — but what it holds is the collision policy plus a disposer
 * identity guard, and nothing here is ever unregistered: a parsed `record`
 * block stays for the life of the schema. `insert()` also takes the source
 * LINE and pushes the diagnostic itself, which is what a one-pass parser
 * wants and the opposite of the read-then-add dance a live registry does.
 * Adopting would buy a disposer per entry that nobody can call and cost
 * the line number. See that package's own module doc, which records the
 * same decision from its end.
 */
class NamedCollection<T> {
  private readonly map: Record<string, T> = {};

  /** @param kind e.g. `'record'`, `'stage variant'` — names the KIND of
   *  thing colliding, in the diagnostic.
   *  @param scope e.g. `''` (records are global) or `enum SpinData tag
   *  stage` (a stage variant collides only within its own enum) — names
   *  WHERE it collided. */
  constructor(
    private readonly kind: string,
    private readonly scope: string,
  ) {}

  /** `false` when the name was already taken and this declaration was
   *  dropped — the caller records the gap, because only it knows which of
   *  the schema's maps this collection becomes. */
  insert(name: string, value: T, line: number, diagnostics: Diagnostic[]): boolean {
    if (name in this.map) {
      diagnostics.push(
        lineDiagnostic(
          'error',
          line,
          `duplicate ${this.kind} "${name}"${this.scope === '' ? '' : ` in ${this.scope}`} — keeping the first, dropping this one`,
        ),
      );
      return false;
    }
    this.map[name] = value;
    return true;
  }

  build(): Record<string, T> {
    return this.map;
  }
}

/**
 * Every `record` block, plus what reading them cost.
 *
 * `unread` is keyed the same way `records` is, and `parseStages` needs it
 * as well as this function's own gaps: under the flat dialect a stage's
 * shape IS one of these records, so a field this reading dropped out of
 * `record Data` is a field dropped out of every stage derived from it.
 */
function parseRecords(
  source: string,
  diagnostics: Diagnostic[],
  refs: RecordRef[],
  gaps: SchemaGap[],
): { records: Record<string, RecordShape>; unread: Record<string, (string | null)[]> } {
  const records = new NamedCollection<RecordShape>('record', '');
  const unread: Record<string, (string | null)[]> = {};
  // Its own array, so a block this scan dropped entirely (no "{", or no
  // matching "}") is visible here as well as in the diagnostics — a
  // dropped block takes its NAME with it, so the gap it leaves is the
  // wide one.
  const blockDiagnostics: Diagnostic[] = [];
  const blocks = findBlocks(source, 'record', blockDiagnostics);
  diagnostics.push(...blockDiagnostics);
  if (blockDiagnostics.length > 0) gaps.push({ in: 'records', name: null, field: null });

  for (const { header, body, line, bodyLine } of blocks) {
    const name = header.trim();
    if (name === '') {
      diagnostics.push(lineDiagnostic('error', line, 'record block has no name'));
      gaps.push({ in: 'records', name: null, field: null });
      continue;
    }
    const parsed = parseFieldList(body, name, bodyLine, diagnostics, refs);
    if (records.insert(name, parsed.shape, line, diagnostics)) {
      unread[name] = parsed.unread;
      for (const field of parsed.unread) gaps.push({ in: 'records', name, field });
    } else {
      // The repeat was dropped whole. Which of the two declarations was
      // the mistake is not knowable here, so the gap covers the entry
      // rather than naming fields off the copy that lost.
      gaps.push({ in: 'records', name, field: null });
      // And the same loss travels in `unread`, as the unnamed field it is.
      // Under the flat `data = <Record>` dialect this record IS a stage's
      // shape, and `parseStages` restates whatever `unread` holds onto
      // every stage derived from it. Without this line the loss stopped on
      // the `records` side, where a stage-shaped consumer never looks — and
      // the pre-flight went back to saying the math does not declare a
      // field the dropped declaration declares, on five of the eight real
      // `.spin` files in this repo.
      //
      // Appended, not assigned: the declaration that WON may have had
      // field-level losses of its own, and they are not superseded by this
      // one.
      (unread[name] ??= []).push(null);
    }
  }
  return { records: records.build(), unread };
}

/**
 * `enum <dataType> tag stage { variant { fields... } variant2 { ... } }` —
 * one nested block per stage variant. `dataType` is whatever the game
 * block's own `data = ...` names (falling back to the conventional
 * `SpinData` when the game block didn't say), so a differently-named or
 * missing tagged enum is reported against the name the file itself chose,
 * not a hardcoded guess.
 *
 * **The flat-record dialect.** Several real `.spin` files (5 of 8 in this
 * repo's corpus — every fixture under `packages/*`, none under `engine/`)
 * skip the tagged enum entirely and point `data` straight at a plain
 * `record` instead:
 *
 * ```spin
 * record Data { stage: str  win: float }
 * game "…" { data = Data }
 * action spin      { stage = base_game   … }
 * action buy_bonus { stage = buy_bonus   … }
 * ```
 *
 * This is NOT missing information, just spread across two constructs
 * instead of one: the stage NAMES are still declared, by every action's
 * own `stage = ...`; what's missing is a PER-stage shape, because there is
 * only the one flat record. So `stages` is derived — `{ for each distinct
 * action.stage → the shape of the record data names }` — never guessed or
 * fabricated: every key comes from an actual `action.stage`, every value
 * from an actual declared record.
 *
 * **The cost of that derivation, which a consumer of `SpinSchema` WILL
 * meet:** under this dialect every stage shares the exact same
 * `RecordShape` object. A later `expects`-style check (task 4) can
 * confirm a field exists on *some* stage this game has, but it CANNOT
 * tell "this field is specific to `free_spins`" apart from "this field
 * happens to be declared at all" — the flat form structurally does not
 * distinguish them. A mechanic that only makes sense on one stage of a
 * flat-dialect game will pass a shape check it should arguably fail. This
 * is a real weakening of what the schema promises for these 5 files, not
 * a bug to fix here — the source file itself doesn't distinguish
 * per-stage shape, so nothing downstream of parsing can recover it.
 *
 * Only when NEITHER form resolves — no tagged enum matching `dataType`,
 * AND (no record named `dataType` OR no action declares any stage at
 * all) — is this genuinely undecidable, and reported as a diagnostic
 * rather than guessed. A stage variant (tagged form) or the flat record
 * (flat form) whose own fields fail to parse is dropped per-field, same
 * rule as `record`.
 */
function parseStages(
  source: string,
  diagnostics: Diagnostic[],
  dataTypeName: string,
  records: Record<string, RecordShape>,
  recordUnread: Record<string, (string | null)[]>,
  actionStageNames: string[],
  actionsDropped: boolean,
  refs: RecordRef[],
  gaps: SchemaGap[],
): Record<string, RecordShape> {
  // Its own array first, so "this scan dropped a block" is a fact here and
  // not only a line in the diagnostics — see the fall-through below.
  const enumBlockDiagnostics: Diagnostic[] = [];
  const enumBlocks = findBlocks(source, 'enum', enumBlockDiagnostics);
  diagnostics.push(...enumBlockDiagnostics);
  const wantedHeader = new RegExp(`^${escapeRegExp(dataTypeName)}\\s+tag\\s+stage$`);
  const spinData = enumBlocks.find((b) => wantedHeader.test(b.header.trim()));

  // The enum this file names could be exactly the block that scan dropped,
  // and nothing below can tell that apart from a file that has no tagged
  // enum at all. Recorded before either branch runs: whichever way the
  // fall-through goes, the stage shapes it produces are not what the file
  // declares.
  if (spinData === undefined && enumBlockDiagnostics.length > 0) {
    gaps.push({ in: 'stages', name: null, field: null });
  }

  if (spinData !== undefined) {
    // `findBlocks` needs a keyword to anchor on; stage variants have none,
    // so walk the enum body directly for `name { ... }` groups instead —
    // but through the SAME `requireMatchingBrace` findBlocks itself uses,
    // so an unterminated variant is diagnosed exactly like an unterminated
    // top-level block, not silently skipped (this used to be a second,
    // uncovered copy of that exact defect, local to this loop). Two
    // variants sharing a name go through `NamedCollection`, same rule as
    // `records` — see its doc for why that's a rule, not a per-site guess.
    const stages = new NamedCollection<RecordShape>(
      'stage variant',
      `enum ${dataTypeName} tag stage`,
    );
    const variantRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = variantRe.exec(spinData.body)) !== null) {
      const name = match[1];
      const braceStart = match.index + match[0].length - 1;
      const variantLine = spinData.bodyLine + lineAt(spinData.body, match.index) - 1;
      // NOTE ON REACHABILITY: `requireMatchingBrace` can provably never
      // return null here. `spinData.body` only ever exists because the
      // OUTER `findBlocks` call above already ran `matchingBrace` on the
      // enum's own `{` and found where it balances to exactly zero — which
      // means the body itself is internally brace-balanced, and any `{`
      // found within an already-balanced string is guaranteed to find its
      // own `}` by (at latest) the string's own end. Verified empirically
      // with adversarial nested-brace input too: it never returns
      // "unterminated", it just occasionally attributes a stray inner `{`
      // to the wrong field (as an unreadable-type diagnostic on THAT
      // field) rather than to a missing brace — a real behavior, just a
      // different one than this line exists to catch. Kept anyway: it
      // costs nothing, it keeps this loop's shape identical to
      // `findBlocks`'s (the reviewer's ask), and it is genuinely live
      // defense if `spinData.body`'s derivation ever changes.
      const braceEnd = requireMatchingBrace(
        spinData.body,
        braceStart,
        `stage variant "${name}"`,
        variantLine,
        diagnostics,
      );
      if (braceEnd === null) break; // unreachable today — see note above
      const body = spinData.body.slice(braceStart + 1, braceEnd);
      const variantBodyLine = spinData.bodyLine + lineAt(spinData.body, braceStart + 1) - 1;
      const parsed = parseFieldList(body, name, variantBodyLine, diagnostics, refs);
      if (stages.insert(name, parsed.shape, variantLine, diagnostics)) {
        for (const field of parsed.unread) gaps.push({ in: 'stages', name, field });
      } else {
        gaps.push({ in: 'stages', name, field: null });
      }
      variantRe.lastIndex = braceEnd + 1;
    }
    const built = stages.build();
    // A tagged enum that RESOLVED and yet declared nothing. The enum's own
    // brace balanced, so `findBlocks` had nothing to report, and the
    // variant scanner simply found no `name { ... }` group — which is what
    // an author gets by dropping a single `{` off the first variant. The
    // result was `stages: {}` with ZERO diagnostics, after which
    // `checkAgainstSchema` told a developer "the math declares no stages"
    // about a file that plainly declares one. Silent loss, same class as
    // the dangling references `parseSpinSchema` checks below.
    if (Object.keys(built).length === 0) {
      gaps.push({ in: 'stages', name: null, field: null });
      diagnostics.push(
        lineDiagnostic(
          'error',
          spinData.line,
          `"enum ${dataTypeName} tag stage" declares no stage variant — nothing inside it reads as "name { ... }"`,
          'give the enum at least one stage variant, e.g. "base_game { grid: [[int]] }"',
        ),
      );
    }
    return built;
  }

  // No enum matches `dataType`. Fall back to the flat-record dialect: pair
  // the ONE record `data =` names with every distinct stage the actions
  // themselves declare (see the doc comment above for why this is
  // derivation, not a guess — and its cost).
  const flatShape = records[dataTypeName];
  if (flatShape !== undefined && actionStageNames.length > 0) {
    // Under this dialect a stage's shape IS the flat record's, so the
    // record's losses are the stage's losses — restated per derived stage
    // rather than left as a `records` gap a stage-shaped consumer would
    // have to know to follow.
    for (const stageName of actionStageNames) {
      for (const field of recordUnread[dataTypeName] ?? []) {
        gaps.push({ in: 'stages', name: stageName, field });
      }
    }
    // And the stage NAMES themselves come from the actions here, so an
    // action this reading dropped is a stage that may be missing from the
    // map entirely — with no name to give it. (Under the tagged dialect
    // the names come from the enum, and a dropped action costs the stages
    // map nothing, which is why this is inside the flat branch.)
    if (actionsDropped) gaps.push({ in: 'stages', name: null, field: null });
    // No `NamedCollection` needed here: every key comes from
    // `actionStageNames` (already deduplicated — see the call site), and
    // every one of them is assigned the exact SAME `flatShape` reference,
    // so re-assigning a key that already has that identical value is not
    // a collision between two different declarations, just idempotence.
    const flatStages: Record<string, RecordShape> = {};
    for (const stageName of actionStageNames) flatStages[stageName] = flatShape;
    return flatStages;
  }

  // Genuinely undecidable: no tagged enum, and no flat-record fallback
  // possible either. Name exactly what's missing rather than guessing.
  const found = enumBlocks.map((b) => `"enum ${b.header.trim()}"`).join(', ');
  const enumPart =
    enumBlocks.length === 0
      ? `no "enum ${dataTypeName} tag stage { ... }" block found`
      : `no "enum ${dataTypeName} tag stage" block found (found: ${found})`;
  const fallbackPart =
    flatShape === undefined
      ? `no record "${dataTypeName}" to fall back to`
      : 'no action declares a stage to derive one from';
  diagnostics.push(diagnostic('error', PLUGIN, 'file', `${enumPart}, and ${fallbackPart}`));
  gaps.push({ in: 'stages', name: null, field: null });
  return {};
}

interface Clause {
  key: string;
  value: string;
  /** Offset of the key in the body it was found in — for the line a diagnostic about this clause goes on. */
  start: number;
}

/**
 * Replaces every nested `{ ... }` group's content (braces included) with
 * spaces, same length, so a nested block never leaks into clause-boundary
 * scanning. Needed for `action`'s inline `feature { buy = 1 }`: without
 * this, `buy` (not a known clause key) creates no boundary of its own, so
 * the whole `feature { ... }` group would otherwise glue itself onto
 * whichever clause precedes it (e.g. `cost = 5.0  feature { buy = 1 }`
 * would make "5.0  feature { buy = 1 }" the value read for `cost`,
 * failing `Number(...)` and losing the entire action — a real bug this
 * caught against `feature.spin`'s `buy_bonus`). Preserving length keeps
 * every other offset in the body valid.
 */
function blankNestedBraces(text: string): string {
  let result = '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') {
      depth++;
      result += ' ';
    } else if (ch === '}') {
      if (depth > 0) depth--;
      result += ' ';
    } else {
      result += depth > 0 ? ' ' : ch;
    }
  }
  return result;
}

/** Walks left from a `{`'s index past whitespace, then past an identifier
 *  if one is there — i.e. finds the start of `name` in `name { ... }`, not
 *  just the brace itself. Needed so a nested block's own HEADER keyword
 *  (e.g. `feature`) doesn't stay behind as trailing garbage on whichever
 *  clause precedes it once the brace group itself is excluded. */
function blockHeaderStart(text: string, braceStart: number): number {
  let i = braceStart;
  while (i > 0 && /\s/.test(text[i - 1])) i--;
  let j = i;
  while (j > 0 && /[A-Za-z0-9_]/.test(text[j - 1])) j--;
  return j;
}

/** Every top-level `name { ... }` block's full span in `text`, header
 *  keyword included (start of `name` through the matching `}`) — used to
 *  stop a clause's value at the start of a nested block like
 *  `feature { ... }` even when nothing inside that block, or its own
 *  header, happens to look like a known clause key. */
function findTopLevelBraceSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      const end = matchingBrace(text, i);
      if (end === -1) break;
      spans.push({ start: blockHeaderStart(text, i), end });
      i = end + 1;
    } else {
      i++;
    }
  }
  return spans;
}

/**
 * Splits a block body into `key = value` clauses (plus, when requested,
 * `ends when <var>`). A clause boundary is found generically — ANY
 * `identifier =` (not `==`, see below), not just this block's own known
 * keys — but only boundaries whose key is actually one of `keys` (or
 * `ends when`) make it into the returned list. Scanning generically and
 * filtering afterward, rather than scanning for just the known keys, is
 * what makes an UNRECOGNIZED clause still terminate the value of
 * whichever recognized clause precedes it, instead of leaking into it:
 * kitsune-wrath's `spirit_gate_spin` has `session = true` immediately
 * followed by a `group = spirit_gate` clause this vocabulary doesn't
 * model (see the report) — without treating `group =` as a boundary too,
 * `session`'s value becomes `"true\n  group = spirit_gate"`, which fails
 * the `=== 'true'` check and silently drops the whole session flag.
 *
 * Three things this buys, all measured against real fixtures, not
 * hypothesized:
 *
 * 1. **Whitespace independence.** `.spin` has no one convention for how
 *    many clauses share a line — `game { ... }` usually writes one
 *    `key = value` per line, `action` usually crowds several onto one
 *    line with a double space, and `logic.spin` (a real fixture) crowds
 *    two with a SINGLE space: `stage = base_game cost = 1.0`. A clause
 *    boundary is "the next `identifier =`", never "N spaces" or "a
 *    newline", so all three read the same way. (This is the fix for the
 *    original whitespace-run splitter, which swallowed `logic.spin`'s
 *    whole clause into one, losing `cost` and misreporting `stage` as
 *    missing.)
 * 2. **Safety against `when`'s own `==`.** A `when` condition can contain
 *    text that looks like an assignment (kitsune-wrath's
 *    `opens = spirit_gate count spirit_gate_open when spirit_gate_open == -1`
 *    has `spirit_gate_open ==` right there). The boundary pattern requires
 *    an `=` NOT itself followed by another `=`, so a `==` comparison is
 *    never mistaken for a clause.
 * 3. **Safety against a nested block's own clauses and header.** `feature`
 *    is itself a known key when it appears as `feature = X` (`game`'s
 *    convention), but `action`'s inline `feature { buy = 1 }` must not
 *    let `buy = 1` register as a boundary, nor let the literal word
 *    `feature` (with no `=` of its own — it's followed by `{`) leak onto
 *    the preceding clause. Nested-brace CONTENT is blanked out before the
 *    generic scan runs, and each nested block's full span — header
 *    keyword included — is added back in as an anonymous, unreturned
 *    boundary purely to terminate whatever precedes it (this is the fix
 *    for a real, measured failure: `feature.spin`'s `buy_bonus` action
 *    was lost entirely because `cost`'s value came out as
 *    `"5.0  feature { buy = 1 }"`, which fails `Number(...)`).
 *
 * Returns every match, in order, WITHOUT deduplicating by key — an action
 * can carry more than one `opens =` (see kitsune-wrath again), and losing
 * all but the last would silently drop a real declaration.
 */
function findClauses(body: string, keys: string[], includeEndsWhen: boolean): Clause[] {
  const flat = blankNestedBraces(body);
  type Boundary = { key: string; start: number; end: number };
  const boundaries: Boundary[] = [];

  // Any `identifier =`, generically — not just this block's own known
  // keys — so an unrecognized clause still terminates its neighbour's
  // value. `(?!=)` excludes `==` (a `when` condition's comparison), never
  // an assignment in this grammar.
  const anyKeyPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/g;
  let match: RegExpExecArray | null;
  while ((match = anyKeyPattern.exec(flat)) !== null) {
    boundaries.push({ key: match[1], start: match.index, end: anyKeyPattern.lastIndex });
  }
  if (includeEndsWhen) {
    const endsWhenPattern = /\bends\s+when\b/g;
    while ((match = endsWhenPattern.exec(flat)) !== null) {
      boundaries.push({ key: 'ends when', start: match.index, end: endsWhenPattern.lastIndex });
    }
  }

  // Each nested block's full span (header keyword through its closing
  // brace) goes in too, as a terminator-only marker (`\0brace` is never a
  // real clause key, so it's filtered out below alongside any other
  // unrecognized boundary) — see point 3 above.
  for (const span of findTopLevelBraceSpans(body)) {
    boundaries.push({ key: '\0brace', start: span.start, end: span.end });
  }

  boundaries.sort((a, b) => a.start - b.start);

  const keySet = new Set(keys);
  const clauses: Clause[] = [];
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    if (!keySet.has(b.key) && !(includeEndsWhen && b.key === 'ends when')) continue;
    const valueEnd = boundaries[i + 1]?.start ?? body.length;
    clauses.push({ key: b.key, value: body.slice(b.end, valueEnd).trim(), start: b.start });
  }
  return clauses;
}

function parseNumberArray(text: string): number[] | null {
  const t = text.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  const inner = t.slice(1, -1).trim();
  if (inner === '') return [];
  const parts = inner.split(',').map((p) => Number(p.trim()));
  return parts.every((n) => Number.isFinite(n)) ? parts : null;
}

const GAME_KEYS = ['bet_levels', 'max_win', 'vars', 'feature', 'data', 'globals'];

/** A game-block clause that names a record (`vars = Vars`), with the line the clause is on. */
interface ClauseRef {
  name: string;
  line: number;
}

function parseGame(
  source: string,
  diagnostics: Diagnostic[],
): {
  gameId: string;
  betLevels: number[];
  maxWin: number;
  line: number;
  vars?: ClauseRef;
  globals?: ClauseRef;
  dataName?: string;
} | null {
  const blocks = findBlocks(source, 'game', diagnostics);
  if (blocks.length === 0) {
    diagnostics.push(diagnostic('error', PLUGIN, 'file', 'no "game { ... }" block found'));
    return null;
  }
  const { header, body, line, bodyLine } = blocks[0];
  // The first block wins — the same rule `NamedCollection` applies to a
  // repeated name, for the same reason: `SpinSchema` has one `gameId`,
  // one `bet_levels` and one `max_win`, so "keep both" is not a shape it
  // can hold. What changed is that the losers are now NAMED. A second
  // `game { }` block (a copy-paste left behind mid-edit, most likely) was
  // taken off the file in complete silence, and the schema that came back
  // looked exactly like a file with one.
  for (const extra of blocks.slice(1)) {
    diagnostics.push(
      lineDiagnostic(
        'error',
        extra.line,
        `a second "game ${extra.header.trim()}" block — a file declares exactly one game; keeping the one on line ${line}, dropping this one`,
        'delete the duplicate game block, or merge its clauses into the first',
      ),
    );
  }
  const nameMatch = /^"([^"]*)"$/.exec(header.trim());
  if (nameMatch === null) {
    diagnostics.push(lineDiagnostic('error', line, 'game block has no quoted name'));
    return null;
  }
  const clauses = findClauses(body, GAME_KEYS, false);
  const get = (key: string) => clauses.find((c) => c.key === key)?.value;
  const ref = (key: string): ClauseRef | undefined => {
    const clause = clauses.find((c) => c.key === key);
    return clause && { name: clause.value, line: bodyLine + lineAt(body, clause.start) - 1 };
  };

  const betLevelsText = get('bet_levels');
  const maxWinText = get('max_win');
  const betLevels = betLevelsText === undefined ? null : parseNumberArray(betLevelsText);
  const maxWin = maxWinText === undefined ? NaN : Number(maxWinText);
  if (betLevels === null || !Number.isFinite(maxWin)) {
    diagnostics.push(
      lineDiagnostic('error', line, 'game block is missing "bet_levels" or "max_win"'),
    );
    return null;
  }
  return {
    gameId: nameMatch[1],
    betLevels,
    maxWin,
    line,
    vars: ref('vars'),
    globals: ref('globals'),
    dataName: get('data'),
  };
}

/** `<action> count <var>`, optionally followed by `when <condition>` — the
 *  condition is kept as raw text, never parsed into structure (per plan:
 *  every consumer this needs only shows or re-evaluates it as an
 *  expression). */
function parseOpens(text: string): { action: string; countVar: string; when?: string } | undefined {
  const match =
    /^([A-Za-z_][A-Za-z0-9_]*)\s+count\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+when\s+(.+))?$/.exec(
      text.trim(),
    );
  if (match === null) return undefined;
  const [, action, countVar, when] = match;
  return when !== undefined && when.trim() !== ''
    ? { action, countVar, when: when.trim() }
    : { action, countVar };
}

/** `feature { key = value ... }`, nested inside an `action` block's body. */
function parseInlineFeature(
  body: string,
  diagnostics: Diagnostic[],
): Record<string, number> | undefined {
  const featureBlocks = findBlocks(body, 'feature', diagnostics);
  if (featureBlocks.length === 0) return undefined;
  const feature: Record<string, number> = {};
  for (const line of featureBlocks[0].body.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/.exec(line);
    if (match) feature[match[1]] = Number(match[2]);
  }
  return feature;
}

/**
 * No `'feature'`: an action's feature is the nested BLOCK form
 * (`feature { buy = 1 }`), read by `parseInlineFeature` above, and
 * `parseActions` never asks `findClauses` for a `feature` clause. Listing
 * it here bought nothing and implied `feature = X` is a legal action
 * clause, which it is not — the clause form belongs to the game block
 * (`GAME_KEYS`). Removing it costs no boundary either: `findClauses`
 * records a boundary at every `identifier =` it sees, known key or not,
 * precisely so an unrecognized clause still terminates its neighbour's
 * value.
 */
const ACTION_KEYS = ['stage', 'cost', 'session', 'extends', 'opens'];

/**
 * Every `action` block, plus whether reading them lost one.
 *
 * `dropped` matters to `parseStages` and to nothing else: under the flat
 * `data = <Record>` dialect the set of stage names is derived from the
 * actions, so an action this function could not read is a stage that may
 * be absent from `stages` with no name to record it under.
 */
function parseActions(
  source: string,
  diagnostics: Diagnostic[],
): { actions: ActionDef[]; dropped: boolean } {
  const actions: ActionDef[] = [];
  const blockDiagnostics: Diagnostic[] = [];
  const blocks = findBlocks(source, 'action', blockDiagnostics);
  diagnostics.push(...blockDiagnostics);
  let dropped = blockDiagnostics.length > 0;
  for (const { header, body, line, bodyLine } of blocks) {
    const name = header.trim();
    if (name === '') {
      diagnostics.push(lineDiagnostic('error', line, 'action block has no name'));
      dropped = true;
      continue;
    }
    const clauses = findClauses(body, ACTION_KEYS, true);
    const get = (key: string) => clauses.find((c) => c.key === key)?.value;
    const getAll = (key: string) => clauses.filter((c) => c.key === key);

    const stage = get('stage');
    const costText = get('cost');
    const cost = costText === undefined ? NaN : Number(costText);
    if (stage === undefined || !Number.isFinite(cost)) {
      diagnostics.push(
        lineDiagnostic('error', line, `action "${name}" is missing "stage" or "cost"`),
      );
      dropped = true;
      continue;
    }
    const action: ActionDef = { name, stage, cost };

    const sessionText = get('session');
    if (sessionText === 'true') action.session = true;

    const extendsVar = get('extends');
    if (extendsVar !== undefined) action.extendsVar = extendsVar;

    const endsWhenVar = get('ends when');
    if (endsWhenVar !== undefined) action.endsWhenVar = endsWhenVar;

    const opensClauses = getAll('opens');
    if (opensClauses.length > 0) {
      const opens: { action: string; countVar: string; when?: string }[] = [];
      for (const { value: text, start } of opensClauses) {
        const entry = parseOpens(text);
        if (entry === undefined) {
          diagnostics.push(
            lineDiagnostic(
              'error',
              bodyLine + lineAt(body, start) - 1,
              `action "${name}": unreadable "opens" clause "${text}"`,
            ),
          );
          continue;
        }
        opens.push(entry);
      }
      if (opens.length > 0) action.opens = opens;
    }

    const feature = parseInlineFeature(body, diagnostics);
    if (feature !== undefined) action.feature = feature;

    actions.push(action);
  }
  return { actions, dropped };
}

/**
 * Parses a `.spin` file's declarative section into a `SpinSchema`. Never
 * throws: an unparseable file yields `schema: null` plus a diagnostic, and
 * a single malformed declaration is dropped (with its own diagnostic)
 * rather than losing the rest of an otherwise-good file.
 */
export function parseSpinSchema(source: string): {
  schema: SpinSchema | null;
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const clean = stripComments(source);

  const game = parseGame(clean, diagnostics);
  if (game === null) return { schema: null, diagnostics };

  const refs: RecordRef[] = [];
  // Every place this reading drops something a `.spin` declares. It travels
  // on the schema so a consumer can tell "the math does not declare X"
  // apart from "we could not read where it does" — see `SchemaGap`.
  const gaps: SchemaGap[] = [];
  const { records, unread: recordUnread } = parseRecords(clean, diagnostics, refs, gaps);
  const { actions, dropped: actionsDropped } = parseActions(clean, diagnostics);
  const actionStageNames = [...new Set(actions.map((a) => a.stage))];
  const stages = parseStages(
    clean,
    diagnostics,
    game.dataName ?? 'SpinData',
    records,
    recordUnread,
    actionStageNames,
    actionsDropped,
    refs,
    gaps,
  );

  // Every reference that points at nothing. Run here, after the whole
  // file, because a forward reference is legal — `positions: [CellPos]`
  // may precede `record CellPos`, and it does in `first-slot`.
  //
  // `data =` is deliberately NOT checked here: `parseStages` above already
  // reports it, in a message that also says which dialect it was looking
  // for, and a second complaint about the same name would only make the
  // one that knows more harder to find.
  diagnostics.push(...checkReferences(game, records, refs));

  const vars = (game.vars !== undefined && records[game.vars.name]) || {};
  const globals = game.globals !== undefined ? records[game.globals.name] : undefined;

  const schema: SpinSchema = {
    gameId: game.gameId,
    betLevels: game.betLevels,
    maxWin: game.maxWin,
    vars,
    stages,
    records,
    actions,
    gaps,
    ...(globals !== undefined ? { globals } : {}),
  };

  return { schema, diagnostics };
}

/**
 * The dangling REFERENCE — the third silent-loss class, alongside the
 * unterminated block `findBlocks` catches and the repeated name
 * `NamedCollection` catches.
 *
 * A name that POINTS at something can be wrong in a way a name that
 * DECLARES something cannot, and every one of these resolved to a value
 * that looked ordinary:
 *
 *  - `vars = Varz` (one character off) became `vars: {}` — a game with no
 *    persistent variables, which is a perfectly legal thing to be;
 *  - `globals = Nope` dropped the field entirely, indistinguishable from
 *    a file that declares no globals;
 *  - a field typed by a record nobody declared stayed in the schema as
 *    `{ kind: 'record', name: 'NoSuchRecord' }`, which every consumer will
 *    follow into nothing.
 *
 * Nothing reads `vars`/`globals`/`records` today. That is exactly why this
 * had to be closed now: the first consumer to arrive would have inherited
 * three silent wrong answers and no way to see where they came from.
 *
 * A dangling field reference is diagnosed but the FIELD IS KEPT. Which of
 * the two names is the mistake — the reference or the missing declaration
 * — is not something this parser can know, and dropping the field would
 * lose a second thing on a guess. `vars` and `globals` have no such
 * choice: there is nothing to keep.
 */
function checkReferences(
  game: { vars?: ClauseRef; globals?: ClauseRef },
  records: Record<string, RecordShape>,
  refs: RecordRef[],
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const declared = Object.keys(records);
  const known = declared.length > 0 ? declared.join(', ') : '(none)';

  for (const [clause, ref] of [
    ['vars', game.vars],
    ['globals', game.globals],
  ] as const) {
    if (ref === undefined || ref.name in records) continue;
    const { name, line } = ref;
    diagnostics.push(
      lineDiagnostic(
        'error',
        line,
        `game block: "${clause} = ${name}" names a record the file does not declare — it declares: ${known}`,
        `fix the name after "${clause} =", or add "record ${name} { ... }"`,
      ),
    );
  }

  for (const ref of refs) {
    if (ref.name in records) continue;
    diagnostics.push(
      lineDiagnostic(
        'error',
        ref.line,
        `block "${ref.owner}": field "${ref.field}" is typed "${ref.name}", which is not a built-in type and which the file does not declare as a record — it declares: ${known}`,
        `fix the type of "${ref.field}", or add "record ${ref.name} { ... }"`,
      ),
    );
  }

  return diagnostics;
}
