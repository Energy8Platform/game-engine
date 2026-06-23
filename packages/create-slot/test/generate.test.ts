import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate';
import { applyDefaults } from '../src/answers';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const versions = { 'platform-core': '*', 'game-engine': '*', 'stake-kit': '*', 'stake-bridge': '*' };

describe('generate', () => {
  it('writes the canonical thin-game tree with substituted + codegen files', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-'));
    await generate(applyDefaults({ id: 'moon-spice', mechanic: 'cascade' }), dir, versions);
    expect(existsSync(join(dir, 'game.spec.ts'))).toBe(false); // spec lives under src/
    expect(readFileSync(join(dir, 'src/game.spec.ts'), 'utf8')).toContain("id: 'moon-spice'");
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toContain('<title>Moon Spice</title>');
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toContain('"name": "moon-spice"');
    expect(readFileSync(join(dir, 'src/GameScene.ts'), 'utf8')).toContain('CascadeController');
    expect(existsSync(join(dir, '.gitignore'))).toBe(true); // _gitignore renamed
    expect(existsSync(join(dir, 'src/stake/adapter.ts'))).toBe(true);
    expect(existsSync(join(dir, 'src/game/normalize.ts'))).toBe(true);
    expect(readFileSync(join(dir, 'src/main.ts'), 'utf8')).toContain('normalize');
  });
  it('omits stake/ when stake=false', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-'));
    await generate(applyDefaults({ id: 'no-stake', mechanic: 'lines', stake: false }), dir, versions);
    expect(existsSync(join(dir, 'src/stake'))).toBe(false);
    expect(readFileSync(join(dir, 'src/GameScene.ts'), 'utf8')).toContain('ReelSpinController');
  });
});
