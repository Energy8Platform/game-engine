import { describe, it, expect } from 'vitest';
import { genGameSpec } from '../src/codegen/gameSpec';

describe('genGameSpec', () => {
  const src = genGameSpec({ id: 'moon-spice', title: 'Moon Spice', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true });
  it("emits the spec id and grid from answers", () => {
    expect(src).toContain("id: 'moon-spice'");
    expect(src).toContain('grid: { cols: 7, rows: 7 }');
  });
  it('emits the mechanic in the spec', () => {
    expect(src).toContain("mechanic: 'cluster'");
  });
  it('includes a default symbol set + base/free/buy actions + exports model', () => {
    expect(src).toContain("kind: 'wild'");
    expect(src).toContain("kind: 'scatter'");
    expect(src).toContain("spin: { role: 'base' }");
    expect(src).toContain("free_spin: { role: 'free' }");
    expect(src).toContain('export const model = defineGame(spec)');
  });
});
