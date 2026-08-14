import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DIAGNOSTIC_CODES, KERNEL_VERSION } from '@/index';

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

  // KERNEL_VERSION (src/index.ts) is the admission gate for every plugin: resolvePlan compares it
  // against each manifest's declared `engine` range and rejects the plugin outright on a mismatch
  // (resolve/engine-mismatch). Nothing connects it to package.json's own "version" — a release that
  // bumps one and misses the other would silently reject every plugin at once, or silently stop
  // enforcing a real engine bump. This is the one place both are already read, so it is the one place
  // that can catch the two drifting apart.
  it('keeps KERNEL_VERSION in sync with package.json\'s version', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(KERNEL_VERSION).toBe(pkg.version);
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

  // DIAGNOSTIC_CODES (diagnostics.ts) claims to list every code this package emits. A hand-maintained
  // list drifts the moment someone adds, renames, or removes a code in one place and not the other —
  // this grep is what keeps that claim true instead of aspirational. It matches any quoted
  // "domain/kebab-code"-shaped string literal anywhere under src/**, which — verified by inspection —
  // is exactly the diagnostic codes and nothing else (no import specifier matches: those all start
  // with "." or a package name with no "/kebab-case" second segment shaped like this).
  it('lists every diagnostic code src/** actually emits, and nothing it does not', () => {
    const CODE_LITERAL = /['"]([a-z][a-z0-9]*\/[a-z][a-z0-9-]*)['"]/g;
    const found = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      const body = readFileSync(file, 'utf8');
      for (const match of body.matchAll(CODE_LITERAL)) found.add(match[1]);
    }

    const declared = new Set(DIAGNOSTIC_CODES);
    const undeclared = [...found].filter((code) => !declared.has(code)).sort();
    const stale = [...declared].filter((code) => !found.has(code)).sort();

    expect(undeclared).toEqual([]); // a code src/** emits but DIAGNOSTIC_CODES does not list
    expect(stale).toEqual([]); // a code DIAGNOSTIC_CODES lists but src/** no longer emits
  });
});
