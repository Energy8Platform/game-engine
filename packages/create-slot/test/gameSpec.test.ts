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
    expect(src).toContain("spin: { role: 'base', rtp: 0.96 }");
    expect(src).toContain("free_spin: { role: 'free' }");
    expect(src).toContain('export const model = defineGame(spec)');
  });
  it('emits an ante (feature) action and titles on buy/feature, with per-mode rtp + maxWin (display SSOT)', () => {
    const src = genGameSpec({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
    expect(src).toContain("ante: { role: 'feature'");
    expect(src).toContain("title: 'ANTE BET'");
    expect(src).toContain("buy_bonus: { role: 'buy'");
    expect(src).toContain("title: 'BUY BONUS'");
    // per-mode economics declared in the spec (feed the Game Info modes table)
    expect(src).toContain('rtp: 0.96');
    expect(src).toContain('maxWin: 5000');
  });
  it('betLevels span the full Stake range: 0.01 (min) and 1000000 (max)', () => {
    // Extract betLevels array from generated source
    const match = src.match(/betLevels:\s*\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    const levels = match![1].split(',').map((s) => parseFloat(s.trim()));
    expect(levels[0]).toBe(0.01);
    expect(levels[levels.length - 1]).toBe(1000000);
  });
  it('defaultBet is present in betLevels', () => {
    const betMatch = src.match(/betLevels:\s*\[([^\]]+)\]/);
    const defaultMatch = src.match(/defaultBet:\s*([\d.]+)/);
    expect(betMatch).not.toBeNull();
    expect(defaultMatch).not.toBeNull();
    const levels = betMatch![1].split(',').map((s) => parseFloat(s.trim()));
    const defaultBet = parseFloat(defaultMatch![1]);
    expect(levels).toContain(defaultBet);
  });
});
