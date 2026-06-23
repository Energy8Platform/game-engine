import { describe, it, expect } from 'vitest';
import { genPackageJson, type DepVersions } from '../src/codegen/packageJson';

const V: DepVersions = { 'platform-core': '^0.24.4', 'game-engine': '^0.17.0', 'stake-kit': '^0.1.0', 'stake-bridge': '^0.2.1' };

describe('genPackageJson', () => {
  const json = JSON.parse(genPackageJson(
    { id: 'moon-spice', title: 'Moon Spice', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true },
    V,
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
  it('emits sim/pool/curate/math scripts via e8-math and the stake-math-tools devDep', () => {
    const json2 = JSON.parse(genPackageJson({ id: 'g', title: 'G', mechanic: 'cluster', grid: { cols: 7, rows: 7 }, stake: true } as any,
      { 'platform-core': '^0.24.4', 'game-engine': '^0.17.0', 'stake-kit': '^0.1.0', 'stake-bridge': '^0.2.1' }));
    expect(json2.scripts.math).toContain('e8-math all');
    expect(json2.scripts.pool).toContain('e8-math pool');
    expect(json2.scripts.curate).toContain('e8-math curate');
    expect(json2.devDependencies['@energy8platform/stake-math-tools']).toBeTruthy();
  });
  it('includes zod even for non-stake games (general spin schema)', () => {
    const j = JSON.parse(genPackageJson({ id: 'g', title: 'G', mechanic: 'lines', grid: { cols: 5, rows: 3 }, stake: false, cascades: false }, V));
    expect(j.dependencies.zod).toBe('^3.23.0');
  });
});
