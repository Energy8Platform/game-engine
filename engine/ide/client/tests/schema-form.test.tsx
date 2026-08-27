import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
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

/** A form wired up the way a real host would use it: onChange feeds straight
 * back into the value it renders from, so a bad intermediate commit is
 * visible on the next render instead of only in a spy's call history. */
function ControlledForm({ initial }: { initial: Record<string, unknown> }) {
  const [value, setValue] = useState(initial);
  return <SchemaForm schema={schema} value={value} onChange={setValue} />;
}

const nestedSchema = JSON.parse(
  JSON.stringify(
    Schema.object({
      wave: Schema.object({ amplitude: Schema.number() }).description('wave envelope'),
    }).toJSON(),
  ),
);

/** A dict entry whose uid isn't in `refs` — the shape a truncated or
 * hand-edited schema graph produces. `new Schema(...)` rebuilds this dict
 * entry as `undefined` rather than dropping the key. */
const danglingRefSchema = (() => {
  const raw = JSON.parse(
    JSON.stringify(
      Schema.object({
        speed: Schema.number().default(8).description('reel speed'),
      }).toJSON(),
    ),
  );
  const objectRefId = Object.keys(raw.refs).find((id) => raw.refs[id].dict)!;
  raw.refs[objectRefId].dict.bogus = 999999;
  return raw;
})();

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

  it('does not commit a value when a number field is cleared', () => {
    const onChange = vi.fn();
    render(<SchemaForm schema={schema} value={{ speed: 8 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('reel speed'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lets the user retype after clearing a number field, instead of reverting to the committed value', () => {
    render(<ControlledForm initial={{ speed: 8 }} />);
    const input = screen.getByLabelText('reel speed') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(input.value).toBe('');
    fireEvent.change(input, { target: { value: '5' } });
    expect(input.value).toBe('5');
  });

  it('renders an unsupported field kind (a nested object) read-only and labelled, without corrupting the value', () => {
    const onChange = vi.fn();
    render(<SchemaForm schema={nestedSchema} value={{ wave: { amplitude: 2 } }} onChange={onChange} />);
    const input = screen.getByLabelText('wave envelope') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.getByText(/unsupported/)).toBeTruthy();
    fireEvent.change(input, { target: { value: 'x' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders nothing for a null schema, without throwing', () => {
    const { container } = render(<SchemaForm schema={null} value={{}} onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a malformed schema, without throwing', () => {
    const { container } = render(<SchemaForm schema={{ nope: true }} value={{}} onChange={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('skips a dict entry whose ref is dangling instead of throwing while rendering the rest', () => {
    render(<SchemaForm schema={danglingRefSchema} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText('reel speed')).toBeTruthy();
    expect(screen.queryByLabelText('bogus')).toBeNull();
  });
});
