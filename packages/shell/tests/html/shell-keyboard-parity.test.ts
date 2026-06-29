// @vitest-environment node
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

it('keyboard.ts is byte-identical across both shells', () => {
  const a = readFileSync(new URL('../../src/core/keyboard.ts', import.meta.url), 'utf8');
  const b = readFileSync(new URL('../../../pixi-shell/src/keyboard.ts', import.meta.url), 'utf8');
  expect(a.length, 'shell keyboard.ts must not be empty').toBeGreaterThan(100);
  expect(b.length, 'pixi-shell keyboard.ts must not be empty').toBeGreaterThan(100);
  expect(a).toBe(b);
});
