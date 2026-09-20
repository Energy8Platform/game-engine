import { describe, expect, it } from 'vitest';
import { viteRows } from '../src/vite-rows';

/** `load` as a plain function — the plugin's hooks are not bound to a vite context. */
function loadOf(plugin: ReturnType<typeof viteRows>) {
  return plugin.load as (id: string) => string | undefined;
}

describe('viteRows', () => {
  it('resolves `virtual:e8-rows` to its own \\0 id and nothing else', () => {
    const plugin = viteRows(new Map());
    const resolveId = plugin.resolveId as (id: string) => string | undefined;
    expect(resolveId('virtual:e8-rows')).toBe('\0virtual:e8-rows');
    expect(resolveId('virtual:other')).toBeUndefined();
    expect(loadOf(plugin)('virtual:e8-rows')).toBeUndefined(); // the unresolved spelling is not ours
  });

  it('a two-row map is one static import() per row, keyed by row id', () => {
    const plugin = viteRows(
      new Map([
        ['boot1', '/repo/engine/game/boot/src/index.ts'],
        ['flow1', '/repo/engine/game/flow/src/runtime.ts'],
      ]),
    );
    expect(loadOf(plugin)('\0virtual:e8-rows')).toBe(
      'export const rows = { "boot1": () => import("/repo/engine/game/boot/src/index.ts"), ' +
        '"flow1": () => import("/repo/engine/game/flow/src/runtime.ts") };',
    );
  });

  it('an empty map (e8 dev) is an empty object', () => {
    expect(loadOf(viteRows(new Map()))('\0virtual:e8-rows')).toBe('export const rows = {};');
  });
});
