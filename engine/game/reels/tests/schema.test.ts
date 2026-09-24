import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Schema from 'schemastery';
import { DEFAULT_REEL_CONFIG } from '@energy8engine/reel-core';
import { Config } from '@energy8engine/reels/schema';

/** `null` → absent on both sides: schemastery drops a `null` default from its output. */
const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (x === null ? undefined : x)));

/**
 * The schema the IDE host imports to draw a form for this row (see
 * `E8RuntimeHalf.schema`). The host is a node process, so the module must
 * import nothing at runtime but `schemastery` — `reel-core` only for types,
 * never `./index`, which pulls in pixi.
 */
describe('@energy8engine/reels/schema', () => {
  it('accepts the flat row config and fills every grid/win default from DEFAULT_REEL_CONFIG', () => {
    const out = Config({ grid: { cols: 5, rows: 3 }, win: {} });
    expect(strip(out.grid)).toMatchObject(strip(DEFAULT_REEL_CONFIG.grid));
    expect(strip(out.win)).toMatchObject(strip(DEFAULT_REEL_CONFIG.win));
    // The two `null` defaults, which `strip` above cannot see.
    expect(Config.dict!.grid.dict!.topReel.meta.default).toBe(null);
    expect(Config.dict!.win.dict!.frameShake.dict!.onlyOnSymbols.meta.default).toBe(null);
  });

  it('a nested `config` key (the old row shape) still validates, but is not read', () => {
    const out = Config({ config: { grid: { cols: 3 } } } as never);
    expect(out.grid.cols).toBe(DEFAULT_REEL_CONFIG.grid.cols);
  });

  it('rejects a wrong type', () => {
    expect(() => Config({ grid: { cols: 'five' } } as never)).toThrow();
    expect(() => Config({ grid: { evaluation: 'diagonal' } } as never)).toThrow();
  });

  it('survives toJSON → new Schema, with the restart meta where the form reads it', () => {
    const node = new Schema(Config.toJSON()) as Schema;
    expect(node.dict!.grid.dict!.cols.meta.extra?.applies).toBe(undefined);
  });

  it('imports only schemastery at runtime (reel-core for types alone)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'schema.ts'), 'utf8');
    const runtime = [...source.matchAll(/^import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(runtime).toEqual(['schemastery']);
  });
});
