import { fireEvent, render, screen } from '@testing-library/react';
import Schema from 'schemastery';
import { describe, expect, it, vi } from 'vitest';
import { SchemaForm } from '../src/index';

const schema = JSON.parse(
  JSON.stringify(
    Schema.object({
      speed: Schema.number().min(1).max(20).step(1).default(8).description('reel speed'),
      title: Schema.string().default('Moon').description('game title'),
      loud: Schema.boolean().default(false).description('loud mode'),
      direction: Schema.union(['up', 'down']).default('up').description('fill direction'),
      holdSpins: Schema.number().default(1).description('held spins').extra('extra', { applies: 'restart' }),
    }).toJSON(),
  ),
);

describe('SchemaForm', () => {
  it('labels each field with its description', () => {
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText('reel speed')).toBeTruthy();
    expect(screen.getByLabelText('game title')).toBeTruthy();
  });

  it('renders a number field with the bounds from the schema', () => {
    render(<SchemaForm schema={schema} value={{ speed: 8 }} onChange={() => {}} />);
    const input = screen.getByLabelText('reel speed') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.min).toBe('1');
    expect(input.max).toBe('20');
  });

  it('emits the whole value with the edited field replaced', () => {
    const onChange = vi.fn();
    render(<SchemaForm schema={schema} value={{ speed: 8, title: 'Moon' }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('reel speed'), { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ speed: 3, title: 'Moon' });
  });

  it('renders a union as a select of its constants', () => {
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    const select = screen.getByLabelText('fill direction') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['up', 'down']);
  });

  it('marks fields that need a restart, so the cost is visible before the click', () => {
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    expect(screen.getByText('перезапуск')).toBeTruthy();
  });

  it('falls back to the schema default when the value has no entry', () => {
    render(<SchemaForm schema={schema} value={{}} onChange={() => {}} />);
    expect((screen.getByLabelText('reel speed') as HTMLInputElement).value).toBe('8');
  });
});
