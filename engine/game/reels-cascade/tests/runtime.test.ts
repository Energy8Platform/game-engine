import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Context } from 'cordis';
import Schema from 'schemastery';
import {
  DEFAULT_REEL_CONFIG,
  type BoardController,
  type ReelSystem,
} from '@energy8engine/reel-core';
import { createBoardStepRegistry, type BoardStepRegistry } from '@energy8engine/play-loop';
import * as runtime from '../src/runtime';
import { Config } from '../src/schema';
import { tumbleController } from '@energy8engine/reel-core';

// The real factory, spied on — so a test can read the config the row handed it.
vi.mock('@energy8engine/reel-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@energy8engine/reel-core')>();
  return { ...actual, tumbleController: vi.fn(actual.tumbleController) };
});

/** A fake `reels` service — just enough of `ReelSystem` for this row to touch: `controllers.register`. */
function fakeReels() {
  const registered = new Map<string, BoardController>();
  const register = vi.fn((c: BoardController) => {
    registered.set(c.kind, c);
    return () => {
      if (registered.get(c.kind) === c) registered.delete(c.kind);
    };
  });
  return { reels: { controllers: { register } } as unknown as ReelSystem, register, registered };
}

const service = (name: string, value: unknown) => ({
  name,
  apply(ctx: Context) {
    ctx.provide(name, value);
  },
});

const { enabled: _enabled, ...CASCADE } = DEFAULT_REEL_CONFIG.cascade;

describe('reels-cascade runtime half', () => {
  it('registers a tumble controller in reels and a reelStep handler in steps', async () => {
    const fake = fakeReels();
    const steps: BoardStepRegistry = createBoardStepRegistry();
    const ctx = new Context();
    await ctx.plugin(service('reels', fake.reels));
    await ctx.plugin(service('steps', steps));
    await ctx.plugin(runtime, CASCADE);

    expect(fake.register).toHaveBeenCalledTimes(1);
    expect(fake.registered.get('tumble')?.kind).toBe('tumble');
    expect(steps.has('reelStep')).toBe(true);

    await ctx.fiber.dispose();
  });

  it('an empty config (a bundle row no patch configured) hands the controller every default', async () => {
    // `resolveComposition` hands such a row `config: {}` and the loader applies it verbatim.
    const fake = fakeReels();
    const ctx = new Context();
    await ctx.plugin(service('reels', fake.reels));
    vi.mocked(tumbleController).mockClear();

    await ctx.plugin(runtime, {});

    expect(vi.mocked(tumbleController)).toHaveBeenCalledWith({
      ...DEFAULT_REEL_CONFIG.cascade,
      enabled: true,
    });

    await ctx.fiber.dispose();
  });

  it('dispose removes both', async () => {
    const fake = fakeReels();
    const steps = createBoardStepRegistry();
    const ctx = new Context();
    await ctx.plugin(service('reels', fake.reels));
    await ctx.plugin(service('steps', steps));
    await ctx.plugin(runtime, CASCADE);

    await ctx.fiber.dispose();

    expect(fake.registered.has('tumble')).toBe(false);
    expect(steps.has('reelStep')).toBe(false);
  });
});

describe('reels-cascade schema', () => {
  /** `null` → absent on both sides: schemastery drops a `null` default from its output. */
  const strip = (v: unknown) =>
    JSON.parse(JSON.stringify(v, (_, x) => (x === null ? undefined : x)));

  it('fills every CascadeConfig default from DEFAULT_REEL_CONFIG.cascade except enabled', () => {
    const out = Config({});
    expect(strip(out)).toEqual(strip(CASCADE));
  });

  it('has no enabled field: the row being there is the switch', () => {
    expect(Config.dict!.enabled).toBeUndefined();
  });

  it('rejects a wrong type', () => {
    expect(() => Config({ gravity: 'yes' } as never)).toThrow();
    expect(() => Config({ multiplier: { mode: 'pow' } } as never)).toThrow();
  });

  it('survives toJSON → new Schema', () => {
    const node = new Schema(Config.toJSON()) as Schema;
    expect(node.dict!.perStepDecel.meta.default).toBe(0.08);
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
