import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generate } from '../src/generate';

const VERSIONS = {
  'platform-core': '^0.0.0', 'game-engine': '^0.0.0', 'stake-kit': '^0.0.0',
  'stake-bridge': '^0.0.0', 'stake-math-tools': '^0.0.0',
};
const ANSWERS = { id: 'demo', title: 'Demo', mechanic: 'cluster' as const, grid: { cols: 7, rows: 7 }, stake: false };

let made: string[] = [];
afterEach(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); made = []; });

describe('generate into an explicit dir', () => {
  it('writes a package.json into the chosen directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'cs-'));
    made.push(root);
    const target = join(root, 'nested', 'demo');
    await generate(ANSWERS, target, VERSIONS);
    const pkg = require(join(target, 'package.json'));
    expect(pkg.name).toBe('demo');
  });
});
