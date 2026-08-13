import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SRC = join(ROOT, 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return name.endsWith('.ts') ? [full] : [];
  });
}

describe('kernel purity', () => {
  it('declares no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toBeUndefined();
  });

  it('imports nothing outside its own source tree', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const body = readFileSync(file, 'utf8');
      for (const match of body.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.')) continue;
        offenders.push(`${file.slice(ROOT.length + 1)} → ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('touches no browser globals', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const body = readFileSync(file, 'utf8');
      for (const global of ['document', 'window', 'localStorage', 'navigator']) {
        if (new RegExp(`\\b${global}\\b`).test(body)) {
          offenders.push(`${file.slice(ROOT.length + 1)} → ${global}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
