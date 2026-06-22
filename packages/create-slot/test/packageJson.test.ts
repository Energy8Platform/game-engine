import { describe, it, expect } from 'vitest';
import { genPackageJson } from '../src/codegen/packageJson';

describe('genPackageJson', () => {
  const json = JSON.parse(genPackageJson(
    { id: 'moon-spice', title: 'Moon Spice', mechanic: 'cascade', grid: { cols: 6, rows: 6 }, stake: true },
    { 'platform-core': '^0.24.4', 'game-engine': '^0.17.0', 'stake-kit': '^0.1.0', 'stake-bridge': '^0.2.1' },
  ));
  it('names the package from the id and pins the 4 deps', () => {
    expect(json.name).toBe('moon-spice');
    expect(json.dependencies['@energy8platform/platform-core']).toBe('^0.24.4');
    expect(json.dependencies['@energy8platform/game-engine']).toBe('^0.17.0');
    expect(json.dependencies['@energy8platform/stake-kit']).toBe('^0.1.0');
  });
  it('has dev/build/typecheck/smoke scripts', () => {
    expect(json.scripts.dev).toBe('vite');
    expect(json.scripts.build).toContain('vite build');
    expect(json.scripts.typecheck).toBe('tsc --noEmit');
  });
});
