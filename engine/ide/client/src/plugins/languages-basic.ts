import type { Context } from 'cordis';
import type { languages } from '../editor/monacoSlice';
import type { LanguageDef } from './languages';

/**
 * The languages a slot project is written in, from Monaco's own Monarch
 * grammars — tokenizers only, none of the language SERVICES (TypeScript's
 * alone is 9.4 MB of workers; see `monacoSlice.ts`). Each grammar module
 * imports `editor/editor.api.js`, so each is reached through a dynamic
 * `import()` inside `load` and never at module evaluation: the bundle
 * gets one small chunk per grammar, fetched on the first file of that
 * kind, and this module stays loadable where Monaco is not (jsdom).
 *
 * Specifiers are `monaco-editor/languages/definitions/<lang>/<lang>.js`,
 * with no `esm/vs/` segment — the package's exports map supplies it.
 */
export const DEFINITIONS: readonly LanguageDef[] = [
  {
    id: 'typescript',
    extensions: ['.ts', '.tsx'],
    load: () => import('monaco-editor/languages/definitions/typescript/typescript.js'),
  },
  {
    id: 'javascript',
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
    load: () => import('monaco-editor/languages/definitions/javascript/javascript.js'),
  },
  {
    id: 'yaml',
    extensions: ['.yml', '.yaml'],
    load: () => import('monaco-editor/languages/definitions/yaml/yaml.js'),
  },
  {
    id: 'css',
    extensions: ['.css'],
    load: () => import('monaco-editor/languages/definitions/css/css.js'),
  },
  {
    id: 'html',
    extensions: ['.html'],
    load: () => import('monaco-editor/languages/definitions/html/html.js'),
  },
  {
    id: 'markdown',
    extensions: ['.md'],
    load: () => import('monaco-editor/languages/definitions/markdown/markdown.js'),
  },
  {
    id: 'json',
    extensions: ['.json', '.jsonc'],
    load: async () => ({ language: json, conf: jsonConf }),
  },
];

/**
 * Monaco ships no Monarch grammar for JSON — its tokenizer is part of the
 * JSON language service, which brings a worker. Twenty lines here instead:
 * a key (a string followed by `:`) is `type`, so keys and values read
 * differently; `//` and block comments for the `.jsonc` files tooling
 * writes.
 */
export const json: languages.IMonarchLanguage = {
  tokenizer: {
    root: [
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment'],
      [/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'],
      [/"(?:[^"\\]|\\.)*"/, 'string'],
      [/-?\d+\.\d+(?:[eE][-+]?\d+)?/, 'number.float'],
      [/-?\d+(?:[eE][-+]?\d+)?/, 'number'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/[{}[\]]/, '@brackets'],
      [/[,:]/, 'delimiter'],
      [/\s+/, 'white'],
    ],
    comment: [
      [/[^*/]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[*/]/, 'comment'],
    ],
  },
};

const jsonConf: languages.LanguageConfiguration = {
  comments: { lineComment: '//', blockComment: ['/*', '*/'] },
  brackets: [
    ['{', '}'],
    ['[', ']'],
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '"', close: '"', notIn: ['string'] },
  ],
};

export const name = 'languages-basic';

export const inject = ['languages'];

export function apply(ctx: Context) {
  for (const def of DEFINITIONS) ctx.effect(() => ctx.languages.register(def));
}
