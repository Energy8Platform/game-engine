import { describe, expect, it } from 'vitest';
import { KERNEL_VERSION } from '@/index';

describe('kernel package', () => {
  it('exposes its version', () => {
    expect(KERNEL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
