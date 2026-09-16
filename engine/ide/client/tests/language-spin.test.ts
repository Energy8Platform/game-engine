import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import * as languages from '../src/plugins/languages';
import * as spinLanguage from '../src/plugins/language-spin';
import { compileGrammar, visible } from './monarch';

const lexer = compileGrammar('spin', spinLanguage.spin);

describe('language-spin', () => {
  it('claims .spin', async () => {
    const ctx = new Context();
    await ctx.plugin(languages);
    await ctx.plugin(spinLanguage);
    expect(ctx.languages.languageFor('game/script.spin')).toBe('spin');
    const { language, conf } = await ctx.languages.list()[0].load();
    expect(language).toBe(spinLanguage.spin);
    expect(conf?.comments?.lineComment).toBe('--');
  });

  it('a function header: keyword, name, parameters with types, the arrow, the return type', () => {
    expect(visible(lexer, 'fn pay_for(sym: int, count: int) -> float {')).toEqual([
      'keyword',
      'identifier',
      '@brackets',
      'identifier',
      'delimiter',
      'type',
      'delimiter',
      'identifier',
      'delimiter',
      'type',
      '@brackets',
      'operator',
      'type',
      '@brackets',
    ]);
  });

  it('a comment runs to the end of the line, whatever it contains', () => {
    expect(visible(lexer, 'let x = 1 -- fn "not a string" {')).toEqual([
      'keyword',
      'identifier',
      'operator',
      'number',
      'comment',
    ]);
  });

  it('strings, numbers, booleans', () => {
    expect(visible(lexer, 'game "first-slot" {')).toEqual(['keyword', 'string', '@brackets']);
    expect(visible(lexer, 'bet_levels = [0.2, 1.0, 5.0]')).toEqual([
      'identifier',
      'operator',
      '@brackets',
      'number.float',
      'delimiter',
      'number.float',
      'delimiter',
      'number.float',
      '@brackets',
    ]);
    expect(visible(lexer, 'if a && !b || c == true {')).toEqual([
      'keyword',
      'identifier',
      'operator',
      'operator',
      'identifier',
      'operator',
      'identifier',
      'operator',
      'keyword',
      '@brackets',
    ]);
  });

  it('declarations are keywords at the start of a line, identifiers elsewhere', () => {
    expect(visible(lexer, 'record Vars {')).toEqual(['keyword', 'identifier', '@brackets']);
    expect(visible(lexer, 'const SYM_W: [int; 6] = [5, 10]')).toEqual([
      'keyword',
      'identifier',
      'delimiter',
      '@brackets',
      'type',
      'delimiter',
      'number',
      '@brackets',
      'operator',
      '@brackets',
      'number',
      'delimiter',
      'number',
      '@brackets',
    ]);
    expect(visible(lexer, 'action spin {')).toEqual(['keyword', 'identifier', '@brackets']);
    expect(visible(lexer, 'let record = 1')).toEqual([
      'keyword',
      'identifier',
      'operator',
      'number',
    ]);
  });

  it('tag is a keyword only in an enum header', () => {
    expect(visible(lexer, 'enum SpinData tag stage {')).toEqual([
      'keyword',
      'identifier',
      'keyword',
      'identifier',
      '@brackets',
    ]);
    expect(visible(lexer, 'let tag = 2')).toEqual(['keyword', 'identifier', 'operator', 'number']);
  });

  it('a context method is a function; the context itself is a type', () => {
    expect(visible(lexer, 'fn fill(c: ctx) { let r = c.rand(6)')).toEqual([
      'keyword',
      'identifier',
      '@brackets',
      'identifier',
      'delimiter',
      'type',
      '@brackets',
      '@brackets',
      'keyword',
      'identifier',
      'operator',
      'function',
      '@brackets',
      'number',
      '@brackets',
    ]);
  });

  it('nothing in the reference script falls to no rule', async () => {
    const { readFileSync } = await import('node:fs');
    // Node's own URL, not the jsdom-environment global: jsdom's `URL` resolves
    // a relative URL against `window.location`, not the `base` argument, so
    // `new URL('.', import.meta.url)` under this package's jsdom test
    // environment silently drops the file: scheme.
    const { fileURLToPath, URL: NodeURL } = await import('node:url');
    const here = fileURLToPath(new NodeURL('.', import.meta.url));
    const text = readFileSync(`${here}/../../../examples/first-slot/game/script.spin`, 'utf8');
    for (const line of text.split('\n')) expect(visible(lexer, line), line).not.toContain('?');
  });
});
