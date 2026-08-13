import { describe, expect, it } from 'vitest';
import * as kernel from '@/index';

describe('kernel package', () => {
  it('exposes its version', () => {
    expect(kernel.KERNEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // One import, every function the package exports. This is a smoke test for the barrel itself:
  // a typo in `src/index.ts`, or a name that got dropped on the way from its module to the barrel,
  // fails here instead of surfacing later as a missing symbol somewhere in phase 2.
  it('exposes every function of the public API from one entry point', () => {
    for (const name of [
      'error',
      'warning',
      'hasErrors',
      'describeError',
      'validate',
      'defaultOf',
      'cloneValue',
      'isPlainObject',
      'isUsableField',
      'mergeSchemas',
      'definePlugin',
      'checkManifestShape',
      'parseVersion',
      'isValidRange',
      'satisfies',
      'orderPlugins',
      'matches',
      'isDefaultMatcher',
      'describeMatcher',
      'resolvePlan',
      'toSnapshot',
      'activatePoint',
      'activateOne',
      'createHookBus',
      'declaredFromPlan',
    ]) {
      expect(typeof kernel[name as keyof typeof kernel]).toBe('function');
    }
  });

  // The barrel's non-function value exports: a constant array and the two recursion caps that back
  // the README's "never throws" contract (schema/object nesting and synchronous hook re-entrancy).
  it('exposes every non-function value export', () => {
    expect(kernel.STRING_KINDS).toEqual(['text', 'color', 'asset', 'symbol', 'spinPath', 'nodeRef', 'sound']);
    expect(kernel.MAX_SCHEMA_DEPTH).toBe(32);
    expect(kernel.MAX_HOOK_DEPTH).toBe(16);
  });
});
