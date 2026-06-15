// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { createButton, createToggle, createSlider } from '@/shell/components/primitives';

describe('createButton', () => {
  it('renders label and fires onClick', () => {
    const onClick = vi.fn();
    const btn = createButton({ label: 'SPIN', className: 'ge-shell-spin', onClick });
    expect(btn.textContent).toBe('SPIN');
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does not fire when disabled', () => {
    const onClick = vi.fn();
    const btn = createButton({ label: 'X', onClick });
    btn.disabled = true;
    btn.click();
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('createToggle', () => {
  it('toggles and reports value', () => {
    const onChange = vi.fn();
    const t = createToggle({ checked: false, onChange });
    t.click();
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe('createSlider', () => {
  it('emits numeric value on input', () => {
    const onInput = vi.fn();
    const s = createSlider({ min: 0, max: 1, step: 0.1, value: 0.5, onInput });
    s.value = '0.8';
    s.dispatchEvent(new Event('input'));
    expect(onInput).toHaveBeenCalledWith(0.8);
  });
});
