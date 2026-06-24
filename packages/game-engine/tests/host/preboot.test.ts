import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFonts, bootGuard } from '../../src/host/preboot';

describe('loadFonts', () => {
  beforeEach(() => {
    (globalThis as any).document = { fonts: { load: vi.fn().mockResolvedValue([]), ready: Promise.resolve() } };
  });
  it('awaits each spec without throwing', async () => {
    await expect(loadFonts(['400 16px "Inter"', '700 16px "Inter"'])).resolves.toBeUndefined();
    expect((document as any).fonts.load).toHaveBeenCalledTimes(2);
  });
  it('swallows font CDN failures', async () => {
    (document as any).fonts.load = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(loadFonts(['400 16px "Inter"'])).resolves.toBeUndefined();
  });
  it('no-ops when specs is empty/undefined', async () => {
    await expect(loadFonts()).resolves.toBeUndefined();
  });
});

describe('bootGuard', () => {
  beforeEach(() => { (globalThis as any).window = {}; });
  it('returns true once then false', () => {
    expect(bootGuard('__test_boot__')).toBe(true);
    expect(bootGuard('__test_boot__')).toBe(false);
  });
});
