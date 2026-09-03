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
 * That guarantee covers two failure shapes, each resolved in exactly ONE
 * place so a new block kind or a new name-keyed collection inherits it by
 * construction rather than by a future author remembering to reimplement
 * it: an unterminated block (a `{` with no matching `}` — an ordinary
 * missing-brace typo, not an exotic input) is diagnosed by `findBlocks`
 * itself, the single function every block form goes through; a name an
 * author repeated (two `record Vars`, two `base_game` variants in one
 * enum) is diagnosed by `NamedCollection`, the single type every
 * name-keyed accumulator is built on. `actions` needs neither — it's an
 * array, so a repeated action name is just two entries, not a collision.
 * Where attribution can still point at a NEIGHBOR rather than the exact
 * culprit (garbage text with no field-name colon of its own, glued onto
 * whichever field precedes it) the loss is still visible as SOME
 * diagnostic on SOME field, never zero diagnostics — see `parseFieldList`.
 */
import { type Diagnostic, diagnostic, type ActionDef, type FieldType, type RecordShape, type SpinSchema } from '@energy8engine/contracts';

const PLUGIN = 'spin-parser';

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
): { header: string; body: string; line: number }[] {
  const results: { header: string; body: string; line: number }[] = [];
  const re = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const afterKeyword = match.index + match[0].length;
    const line = source.slice(0, match.index).split('\n').length;
    const braceStart = source.indexOf('{', afterKeyword);
    if (braceStart === -1) {
      diagnostics.push(
        diagnostic('error', PLUGIN, `line ${line}`, `"${keyword}" block has no "{" — nothing to parse`),
      );
      continue;
    }
    const header = source.slice(afterKeyword, braceStart).trim();
    const label = header === '' ? `"${keyword}"` : `"${keyword} ${header}"`;
    const bodyEnd = requireMatchingBrace(source, braceStart, label, line, diagnostics);
    if (bodyEnd === null) continue;
    const body = source.slice(braceStart + 1, bodyEnd);
    results.push({ header, body, line });
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
    diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, `${label}: unterminated block — no matching "}" found`));
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
  line: number,
  diagnostics: Diagnostic[],
): RecordShape {
  const shape: RecordShape = {};
  const fieldRe = /([A-Za-z_][A-Za-z0-9_]*)\s*:/g;
  const boundaries: { name: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = fieldRe.exec(body)) !== null) {
    boundaries.push({ name: match[1], start: match.index, end: fieldRe.lastIndex });
  }

  const leading = body.slice(0, boundaries[0]?.start ?? body.length).trim();
  if (leading !== '') {
    diagnostics.push(
      diagnostic(
        'error',
        PLUGIN,
        `line ${line}`,
        `block "${blockName}": unreadable declaration "${leading}" (expected "name: Type")`,
      ),
    );
  }

  for (let i = 0; i < boundaries.length; i++) {
    const { name, end } = boundaries[i];
    const valueEnd = boundaries[i + 1]?.start ?? body.length;
    const typeText = body.slice(end, valueEnd).trim();
    const type = typeText === '' ? null : parseFieldType(typeText);
    if (type === null) {
      diagnostics.push(
        diagnostic(
          'error',
          PLUGIN,
          `line ${line}`,
          `block "${blockName}": field "${name}" has an unreadable type "${typeText === '' ? '(empty)' : typeText}"`,
        ),
      );
      continue;
    }
    shape[name] = type;
  }

  return shape;
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

  insert(name: string, value: T, line: number, diagnostics: Diagnostic[]): void {
    if (name in this.map) {
      diagnostics.push(
        diagnostic(
          'error',
          PLUGIN,
          `line ${line}`,
          `duplicate ${this.kind} "${name}"${this.scope === '' ? '' : ` in ${this.scope}`} — keeping the first, dropping this one`,
        ),
      );
      return;
    }
    this.map[name] = value;
  }

  build(): Record<string, T> {
    return this.map;
  }
}

