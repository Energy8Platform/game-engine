/**
 * A small expression language for flow `when`/`if` conditions and `$path`
 * reads, with arithmetic and formats layered on top of a boolean core.
 *
 * Grammar (loosest to tightest):
 *   pipe → or → and → not → comparison → additive → multiplicative → unary → primary
 *
 * `pipe` (`expr | name` or `expr | name:arg`) only applies at the very top —
 * inside parens, grouping restarts at `or`, so a pipe binds loosest and can't
 * sneak in mid-expression without its own parens. `or`/`and` (`||`/`&&`)
 * return the operand, as JS `||`/`&&` do (both sides are still evaluated):
 * `$result.win || 0` keeps `12.5` rather than flattening it to `true` —
 * that's what lets `$result.win || 0 | int` format the real number. Inside
 * a parenthesised group feeding a comparison, it's that operand — not a
 * coerced boolean — that gets compared: `($s || $z) == "x"` is `true` when
 * `$s` is `"x"`. `not` (`!`) sits ABOVE `comparison`, i.e. binds LOOSER than
 * a comparison operator: `!a == b` parses as `!(a == b)`, not `(!a) == b`.
 * Chain `!!x` if you need `!` to apply to a bare value before a comparison
 * runs.
 *
 * `additive`/`multiplicative`/`unary` add `+ - * /` and unary `-` with the
 * usual precedence (`1 + 2 * 3` is `7`, not `9`), over paths into `vars`
 * (`result.stage`), string/number/`true`/`false`/`null` literals, and
 * parens. A path segment that's a plain integer indexes an array
 * numerically (`result.data.cascades.0.step_win`).
 *
 * Missing values: `readPath` answers `null` for a missing var, and
 * `Number(null)` is `0` — which would silently turn `$missing + 1` into `1`.
 * Arithmetic instead runs operands through a local `num()` that maps
 * `null`/`undefined`/`''` to `NaN`, so a missing operand propagates as
 * `NaN` (`$missing + 1` → `NaN`), matching plain JS `undefined + 1`.
 *
 * `evaluateValue` returns the raw value this grammar produces (a number,
 * string, boolean, `null`, or the string a pipe format returns). `evaluate`
 * is `Boolean(evaluateValue(...))` — a bare path or arithmetic result at the
 * top level is coerced the same way a comparison result already is.
 *
 * Pipe formats (`value | name`, or `value | name:arg`), each returns a string:
 *   - `currency` — reads `$session.currency` (`{ symbol, decimals, position }`)
 *     when present: fixes to `decimals` digits (default 2), symbol before or
 *     after per `position` (`'right'` puts it after a space); with no
 *     `$session.currency`, just `toFixed(2)`, no symbol.
 *   - `fixed:n` — `toFixed(n)` (arg is the digit count, e.g. `| fixed:1`).
 *   - `int` — `Math.round(value)`, stringified.
 *   - `multiplier` — `x` plus the number with trailing zeros trimmed
 *     (`Number(n.toFixed(4))`), e.g. `x2.5`, `x48`.
 *   An unknown format name throws a `SyntaxError` naming it.
 *
 * No side effects, no function calls — reading is all this does, so eager
 * (non-short-circuit) evaluation of `&&`/`||` is safe even though both
 * sides are always evaluated.
 *
 * String literals have no escapes at all — no `\'`, no `\"`, no `\\`. To
 * put a quote character inside a string, write the literal with the
 * OTHER quote style (`"it's"` rather than `'it\'s'`, which would just end
 * the string at the unescaped `'`).
 */

type Tok =
  | { type: 'path'; value: string; pos: number }
  | { type: 'number'; value: string; pos: number }
  | { type: 'string'; value: string; pos: number }
  | { type: 'op'; value: string; pos: number };

