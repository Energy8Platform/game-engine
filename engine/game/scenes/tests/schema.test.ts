import { describe, expect, it } from 'vitest';
import { Config } from '../src/schema';

describe('scenes Config', () => {
  it('defaults mode/transition/transitionMs and marks design as restart', () => {
    const v = Config({ design: { width: 480, height: 288 } });
    expect(v).toEqual({ design: { width: 480, height: 288 }, mode: 'contain', transition: 'cut', transitionMs: 300 });
    const json = JSON.parse(JSON.stringify(Config)) as { refs: Record<string, any>; uid: number };
    const text = JSON.stringify(json);
    expect(text).toContain('"applies":"restart"');
  });
  it('refuses a non-natural design size and an unknown mode', () => {
    expect(() => Config({ design: { width: -1, height: 1 } })).toThrow();
    expect(() => Config({ design: { width: 1, height: 1 }, mode: 'stretch' } as never)).toThrow();
  });
});
