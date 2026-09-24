import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import Schema from 'schemastery';
import { DEFAULT_REEL_CONFIG, type Anticipator, type ReelSystem } from '@energy8engine/reel-core';
import * as runtime from '../src/runtime';
import { Config } from '../src/schema';

/** A fake `reels` service — just enough of `ReelSystem` for this row to touch: `anticipation.set`. */
function fakeReels() {
  let current: Anticipator | null = null;
  let lastDisposed: Anticipator | null = null;
  const set = vi.fn((a: Anticipator) => {
    current = a;
    return () => {
      if (current !== a) return;
      lastDisposed = a;
      current = null;
    };
  });

  return {
    reels: { anticipation: { set } } as unknown as ReelSystem,
    set,
    current: () => current,
    lastDisposed: () => lastDisposed,
  };
}

const reelsService = (reels: ReelSystem) => ({
  name: 'reels',
  apply(ctx: Context) {
    ctx.provide('reels', reels);
  },
});

describe('reels-anticipation runtime half', () => {
  it('sets an anticipator built from the config', async () => {
    const fake = fakeReels();
    const ctx = new Context();
    await ctx.plugin(reelsService(fake.reels));

    const config = { ...DEFAULT_REEL_CONFIG.anticipation, threshold: 3 };
    await ctx.plugin(runtime, config);

    expect(fake.set).toHaveBeenCalledTimes(1);
    expect(fake.current()).not.toBeNull();
    expect(fake.current()!.config).toEqual(config);

    await ctx.fiber.dispose();
  });

  it('an empty config (a bundle row no patch configured) builds the default anticipator', async () => {
    // `resolveComposition` hands such a row `config: {}` and the loader applies it verbatim.
    const fake = fakeReels();
    const ctx = new Context();
    await ctx.plugin(reelsService(fake.reels));

    await ctx.plugin(runtime, {});

    expect(fake.current()!.config).toEqual(DEFAULT_REEL_CONFIG.anticipation);

    await ctx.fiber.dispose();
  });

  it('dispose unsets the anticipator', async () => {
    const fake = fakeReels();
    const ctx = new Context();
    await ctx.plugin(reelsService(fake.reels));
    await ctx.plugin(runtime, DEFAULT_REEL_CONFIG.anticipation);

    const set = fake.current();
    expect(set).not.toBeNull();

    await ctx.fiber.dispose();

    expect(fake.current()).toBeNull();
    expect(fake.lastDisposed()).toBe(set);
  });
});

describe('reels-anticipation schema', () => {
  /** `null` → absent on both sides: schemastery drops a `null` default from its output. */
  const strip = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (x === null ? undefined : x)));

  it('fills every AnticipationConfig default from DEFAULT_REEL_CONFIG.anticipation', () => {
    const out = Config({});
    expect(strip(out)).toMatchObject(strip(DEFAULT_REEL_CONFIG.anticipation));
  });

  it('rejects a wrong type', () => {
    expect(() => Config({ threshold: 'two' } as never)).toThrow();
    expect(() => Config({ reels: 'diagonal' } as never)).toThrow();
  });

  it('survives toJSON → new Schema', () => {
    const node = new Schema(Config.toJSON()) as Schema;
    expect(node.dict!.threshold.meta.default).toBe(2);
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

  it('imports only schemastery at runtime (reel-core for types alone)', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'schema.ts'), 'utf8');
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\b)[^'"]*['"]([^'"]+)['"]/gm)].map(
      (m) => m[1],
    );
    expect(runtimeImports).toEqual(['schemastery']);
  });
});