const COMPARE_OPS = ['==', '!=', '<=', '>=', '<', '>'];

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i;
      i++;
      let value = '';
      while (i < n && src[i] !== c) {
        value += src[i];
        i++;
      }
      if (i >= n) throw new SyntaxError(`unterminated string at position ${start}`);
      i++; // closing quote
      toks.push({ type: 'string', value, pos: start });
      continue;
    }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[0-9.]/.test(src[i])) i++;
      toks.push({ type: 'number', value: src.slice(start, i), pos: start });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const start = i;
      i++;
      while (i < n && /[\w$]/.test(src[i])) i++;
      // A path segment may itself be a plain integer (`cascades.0.step_win`),
      // so the lookahead after `.` accepts a leading digit too.
      while (src[i] === '.' && /[A-Za-z_$0-9]/.test(src[i + 1] ?? '')) {
        i += 2;
        while (i < n && /[\w$]/.test(src[i])) i++;
      }
      toks.push({ type: 'path', value: src.slice(start, i), pos: start });
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === '&&' || two === '||' || COMPARE_OPS.includes(two)) {
      toks.push({ type: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    // `|` is a single-char op only when the next char isn't also `|` — the
    // two-char check above already claims `||` first.
    if ('()!<>|:+-*/'.includes(c)) {
      toks.push({ type: 'op', value: c, pos: i });
      i++;
      continue;
    }
    throw new SyntaxError(`unexpected character '${c}' at position ${i}`);
  }
  return toks;
}

/** `readPath` answers `null` for a missing var; bare `Number(null)` is `0`,
 * which would let `$missing + 1` silently become `1`. This maps "nothing
 * here" to `NaN` instead, so a missing operand propagates as `NaN`. */
function num(x: unknown): number {
  return x === null || x === undefined || x === '' ? NaN : Number(x);
}

class Parser {
  private i = 0;
  constructor(
    private readonly toks: Tok[],
    private readonly vars: Record<string, unknown>,
    private readonly srcLen: number,
  ) {}

  private peek(): Tok | undefined {
    return this.toks[this.i];
  }

  private next(): Tok | undefined {
    return this.toks[this.i++];
  }

  private endPos(): number {
    return this.peek()?.pos ?? this.srcLen;
  }

  private isOp(value: string): boolean {
    const t = this.peek();
    return t?.type === 'op' && t.value === value;
  }

  private expectOp(value: string): void {
    const t = this.next();
    if (!t || t.type !== 'op' || t.value !== value) {
      throw new SyntaxError(`expected '${value}' at position ${t ? t.pos : this.srcLen}`);
    }
  }

  parse(): unknown {
    const value = this.parsePipes();
    if (this.i < this.toks.length) throw new SyntaxError(`unexpected token at position ${this.endPos()}`);
    return value;
  }

  private parsePipes(): unknown {
    let value = this.parseOr();
    while (this.isOp('|')) {
      this.next();
      const name = this.next();
      if (!name || name.type !== 'path') throw new SyntaxError(`expected a format name at position ${name?.pos ?? this.srcLen}`);
      let arg: unknown;
      if (this.isOp(':')) {
        this.next();
        arg = this.parsePrimary();
      }
      value = format(name.value, value, arg, this.vars, name.pos);
    }
    return value;
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.isOp('||')) {
      this.next();
      const right = this.parseAnd();
      left = Boolean(left) ? left : right;
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseNot();
    while (this.isOp('&&')) {
      this.next();
      const right = this.parseNot();
      left = Boolean(left) ? right : left;
    }
    return left;
  }

  private parseNot(): unknown {
    if (this.isOp('!')) {
      this.next();
      return !Boolean(this.parseNot());
    }
    return this.parseComparison();
  }

  private parseComparison(): unknown {
    const left = this.parseAdditive();
    const t = this.peek();
    if (t?.type === 'op' && COMPARE_OPS.includes(t.value)) {
      this.next();
      return compare(t.value, left, this.parseAdditive(), t.pos);
    }
    return left;
  }

  private parseAdditive(): unknown {
    let left = this.parseMultiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next()!.value;
      const right = this.parseMultiplicative();
      left = op === '+' ? num(left) + num(right) : num(left) - num(right);
    }
    return left;
  }

  private parseMultiplicative(): unknown {
    let left = this.parseUnary();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.next()!.value;
      const right = this.parseUnary();
      left = op === '*' ? num(left) * num(right) : num(left) / num(right);
    }
    return left;
  }

  private parseUnary(): unknown {
    if (this.isOp('-')) {
      this.next();
      return -num(this.parseUnary());
    }
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    const t = this.next();
    if (!t) throw new SyntaxError(`unexpected end of expression at position ${this.srcLen}`);
    if (t.type === 'op' && t.value === '(') {
      // A pipe binds loosest, only at the top — inside parens, grouping
      // restarts at `or`.
      const value = this.parseOr();
      this.expectOp(')');
      return value;
    }
    if (t.type === 'number') return Number(t.value);
    if (t.type === 'string') return t.value;
    if (t.type === 'path') {
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      return readPath(t.value, this.vars);
    }
    throw new SyntaxError(`unexpected token at position ${t.pos}`);
  }
}

