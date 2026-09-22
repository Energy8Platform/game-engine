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
  it('carries main.ts, env.d.ts, script.spin, e8.profile.yml, flow.yml and the three scene files byte-for-byte from first-slot', () => {
    for (const rel of [
      '.gitignore',
      'src/main.ts',
      'src/env.d.ts',
      'src/editor.ts',
      'game/script.spin',
      'e8.profile.yml',
      'flow.yml',
      'scenes/base_game.scene.yml',
      'scenes/big_win.scene.yml',
      'scenes/orb.scene.yml',
      'editor.html',
      'assets/logo.png',
      'assets/coin.json',
      'assets/coin.png',
      'assets/spin.wav',
      'symbols.yml',
      'assets/symbols/1.png',
      'assets/symbols/2.png',
      'assets/symbols/3.png',
      'assets/symbols/4.png',
      'assets/symbols/5.png',
      'assets/symbols/6.png',
    ]) {
      expect(readFileSync(join(TEMPLATE, rel))).toEqual(readFileSync(join(EXAMPLE, rel)));
    }
  });

  /**
   * NOT byte-identical to `first-slot`'s, on purpose: that one `extends`
   * `tsconfig.base.json` by a relative path that only resolves at the
   * depth of `engine/examples/<id>`, and a project the host creates lands
   * wherever the workspace root is — one level deeper under a temp root,
   * anywhere at all outside this repo. vite's esbuild transform reads
   * this file for every `.ts` it serves, and an unresolved `extends`
   * 500s each of them (measured: `#status` empty for 40 s). So the base
   * options are inlined here, and the file must stay self-contained.
   */
  it('tsconfig.json is self-contained: no extends, bundler resolution, vite/client types', () => {
    const tsconfig = JSON.parse(readFileSync(join(TEMPLATE, 'tsconfig.json'), 'utf8')) as {
      extends?: unknown;
      compilerOptions: { moduleResolution?: unknown; types?: unknown };
    };
    expect(tsconfig.extends).toBeUndefined();
    expect(tsconfig.compilerOptions.moduleResolution).toBe('bundler');
    expect(tsconfig.compilerOptions.types).toContain('vite/client');
  });

  it('e8.template.yml is a manifest with a name and a description', () => {
    const manifest = yaml.load(readFileSync(join(TEMPLATE, 'e8.template.yml'), 'utf8'));
    expect(manifest).toEqual({ name: expect.any(String), description: expect.any(String) });
  });

  it('e8.yml composes exactly the ide-bridge entry', () => {
    const entries = yaml.load(readFileSync(join(TEMPLATE, 'e8.yml'), 'utf8'));
    expect(entries).toEqual([{ id: 'bridge1', name: '@energy8engine/ide-bridge', config: {} }]);
  });

  /**
   * `index.html` was never in the byte-identical list above, and Task 4 of
   * "tempo" (2026-09-20) pins it here rather than there for a reason: the
   * two copies are NOT byte-identical, even with `{{id}}` substituted —
   * `1b341dc` ("Offer only the mechanics the template ships") deliberately
   * gave `first-slot` a third `<option value="reel-step">` (and a comment
   * naming it) that `slot-basic` does not carry, because the template
   * ships no `reel-step` mechanic to bind it to — the exact thing the
   * `e8.patch.yml` test right below this one already pins from the other
   * side. So this test strips the ONE block both changes live in (the
   * `<select id="mechanic">` `<label>`, comment included) from both
   * copies before comparing — catching drift anywhere else in the file
   * (the turbo checkbox this task adds among it) while leaving that one,
   * already-settled divergence alone rather than silently re-allowing it
   * everywhere.
   */
  it('index.html matches first-slot byte-for-byte, aside from {{id}} and the mechanic <select> (first-slot ships a third, project-only mechanic — 1b341dc)', () => {
    const stripMechanicLabel = (html: string) =>
      html.replace(/ {6}<label>\n {8}mechanic:\n[\s\S]*?<\/select>\n {6}<\/label>\n/, '');
    const template = stripMechanicLabel(
      readFileSync(join(TEMPLATE, 'index.html'), 'utf8').replace('{{id}}', 'first-slot'),
    );
    const example = stripMechanicLabel(readFileSync(join(EXAMPLE, 'index.html'), 'utf8'));
    // Fails loudly rather than vacuously if the regex above ever stops
    // matching (an edit reshapes the `<select>` block) — an empty-string
    // `toEqual` on both sides would otherwise pass having stripped
    // everything.
    expect(template).not.toBe('');
    expect(template).toEqual(example);
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
   * sixteen files plus their four parent directories, and in particular no
   * `plugins/` — `first-slot` has one, `slot-basic` does not. `README.md`
   * holds the patch's prose: the IDE rewrites `e8.patch.yml` without
   * comments, so a created project keeps the explanation here.
   *
   * `.gitignore` is shipped content too, and `workspace.create` copies it
   * with the rest (`cpSync` does not skip dotfiles): a project the IDE
   * creates has to ignore `.e8/` from its first commit — that is where the
   * host writes the assembled `prelude ⧺ logic` .spin and `e8 shot`'s PNGs,
   * neither of which is the author's source.
   */
  it('ships exactly the sixteen template files, no plugins/ directory', () => {
    const topLevel = readdirSync(TEMPLATE)
      .filter((name) => name !== 'node_modules')
      .sort();
    expect(topLevel).toEqual([
      '.gitignore',
      'README.md',
      'assets',
      'e8.patch.yml',
      'e8.profile.yml',
      'e8.template.yml',
      'e8.yml',
      'editor.html',
      'flow.yml',
      'game',
      'index.html',
      'package.json',
      'scenes',
      'src',
      'symbols.yml',
      'tsconfig.json',
    ]);
  });
});
