// packages/create-slot/test/scaffold.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generate } from '../src/generate';
import { applyDefaults } from '../src/answers';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// Absolute paths to the local packages (built dist must exist).
const REPO = resolve(__dirname, '../../..');
const LOCAL = {
  'platform-core': 'file:' + join(REPO, 'packages/platform-core'),
  'game-engine': 'file:' + join(REPO, 'packages/game-engine'),
  'stake-kit': 'file:' + join(REPO, 'packages/stake-kit'),
  'stake-bridge': 'file:' + join(REPO, 'packages/stake-bridge'),
};

describe('scaffold anti-drift', () => {
  it('a generated game typechecks against the local packages', () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-scaffold-'));
    // generate with file: deps so npm install resolves the LOCAL built packages
    // (catches drift between the template/codegen and the real package APIs)
    return generate(applyDefaults({ id: 'drift-check', mechanic: 'cascade' }), dir, LOCAL as any).then(() => {
      // Dedupe pixi.js: patch the generated tsconfig to redirect pixi.js type resolution to the
      // monorepo's own copy so user source and the symlinked game-engine see ONE Texture class.
      // (Matches a real single-pixi.js published install; avoids a file:-symlink two-copies false
      // positive where pixi.js installs twice and protected-member structural typing breaks.)
      const tscPath = join(dir, 'tsconfig.json');
      const tsc = JSON.parse(readFileSync(tscPath, 'utf8'));
      tsc.compilerOptions.baseUrl = '.';
      tsc.compilerOptions.paths = {
        'pixi.js': [join(REPO, 'node_modules/pixi.js/lib/index.d.ts')],
      };
      writeFileSync(tscPath, JSON.stringify(tsc, null, 2));
      execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit' });
      // typecheck the generated game against the local package .d.ts
      execFileSync('npx', ['tsc', '--noEmit'], { cwd: dir, stdio: 'inherit' });
      expect(readFileSync(join(dir, 'src/GameScene.ts'), 'utf8')).toContain('CascadeController');
    });
  }, 180_000);
});
