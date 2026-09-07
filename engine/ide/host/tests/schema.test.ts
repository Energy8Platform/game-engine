import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIdeHost } from '../src/index';

function fixture(name: string): string {
  return join(__dirname, 'fixtures', name);
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
    const host = await createIdeHost({ cwd: fixture('project-simple'), port: 0 });
    expect(host.ctx.spinSchema.schema!.gameId).toBe('demo');
    await host.stop();
  });

  it('a missing script.spin is a diagnostic and the host still starts', async () => {
    const host = await createIdeHost({ cwd: fixture('project-no-spin'), port: 0 });
    expect(host.ctx.spinSchema.schema).toBeNull();
    expect(host.ctx.spinSchema.diagnostics.some((d) => d.where.includes('script.spin'))).toBe(
      true,
    );
    expect(host.url).toBeTruthy();
    await host.stop();
  });

  it('an action naming a stage the enum does not declare is a diagnostic', async () => {
    // The judgement task 1's type guard deliberately refused to make.
    const host = await createIdeHost({ cwd: fixture('project-stage-typo'), port: 0 });
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
    const host = await createIdeHost({ cwd: fixture('project-no-spin'), port: 0 });
    const diagnostics = host.ctx.spinSchema.diagnostics;
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    await host.stop();
  });

  it('a .spin the parser could only half-read yields half a schema and warnings, not errors', async () => {
    // Half a schema plus a diagnostic beats nothing — but only if the
    // diagnostic does not itself blank the screen. `project-half-spin`'s
    // `.spin` has one unterminated record; everything else in it reads.
    const host = await createIdeHost({ cwd: fixture('project-half-spin'), port: 0 });
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
    const host = await createIdeHost({ cwd: fixture('project-stage-typo'), port: 0 });
    const stageTypo = host.ctx.spinSchema.diagnostics.find((d) =>
      d.message.includes('free_spins'),
    )!;
    expect(stageTypo.severity).toBe('error');
    await host.stop();
  });

  it('/api/composition carries no error-severity diagnostic for a project with no .spin', async () => {
    // The end of the wire this severity actually travels: what the
    // browser receives, not just what the service holds.
    const host = await createIdeHost({ cwd: fixture('project-no-spin'), port: 0 });
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
    const host = await createIdeHost({ cwd: fixture('project-simple'), port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body.schema.gameId).toBe('demo');
    await host.stop();
  });

  it('carries a null schema and its diagnostics rather than omitting the field', async () => {
    const host = await createIdeHost({ cwd: fixture('project-no-spin'), port: 0 });
    const body = await (await fetch(`${host.url}/api/composition`)).json();
    expect(body).toHaveProperty('schema');
    expect(body.schema).toBeNull();
    expect(body.diagnostics.length).toBeGreaterThan(0);
    await host.stop();
  });
});
