import { afterEach, describe, expect, it, vi } from 'vitest';
import { markModuleCopy, moduleCopies } from '../src/index';

const KEY = Symbol.for('energy8engine.moduleCopies');

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
});

describe('module copies', () => {
  it('reads back what was marked, one list of urls per name', () => {
    markModuleCopy('@e/a', 'file:///one/a.ts');
    markModuleCopy('@e/a', 'file:///two/a.ts');
    markModuleCopy('@e/b', 'file:///one/b.ts');
    expect(moduleCopies()).toEqual(
      new Map([
        ['@e/a', ['file:///one/a.ts', 'file:///two/a.ts']],
        ['@e/b', ['file:///one/b.ts']],
      ]),
    );
  });

  it('the same url twice is one copy — a page that composes twice is not a duplicate', () => {
    markModuleCopy('@e/a', 'file:///one/a.ts');
    markModuleCopy('@e/a', 'file:///one/a.ts');
    expect(moduleCopies().get('@e/a')).toEqual(['file:///one/a.ts']);
  });

  it('two copies of the helper itself share one map', async () => {
    markModuleCopy('@e/a', 'file:///one/a.ts');
    vi.resetModules();
    const second = await import('../src/module-copies');
    expect(second.markModuleCopy).not.toBe(markModuleCopy);
    second.markModuleCopy('@e/a', 'file:///two/a.ts');
    expect(moduleCopies().get('@e/a')).toEqual(['file:///one/a.ts', 'file:///two/a.ts']);
    expect(second.moduleCopies().get('@e/a')).toEqual(['file:///one/a.ts', 'file:///two/a.ts']);
  });
});
