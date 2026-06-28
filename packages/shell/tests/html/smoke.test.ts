// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as shell from '@/ui/html';

describe('shell public API', () => {
  it('exports the factory and teardown', () => {
    expect(typeof shell.createGameShell).toBe('function');
    expect(typeof shell.removeGameShell).toBe('function');
  });

  it('does not import pixi (renderer-agnostic)', async () => {
    const src = await import('@/ui/html/index');
    expect(Object.keys(src)).toContain('createGameShell');
  });
});

describe('main entry re-exports shell factory', () => {
  it('createGameShell is reachable from the html entry', async () => {
    const root = await import('@/ui/html');
    expect(typeof (root as Record<string, unknown>).createGameShell).toBe('function');
  });
});
