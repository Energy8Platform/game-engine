import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Schema from 'schemastery';
import { Config } from '@energy8engine/stage/schema';

/**
 * The schema the IDE host imports to draw a form for this row (see
 * `E8RuntimeHalf.schema`). The host is a node process, so the module must
 * import nothing but `schemastery` — not `./index`, which pulls in pixi.
 */
describe('@energy8engine/stage/schema', () => {
  it("accepts first-slot's patch config for this row", () => {
    expect(() => Config({ design: { width: 480, height: 288 } })).not.toThrow();
  });

  it('fills in one reels layer, no scenes, a cut, 300 ms', () => {
    const config = Config({ design: { width: 480, height: 288 } });
    expect(config.layers).toEqual([{ id: 'reels', z: 0 }]);
    expect(config.scenes).toEqual({});
    expect(config.transition).toBe('cut');
    expect(config.transitionMs).toBe(300);
  });

  it('accepts a scene naming layers, rejects a layer with no id', () => {
    expect(() =>
      Config({ design: { width: 1, height: 1 }, scenes: { base_game: { layers: ['reels'] } } }),
    ).not.toThrow();
    expect(() => Config({ design: { width: 1, height: 1 }, layers: [{}] } as never)).toThrow();
  });

  it('rejects a wrong type', () => {
    expect(() => Config({ design: { width: 'wide' } } as never)).toThrow();
  });

  it('survives toJSON → new Schema, with the restart meta where the form reads it', () => {
    const node = new Schema(Config.toJSON()) as Schema;
    expect(node.dict!.design.dict!.width.meta.extra?.applies).toBe('restart');
  });

  it('imports only schemastery', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'schema.ts'), 'utf8');
    const specifiers = [...source.matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(specifiers).toEqual(['schemastery']);
  });
});
