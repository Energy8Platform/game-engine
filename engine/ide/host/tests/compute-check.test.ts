import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../src/compute';
import { createIdeHost } from '../src/index';
import { checkSource } from '../src/plugins/schema';

const SPIN = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game', 'script.spin');
const STAGE_TYPO = join(__dirname, 'fixtures', 'project-stage-typo', 'game', 'script.spin');

describe('check', () => {
  it('reads a valid .spin: no error diagnostics, the schema names the game', async () => {
    const result = await check({ file: SPIN });
    expect(result.file).toBe(SPIN);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.schema?.gameId).toBe('first-slot');
  });

  it("a parse problem is a warning with a line — the panel's verdict, not the parser's", async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'e8-check-')), 'broken.spin');
    writeFileSync(file, readFileSync(SPIN, 'utf8') + '\nrecord {\n');
    const result = await check({ file });
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.every((d) => d.severity === 'warning')).toBe(true);
    expect(result.diagnostics[0].at?.line).toBeTypeOf('number');
  });

  it('an action naming an undeclared stage is an error, addressed to the file given', async () => {
    const result = await check({ file: STAGE_TYPO });
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].where).toBe(STAGE_TYPO);
    expect(errors[0].message).toContain('free_spins');
  });

  it('gives the same verdict as POST /api/check for the same text', async () => {
    const host = await createIdeHost({ root: join(__dirname, 'fixtures', 'workspace'), port: 0 });
    try {
      for (const source of [
        readFileSync(STAGE_TYPO, 'utf8'),
        readFileSync(SPIN, 'utf8') + '\nrecord {\n',
      ]) {
        const res = await fetch(`${host.url}/api/check`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ source }),
        });
        expect((await res.json()).diagnostics).toEqual(checkSource(source).diagnostics);
      }
    } finally {
      await host.stop();
    }
  });

  it('a missing file is one compute diagnostic naming the path, not a throw', async () => {
    const file = join(tmpdir(), 'e8-check-does-not-exist', 'script.spin');
    const result = await check({ file });
    expect(result.schema).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'error',
      plugin: 'compute',
      where: file,
    });
  });
});
