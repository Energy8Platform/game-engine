import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from 'cordis';
import { afterEach, describe, expect, it } from 'vitest';
import { check, spin } from '../src/compute';
import * as schema from '../src/plugins/schema';
import { assemble, isGameSpec } from '../src/plugins/spec';

/**
 * `first-slot`'s LOGIC, against a `GameSpec`. Its `script.spin` cannot
 * compile on its own (it names `SYM` and `PAY_S1..PAY_S6`, which only the
 * generated prelude declares) — that is the whole point of the fixture,
 * and the tests below lean on it in both directions.
 */
const FIXTURE = join(__dirname, 'fixtures', 'project-spec');
/** The descriptive `spec.json` `first-slot` ships — NOT a `GameSpec`. */
const DESCRIPTIVE = join(
  __dirname,
  '..',
  '..',
  '..',
  'examples',
  'first-slot',
  'game',
  'spec.json',
);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A private, writable copy of the fixture as a project root. */
function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ide-host-spec-')));
  cpSync(FIXTURE, dir, { recursive: true });
  writeFileSync(join(dir, 'e8.yml'), '[]\n');
  dirs.push(dir);
  return dir;
}

const specOf = (dir: string) =>
  JSON.parse(readFileSync(join(dir, 'game', 'spec.json'), 'utf8')) as Record<string, unknown>;
const writeSpec = (dir: string, spec: unknown) =>
  writeFileSync(join(dir, 'game', 'spec.json'), JSON.stringify(spec, null, 2));

describe('isGameSpec', () => {
  it('tells a GameSpec from the descriptive spec.json the examples ship', () => {
    expect(isGameSpec(specOf(FIXTURE))).toBe(true);
    expect(isGameSpec(JSON.parse(readFileSync(DESCRIPTIVE, 'utf8')))).toBe(false);
    // The three marks, each on its own — a spec missing any one of them is
    // metadata, not something to prepend a prelude to.
    expect(isGameSpec({ ...specOf(FIXTURE), type: 'table' })).toBe(false);
    expect(isGameSpec({ ...specOf(FIXTURE), symbols: {} })).toBe(false);
    expect(isGameSpec({ ...specOf(FIXTURE), symbols: [{ id: 1, name: 'sym-1' }] })).toBe(false);
    expect(isGameSpec(null)).toBe(false);
  });
});

describe('assemble', () => {
  it('writes prelude ⧺ logic to .e8/game/script.spin and points the games dir at it', async () => {
    const cwd = project();
    const authored = readFileSync(join(cwd, 'game', 'script.spin'), 'utf8');
    // The premise: the paytable the logic reads is NOT in the logic.
    expect(authored).toContain('PAY_S1[i]');
    expect(authored).not.toContain('const PAY_S1');

    const result = await assemble(cwd);
    expect(result.diagnostics).toEqual([]);
    expect(result.gamesDir).toBe(join(cwd, '.e8', 'game'));
    expect(result.spinFile).toBe(join(cwd, '.e8', 'game', 'script.spin'));

    const out = readFileSync(result.spinFile, 'utf8');
    expect(out.startsWith('-- AUTO-GENERATED')).toBe(true);
    // Exactly the declarations `game/spec.json` owns, in the assembly only.
    for (const decl of [
      'const SPEC =',
      'const SYMBOLS',
      'const SYM =',
      'const PAY_COUNTS',
      'const PAY_S1',
    ]) {
      expect(out).toContain(decl);
      expect(authored).not.toContain(decl);
    }
    expect(out).toContain(authored);
    // The author's line 1 sits exactly `preludeLines` lines down.
    expect(out.split('\n')[result.preludeLines]).toBe(authored.split('\n')[0]);
  });

  it('the assembled file is what e8 check parses — and it names the game', async () => {
    const cwd = project();
    const { spinFile } = await assemble(cwd);
    const result = await check({ file: spinFile });
    expect(result.diagnostics).toEqual([]);
    expect(result.schema?.gameId).toBe('spec-slot');
  });

  it('e8 check with no file resolves to the assembled .spin for a GameSpec project', async () => {
    const cwd = project();
    const result = await check({ cwd });
    expect(result.file).toBe(join(cwd, '.e8', 'game', 'script.spin'));
    expect(result.diagnostics).toEqual([]);
  });

  it('a GameSpec that cannot be used is one error diagnostic, and the games dir is unchanged', async () => {
    const cwd = project();
    // `validateSpec`'s own refusal, reported as `spec`/`game/spec.json`.
    writeSpec(cwd, { ...specOf(cwd), maxWin: 0 });
    const result = await assemble(cwd);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        plugin: 'spec',
        where: 'game/spec.json',
        message: expect.stringContaining('maxWin'),
      }),
    ]);
    expect(result.gamesDir).toBe(join(cwd, 'game'));
    expect(existsSync(join(cwd, '.e8'))).toBe(false);
  });

  it('a descriptive spec.json is left alone — no prelude, no .e8, the project’s own game/', async () => {
    const cwd = project();
    cpSync(DESCRIPTIVE, join(cwd, 'game', 'spec.json'));
    const result = await assemble(cwd);
    expect(result).toMatchObject({
      gamesDir: join(cwd, 'game'),
      spinFile: join(cwd, 'game', 'script.spin'),
      preludeLines: 0,
      diagnostics: [],
    });
    expect(existsSync(join(cwd, '.e8'))).toBe(false);
  });

  it('a project with no game/spec.json at all is left alone too', async () => {
    const cwd = project();
    rmSync(join(cwd, 'game', 'spec.json'));
    const result = await assemble(cwd);
    expect(result).toMatchObject({ gamesDir: join(cwd, 'game'), preludeLines: 0, diagnostics: [] });
  });
});

