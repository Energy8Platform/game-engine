import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import * as languages from '../src/plugins/languages';
import * as basic from '../src/plugins/languages-basic';
import { compileGrammar, visible } from './monarch';

async function boot() {
  const ctx = new Context();
  await ctx.plugin(languages);
  await ctx.plugin(basic);
  return ctx;
}

describe('languages-basic', () => {
  it('claims the extensions the projects use', async () => {
    const ctx = await boot();
    const cases: [string, string][] = [
      ['src/main.ts', 'typescript'],
      ['src/App.tsx', 'typescript'],
      ['vite.config.js', 'javascript'],
      ['bin/e8.mjs', 'javascript'],
      ['x.cjs', 'javascript'],
      ['x.jsx', 'javascript'],
      ['game/spec.json', 'json'],
      ['tsconfig.jsonc', 'json'],
      ['e8.yml', 'yaml'],
      ['e8.yaml', 'yaml'],
      ['styles.css', 'css'],
      ['index.html', 'html'],
      ['README.md', 'markdown'],
      ['game/script.spin', 'plaintext'],
    ];
    for (const [path, id] of cases) expect(ctx.languages.languageFor(path), path).toBe(id);
  });

  it('every Monaco grammar loads and compiles (the module path is the one that fails a build when misspelled)', async () => {
    for (const def of basic.DEFINITIONS) {
      const { language } = await def.load();
      expect(() => compileGrammar(def.id, language), def.id).not.toThrow();
    }
  }, 20_000);

  it('the JSON grammar tells keys from values, and comments from both', () => {
    const lexer = compileGrammar('json', basic.json);
    expect(
      visible(lexer, '{ "cols": 5, "name": "x", "on": true, "v": null, "f": -1.5e3 }'),
    ).toEqual([
      '@brackets',
      'type',
      'delimiter',
      'number',
      'delimiter',
      'type',
      'delimiter',
      'string',
      'delimiter',
      'type',
      'delimiter',
      'keyword',
      'delimiter',
      'type',
      'delimiter',
      'keyword',
      'delimiter',
      'type',
      'delimiter',
      'number.float',
      '@brackets',
    ]);
    expect(visible(lexer, '["a", 1] // trailing')).toEqual([
      '@brackets',
      'string',
      'delimiter',
      'number',
      '@brackets',
      'comment',
    ]);
    expect(visible(lexer, '"esc\\"aped": 1')).toEqual(['type', 'delimiter', 'number']);
  });
});
