import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripRigHistory, findRigHistory } from '../src/vite/stripRigHistory';

const build = (outDir: string): void => {
  const p = stripRigHistory() as { configResolved(c: unknown): void; closeBundle(): void };
  p.configResolved({ root: '/', build: { outDir } });
  p.closeBundle();
};

describe('stripRigHistory', () => {
  it('drops every .rig-history under outDir and keeps everything else', () => {
    const out = mkdtempSync(join(tmpdir(), 'e8-strip-'));
    for (const rig of ['assets/rigs/h1', 'assets/deep/er/h2']) {
      mkdirSync(join(out, rig, '.rig-history/rig'), { recursive: true });
      writeFileSync(join(out, rig, '.rig-history/rig/0001.json'), '{}');
      writeFileSync(join(out, rig, 'rig.json'), '{}');
      writeFileSync(join(out, rig, 'head.png'), '');
    }
    expect(findRigHistory(out)).toHaveLength(2);
    build(out);
    expect(findRigHistory(out)).toEqual([]);
    expect(existsSync(join(out, 'assets/rigs/h1/rig.json'))).toBe(true);
    expect(existsSync(join(out, 'assets/rigs/h1/head.png'))).toBe(true);
    expect(existsSync(join(out, 'assets/deep/er/h2/rig.json'))).toBe(true);
  });

  it('is a no-op on a build without rigs, and on a missing outDir', () => {
    const out = mkdtempSync(join(tmpdir(), 'e8-strip-'));
    writeFileSync(join(out, 'index.html'), '');
    build(out);
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(() => build(join(out, 'nope'))).not.toThrow();
  });
});
