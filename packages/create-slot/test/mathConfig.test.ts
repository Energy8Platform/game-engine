import { describe, it, expect } from 'vitest';
import { genMathConfig } from '../src/codegen/mathConfig';

describe('genMathConfig', () => {
  const s = genMathConfig({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });

  it('is node-only (reads the .spin via node:fs), imports the model, exports a spin-runtime MathConfig with a modes block', () => {
    expect(s).toContain("import { readFileSync } from 'node:fs'");
    expect(s).toContain("import { buildSpinScript } from '@energy8platform/platform-core/game-spec'");
    expect(s).toContain("import { model } from './src/game.spec'");
    expect(s).toContain('luaScript: buildSpinScript(model');
    expect(s).toContain("runtime: 'spin'");
    expect(s).toContain('capMaxWin: model.spec.maxWin * 100');
    expect(s).toContain('export default');
    expect(s).not.toContain('?raw'); // node-only, not the browser dev.config
  });

  it('uses sim.iterations: 100_000 and curate.nRowsOut: 50_000 (nRowsOut < iterations)', () => {
    expect(s).toContain('100_000');
    expect(s).toContain('50_000');
  });

  it('ships active ANTE + BUY_BONUS feature modes defaulting to sim.iterations 100_000', () => {
    expect(s).toContain('BUY_BONUS: { sim: { iterations: 100_000 } }');
    expect(s).toContain('ANTE: { sim: { iterations: 100_000 } }');
    // not left commented-out anymore
    expect(s).not.toContain('// BUY_BONUS:');
  });

  it('imports MathConfig type from stake-math-tools', () => {
    expect(s).toContain("from '@energy8platform/stake-math-tools'");
    expect(s).toContain('MathConfig');
  });
});
