import type { Context } from 'cordis';
import type { languages } from '../editor/monacoSlice';

/**
 * A Monarch grammar for `.spin` (SpinML), written from the language's
 * own lexer and parser (`casino_platform/e8/crates/spinml/src/`): the
 * lexer's keyword table, the parser's top-level declaration words —
 * identifiers to the lexer, keywords to a reader, so they are keywords
 * here only at the start of a line, where the parser accepts them — and
 * `tag`, which the parser recognises only inside an enum header. Every
 * construct is single-line (a `--` comment ends with the line, a string
 * may not contain a newline), so the whole grammar is one `root` state,
 * which is also what lets `tests/monarch.ts` walk it.
 */
export const spin: languages.IMonarchLanguage = {
  keywords: [
    'fn',
    'let',
    'if',
    'else',
    'while',
    'for',
    'in',
    'return',
    'break',
    'continue',
    'true',
    'false',
  ],
  declarations: ['record', 'enum', 'game', 'action', 'const'],
  types: ['int', 'float', 'bool', 'ctx', 'outcome', 'str'],
  tokenizer: {
    root: [
      [/--.*$/, 'comment'],
      [/"[^"\n]*"/, 'string'],
      // A declaration word opens a top-level block, and top level is column 0.
      [/^(?:record|enum|game|action|const)\b/, 'keyword'],
      // `enum Name tag stage {` — `tag` followed by the tag's name and the block.
      [/\btag\b(?=\s+[a-zA-Z_]\w*\s*\{)/, 'keyword'],
      // A context method: `c.rand(6)`, `c.pick(...)`.
      [/\bc\.[a-zA-Z_]\w*/, 'function'],
      [
        /[a-zA-Z_]\w*/,
        { cases: { '@keywords': 'keyword', '@types': 'type', '@default': 'identifier' } },
      ],
      [/\d+\.\d+/, 'number.float'],
      [/\d+/, 'number'],
      [/[{}()[\]]/, '@brackets'],
      [/\.\.|->|&&|\|\||[!=<>]=|[!=<>+\-*/%]/, 'operator'],
      [/[;,.:]/, 'delimiter'],
      [/\s+/, 'white'],
    ],
  },
};

export const spinConf: languages.LanguageConfiguration = {
  comments: { lineComment: '--' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string', 'comment'] },
  ],
  surroundingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
  ],
};

export const name = 'language-spin';

export const inject = ['languages'];

export function apply(ctx: Context) {
  ctx.effect(() =>
    ctx.languages.register({
      id: 'spin',
      extensions: ['.spin'],
      load: async () => ({ language: spin, conf: spinConf }),
    }),
  );
}
