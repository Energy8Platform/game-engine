import { describe, expect, it } from 'vitest';
import Schema from 'schemastery';
import { Config } from '../src/schema';

describe('scenes Config', () => {
  it('defaults mode/transition/transitionMs/fonts and marks design as restart', () => {
    const v = Config({ design: { width: 480, height: 288 } });
    expect(v).toEqual({
      design: { width: 480, height: 288 },
      portrait: {},
      mode: 'contain',
      transition: 'cut',
      transitionMs: 300,
      fonts: [],
    });
    const json = JSON.parse(JSON.stringify(Config)) as { refs: Record<string, any>; uid: number };
    const text = JSON.stringify(json);
    expect(text).toContain('"applies":"restart"');
  });

  it('fonts[].src carries the asset extra, weight/style default to "normal"', () => {
    expect(Config.dict!.fonts.inner!.dict!.src.meta.asset).toEqual(['woff2', 'woff', 'ttf', 'otf']);
    const v = Config({
      design: { width: 480, height: 288 },
      fonts: [{ family: 'E8Test', src: 'assets/f.woff2' }],
    });
    expect(v.fonts).toEqual([{ family: 'E8Test', src: 'assets/f.woff2', weight: 'normal', style: 'normal' }]);
  });

  // The IDE draws its form from these: a field with no description is a
  // blank label, and a leaf missing a `.default()` has no starting value
  // to show until an author sets one. Same walker as `@energy8engine/reels`'
  // own `tests/schema.test.ts` — a `.required()` leaf (no sane default,
  // `fonts[].family`/`fonts[].src` among them) is the one kind allowed to
  // skip `default`.
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
  it('takes an optional portrait design size', () => {
    const v = Config({ design: { width: 480, height: 288 }, portrait: { width: 288, height: 480 } });
    expect(v.portrait).toEqual({ width: 288, height: 480 });
    expect(() => Config({ design: { width: 1, height: 1 }, portrait: { width: -1, height: 1 } })).toThrow();
  });
  it('refuses a non-natural design size and an unknown mode', () => {
    expect(() => Config({ design: { width: -1, height: 1 } })).toThrow();
    expect(() => Config({ design: { width: 1, height: 1 }, mode: 'stretch' } as never)).toThrow();
  });
});
