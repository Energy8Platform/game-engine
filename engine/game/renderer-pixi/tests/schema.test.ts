import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Schema from 'schemastery';
import { Config } from '@energy8engine/renderer-pixi/schema';

/**
 * The schema the IDE host imports to draw a form for this row (see
 * `E8RuntimeHalf.schema`). The host is a node process, so the module must
 * import nothing but `schemastery` — not `./index`, which pulls in pixi.
 */
describe('@energy8engine/renderer-pixi/schema', () => {
  it("accepts first-slot's patch config for this row", () => {
    expect(() => Config({ width: 480, height: 288, background: '#10121a' })).not.toThrow();
  });

  it('rejects a wrong type', () => {
    expect(() => Config({ width: '480' } as never)).toThrow();
  });

  it('survives toJSON → new Schema, with the restart meta where the form reads it', () => {
    const node = new Schema(Config.toJSON()) as Schema;
    expect(node.dict!.width.meta.extra?.applies).toBe('restart');
  });

  it("width and height's descriptions mention the mount they leave empty", () => {
    const node = new Schema(Config.toJSON()) as Schema;
    expect(node.dict!.width.meta.description).toContain('mount');
    expect(node.dict!.height.meta.description).toContain('mount');
  });

  it('imports only schemastery', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'schema.ts'), 'utf8');
    const specifiers = [...source.matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    expect(specifiers).toEqual(['schemastery']);
  });
});