function compare(op: string, a: unknown, b: unknown, pos: number): boolean {
  switch (op) {
    // Numeric-vs-numeric and generic equality both land on `===`: JS
    // already compares same-typed numbers numerically, so there is no
    // separate branch to write for "both are numbers".
    case '==':
      return a === b;
    case '!=':
      return a !== b;
    case '<':
      return Number(a) < Number(b);
    case '<=':
      return Number(a) <= Number(b);
    case '>':
      return Number(a) > Number(b);
    case '>=':
      return Number(a) >= Number(b);
    default:
      throw new SyntaxError(`unknown operator '${op}' at position ${pos}`);
  }
}

/** The pipe formats; each returns a string. `vars` is for `currency`'s `$session.currency`. */
function format(name: string, value: unknown, arg: unknown, vars: Record<string, unknown>, pos: number): string {
  const n = num(value);
  switch (name) {
    case 'currency': {
      const c = readPath('$session.currency', vars) as
        { symbol?: string; decimals?: number; position?: string } | null;
      const decimals = typeof c?.decimals === 'number' ? c.decimals : 2;
      const text = n.toFixed(decimals);
      if (!c?.symbol) return text;
      return c.position === 'right' ? `${text} ${c.symbol}` : `${c.symbol}${text}`;
    }
    case 'int':
      return String(Math.round(n));
    case 'fixed':
      return n.toFixed(Number(arg ?? 0));
    case 'multiplier':
      return `x${String(Number(n.toFixed(4)))}`;
    default:
      throw new SyntaxError(`unknown format '${name}' at position ${pos}`);
  }
}

/**
 * Reads a dotted path out of `vars` (`'result.stage'` → `vars.result?.stage`).
 * A leading `$` is stripped, so `'$x'` and `'x'` read the same value. A
 * segment that lands on an array indexes it numerically (`'result.
 * nextActions.0'` → `vars.result.nextActions[0]`) rather than reading an
 * own-property named `'0'` (which would work too, only by accident — a
 * string subscript on an array is untyped in plain JS but is exactly what
 * `Array.prototype[key]` already does; the explicit branch just says so).
 * Any missing branch of the path reads as `null` (never `undefined`), so a
 * missing value compares equal to a literal `null` under `evaluate`.
 */
export function readPath(path: string, vars: Record<string, unknown>): unknown {
  const clean = path.startsWith('$') ? path.slice(1) : path;
  const value = clean.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return undefined;
    return Array.isArray(acc) ? acc[Number(key)] : (acc as Record<string, unknown>)[key];
  }, vars);
  return value ?? null;
}

/**
 * Evaluates an expression against `vars` and returns its raw value (see the
 * module doc comment for the grammar). Throws `SyntaxError` (with the
 * failing position) on a malformed expression.
 */
export function evaluateValue(expr: string, vars: Record<string, unknown>): unknown {
  return new Parser(tokenize(expr), vars, expr.length).parse();
}

/**
 * Evaluates a boolean expression against `vars`. Throws `SyntaxError` (with
 * the failing position) on a malformed expression. `Boolean(evaluateValue(...))`
 * — a bare path or arithmetic result at the top level is coerced, same as a
 * comparison result already is.
 */
export function evaluate(expr: string, vars: Record<string, unknown>): boolean {
  return Boolean(evaluateValue(expr, vars));
}