function parseRecords(source: string, diagnostics: Diagnostic[]): Record<string, RecordShape> {
  const records = new NamedCollection<RecordShape>('record', '');
  for (const { header, body, line } of findBlocks(source, 'record', diagnostics)) {
    const name = header.trim();
    if (name === '') {
      diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, 'record block has no name'));
      continue;
    }
    records.insert(name, parseFieldList(body, name, line, diagnostics), line, diagnostics);
  }
  return records.build();
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
  actionStageNames: string[],
): Record<string, RecordShape> {
  const enumBlocks = findBlocks(source, 'enum', diagnostics);
  const wantedHeader = new RegExp(`^${escapeRegExp(dataTypeName)}\\s+tag\\s+stage$`);
  const spinData = enumBlocks.find((b) => wantedHeader.test(b.header.trim()));

  if (spinData !== undefined) {
    // `findBlocks` needs a keyword to anchor on; stage variants have none,
    // so walk the enum body directly for `name { ... }` groups instead —
    // but through the SAME `requireMatchingBrace` findBlocks itself uses,
    // so an unterminated variant is diagnosed exactly like an unterminated
    // top-level block, not silently skipped (this used to be a second,
    // uncovered copy of that exact defect, local to this loop). Two
    // variants sharing a name go through `NamedCollection`, same rule as
    // `records` — see its doc for why that's a rule, not a per-site guess.
    const stages = new NamedCollection<RecordShape>('stage variant', `enum ${dataTypeName} tag stage`);
    const variantRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = variantRe.exec(spinData.body)) !== null) {
      const name = match[1];
      const braceStart = match.index + match[0].length - 1;
      const variantLine = spinData.line + spinData.body.slice(0, match.index).split('\n').length - 1;
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
      const braceEnd = requireMatchingBrace(spinData.body, braceStart, `stage variant "${name}"`, variantLine, diagnostics);
      if (braceEnd === null) break; // unreachable today — see note above
      const body = spinData.body.slice(braceStart + 1, braceEnd);
      stages.insert(name, parseFieldList(body, name, variantLine, diagnostics), variantLine, diagnostics);
      variantRe.lastIndex = braceEnd + 1;
    }
    return stages.build();
  }

  // No enum matches `dataType`. Fall back to the flat-record dialect: pair
  // the ONE record `data =` names with every distinct stage the actions
  // themselves declare (see the doc comment above for why this is
  // derivation, not a guess — and its cost).
  const flatShape = records[dataTypeName];
  if (flatShape !== undefined && actionStageNames.length > 0) {
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
  return {};
}

interface Clause {
  key: string;
  value: string;
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
    clauses.push({ key: b.key, value: body.slice(b.end, valueEnd).trim() });
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

function parseGame(
  source: string,
  diagnostics: Diagnostic[],
): { gameId: string; betLevels: number[]; maxWin: number; varsName?: string; globalsName?: string; dataName?: string } | null {
  const blocks = findBlocks(source, 'game', diagnostics);
  if (blocks.length === 0) {
    diagnostics.push(diagnostic('error', PLUGIN, 'file', 'no "game { ... }" block found'));
    return null;
  }
  const { header, body, line } = blocks[0];
  const nameMatch = /^"([^"]*)"$/.exec(header.trim());
  if (nameMatch === null) {
    diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, 'game block has no quoted name'));
    return null;
  }
  const clauses = findClauses(body, GAME_KEYS, false);
  const get = (key: string) => clauses.find((c) => c.key === key)?.value;

  const betLevelsText = get('bet_levels');
  const maxWinText = get('max_win');
  const betLevels = betLevelsText === undefined ? null : parseNumberArray(betLevelsText);
  const maxWin = maxWinText === undefined ? NaN : Number(maxWinText);
  if (betLevels === null || !Number.isFinite(maxWin)) {
    diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, 'game block is missing "bet_levels" or "max_win"'));
    return null;
  }
  return {
    gameId: nameMatch[1],
    betLevels,
    maxWin,
    varsName: get('vars'),
    globalsName: get('globals'),
    dataName: get('data'),
  };
}

