import { describe, expect, it } from 'vitest';
import { Context } from 'cordis';
import type { Diagnostic } from '@energy8engine/contracts';
import * as languages from '../src/plugins/languages';
import type { LanguageDef } from '../src/plugins/languages';

const grammar = async () => ({ language: { tokenizer: { root: [] } } });

function def(id: string, extensions: string[]): LanguageDef {
  return { id, extensions, load: grammar };
}

/** A stand-in for `connection`: records reports, hands back a retract that removes the entry. */
function fakeConnection() {
  const reported: Diagnostic[] = [];
  return {
    reported,
    report(diag: Diagnostic) {
      reported.push(diag);
      return () => {
        const i = reported.indexOf(diag);
        if (i >= 0) reported.splice(i, 1);
      };
    },
  };
}

async function boot(connection?: ReturnType<typeof fakeConnection>) {
  const ctx = new Context();
  if (connection) ctx.provide('connection', connection);
  await ctx.plugin(languages);
  return ctx;
}

describe('languages', () => {
  it('lists what was registered, in registration order', async () => {
    const ctx = await boot();
    ctx.languages.register(def('yaml', ['.yml', '.yaml']));
    ctx.languages.register(def('spin', ['.spin']));
    expect(ctx.languages.list().map((d) => d.id)).toEqual(['yaml', 'spin']);
  });

  it('maps a path to a language by its last extension, case-insensitively', async () => {
    const ctx = await boot();
    ctx.languages.register(def('typescript', ['.ts', '.tsx']));
    expect(ctx.languages.languageFor('src/main.ts')).toBe('typescript');
    expect(ctx.languages.languageFor('src/App.TSX')).toBe('typescript');
    expect(ctx.languages.languageFor('src/main.test.ts')).toBe('typescript');
  });

  it('answers plaintext for an unknown extension, a dotfile, and no extension', async () => {
    const ctx = await boot();
    ctx.languages.register(def('typescript', ['.ts']));
    expect(ctx.languages.languageFor('game/script.spin')).toBe('plaintext');
    expect(ctx.languages.languageFor('.gitignore')).toBe('plaintext');
    expect(ctx.languages.languageFor('Makefile')).toBe('plaintext');
    expect(ctx.languages.languageFor('a.ts/README')).toBe('plaintext');
  });

  it('the last registration for an extension wins, and says so', async () => {
    const connection = fakeConnection();
    const ctx = await boot(connection);
    ctx.languages.register(def('json', ['.json']));
    ctx.languages.register(def('jsonc', ['.json']));
    expect(ctx.languages.languageFor('x.json')).toBe('jsonc');
    expect(connection.reported).toHaveLength(1);
    expect(connection.reported[0]).toMatchObject({
      severity: 'warning',
      plugin: 'languages',
      where: 'jsonc',
    });
    expect(connection.reported[0].message).toContain('.json');
  });

  it('registering the same id again replaces the definition', async () => {
    const ctx = await boot();
    const first = def('spin', ['.spin']);
    const second = def('spin', ['.spin', '.spinml']);
    ctx.languages.register(first);
    ctx.languages.register(second);
    expect(ctx.languages.list()).toEqual([second]);
    expect(ctx.languages.languageFor('a.spinml')).toBe('spin');
  });

  it('a re-registered id moves to the end, so it wins later extension collisions too', async () => {
    const ctx = await boot();
    ctx.languages.register(def('javascript', ['.js', '.mjs']));
    ctx.languages.register(def('typescript', ['.ts']));
    ctx.languages.register(def('typescript', ['.ts', '.mjs']));
    expect(ctx.languages.languageFor('x.mjs')).toBe('typescript');
    expect(ctx.languages.list().map((d) => d.id)).toEqual(['javascript', 'typescript']);
  });

  it('a retract removes the definition; a stale retract removes nothing', async () => {
    const ctx = await boot();
    const off = ctx.languages.register(def('spin', ['.spin']));
    ctx.languages.register(def('spin', ['.spin']));
    off(); // stale: the second registration is current
    expect(ctx.languages.list()).toHaveLength(1);
    expect(ctx.languages.languageFor('a.spin')).toBe('spin');
  });

  it('notifies subscribers on register and on retract, not on a stale retract', async () => {
    const ctx = await boot();
    let calls = 0;
    ctx.languages.subscribe(() => calls++);
    const off = ctx.languages.register(def('spin', ['.spin']));
    expect(calls).toBe(1);
    off();
    expect(calls).toBe(2);
    off();
    expect(calls).toBe(2);
  });

  it('failed() reports an error diagnostic, retracted when the id is registered again', async () => {
    const connection = fakeConnection();
    const ctx = await boot(connection);
    ctx.languages.register(def('spin', ['.spin']));
    ctx.languages.failed('spin', 'bad regex');
    expect(connection.reported).toHaveLength(1);
    expect(connection.reported[0]).toMatchObject({
      severity: 'error',
      plugin: 'languages',
      where: 'spin',
    });
    expect(connection.reported[0].message).toContain('bad regex');
    ctx.languages.failed('spin', 'still bad');
    expect(connection.reported).toHaveLength(1);
    expect(connection.reported[0].message).toContain('still bad');
    ctx.languages.register(def('spin', ['.spin']));
    expect(connection.reported).toHaveLength(0);
  });

  it('works without a connection: failed() and collisions are silent', async () => {
    const ctx = await boot();
    ctx.languages.register(def('json', ['.json']));
    ctx.languages.register(def('jsonc', ['.json']));
    expect(() => ctx.languages.failed('json', 'x')).not.toThrow();
  });
});
