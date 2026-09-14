import { cpSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIdeHost, type IdeHost } from '../src/index';

function fixture(name: string): string {
  return join(__dirname, 'fixtures', name);
}

/**
 * The exact minimal `.spin` `spin-parser`'s own suite already proves parses
 * with zero diagnostics — see `fixtures/project-simple/game/script.spin`'s
 * doc comment. Read once, from that checked-in file, rather than retyped
 * here: retyping it would give `/api/check`'s "nothing wrong" test its own,
 * independently-driftable copy of "known good".
 */
const GOOD_SPIN = readFileSync(
  join(__dirname, 'fixtures', 'project-simple', 'game', 'script.spin'),
  'utf8',
);

/**
 * A fresh temp copy of `fixtures/files/plain` (an `e8.yml: []` project, so
 * the host boots with no composition to resolve) with its `game/script.spin`
 * overwritten to `GOOD_SPIN` — never the checked-in fixture itself. These
 * tests exercise a route whose whole point is that it must never touch this
 * file; running it against a shared, un-copied fixture would make a bug in
 * that route corrupt a checked-in file instead of failing a test.
 */
function checkFixture(): string {
  const dir = realpathSync(mkdtempSync(join('/tmp', 'ide-host-schema-check-')));
  cpSync(join(__dirname, 'fixtures', 'files', 'plain'), dir, { recursive: true });
  writeFileSync(join(dir, 'game', 'script.spin'), GOOD_SPIN);
  return dir;
}

function startHost(cwd: string): Promise<IdeHost> {
  return createIdeHost({ root: cwd, port: 0 });
}

/**
 * `ctx.spinSchema` — the host's read of `game/script.spin`, exposed the
 * same way `ctx.project` already exposes the composition: a live getter
 * pair plus `reload()`, never a throw. See `../src/plugins/schema.ts`'s
 * module doc for why this judgement (an action naming a stage the schema
 * does not declare) lives here and not in `isSpinSchema`.
 */
describe('ctx.spinSchema', () => {
  it('parses the project game/script.spin and exposes it', async () => {
    const host = await createIdeHost({ root: fixture('project-simple'), port: 0 });
    expect(host.ctx.spinSchema.schema!.gameId).toBe('demo');
    await host.stop();
  });

  it('a missing script.spin is a diagnostic and the host still starts', async () => {
    const host = await createIdeHost({ root: fixture('project-no-spin'), port: 0 });
    expect(host.ctx.spinSchema.schema).toBeNull();
    expect(host.ctx.spinSchema.diagnostics.some((d) => d.where.includes('script.spin'))).toBe(true);
    expect(host.url).toBeTruthy();
    await host.stop();
  });

  it('an action naming a stage the enum does not declare is a diagnostic', async () => {
    // The judgement task 1's type guard deliberately refused to make.
    const host = await createIdeHost({ root: fixture('project-stage-typo'), port: 0 });
    expect(host.ctx.spinSchema.diagnostics.some((d) => d.message.includes('free_spins'))).toBe(
      true,
    );
    await host.stop();
  });
});

/**
 * The severity half of the same promise, and the reason it is its own
 * describe block: `error` and `warning` are not decoration here. Any
 * `error` diagnostic in the composition makes `createGame` paint the
 * failure screen over the mount (`game/runtime/src/index.ts`), so the
 * severity this file chooses decides whether an unreadable `.spin` stops
 * a game or merely annotates it.
 *
 * The line: a `.spin` this parser could not read is a fact about THIS
 * PARSER, not about the game. The real compiler lives elsewhere, the math
 * runs through it, and a project with no `.spin` at all composed and
 * played perfectly well before a schema existed to read — so a read or
 * parse failure degrades (`warning`) and never stops. A judgement made
 * ABOUT a schema we did read (`checkActionStages` below) is a real
 * contradiction inside the project's own file and stays `error`.
 */
