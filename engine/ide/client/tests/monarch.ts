import { compile } from 'monaco-editor/editor/standalone/common/monarch/monarchCompile.js';
import type { languages } from '../src/editor/monacoSlice';

type Compiled = ReturnType<typeof compile>;

export function compileGrammar(id: string, grammar: languages.IMonarchLanguage): Compiled {
  return compile(id, grammar);
}

/**
 * A root-state walk over a compiled Monarch grammar: at each position the
 * first rule whose regex matches wins, exactly Monarch's own order, and its
 * token string is recorded. Only the `root` state is walked — a rule that
 * switches state (`next`) is followed no further, so grammars under test
 * keep single-line constructs (strings, `--` comments) in `root`. `'?'`
 * marks a character no rule matched. Not a claim about Monaco's lexer; a
 * claim about which RULE a piece of text falls to.
 */
export function tokenizeRoot(lexer: Compiled, line: string): string[] {
  const out: string[] = [];
  let pos = 0;
  while (pos < line.length) {
    const rest = line.slice(pos);
    let matched = false;
    for (const rule of lexer.tokenizer.root as any[]) {
      if (rule.matchOnlyAtLineStart && pos > 0) continue;
      const m = rule.regex.exec(rest) as RegExpExecArray | null;
      if (!m || m.index !== 0 || m[0].length === 0) continue;
      const action = rule.action;
      const token: string =
        typeof action === 'string'
          ? action
          : typeof action.test === 'function'
            ? action.test(m[0], m, 'root', pos + m[0].length === line.length)
            : action.token;
      out.push(token);
      pos += m[0].length;
      matched = true;
      break;
    }
    if (!matched) {
      out.push('?');
      pos++;
    }
  }
  return out;
}

/** The tokens of `line` with `white` dropped — what a reader's eye sees. */
export function visible(lexer: Compiled, line: string): string[] {
  return tokenizeRoot(lexer, line).filter((t) => t !== 'white');
}
