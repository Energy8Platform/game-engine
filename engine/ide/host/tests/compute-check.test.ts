import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { check } from '../src/compute';

const SPIN = join(__dirname, '..', '..', '..', 'examples', 'first-slot', 'game', 'script.spin');

describe('check', () => {
  it('reads a valid .spin: no error diagnostics, the schema names the game', async () => {
    const result = await check({ file: SPIN });
    expect(result.file).toBe(SPIN);
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(result.schema?.gameId).toBe('first-slot');
  });

  it('reports a broken declaration as an error with a line', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'e8-check-')), 'broken.spin');
    writeFileSync(file, readFileSync(SPIN, 'utf8') + '\nrecord {\n');
    const result = await check({ file });
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].at?.line).toBeTypeOf('number');
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
