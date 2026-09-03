/**
 * Reads the declarative section a `.spin` file already states — the
 * `record`/`enum SpinData tag stage`/`game`/`action` blocks — into a
 * `SpinSchema`. Everything else in the file (`const`, `fn`, the body of
 * `execute`) is math, not shape, and is skipped rather than parsed.
 *
 * Pure: a string in, a schema and diagnostics out. No `fs`, no cordis — the
 * host (a later task) reads the file and calls this. And it never throws:
 * a file it cannot make sense of yields `schema: null` plus a diagnostic
 * naming what was missing, and a single malformed block (say, one broken
 * `record`) drops only that block from the schema, with a diagnostic saying
 * so, rather than losing everything else that DID parse.
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

/**
 * Finds every top-level `keyword ... { ... }` block by keyword, respecting
 * brace nesting so a block's own nested `{ }` (e.g. a stage variant inside
 * `enum SpinData tag stage { ... }`) doesn't end the match early. Returns
 * each match's header (between the keyword and the opening brace) and body
 * (between the matched braces), plus the 1-based line the block starts on
 * (for diagnostics).
 */
function findBlocks(
  source: string,
  keyword: string,
): { header: string; body: string; line: number }[] {
  const results: { header: string; body: string; line: number }[] = [];
  const re = new RegExp(`\\b${keyword}\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const afterKeyword = match.index + match[0].length;
    const braceStart = source.indexOf('{', afterKeyword);
    if (braceStart === -1) continue;
    const header = source.slice(afterKeyword, braceStart).trim();
    const bodyEnd = matchingBrace(source, braceStart);
    if (bodyEnd === -1) continue;
    const body = source.slice(braceStart + 1, bodyEnd);
    const line = source.slice(0, match.index).split('\n').length;
    results.push({ header, body, line });
    re.lastIndex = bodyEnd + 1;
  }
  return results;
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
 * Parses a `name: Type` field list, whitespace- or newline-separated
 * (`.spin` uses no commas between record/stage fields — see `first-slot`'s
 * `record CascadeStep { grid: [[int]] removed: [CellPos] win: float }`).
 * A field whose type fails to parse is dropped and reported; the rest of
 * the block still parses.
 */
function parseFieldList(
  body: string,
  blockName: string,
  line: number,
  diagnostics: Diagnostic[],
): RecordShape | null {
  const shape: RecordShape = {};
  const fieldRe = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*((?:\[[^\]]*\]|[^\s?])+\??)/g;
  let match: RegExpExecArray | null;
  let any = false;
  while ((match = fieldRe.exec(body)) !== null) {
    any = true;
    const [, name, typeText] = match;
    const type = parseFieldType(typeText);
    if (type === null) {
      diagnostics.push(
        diagnostic('error', PLUGIN, `line ${line}`, `block "${blockName}": field "${name}" has an unreadable type "${typeText}"`),
      );
      continue;
    }
    shape[name] = type;
  }
  if (!any && body.trim() !== '') {
    diagnostics.push(
      diagnostic('error', PLUGIN, `line ${line}`, `block "${blockName}": no readable "name: Type" fields`),
    );
    return null;
  }
  return shape;
}

function parseRecords(source: string, diagnostics: Diagnostic[]): Record<string, RecordShape> {
  const records: Record<string, RecordShape> = {};
  for (const { header, body, line } of findBlocks(source, 'record')) {
    const name = header.trim();
    if (name === '') {
      diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, 'record block has no name'));
      continue;
    }
    const shape = parseFieldList(body, name, line, diagnostics);
    if (shape === null) continue;
    records[name] = shape;
  }
  return records;
}

/**
 * `enum SpinData tag stage { variant { fields... } variant2 { ... } }` —
 * one nested block per stage variant. Only the first tagged enum (`.spin`
 * declares exactly one `SpinData`) is read; a stage variant whose own
 * fields fail to parse is dropped, same rule as `record`.
 */
function parseStages(source: string, diagnostics: Diagnostic[]): Record<string, RecordShape> {
  const stages: Record<string, RecordShape> = {};
  const enumBlocks = findBlocks(source, 'enum');
  const spinData = enumBlocks.find((b) => /^SpinData\s+tag\s+stage$/.test(b.header.trim()));
  if (spinData === undefined) return stages;
  // `findBlocks` needs a keyword to anchor on; stage variants have none, so
  // walk the enum body directly for `name { ... }` groups instead.
  const variantRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = variantRe.exec(spinData.body)) !== null) {
    const name = match[1];
    const braceStart = match.index + match[0].length - 1;
    const braceEnd = matchingBrace(spinData.body, braceStart);
    if (braceEnd === -1) continue;
    const body = spinData.body.slice(braceStart + 1, braceEnd);
    const variantLine = spinData.line + spinData.body.slice(0, match.index).split('\n').length - 1;
    const shape = parseFieldList(body, name, variantLine, diagnostics);
    if (shape !== null) stages[name] = shape;
    variantRe.lastIndex = braceEnd + 1;
  }
  return stages;
}

/**
 * `key = value` clauses inside a block body. `.spin` writes these either
 * one per line (`game { ... }`'s usual style) or several to a line
 * separated by a double space (`action`'s usual style — see
 * `stage = base_game  cost = 1.0`), so a clause boundary is a newline OR a
 * run of 2+ spaces; a single space stays inside a clause's own value
 * (`opens = free_spin count free_spins_awarded` is one clause, not three).
 */
function parseAssignments(body: string): Map<string, string> {
  const assignments = new Map<string, string>();
  const clauses = body
    .split(/\n|[ \t]{2,}/)
    .map((c) => c.trim())
    .filter((c) => c !== '');
  for (const clause of clauses) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(clause);
    if (match) assignments.set(match[1], match[2].trim());
  }
  return assignments;
}

function parseNumberArray(text: string): number[] | null {
  const t = text.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  const inner = t.slice(1, -1).trim();
  if (inner === '') return [];
  const parts = inner.split(',').map((p) => Number(p.trim()));
  return parts.every((n) => Number.isFinite(n)) ? parts : null;
}

function parseGame(source: string, diagnostics: Diagnostic[]): { gameId: string; betLevels: number[]; maxWin: number } | null {
  const blocks = findBlocks(source, 'game');
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
  const assignments = parseAssignments(body);
  const betLevelsText = assignments.get('bet_levels');
  const maxWinText = assignments.get('max_win');
  const betLevels = betLevelsText === undefined ? null : parseNumberArray(betLevelsText);
  const maxWin = maxWinText === undefined ? NaN : Number(maxWinText);
  if (betLevels === null || !Number.isFinite(maxWin)) {
    diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, 'game block is missing "bet_levels" or "max_win"'));
    return null;
  }
  return { gameId: nameMatch[1], betLevels, maxWin };
}

/** `opens = <action> count <var>`. */
function parseOpens(text: string): { action: string; countVar: string } | undefined {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s+count\s+([A-Za-z_][A-Za-z0-9_]*)$/.exec(text.trim());
  return match === undefined || match === null ? undefined : { action: match[1], countVar: match[2] };
}

/** `feature { key = value ... }`, nested inside an `action` block's body. */
function parseInlineFeature(body: string): Record<string, number> | undefined {
  const featureBlocks = findBlocks(body, 'feature');
  if (featureBlocks.length === 0) return undefined;
  const feature: Record<string, number> = {};
  for (const line of featureBlocks[0].body.split('\n')) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/.exec(line);
    if (match) feature[match[1]] = Number(match[2]);
  }
  return feature;
}

function parseActions(source: string, diagnostics: Diagnostic[]): ActionDef[] {
  const actions: ActionDef[] = [];
  for (const { header, body, line } of findBlocks(source, 'action')) {
    const name = header.trim();
    if (name === '') {
      diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, 'action block has no name'));
      continue;
    }
    const assignments = parseAssignments(body);
    const stage = assignments.get('stage');
    const costText = assignments.get('cost');
    const cost = costText === undefined ? NaN : Number(costText);
    if (stage === undefined || !Number.isFinite(cost)) {
      diagnostics.push(diagnostic('error', PLUGIN, `line ${line}`, `action "${name}" is missing "stage" or "cost"`));
      continue;
    }
    const action: ActionDef = { name, stage, cost };
    const sessionText = assignments.get('session');
    if (sessionText === 'true') action.session = true;
    const extendsVar = assignments.get('extends');
    if (extendsVar !== undefined) action.extendsVar = extendsVar;
    const endsWhenMatch = /\bends\s+when\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(body);
    if (endsWhenMatch) action.endsWhenVar = endsWhenMatch[1];
    const opensText = assignments.get('opens');
    if (opensText !== undefined) {
      const opens = parseOpens(opensText);
      if (opens !== undefined) action.opens = opens;
    }
    const feature = parseInlineFeature(body);
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
  const stages = parseStages(clean, diagnostics);
  const actions = parseActions(clean, diagnostics);

  const varsBlock = findBlocks(clean, 'game')[0];
  const gameAssignments = parseAssignments(varsBlock.body);
  const varsRecordName = gameAssignments.get('vars');
  const vars = (varsRecordName !== undefined && records[varsRecordName]) || {};

  const globalsRecordName = gameAssignments.get('globals');
  const globals = globalsRecordName !== undefined ? records[globalsRecordName] : undefined;

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