describe('the assembled .spin is what e8-server plays', () => {
  it('spins a GameSpec project on a real e8-server', async () => {
    const cwd = project();
    const report = await spin({ cwd, n: 5, seed: 'specslot' });
    expect(report.diagnostics).toEqual([]);
    expect(report.spins).toBe(5);
    expect(report.bet).toBe(0.2);
    expect(report.stages).toEqual({ base_game: 5 });
  }, 30_000);

  it('without the prelude the same logic is refused — the assembly is what makes it run', async () => {
    // Same project, spec.json swapped for the descriptive one: `assemble`
    // leaves `game/` alone, so e8-server is handed the logic by itself and
    // the compiler says exactly what it is missing.
    const cwd = project();
    cpSync(DESCRIPTIVE, join(cwd, 'game', 'spec.json'));
    const report = await spin({ cwd, n: 1 });
    expect(report.spins).toBe(0);
    expect(report.diagnostics.map((d) => d.message).join('\n')).toContain("unknown variable 'SYM'");
  }, 30_000);
});

describe('the spin schema reads the assembly and reports the author’s line', () => {
  /** `schema` on its own — no server, no session; `ctx.spinSchema` is all these read. */
  async function spinSchema(cwd: string) {
    const ctx = new Context();
    await ctx.plugin(schema, { cwd });
    const service = ctx.spinSchema;
    await ctx.fiber.dispose();
    return service;
  }

  it('parses the assembled file, not the logic the compiler would refuse', async () => {
    const cwd = project();
    const service = await spinSchema(cwd);
    expect(service.schema?.gameId).toBe('spec-slot');
    expect(service.diagnostics).toEqual([]);
    // It assembled on its own: a reader must not depend on someone else
    // having written `.e8/game/script.spin` first.
    expect(existsSync(join(cwd, '.e8', 'game', 'script.spin'))).toBe(true);
  });

  it("a mistake in game/script.spin is reported at the author's line, with the prelude named", async () => {
    const cwd = project();
    const file = join(cwd, 'game', 'script.spin');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nrecord {\n`);
    const authorLine = readFileSync(file, 'utf8').split('\n').indexOf('record {') + 1;
    expect(authorLine).toBeGreaterThan(1);

    const { preludeLines } = await assemble(cwd);
    expect(preludeLines).toBeGreaterThan(0);

    const service = await spinSchema(cwd);
    const located = service.diagnostics.filter((d) => d.at !== undefined);
    expect(located.length).toBeGreaterThan(0);
    for (const d of located) {
      // Not `authorLine + preludeLines`: the offset is subtracted back off,
      // so the number names a line the author can actually go and edit.
      expect(d.at!.line).toBe(authorLine);
      expect(d.where).toBe(`line ${authorLine}`);
      expect(d.message).toContain(`game/script.spin line ${authorLine}`);
    }
    // And the file the diagnostics are about is the one that was read.
    expect(service.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('a stage the enum never declares is an error naming the assembled file', async () => {
    const cwd = project();
    const file = join(cwd, 'game', 'script.spin');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('  stage = base_game\n', '  stage = free_spins\n'),
    );
    const service = await spinSchema(cwd);
    const errors = service.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].where).toBe('.e8/game/script.spin');
  });
});