/** `<action> count <var>`, optionally followed by `when <condition>` — the
 *  condition is kept as raw text, never parsed into structure (per plan:
 *  every consumer this needs only shows or re-evaluates it as an
 *  expression). */
function parseOpens(text: string): { action: string; countVar: string; when?: string } | undefined {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+count\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+when\s+(.+))?$/.exec(text.trim());
  if (match === null) return undefined;
  const [, action, countVar, when] = match;
  return when !== undefined && when.trim() !== '' ? { action, countVar, when: when.trim() } : { action, countVar };
}

/** `feature { key = value ... }`, nested inside an `action` block's body. */
function parseInlineFeature(body: string, diagnostics: Diagnostic[]): Record<string, number> | undefined {
  const featureBlocks = findBlocks(body, 'feature', diagnostics);
  if (featureBlocks.length === 0) return undefined;
  const feature: Record<string, number> = {};
  for (const line of featureBlocks[0].body.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/.exec(line);
    if (match) feature[match[1]] = Number(match[2]);
  }
  return feature;
}

const ACTION_KEYS = ['stage', 'cost', 'session', 'extends', 'opens', 'feature'];

function parseActions(source: string, diagnostics: Diagnostic[]): ActionDef[] {
  const actions: ActionDef[] = [];
  for (const { header, body, line } of findBlocks(source, 'action', diagnostics)) {
    const name = header.trim();
    if (name === '') {
      diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, 'action block has no name'));
      continue;
    }
    const clauses = findClauses(body, ACTION_KEYS, true);
    const get = (key: string) => clauses.find((c) => c.key === key)?.value;
    const getAll = (key: string) => clauses.filter((c) => c.key === key).map((c) => c.value);

    const stage = get('stage');
    const costText = get('cost');
    const cost = costText === undefined ? NaN : Number(costText);
    if (stage === undefined || !Number.isFinite(cost)) {
      diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, `action "${name}" is missing "stage" or "cost"`));
      continue;
    }
    const action: ActionDef = { name, stage, cost };

    const sessionText = get('session');
    if (sessionText === 'true') action.session = true;

    const extendsVar = get('extends');
    if (extendsVar !== undefined) action.extendsVar = extendsVar;

    const endsWhenVar = get('ends when');
    if (endsWhenVar !== undefined) action.endsWhenVar = endsWhenVar;

    const opensTexts = getAll('opens');
    if (opensTexts.length > 0) {
      const opens: { action: string; countVar: string; when?: string }[] = [];
      for (const text of opensTexts) {
        const entry = parseOpens(text);
        if (entry === undefined) {
          diagnostics.push(
            diagnostic('error', PLUGIN, `line ${line}`, `action "${name}": unreadable "opens" clause "${text}"`),
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
  return actions;
}

/**
 * Parses a `.spin` file's declarative section into a `SpinSchema`. Never
 * throws: an unparseable file yields `schema: null` plus a diagnostic, and
 * a single malformed declaration is dropped (with its own diagnostic)
 * rather than losing the rest of an otherwise-good file.
 */
export function parseSpinSchema(source: string): { schema: SpinSchema | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const clean = stripComments(source);

  const game = parseGame(clean, diagnostics);
  if (game === null) return { schema: null, diagnostics };

  const records = parseRecords(clean, diagnostics);
  const actions = parseActions(clean, diagnostics);
  const actionStageNames = [...new Set(actions.map((a) => a.stage))];
  const stages = parseStages(clean, diagnostics, game.dataName ?? 'SpinData', records, actionStageNames);

  const vars = (game.varsName !== undefined && records[game.varsName]) || {};
  const globals = game.globalsName !== undefined ? records[game.globalsName] : undefined;

  const schema: SpinSchema = {
    gameId: game.gameId,
    betLevels: game.betLevels,
    maxWin: game.maxWin,
    vars,
    stages,
    records,
    actions,
    ...(globals !== undefined ? { globals } : {}),
  };

  return { schema, diagnostics };
}
