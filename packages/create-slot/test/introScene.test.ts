import { describe, it, expect } from 'vitest';
import { genIntroScene } from '../src/codegen/introScene';

describe('genIntroScene', () => {
  const s = genIntroScene({ id: 'g', title: 'My Game', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true, cascades: true });
  it('is a Scene subclass that calls the injected onStart and shows the title', () => {
    expect(s).toContain("import { Scene } from '@energy8platform/game-engine/core'");
    expect(s).toContain('export class IntroScene extends Scene');
    expect(s).toContain('My Game');
    expect(s).toContain('onStart');         // calls the host-injected callback
  });
  it('imports no node: builtins (browser-safe)', () => {
    expect(s).not.toContain("from 'node:");
  });
});
