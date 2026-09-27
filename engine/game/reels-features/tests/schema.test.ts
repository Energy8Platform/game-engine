import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import Schema from 'schemastery';
import { Config } from '../src/schema';

/** The table task-5-brief.md pins verbatim — the one place these literals are typed by hand. */
const DEFAULTS = {
  expandWild: { enabled: true, ms: 280, holdMs: 500, ringColor: 0xffd700 },
  walkWild: { enabled: true, morphMs: 240, stepMs: 260, easing: 'easeInOutQuad', ringColor: 0xff66cc },
  dropWilds: { enabled: true, ms: 280, staggerMs: 60 },
  reveal: { enabled: true, ms: 280 },
  transform: { enabled: true, ms: 280, pulseScale: 1.15, pulseMs: 220 },
  multipliers: {
    enabled: true,
    pulseMs: 240,
    labelMs: 500,
    totalMs: 900,
    labelColor: 0xffd24a,
    totalColor: 0xffe24a,
  },
  sticky: { enabled: true, ringColor: 0xec4899 },
  giant: { enabled: true, ms: 420, easing: 'easeOutBack' },
  nudge: { enabled: true, ms: 240, easing: 'easeOutBack' },
};

describe('reels-features schema', () => {
  it('fills every default from the task-5 table', () => {
    expect(Config({})).toEqual(DEFAULTS);
  });

  it('rejects a wrong type', () => {
    expect(() => Config({ expandWild: { ms: 'fast' } } as never)).toThrow();
    expect(() => Config({ giant: { easing: 5 } } as never)).toThrow();
    expect(() => Config({ sticky: { enabled: 'yes' } } as never)).toThrow();
  });

  // Task 1: every `ringColor`/`labelColor`/`totalColor` carries `meta.role
  // === 'color'`, surviving the JSON round-trip the IDE host sends the
  // schema through (the IDE's ColorField dispatches off that, not the live
  // `Schema` instance).
  it('every colour field carries role: color, surviving JSON', () => {
    const node = new Schema(JSON.parse(JSON.stringify(Config))) as Schema;
    expect([
      node.dict!.expandWild.dict!.ringColor.meta.role,
      node.dict!.walkWild.dict!.ringColor.meta.role,
      node.dict!.sticky.dict!.ringColor.meta.role,
      node.dict!.multipliers.dict!.labelColor.meta.role,
      node.dict!.multipliers.dict!.totalColor.meta.role,
    ]).toEqual(Array(5).fill('color'));
  });

  it('survives toJSON → new Schema', () => {
    const node = new Schema(Config.toJSON()) as Schema;
    expect(node.dict!.giant.dict!.ms.meta.default).toBe(420);
    expect(node.dict!.multipliers.dict!.labelColor.meta.default).toBe(0xffd24a);
  });

  // The IDE draws its form from these: a field with no description is a blank label.
  it('every field, at any depth, has a non-empty description', () => {
    const missing: string[] = [];
    const walk = (node: Schema, path: string) => {
      for (const [key, child] of Object.entries(node.dict ?? {})) {
        const at = `${path}.${key}`;
        if (!child.meta.description) missing.push(at);
        walk(child, at);
      }
      for (const member of node.list ?? []) walk(member, path);
      if (node.inner) walk(node.inner, `${path}[]`);
    };
    walk(Config, '$');
    expect(missing).toEqual([]);
  });

  it('imports only schemastery at runtime', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'schema.ts'), 'utf8');
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)].map(
      (m) => m[1],
    );
    expect(runtimeImports).toEqual(['schemastery']);
  });
});
