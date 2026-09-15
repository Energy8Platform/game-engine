import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as yaml from 'js-yaml';

/**
 * `slot-basic` is `first-slot` minus its `plugins/` and the `reel-step`
 * mechanic, with `{{id}}` standing in for the project id in the three
 * files a project creator rewrites. Paths resolved from this file's own
 * `import.meta.url`, the same way `project.ts`'s `REPO_BUNDLES_DIR` finds
 * `engine/bundles` — not `__dirname`, so this stays honest about being ESM.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const TEMPLATE = join(ROOT, 'engine/templates/slot-basic');
const EXAMPLE = join(ROOT, 'engine/examples/first-slot');

/** Never descends into `node_modules` — npm hoists one here at install time
 * (the template pins `@energy8platform/game-engine@^0.41.0` against the
 * monorepo's newer version, same as `first-slot` itself does), and vendor
 * code is not template content. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('engine/templates/slot-basic', () => {
  it('carries main.ts, script.spin, tsconfig.json and e8.profile.yml byte-for-byte from first-slot', () => {
    for (const rel of ['src/main.ts', 'game/script.spin', 'tsconfig.json', 'e8.profile.yml']) {
      expect(readFileSync(join(TEMPLATE, rel))).toEqual(readFileSync(join(EXAMPLE, rel)));
    }
  });

  it('e8.template.yml is a manifest with a name and a description', () => {
    const manifest = yaml.load(readFileSync(join(TEMPLATE, 'e8.template.yml'), 'utf8'));
    expect(manifest).toEqual({ name: expect.any(String), description: expect.any(String) });
  });

  it('e8.yml composes exactly the ide-bridge entry', () => {
    const entries = yaml.load(readFileSync(join(TEMPLATE, 'e8.yml'), 'utf8'));
    expect(entries).toEqual([{ id: 'bridge1', name: '@energy8engine/ide-bridge', config: {} }]);
  });

  it('e8.patch.yml binds base_game to classic and ships no reel-step row', () => {
    const patch = yaml.load(readFileSync(join(TEMPLATE, 'e8.patch.yml'), 'utf8')) as {
      rows: Array<{ id: string; name?: string; config?: { stages?: { base_game?: string } } }>;
    };
    const boundRow = patch.rows.find((r) => r.config?.stages?.base_game !== undefined);
    expect(boundRow?.config?.stages?.base_game).toBe('classic');
    expect(patch.rows.some((r) => r.name === 'reel-step')).toBe(false);
  });

  /**
   * `package.json.name` is NOT `{{id}}`, unlike the brief's literal text:
   * `engine/templates/slot-basic` sits exactly two segments under
   * `engine`, the same depth as the root `package.json`'s `workspaces`
   * glob (`engine`, then two more), so having a `package.json` here makes
   * npm treat this template directory as a workspace — a literal
   * `{{id}}` name there breaks `npm install`/`npm ls` for the whole
   * monorepo. Fixed to `e8-template-slot-basic` instead; Task 2's
   * `workspace.create` rewrites this field by JSON edit (not string
   * substitution) when it copies the template, the same way it does for
   * `game/spec.json` and `index.html`.
   */
  it('package.json is a valid, real workspace name — not the {{id}} placeholder', () => {
    const pkg = JSON.parse(readFileSync(join(TEMPLATE, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('e8-template-slot-basic');
  });

  it('{{id}} appears only in game/spec.json and index.html', () => {
    const withPlaceholder = walk(TEMPLATE)
      .filter((f) => readFileSync(f, 'utf8').includes('{{id}}'))
      .map((f) => relative(TEMPLATE, f))
      .sort();
    expect(withPlaceholder).toEqual(['game/spec.json', 'index.html']);
  });

  /**
   * The template's own top level, ignoring `node_modules` (an install-time
   * hoist, not shipped content — see `walk`'s doc comment): exactly the
   * nine files plus their two parent directories, and in particular no
   * `plugins/` — `first-slot` has one, `slot-basic` does not.
   */
  it('ships exactly the nine template files, no plugins/ directory', () => {
    const topLevel = readdirSync(TEMPLATE)
      .filter((name) => name !== 'node_modules')
      .sort();
    expect(topLevel).toEqual([
      'e8.patch.yml',
      'e8.profile.yml',
      'e8.template.yml',
      'e8.yml',
      'game',
      'index.html',
      'package.json',
      'src',
      'tsconfig.json',
    ]);
  });
});
