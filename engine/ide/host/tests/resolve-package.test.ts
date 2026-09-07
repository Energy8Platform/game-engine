import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackageJson, unresolvedReason } from '../src/resolvePackage';

/**
 * Builds a fresh temp project from a flat map of relative-path -> file
 * content, the way `project.test.ts`'s fixtures look once expanded. Every
 * other host test either copies a checked-in fixture directory or builds
 * one by hand with repeated `mkdirSync`/`writeFileSync` pairs; this is that
 * same idea condensed for a test file that only cares about
 * `resolvePackage`'s own view of a project, not the rest of the host.
 *
 * Returns the REALPATH of the temp dir, not the raw `mkdtempSync` result —
 * measured directly on this machine: macOS's `os.tmpdir()` answers through
 * `/var`, itself a symlink to `/private/var`, so `require.resolve` (which
 * follows symlinks by default) comes back `/private/var/...` while an
 * unresolved `dir` variable stays `/var/...`. That mismatch fails a bare
 * `.dir` equality assertion for a reason that has nothing to do with
 * plugin resolution — the exact class of accidental symlink failure this
 * task is otherwise all about guarding against, just showing up in the
 * test's own scaffolding instead of the code under test.
 */
function projectWith(files: Record<string, string>): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ide-host-resolve-package-')));
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
  return dir;
}

describe('readPackageJson', () => {
  it('finds a plugin the project keeps in plugins/', () => {
    const dir = projectWith({
      'plugins/acme-thing/package.json': '{"name":"acme-thing","version":"1.0.0"}',
    });
    expect(readPackageJson(dir, 'acme-thing')!.dir).toBe(join(dir, 'plugins', 'acme-thing'));
  });

  it('a project plugin beats an installed package of the same name', () => {
    const dir = projectWith({
      'plugins/dup/package.json': '{"name":"dup","version":"1.0.0"}',
      'node_modules/dup/package.json': '{"name":"dup","version":"9.9.9"}',
      'node_modules/dup/index.js': '',
    });
    expect(readPackageJson(dir, 'dup')!.dir).toBe(join(dir, 'plugins', 'dup'));
  });

  it('still finds installed packages when the project has no plugins/ at all', () => {
    const dir = projectWith({
      'node_modules/only/package.json': '{"name":"only","version":"1.0.0"}',
      'node_modules/only/index.js': '',
    });
    expect(readPackageJson(dir, 'only')!.dir).toBe(join(dir, 'node_modules', 'only'));
  });

  it('a plugins/ entry with no package.json is not a package', () => {
    const dir = projectWith({ 'plugins/empty/index.js': '' });
    expect(readPackageJson(dir, 'empty')).toBeNull();
  });

  it('a name that escapes the plugins directory resolves nothing', () => {
    // `name: '../../../etc'` in a patch must not walk out of the project.
    const dir = projectWith({ 'plugins/ok/package.json': '{"name":"ok","version":"1.0.0"}' });
    expect(readPackageJson(dir, '../../../etc')).toBeNull();
  });

  it('an escape that lands on a REAL package.json is still refused', () => {
    // The test above never exercises the containment check at all: from a
    // fresh `mkdtempSync` project, three `..` segments land somewhere with
    // no `package.json`, so it passes even with no containment logic
    // whatsoever — the same trap `runtime-assets.test.ts`'s doc comment
    // describes for the symlink case ("measured directly: with the
    // containment check deleted outright, that version of this test still
    // passed unchanged"). Here the escape target is built to actually
    // exist: `name: '../../secret'` from `<project>/plugins` lexically
    // lands one level ABOVE the project root, and a real package.json sits
    // there waiting. A lexical `join` with no realpath comparison would
    // serve it; only comparing realpaths against `plugins/`'s own root
    // catches this.
    const root = projectWith({ 'secret/package.json': '{"name":"secret","version":"6.6.6"}' });
    const dir = join(root, 'project');
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    expect(readPackageJson(dir, '../../secret')).toBeNull();
  });

  it('invalid JSON in a plugins/ manifest resolves nothing, not a throw', () => {
    // The single most ordinary mistake the hand-edited `plugins/` workflow
    // invites — a typo that breaks the JSON. `readProjectPlugin`'s own
    // `JSON.parse` used to sit outside any try/catch, the only one in this
    // file not wrapped: the two `require.resolve`-based branches above
    // already catch a `JSON.parse` failure incidentally, since their
    // `try` wraps the whole resolve-then-parse sequence. A `SyntaxError`
    // here must come back as an ordinary "could not resolve" null, not
    // propagate out of this function and up through every caller's own
    // per-row loop.
    const dir = projectWith({ 'plugins/broken/package.json': '{ this is not valid JSON' });
    expect(readPackageJson(dir, 'broken')).toBeNull();
  });

  it('a package.json that is a directory resolves nothing, not a throw', () => {
    // `readFileSync` on a directory throws EISDIR — a different failure
    // shape than "missing" (which `realpathSync` alone already handles;
    // the path genuinely exists here, so that check passes and only the
    // subsequent read fails). Still must not escape as an uncaught
    // exception.
    const dir = projectWith({});
    mkdirSync(join(dir, 'plugins', 'broken2', 'package.json'), { recursive: true });
    expect(readPackageJson(dir, 'broken2')).toBeNull();
  });
});

/**
 * Why `readPackageJson` came back `null`, for the callers that turn that
 * `null` into a diagnostic.
 *
 * `null` collapses two situations a person needs apart: nothing by that
 * name anywhere (a typo, or a missing install), and a package that IS
 * there, in the project's own `plugins/`, whose manifest cannot be read.
 * The caller's message was written for the first and was being shown for
 * the second — "check for a typo in e8.patch.yml, or install it" about a
 * package already sitting on disk.
 */
describe('unresolvedReason', () => {
  it('explains a plugins/ manifest whose JSON does not parse, naming the file', () => {
    const dir = projectWith({ 'plugins/broken/package.json': '{ this is not valid JSON' });
    const reason = unresolvedReason(dir, 'broken')!;
    expect(reason).toBeDefined();
    expect(reason).toContain(join(dir, 'plugins', 'broken', 'package.json'));
    expect(reason.toLowerCase()).toContain('json');
  });

  it('explains a package.json that is a directory, not only one with bad syntax', () => {
    const dir = projectWith({});
    mkdirSync(join(dir, 'plugins', 'broken2', 'package.json'), { recursive: true });
    expect(unresolvedReason(dir, 'broken2')).toContain('package.json');
  });

  it('has nothing to say about a name that is simply not there', () => {
    // The caller's own "could not be resolved … check for a typo, or
    // install it" is exactly right for this one, and must not be
    // second-guessed.
    const dir = projectWith({ 'plugins/ok/package.json': '{"name":"ok","version":"1.0.0"}' });
    expect(unresolvedReason(dir, 'no-such-thing')).toBeUndefined();
  });

  it('has nothing to say about a package that resolves fine', () => {
    const dir = projectWith({ 'plugins/ok/package.json': '{"name":"ok","version":"1.0.0"}' });
    expect(unresolvedReason(dir, 'ok')).toBeUndefined();
  });

  it('has nothing to say about a name that escapes plugins/ — that is refusal, not damage', () => {
    const root = projectWith({ 'secret/package.json': '{"name":"secret","version":"6.6.6"}' });
    const dir = join(root, 'project');
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    expect(unresolvedReason(dir, '../../secret')).toBeUndefined();
  });
});
