/**
 * A tiny boolean expression language for flow `when`/`if` conditions:
 * `or → and → not → comparison → primary`, over paths into `vars`
 * (`result.stage`), string/number/`true`/`false`/`null` literals, and
 * parens. No side effects, no function calls — reading is all it does,
 * so eager (non-short-circuit) evaluation of `&&`/`||` is safe.
 *
 * `not` sits ABOVE `comparison` in that chain, i.e. `!` binds LOOSER than
 * a comparison operator, not tighter as it does in most C-like languages:
 * `!a == b` parses as `!(a == b)`, not `(!a) == b`. Chain `!!x` if you
 * need `!` to apply to a bare value before a comparison runs.
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
      while (src[i] === '.' && /[A-Za-z_$]/.test(src[i + 1] ?? '')) {
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
    if ('()!<>'.includes(c)) {
      toks.push({ type: 'op', value: c, pos: i });
      i++;
      continue;
    }
    throw new SyntaxError(`unexpected character '${c}' at position ${i}`);
  }
  return toks;
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

  private expectOp(value: string): void {
    const t = this.next();
    if (!t || t.type !== 'op' || t.value !== value) {
      throw new SyntaxError(`expected '${value}' at position ${t ? t.pos : this.srcLen}`);
    }
  }

  parse(): unknown {
    const value = this.parseOr();
    if (this.i < this.toks.length) {
      throw new SyntaxError(`unexpected token at position ${this.endPos()}`);
    }
    return value;
  }

  private parseOr(): unknown {
    let left = this.parseAnd();
    while (this.peek()?.type === 'op' && this.peek()!.value === '||') {
      this.next();
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(): unknown {
    let left = this.parseNot();
    while (this.peek()?.type === 'op' && this.peek()!.value === '&&') {
      this.next();
      const right = this.parseNot();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseNot(): unknown {
    if (this.peek()?.type === 'op' && this.peek()!.value === '!') {
      this.next();
      return !Boolean(this.parseNot());
    }
    return this.parseComparison();
  }

  private parseComparison(): unknown {
    const left = this.parsePrimary();
    const t = this.peek();
    if (t?.type === 'op' && COMPARE_OPS.includes(t.value)) {
      this.next();
      const right = this.parsePrimary();
      return compare(t.value, left, right, t.pos);
    }
    return left;
  }

  private parsePrimary(): unknown {
    const t = this.next();
    if (!t) throw new SyntaxError(`unexpected end of expression at position ${this.srcLen}`);
    if (t.type === 'op' && t.value === '(') {
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
 * Evaluates a boolean expression against `vars`. Throws `SyntaxError` (with
 * the failing position) on a malformed expression. A bare path or literal
 * at the top level is coerced with `Boolean()`, same as a comparison result
 * already is.
 */
export function evaluate(expr: string, vars: Record<string, unknown>): boolean {
  const parser = new Parser(tokenize(expr), vars, expr.length);
  return Boolean(parser.parse());
}
