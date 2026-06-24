import { describe, it, expect } from 'vitest';
import { genClaudeMd } from '../src/codegen/claudeMd';

describe('genClaudeMd', () => {
  const a = { id: 'moon-spice', title: 'Moon Spice', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true } as const;
  const md = genClaudeMd(a);

  it('is a CLAUDE.md naming the game and the SSOT + scene contract', () => {
    expect(md.startsWith('# CLAUDE.md')).toBe(true);
    expect(md).toContain('moon-spice');
    expect(md).toContain('src/game.spec.ts');
    expect(md).toContain('present(result, ctx)');
    expect(md).toContain('onBonusEnter');
  });

  it('documents the key commands (dev / stake harness / build:stake / math)', () => {
    expect(md).toContain('npm run dev');
    expect(md).toContain('npm run stake');
    expect(md).toContain('npm run build:stake');
    expect(md).toContain('math:curate');
  });

  it('mentions the cascade mechanic when cascades are on', () => {
    expect(md).toContain('CASCADE');
    expect(genClaudeMd({ ...a, cascades: false })).not.toContain('CASCADE');
  });
});
