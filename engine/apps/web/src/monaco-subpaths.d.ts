/**
 * `ide-client/src/plugins/languages-basic.ts` imports Monaco's Monarch
 * grammar modules by their deep specifier (`monaco-editor/languages/
 * definitions/<lang>/<lang>.js`) — plain `.js` with no sibling `.d.ts`,
 * so `tsc` reports TS7016 wherever that file is part of the PROGRAM.
 * `ide-client`'s own typecheck already has a full shim for this
 * (`ide/client/src/monaco-modules.d.ts`), but this app's tsconfig only
 * `include`s `src/**` here — an ambient `.d.ts` outside that is invisible
 * to this program even though the `.ts` files that import through it are
 * reached via `@energy8engine/ide-client`. `any`-typed: this app never
 * calls into these modules directly, it only needs `tsc` to stop refusing
 * the specifier.
 */
declare module 'monaco-editor/languages/definitions/*' {
  const mod: any;
  export = mod;
}
