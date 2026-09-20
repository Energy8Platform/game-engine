import { execSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
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

/** Live `e8-server` processes serving `dir` — the same pgrep `compute-spin.test.ts` uses. */
function e8Servers(dir: string): number {
  try {
    return execSync(`pgrep -f 'e8-server.*--games-dir ${dir}'`)
      .toString()
      .split('\n')
      .filter(Boolean).length;
  } catch {
    return 0; // pgrep exits 1 on no match
  }
}

const specOf = (dir: string) =>
  JSON.parse(readFileSync(join(dir, 'game', 'spec.json'), 'utf8')) as Record<string, unknown>;
const writeSpec = (dir: string, spec: unknown) =>
  writeFileSync(join(dir, 'game', 'spec.json'), JSON.stringify(spec, null, 2));

describe('isGameSpec', () => {
  it('tells a GameSpec from the descriptive spec.json the examples ship', () => {
    expect(isGameSpec(specOf(FIXTURE))).toBe(true);
    // No descriptive spec.json carries `type` at all — that is the mark.
    expect(isGameSpec(JSON.parse(readFileSync(DESCRIPTIVE, 'utf8')))).toBe(false);
    expect(isGameSpec({ ...specOf(FIXTURE), type: 'table' })).toBe(false);
    expect(isGameSpec({ ...specOf(FIXTURE), symbols: {} })).toBe(false);
    expect(isGameSpec(null)).toBe(false);
    // A first symbol with no `pay` is an ordinary game (a wild, a scatter),
    // not a reason to treat the spec as metadata.
    expect(isGameSpec({ ...specOf(FIXTURE), symbols: [{ id: 'WILD', kind: 'wild' }] })).toBe(true);
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
    // prelude FIRST, then the author's file whole and unedited.
    expect(out.endsWith(authored)).toBe(true);
  });

  it('the assembled file is what e8 check parses — and it names the game', async () => {
    const cwd = project();
    const { spinFile } = await assemble(cwd);
    const result = await check({ file: spinFile });
    expect(result.diagnostics).toEqual([]);
    expect(result.schema?.gameId).toBe('spec-slot');
  });

  it('e8 check with no file reads the AUTHORED game/script.spin, even for a GameSpec project', async () => {
    const cwd = project();
    const result = await check({ cwd });
    expect(result.file).toBe(join(cwd, 'game', 'script.spin'));
    expect(result.diagnostics).toEqual([]);
    expect(result.schema?.gameId).toBe('spec-slot');
  });

  it("a mistake appended to the authored file is reported at the author's own line, not the assembly's shifted one", async () => {
    const cwd = project();
    const file = join(cwd, 'game', 'script.spin');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nrecord {\n`);
    const authorLine = readFileSync(file, 'utf8').split('\n').indexOf('record {') + 1;
    expect(authorLine).toBeGreaterThan(1);

    const result = await check({ cwd });
    expect(result.file).toBe(file);
    const located = result.diagnostics.filter((d) => d.at !== undefined);
    expect(located.length).toBeGreaterThan(0);
    for (const d of located) expect(d.at!.line).toBe(authorLine);
  });

  /**
   * `validateSpec` compares (`spec.maxWin <= 0`), and `undefined <= 0` is
   * `false` — so a MISSING number is not its refusal but ours, and it has
   * to be ours: the prelude would otherwise say `max_win: undefined` and
   * the compiler would blame a generated file. Same for the grid, whose
   * absence also makes `cells` `NaN`.
   */
  it.each([
    ['maxWin', (spec: Record<string, unknown>) => delete spec.maxWin],
    ['grid.cols, grid.rows', (spec: Record<string, unknown>) => (spec.grid = {})],
  ])(
    'a GameSpec missing %s is one error diagnostic, games dir unchanged',
    async (names, break_) => {
      const cwd = project();
      const spec = specOf(cwd);
      break_(spec);
      writeSpec(cwd, spec);

      const result = await assemble(cwd);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          severity: 'error',
          plugin: 'spec',
          where: 'game/spec.json',
          message: expect.stringContaining(names),
        }),
      ]);
      expect(result.gamesDir).toBe(join(cwd, 'game'));
      expect(existsSync(join(cwd, '.e8'))).toBe(false);
    },
  );

  it('a GameSpec validateSpec itself refuses is the same diagnostic', async () => {
    const cwd = project();
    writeSpec(cwd, { ...specOf(cwd), betLevels: [5, 1] });
    const result = await assemble(cwd);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        plugin: 'spec',
        where: 'game/spec.json',
        message: expect.stringContaining('ascending'),
      }),
    ]);
    expect(existsSync(join(cwd, '.e8'))).toBe(false);
  });

  it('rewrites .e8/game/script.spin only when the bytes actually change', async () => {
    const cwd = project();
    const { spinFile } = await assemble(cwd);
    const first = statSync(spinFile).mtimeMs;
    await assemble(cwd);
    expect(statSync(spinFile).mtimeMs).toBe(first);

    writeFileSync(
      join(cwd, 'game', 'script.spin'),
      `${readFileSync(join(cwd, 'game', 'script.spin'), 'utf8')}\n-- edited\n`,
    );
    await assemble(cwd);
    expect(readFileSync(spinFile, 'utf8').endsWith('-- edited\n')).toBe(true);
  });

  it('a descriptive spec.json is left alone — no prelude, no .e8, the project’s own game/', async () => {
    const cwd = project();
    cpSync(DESCRIPTIVE, join(cwd, 'game', 'spec.json'));
    const result = await assemble(cwd);
    expect(result).toEqual({
      gamesDir: join(cwd, 'game'),
      spinFile: join(cwd, 'game', 'script.spin'),
      diagnostics: [],
    });
    expect(existsSync(join(cwd, '.e8'))).toBe(false);
  });

  it('a project with no game/spec.json at all is left alone too', async () => {
    const cwd = project();
    rmSync(join(cwd, 'game', 'spec.json'));
    const result = await assemble(cwd);
    expect(result).toMatchObject({ gamesDir: join(cwd, 'game'), diagnostics: [] });
  });
});

describe('e8 check and e8 spin carry what assemble had to say', () => {
  const brokenSpec = (cwd: string) => {
    const spec = specOf(cwd);
    delete spec.maxWin;
    writeSpec(cwd, spec);
  };

  it('e8 check on a broken spec reports it, above whatever the parser says', async () => {
    const cwd = project();
    brokenSpec(cwd);
    const result = await check({ cwd });
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'spec',
      where: 'game/spec.json',
    });
    // No assembly to read, so the file checked is the authored logic.
    expect(result.file).toBe(join(cwd, 'game', 'script.spin'));
  });

  it('e8 spin on a broken spec reports it and spawns no e8-server', async () => {
    const cwd = project();
    brokenSpec(cwd);
    const before = e8Servers(cwd);
    const report = await spin({ cwd, n: 3 });
    expect(report.spins).toBe(0);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', plugin: 'spec', where: 'game/spec.json' }),
    ]);
    // `assemble` refused before the session was ever composed — nothing to
    // wait for, so this is not a poll: the count cannot have risen yet.
    expect(e8Servers(cwd)).toBe(before);
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

describe('the spin schema reads the AUTHORED game/script.spin', () => {
  /** `schema` on its own — no server, no session; `ctx.spinSchema` is all these read. */
  async function spinSchema(cwd: string) {
    const ctx = new Context();
    await ctx.plugin(schema, { cwd });
    const service = ctx.spinSchema;
    await ctx.fiber.dispose();
    return service;
  }

  /**
   * The prelude is `const` declarations and nothing else, and
   * `parseSpinSchema` skips every `const` — so the authored file already
   * parses to the whole schema, and reading it costs no disk write and
   * gives line numbers in the file the author can open (spec §6).
   */
  it('parses the authored file to the full schema, and assembles nothing to do it', async () => {
    const cwd = project();
    const service = await spinSchema(cwd);
    expect(service.schema?.gameId).toBe('spec-slot');
    expect(service.diagnostics).toEqual([]);
    expect(existsSync(join(cwd, '.e8'))).toBe(false);
  });

  it('a mistake is reported at its line in game/script.spin, untouched by any offset', async () => {
    const cwd = project();
    const file = join(cwd, 'game', 'script.spin');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nrecord {\n`);
    const authorLine = readFileSync(file, 'utf8').split('\n').indexOf('record {') + 1;
    expect(authorLine).toBeGreaterThan(1);

    const service = await spinSchema(cwd);
    const located = service.diagnostics.filter((d) => d.at !== undefined);
    expect(located.length).toBeGreaterThan(0);
    for (const d of located) {
      expect(d.at!.line).toBe(authorLine);
      expect(d.where).toBe(`line ${authorLine}`);
    }
    expect(service.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
  });

  it('a stage the enum never declares is an error naming game/script.spin', async () => {
    const cwd = project();
    const file = join(cwd, 'game', 'script.spin');
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace('  stage = base_game\n', '  stage = free_spins\n'),
    );
    const service = await spinSchema(cwd);
    const errors = service.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].where).toBe('game/script.spin');
  });
});
