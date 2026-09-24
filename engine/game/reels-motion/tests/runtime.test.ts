import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import Schema from 'schemastery';
import {
  BUILTIN_MOTION_STYLES,
  DEFAULT_REEL_CONFIG,
  type MotionConfig,
  type MotionStyle,
  type ReelSystem,
} from '@energy8engine/reel-core';
import * as runtime from '../src/runtime';
import { Config } from '../src/schema';

/** A fake `reels` service — just enough of `ReelSystem` for this row to touch: `motions`/`useMotion`. */
function fakeReels() {
  const registered = new Map<string, MotionStyle>();
  const registerDisposed: string[] = [];
  const motions = {
    register: vi.fn((style: MotionStyle) => {
      registered.set(style.key, style);
      return () => {
        if (registered.get(style.key) !== style) return;
        registered.delete(style.key);
        registerDisposed.push(style.key);
      };
    }),
    get: (key: string) => registered.get(key),
    keys: () => [...registered.keys()],
  };

  const useMotionCalls: { key: string; config: MotionConfig }[] = [];
  let useMotionDisposed = false;
  const useMotion = vi.fn((key: string, config: MotionConfig) => {
    useMotionCalls.push({ key, config });
    useMotionDisposed = false;
    return () => {
      useMotionDisposed = true;
    };
  });

  return {
    reels: { motions, useMotion } as unknown as ReelSystem,
    registered,
    registerDisposed,
    useMotionCalls,
    isUseMotionDisposed: () => useMotionDisposed,
  };
}

const reelsService = (reels: ReelSystem) => ({
  name: 'reels',
  apply(ctx: Context) {
    ctx.provide('reels', reels);
  },
});

describe('reels-motion runtime half', () => {
  it('registers the three built-in motion styles and activates the configured one', async () => {
    const fake = fakeReels();
    const ctx = new Context();
    await ctx.plugin(reelsService(fake.reels));

    await ctx.plugin(runtime, DEFAULT_REEL_CONFIG.motion);

    expect([...fake.registered.keys()].sort()).toEqual(
      BUILTIN_MOTION_STYLES.map((s) => s.key).sort(),
    );
    expect(fake.useMotionCalls).toEqual([{ key: 'swap', config: DEFAULT_REEL_CONFIG.motion }]);

    await ctx.fiber.dispose();
  });

  it('an empty config (a bundle row no patch configured) activates `swap` with every default', async () => {
    // `resolveComposition` hands such a row `config: {}` and the loader applies it verbatim —
    // nothing runs the schema's defaults on the way, so the row has to fill them itself.
    const fake = fakeReels();
    const ctx = new Context();
    await ctx.plugin(reelsService(fake.reels));

    await ctx.plugin(runtime, {} as MotionConfig);

    expect(fake.useMotionCalls).toEqual([{ key: 'swap', config: DEFAULT_REEL_CONFIG.motion }]);

    await ctx.fiber.dispose();
  });

  it('a config override picks a different style and passes the merged config through', async () => {
    const fake = fakeReels();
    const ctx = new Context();
    await ctx.plugin(reelsService(fake.reels));

    const config: MotionConfig = { ...DEFAULT_REEL_CONFIG.motion, style: 'cascade-drop', spinUp: 300 };
    await ctx.plugin(runtime, config);

    expect(fake.useMotionCalls).toEqual([{ key: 'cascade-drop', config }]);

    await ctx.fiber.dispose();
  });

  it('disposing the row runs every disposer — the three registrations and the useMotion pick', async () => {
    const fake = fakeReels();
    const ctx = new Context();
    await ctx.plugin(reelsService(fake.reels));
    await ctx.plugin(runtime, DEFAULT_REEL_CONFIG.motion);

    expect(fake.registered.size).toBe(3);
    expect(fake.isUseMotionDisposed()).toBe(false);

    await ctx.fiber.dispose();

    expect(fake.registered.size).toBe(0);
    expect(fake.registerDisposed.sort()).toEqual(BUILTIN_MOTION_STYLES.map((s) => s.key).sort());
    expect(fake.isUseMotionDisposed()).toBe(true);
  });

});

describe('reels-motion schema', () => {
  const strip = (v: unknown) => JSON.parse(JSON.stringify(v));

  it('fills every MotionConfig default from DEFAULT_REEL_CONFIG.motion', () => {
    const out = Config({});
    expect(strip(out)).toMatchObject(strip(DEFAULT_REEL_CONFIG.motion));
  });

  it('rejects a wrong type', () => {
    expect(() => Config({ stopMode: 'diagonal' } as never)).toThrow();
    expect(() => Config({ spinUp: 'fast' } as never)).toThrow();
  });

  it('survives toJSON → new Schema', () => {
    const node = new Schema(Config.toJSON()) as Schema;
    expect(node.dict!.style.meta.default).toBe('swap');
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
