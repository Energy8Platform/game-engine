import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Schema from 'schemastery';
import { Config } from '@energy8engine/game-runtime/schema';

/**
 * The schema the IDE host imports to draw a form for this row (see
 * `E8RuntimeHalf.schema`). The host is a node process, so the module must
 * import nothing but `schemastery` — not `./index`, which pulls in pixi.
 */
describe('@energy8engine/game-runtime/schema', () => {
  it("accepts first-slot's patch config for this row", () => {
    expect(() => Config({ stages: { base_game: 'reel-step' } })).not.toThrow();
  });

  it('rejects a wrong type', () => {
    expect(() => Config({ stages: { base_game: 7 } } as never)).toThrow();
  });

  it('survives toJSON → new Schema, with the restart meta where the form reads it', () => {
    const node = new Schema(Config.toJSON()) as Schema;
    expect(node.dict!.stages.meta.extra?.applies).toBe(undefined);
  });

  it('imports only schemastery', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'schema.ts'), 'utf8');
    const specifiers = [...source.matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(specifiers).toEqual(['schemastery']);
  });
});
