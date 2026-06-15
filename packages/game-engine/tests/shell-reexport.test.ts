// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as shell from '@/shell';

describe('game-engine /shell re-export', () => {
  it('re-exports createGameShell from platform-core', () => {
    expect(typeof shell.createGameShell).toBe('function');
    expect(typeof shell.removeGameShell).toBe('function');
  });
});
