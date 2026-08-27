import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sources(join(dir, e.name)) : [join(dir, e.name)],
  );
}

describe('contracts purity', () => {
  it('imports nothing — not cordis, not schemastery, not node builtins', () => {
    for (const file of sources(SRC)) {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      const foreign = imports.filter((s) => !s.startsWith('.'));
      expect(foreign, `${file} imports ${foreign.join(', ')}`).toEqual([]);
    }
  });
});
