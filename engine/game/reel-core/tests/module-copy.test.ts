import { describe, expect, it } from 'vitest';
import { moduleCopies } from '@energy8engine/contracts';
import '../src/index';

describe('@energy8engine/reel-core', () => {
  it('marks itself as loaded, once, with its own module url', () => {
    const urls = moduleCopies().get('@energy8engine/reel-core');
    expect(urls).toHaveLength(1);
    expect(urls![0]).toMatch(/\/reel-core\/src\/index\.ts$/);
  });
});
