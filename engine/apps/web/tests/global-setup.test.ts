import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isFresh } from './e2e/global-setup';

/** A temp tree: `roots[0]/a.ts`, `roots[0]/deep/b.ts`, `roots[1]/c.ts`, every file stamped at `t`. */
let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tree(t: number): { roots: string[]; files: string[] } {
  dir = mkdtempSync(join(tmpdir(), 'e8-global-setup-'));
  const roots = [join(dir, 'one'), join(dir, 'two')];
  const files = [join(roots[0], 'a.ts'), join(roots[0], 'deep', 'b.ts'), join(roots[1], 'c.ts')];
  mkdirSync(join(roots[0], 'deep'), { recursive: true });
  mkdirSync(roots[1], { recursive: true });
  for (const f of files) {
    writeFileSync(f, '');
    utimesSync(f, t / 1000, t / 1000);
  }
  return { roots, files };
}

describe('isFresh', () => {
  const t = 1_700_000_000_000;

  it('is true when dist/index.html is at least as new as every file under the roots', () => {
    const { roots } = tree(t);
    expect(isFresh(t, roots)).toBe(true);
    expect(isFresh(t + 1000, roots)).toBe(true);
  });

  it('is false when any file, however deep, is newer', () => {
    const { roots, files } = tree(t);
    utimesSync(files[1], (t + 5000) / 1000, (t + 5000) / 1000);
    expect(statSync(files[1]).mtimeMs).toBeGreaterThan(t);
    expect(isFresh(t, roots)).toBe(false);
  });

  it('a single file passed as a root counts too', () => {
    const { roots, files } = tree(t);
    expect(isFresh(t, [...roots, files[2]])).toBe(true);
    utimesSync(files[2], (t + 5000) / 1000, (t + 5000) / 1000);
    expect(isFresh(t, [...roots, files[2]])).toBe(false);
  });

  it('a root that does not exist is never fresh', () => {
    const { roots } = tree(t);
    expect(isFresh(t, [...roots, join(dir, 'nope')])).toBe(false);
  });
});
