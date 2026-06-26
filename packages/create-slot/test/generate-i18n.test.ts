import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate';
import { applyDefaults } from '../src/answers';

let dir = '';
afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const versions = { 'platform-core': '*', 'game-engine': '*', 'stake-kit': '*', 'stake-bridge': '*', 'stake-math-tools': '*' };

const ALL_LANGS = ['de', 'es', 'fi', 'fr', 'hi', 'id', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'vi', 'zh', 'da'] as const;

describe('generate: src/i18n.ts', () => {
  it('emits src/i18n.ts with an en map and 15 stub language keys', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-i18n-'));
    await generate(applyDefaults({ id: 'neon-jewels', mechanic: 'lines' }), dir, versions);

    // File must exist
    expect(existsSync(join(dir, 'src/i18n.ts'))).toBe(true);

    const content = readFileSync(join(dir, 'src/i18n.ts'), 'utf8');

    // Must export an `i18n` const
    expect(content).toContain('export const i18n');

    // 'en' must be present and populated (not empty {}) — valid as `en:` or `'en':`
    expect(content).toMatch(/\ben:/);
    // en should have at least one key derived from the default action strings
    expect(content).toMatch(/['"]ANTE BET['"]/);

    // All 15 non-English language stubs must be present
    for (const lang of ALL_LANGS) {
      expect(content, `missing stub for '${lang}'`).toContain(`'${lang}':`);
    }

    // Each stub must have a TODO translate comment
    expect(content).toContain('TODO: translate');

    // Must have a header comment explaining english-as-key convention
    expect(content).toContain('english-as-key');
  });

  it('generated src/main.ts imports i18n and passes it to createSlotGame', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-i18n-main-'));
    await generate(applyDefaults({ id: 'star-cluster', mechanic: 'cluster' }), dir, versions);

    const mainTs = readFileSync(join(dir, 'src/main.ts'), 'utf8');

    // Must import i18n from the i18n module
    expect(mainTs).toMatch(/import\s*\{?\s*i18n\s*\}?\s*from\s*['"]\.\/i18n['"]/);

    // Must pass i18n to createSlotGame (inside shell: {})
    expect(mainTs).toContain('i18n,');
    // i18n wired inside shell: block
    expect(mainTs).toMatch(/shell:\s*\{[^}]*i18n/s);
  });

  it('generated CLAUDE.md has a Localization section', async () => {
    dir = mkdtempSync(join(tmpdir(), 'cs-i18n-docs-'));
    await generate(applyDefaults({ id: 'gem-quest', mechanic: 'ways' }), dir, versions);

    const claudeMd = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('Localization');
    expect(claudeMd).toContain('i18n.ts');
  });
});
