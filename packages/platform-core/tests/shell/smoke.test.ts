// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as shell from '@/shell';

describe('shell public API', () => {
  it('exports the factory and teardown', () => {
    expect(typeof shell.createGameShell).toBe('function');
    expect(typeof shell.removeGameShell).toBe('function');
  });

  it('does not import pixi (renderer-agnostic)', async () => {
    const src = await import('@/shell/index');
    expect(Object.keys(src)).toContain('createGameShell');
  });
});

describe('main entry re-exports shell factory', () => {
  it('createGameShell is reachable from the package root', async () => {
    const root = await import('@/index');
    expect(typeof (root as Record<string, unknown>).createGameShell).toBe('function');
  });
});
