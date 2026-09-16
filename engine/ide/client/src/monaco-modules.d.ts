/**
 * Ambient types for the monaco-editor deep entry points `languages-basic.ts`
 * and `tests/monarch.ts` import bindings from. The package ships a
 * declaration file only for its top-level `editor/editor.api.js` — these
 * grammar/compiler modules are plain `.js` with no sibling `.d.ts`, so
 * `tsc` (no `allowJs`) sees them as unresolvable and would otherwise fail
 * on the import specifier itself. Kept to exactly the bindings actually
 * imported; shapes read off the modules' own source.
 *
 * No top-level import/export here on purpose: that would turn this file
 * into a module, and each `declare module '<specifier>'` below into an
 * AUGMENTATION of that module rather than a fresh ambient declaration —
 * which only adds members to a module tsc already resolved, and tsc can't
 * resolve these (no `.d.ts` on disk), so the augmentation would do
 * nothing and TS7016 would still fire. Type references below use inline
 * `import('…').…` instead of a hoisted import, so the file stays a
 * script and each `declare module` block stands alone.
 */
declare module 'monaco-editor/languages/definitions/typescript/typescript.js' {
  export const language: import('monaco-editor/editor/editor.api.js').languages.IMonarchLanguage;
  export const conf: import('monaco-editor/editor/editor.api.js').languages.LanguageConfiguration;
}
declare module 'monaco-editor/languages/definitions/javascript/javascript.js' {
  export const language: import('monaco-editor/editor/editor.api.js').languages.IMonarchLanguage;
  export const conf: import('monaco-editor/editor/editor.api.js').languages.LanguageConfiguration;
}
declare module 'monaco-editor/languages/definitions/yaml/yaml.js' {
  export const language: import('monaco-editor/editor/editor.api.js').languages.IMonarchLanguage;
  export const conf: import('monaco-editor/editor/editor.api.js').languages.LanguageConfiguration;
}
declare module 'monaco-editor/languages/definitions/css/css.js' {
  export const language: import('monaco-editor/editor/editor.api.js').languages.IMonarchLanguage;
  export const conf: import('monaco-editor/editor/editor.api.js').languages.LanguageConfiguration;
}
declare module 'monaco-editor/languages/definitions/html/html.js' {
  export const language: import('monaco-editor/editor/editor.api.js').languages.IMonarchLanguage;
  export const conf: import('monaco-editor/editor/editor.api.js').languages.LanguageConfiguration;
}
declare module 'monaco-editor/languages/definitions/markdown/markdown.js' {
  export const language: import('monaco-editor/editor/editor.api.js').languages.IMonarchLanguage;
  export const conf: import('monaco-editor/editor/editor.api.js').languages.LanguageConfiguration;
}

declare module 'monaco-editor/editor/standalone/common/monarch/monarchCompile.js' {
  export function compile(
    languageId: string,
    language: import('monaco-editor/editor/editor.api.js').languages.IMonarchLanguage,
  ): { tokenizer: Record<string, unknown> } & Record<string, unknown>;
}
