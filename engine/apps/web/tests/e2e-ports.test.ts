import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { IDE_HMR_PORT, IDE_HOST_PORT, IDE_WEB_PORT, resolveHostPort } from '../e2e-ports';

/**
 * `resolveHostPort` is the pure half of `e2e-ports.ts`, pulled out so this
 * test can call it with a fake env record instead of spawning a child
 * `node` per case (the other option the task brief allowed) — cheaper and
 * just as honest, since the module-level `IDE_HOST_PORT` below is defined
 * as nothing more than `resolveHostPort(process.env)`.
 */
describe('resolveHostPort', () => {
  it('defaults to 5679 when E8_E2E_HOST_PORT is unset', () => {
    expect(resolveHostPort({})).toBe(5679);
  });

  it('reads E8_E2E_HOST_PORT when set', () => {
    expect(resolveHostPort({ E8_E2E_HOST_PORT: '6123' })).toBe(6123);
  });
});

it('IDE_HOST_PORT matches resolveHostPort(process.env) — the default, unset in this test run', () => {
  expect(IDE_HOST_PORT).toBe(resolveHostPort(process.env));
  expect(IDE_HOST_PORT).toBe(5679);
});

it('IDE_WEB_PORT and IDE_HMR_PORT match the fixed ports vite.config.ts binds', () => {
  expect(IDE_WEB_PORT).toBe(5680);
  expect(IDE_HMR_PORT).toBe(5690);
});

it('has no imports — vite.config.ts and project-fixture.ts must not end up depending on each other through it', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(join(here, '..', 'e2e-ports.ts'), 'utf8');
  expect(src).not.toMatch(/^\s*import\b/m);
});
