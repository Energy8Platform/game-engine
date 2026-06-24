import { describe, it, expect } from 'vitest';
import { CountUpDisplay } from '@/slot/overlay/CountUpDisplay';

describe('CountUpDisplay.setFormat', () => {
  it('re-renders the current value with the new formatter', () => {
    const d = new CountUpDisplay({ format: (v) => v.toFixed(2) });
    d.setValue(5);
    expect(d.text).toBe('5.00');
    d.setFormat((v) => `€${v.toFixed(1)}`);
    expect(d.text).toBe('€5.0'); // re-rendered immediately with the live value
  });
});
