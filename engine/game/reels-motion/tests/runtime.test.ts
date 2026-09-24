import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import Schema from 'schemastery';
import {
  BUILTIN_MOTION_STYLES,
  DEFAULT_REEL_CONFIG,
  type MotionConfig,
  type MotionStyle,
  type ReelSystem,
} from '@energy8engine/reel-core';
import { Container } from 'pixi.js';
import * as reelsRow from '@energy8engine/reels/runtime';
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

/**
 * The REAL `reels1` row (`@energy8engine/reels/runtime`) under this row — not the fake above.
 * (Here rather than in `reels`' tests: `reels-motion` depends on `reels`, so the other way round
 * would be a package cycle.)
 */
describe('reels-motion on the real reels row', () => {
  const assetsService = {
    name: 'assets',
    apply(ctx: Context) {
      ctx.provide('assets', { resolve: () => new Container() as never });
    },
  };
  const flush = () => new Promise<void>((r) => setTimeout(r, 0));
  // the real SpinEngine starts pixi's shared Ticker, which asks for animation frames
  beforeAll(() => {
    (globalThis as any).requestAnimationFrame ??= () => 0;
    (globalThis as any).cancelAnimationFrame ??= () => {};
  });

  it('after a hot re-apply of reels1, a spin runs the style on the NEW system — no "no motion row" warning', async () => {
    const ctx = new Context();
    const report = vi.fn();
    ctx.provide('diagnostics', { report } as never);
    await ctx.plugin(assetsService);
    const reelsFiber = ctx.plugin(reelsRow, { grid: { cols: 5, rows: 3 } });
    await reelsFiber;
    await ctx.plugin(runtime, {});
    const first = ctx.reels;

    await reelsFiber.update({ grid: { cols: 3, rows: 3 } });
    await vi.waitFor(() => expect(ctx.reels?.config.grid.cols).toBe(3));
    expect(ctx.reels).not.toBe(first);
    await vi.waitFor(() => expect(ctx.reels.motions.get('swap')).toBeDefined());

    const swap = ctx.reels.motions.get('swap')!;
    const create = vi.spyOn(swap, 'create');
    // not awaited: the real SpinEngine needs a live ticker to land; the pick happens up front
    void ctx.board.spinTo({ kind: 'spinTo', board: [[1, 2, 3], [4, 5, 6], [7, 8, 9]] });
    await flush();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].grid).toBe(ctx.reels.grid);
    expect(report).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('no motion row') }),
    );

    create.mockRestore();
    ctx.board.skip?.();
    await ctx.fiber.dispose();
  });

  it('a partial nested patch keeps the other defaults of that object — as useMotion sees it', async () => {
    const ctx = new Context();
    await ctx.plugin(assetsService);
    await ctx.plugin(reelsRow, { grid: { cols: 1, rows: 1 } });
    const useMotion = vi.spyOn(ctx.reels, 'useMotion');

    await ctx.plugin(runtime, { settle: { ms: 100 } });

    expect(useMotion).toHaveBeenCalledWith('swap', {
      ...DEFAULT_REEL_CONFIG.motion,
      settle: { ...DEFAULT_REEL_CONFIG.motion.settle, ms: 100 },
    });
    await ctx.fiber.dispose();
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
