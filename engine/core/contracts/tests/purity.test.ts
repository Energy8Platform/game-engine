import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : [join(dir, e.name)],
  );
}

/**
 * Every way TS/JS source can name a module specifier as a plain string
 * literal — the only form `contracts` is allowed to use at all (a computed
 * specifier would defeat static analysis of "what does this package pull
 * in", which is the whole point of this test). Four independent patterns,
 * not one: the original version of this test only matched `from '…'` with
 * single quotes, which is blind to a bare side-effect `import 'x'` (no
 * `from`), `require('x')`, a dynamic `import('x')`, and any of the above
 * spelled with double quotes instead of single.
 *
 * The specifier itself is restricted to `[^\s'"]+` — no whitespace or
 * quote characters — rather than "anything up to the matching quote".
 * A real module specifier (a package name, a relative path, a `node:`
 * builtin) never contains a space; a prose sentence in a doc comment
 * almost always does. Measured directly: the looser version matched the
 * word `from` followed by a double-quoted phrase inside one of this very
 * file's own doc comments (`mechanic.ts`'s "apart from \"this spin did
 * not cascade\" when…") the moment double-quote support was added — a
 * real false positive, not a hypothetical one. Restricting the specifier
 * to a single space-free token closes that without narrowing what real
 * import forms this still catches (see the evasion test below).
 */
const IMPORT_PATTERNS = [
  /\bfrom\s*(['"])([^\s'"]+)\1/g, // import ... from 'x' | "x"; export ... from 'x' | "x";
  /\brequire\s*\(\s*(['"])([^\s'"]+)\1\s*\)/g, // require('x') | require("x")
  /\bimport\s*\(\s*(['"])([^\s'"]+)\1\s*\)/g, // dynamic import('x') | import("x")
  /\bimport\s*(['"])([^\s'"]+)\1\s*;/g, // bare side-effect import 'x'; | import "x";
];

function importsIn(text: string): string[] {
  return IMPORT_PATTERNS.flatMap((pattern) => [...text.matchAll(pattern)].map((m) => m[2]));
}

describe('contracts purity', () => {
  it('imports nothing — not cordis, not schemastery, not node builtins', () => {
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      const imports = importsIn(text);
      const foreign = imports.filter((s) => !s.startsWith('.'));
      expect(foreign, `${file} imports ${foreign.join(', ')}`).toEqual([]);
    }
  });

  /**
   * Proves the strengthened matcher actually catches what the old one was
   * blind to — each of these four lines is a real evasion of the original
   * `/from '([^']+)'/g`-only pattern (a foreign import spelled a way that
   * regex would silently miss), and every one must be caught here.
   */
  it('catches every evasion form the single-pattern version was blind to', () => {
    const evasions = [
      `import "node:fs";`, // double quotes
      `import fs from "node:fs";`, // double-quoted "from"
      `import 'node:fs';`, // bare side-effect import, no "from" at all
      `const fs = require('node:fs');`, // require()
      `const fs = await import('node:fs');`, // dynamic import()
    ];
    for (const line of evasions) {
      const foreign = importsIn(line).filter((s) => !s.startsWith('.'));
      expect(foreign, `did not catch: ${line}`).toEqual(['node:fs']);
    }
  });
});
