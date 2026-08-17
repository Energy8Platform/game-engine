import { describe, expect, it } from 'vitest';
import { RUNTIME_VERSION } from '@/index';
import { KERNEL_VERSION } from '@energy8engine/kernel';

describe('runtime package', () => {
  it('exposes its version', () => {
    expect(RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('can reach the kernel', () => {
    expect(KERNEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
