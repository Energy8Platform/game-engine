import './setup-canvas'; // must be first — patches canvas getContext before pixi.js loads
import { describe, it, expect } from 'vitest';
import { makeText } from '@/ui/pixi/text';

// Regression: makeText is the ONE shell text helper (How to Play, disclaimer, Game Info titles,
// mode table, win messages, buy-bonus cards). When a wrap width is given it must also breakWords,
// or CJK / long unbroken runs overflow the width instead of wrapping.
describe('makeText word wrapping', () => {
  it('enables breakWords alongside wordWrap when a wrapWidth is set', () => {
    const t = makeText('のののののののののののののののののの', { size: 20, wrapWidth: 100 });
    expect(t.style.wordWrap).toBe(true);
    expect(t.style.wordWrapWidth).toBe(100);
    expect(t.style.breakWords).toBe(true);
  });

  it('leaves wrapping off when no wrapWidth is given', () => {
    const t = makeText('hello', { size: 20 });
    expect(t.style.wordWrap).toBe(false);
  });
});