describe('ctx.spinSchema — severity: a .spin we cannot read must not stop the game', () => {
  it('a missing script.spin is a warning, never an error', async () => {
    const host = await createIdeHost({ root: fixture('project-no-spin'), port: 0 });
    const diagnostics = host.ctx.spinSchema.diagnostics;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    await host.stop();
  });

  it('a .spin the parser could only half-read yields half a schema and warnings, not errors', async () => {
    // Half a schema plus a diagnostic beats nothing — but only if the
    // diagnostic does not itself blank the screen. `project-half-spin`'s
    // `.spin` has one unterminated record; everything else in it reads.
    const host = await createIdeHost({ root: fixture('project-half-spin'), port: 0 });
    // Half a schema: the game block and the stage came through.
    expect(host.ctx.spinSchema.schema!.gameId).toBe('demo');
    expect(Object.keys(host.ctx.spinSchema.schema!.stages)).toEqual(['base_game']);
    // ...and the loss is reported, at a severity that degrades rather
    // than stops.
    const parseDiagnostics = host.ctx.spinSchema.diagnostics.filter((d) =>
      d.message.includes('Broken'),
    );
    expect(parseDiagnostics.length).toBeGreaterThan(0);
    expect(parseDiagnostics.every((d) => d.severity === 'warning')).toBe(true);
    await host.stop();
  });

  it('an action naming an undeclared stage stays an error — that one IS about a schema we read', async () => {
    const host = await createIdeHost({ root: fixture('project-stage-typo'), port: 0 });
    const stageTypo = host.ctx.spinSchema.diagnostics.find((d) =>
      d.message.includes('free_spins'),
    )!;
    expect(stageTypo.severity).toBe('error');
    await host.stop();
  });

  it('/api/composition carries no error-severity diagnostic for a project with no .spin', async () => {
    // The end of the wire this severity actually travels: what the
    // browser receives, not just what the service holds.
    const host = await createIdeHost({ root: fixture('project-no-spin'), port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body.diagnostics.length).toBeGreaterThan(0);
    expect(body.diagnostics.filter((d: { severity: string }) => d.severity === 'error')).toEqual(
      [],
    );
    await host.stop();
  });
});

describe('GET /api/composition carries the schema', () => {
  it('the composition response carries the schema', async () => {
    const host = await createIdeHost({ root: fixture('project-simple'), port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body.schema.gameId).toBe('demo');
    await host.stop();
  });

  it('carries a null schema and its diagnostics rather than omitting the field', async () => {
    const host = await createIdeHost({ root: fixture('project-no-spin'), port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body).toHaveProperty('schema');
    expect(body.schema).toBeNull();
    expect(body.diagnostics.length).toBeGreaterThan(0);
    await host.stop();
  });
});

/**
 * `POST /api/check` — the answer to "what is wrong with this text", for
 * `.spin` text that only exists in a browser editor buffer, never
 * written to `game/script.spin`. `parseSpinSchema` is a pure function of a
 * string (see its own doc comment), which is what makes this route cheap:
 * no temp file, no write, nothing to clean up — and, just as important, no
 * effect on `ctx.spinSchema`, the service the composition screen already
 * reads. A route that reloaded that service on every keystroke would make
 * typing in the editor rewrite what the rest of the IDE believes about a
 * file nobody saved.
 */
describe('POST /api/check', () => {
  it('parses the source it was handed, without touching any file', async () => {
    const dir = checkFixture();
    const host = await startHost(dir);
    const before = readFileSync(join(dir, 'game/script.spin'), 'utf8');
    const res = await fetch(`${host.url}/api/check`, {
      method: 'POST',
      // Missing "bet_levels"/"max_win" — the smallest input that reaches a
      // diagnostic carrying `at`, checked directly against
      // `parseSpinSchema` before writing this test (see task-2-report.md):
      // a bare `record { }` never gets past "no game block found", which
      // carries no `at` at all.
      body: JSON.stringify({ source: 'game "x" {\n}\n' }),
    });
    expect((await res.json()).diagnostics[0].at).toEqual({ line: 1 });
    expect(readFileSync(join(dir, 'game/script.spin'), 'utf8')).toBe(before);
    await host.stop();
  });

  it('a source with nothing wrong answers with an empty list, not a null', async () => {
    // An editor clearing its markers needs "no problems" to be a value.
    const dir = checkFixture();
    const host = await startHost(dir);
    const source = readFileSync(join(dir, 'game/script.spin'), 'utf8');
    const res = await fetch(`${host.url}/api/check`, {
      method: 'POST',
      body: JSON.stringify({ source }),
    });
    expect((await res.json()).diagnostics).toEqual([]);
    await host.stop();
  });

  it('a body with no source is a diagnostic, not a crash', async () => {
    const host = await startHost(checkFixture());
    const res = await fetch(`${host.url}/api/check`, {
      method: 'POST',
      body: JSON.stringify({ notSource: 'x' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).diagnostics).toHaveLength(1);
    await host.stop();
  });

  it('a body that is not JSON is a diagnostic, not an empty 500', async () => {
    // The scar: an unwrapped parse once answered 500 with nothing in the body.
    const host = await startHost(checkFixture());
    const res = await fetch(`${host.url}/api/check`, { method: 'POST', body: '<html>' });
    expect(res.status).toBe(400);
    expect((await res.json()).diagnostics).toHaveLength(1);
    await host.stop();
  });

  it('does not disturb the schema service the project is already using', async () => {
    // `/api/check` is a pure question about a string. If it reloaded or
    // replaced `spinSchema`, typing in the editor would rewrite what the
    // composition screen believes about a file nobody saved.
    const host = await startHost(checkFixture());
    const before = host.ctx.spinSchema.schema;
    expect(before).not.toBeNull();
    await fetch(`${host.url}/api/check`, {
      method: 'POST',
      body: JSON.stringify({ source: 'game "x" {\n}\n' }),
    });
    expect(host.ctx.spinSchema.schema).toBe(before);
    await host.stop();
  });
});
