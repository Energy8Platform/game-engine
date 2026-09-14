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
      holdSpins: Schema.number()
        .default(1)
        .description('held spins')
        .extra('extra', { applies: 'restart' }),
    }).toJSON(),
  ),
);

/** A form wired up the way a real host would use it: onChange feeds straight
 * back into the value it renders from, so a bad intermediate commit is
 * visible on the next render instead of only in a spy's call history. */
function ControlledForm({ initial }: { initial: Record<string, unknown> }) {
  const [value, setValue] = useState(initial);
  return <SchemaForm rowId="row" schema={schema} value={value} onChange={setValue} />;
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
    render(<SchemaForm rowId="row" schema={schema} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText('reel speed')).toBeTruthy();
    expect(screen.getByLabelText('game title')).toBeTruthy();
  });

  it('renders a number field with the bounds from the schema', () => {
    render(<SchemaForm rowId="row" schema={schema} value={{ speed: 8 }} onChange={() => {}} />);
    const input = screen.getByLabelText('reel speed') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.min).toBe('1');
    expect(input.max).toBe('20');
  });

  it('emits the whole value with the edited field replaced', () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        rowId="row"
        schema={schema}
        value={{ speed: 8, title: 'Moon' }}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('reel speed'), { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ speed: 3, title: 'Moon' });
  });

  it('renders a union as a select of its constants', () => {
    render(<SchemaForm rowId="row" schema={schema} value={{}} onChange={() => {}} />);
    const select = screen.getByLabelText('fill direction') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['up', 'down']);
  });

  it('marks fields that need a restart, so the cost is visible before the click', () => {
    render(<SchemaForm rowId="row" schema={schema} value={{}} onChange={() => {}} />);
    expect(screen.getByText('restart')).toBeTruthy();
  });

  it('falls back to the schema default when the value has no entry', () => {
    render(<SchemaForm rowId="row" schema={schema} value={{}} onChange={() => {}} />);
    expect((screen.getByLabelText('reel speed') as HTMLInputElement).value).toBe('8');
  });

  it('does not commit a value when a number field is cleared', () => {
    const onChange = vi.fn();
    render(<SchemaForm rowId="row" schema={schema} value={{ speed: 8 }} onChange={onChange} />);
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
    render(
      <SchemaForm
        rowId="row"
        schema={nestedSchema}
        value={{ wave: { amplitude: 2 } }}
        onChange={onChange}
      />,
    );
    const input = screen.getByLabelText('wave envelope') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.getByText(/unsupported/)).toBeTruthy();
    fireEvent.change(input, { target: { value: 'x' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders nothing for a null schema, without throwing', () => {
    const { container } = render(
      <SchemaForm rowId="row" schema={null} value={{}} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the rebuilt schema has no usable dict, without throwing', () => {
    // `new Schema({ nope: true })` does not throw — it rebuilds to an
    // instance with `dict: undefined`. This exercises the pre-existing
    // `!node?.dict` guard in SchemaForm, not the try/catch around
    // `new Schema(...)` — see the next test for that.
    const { container } = render(
      <SchemaForm rowId="row" schema={{ nope: true }} value={{}} onChange={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when rebuilding the schema itself throws, without propagating the error', () => {
    // A graph whose ref actually resolves to `null` makes `new Schema(...)`
    // throw (`Cannot read properties of null (reading 'refs')`), unlike
    // `{ nope: true }` above. This is what the try/catch in `rebuild()`
    // exists for.
    const { container } = render(
      <SchemaForm
        rowId="row"
        schema={{ uid: 1, refs: { 1: null } }}
        value={{}}
        onChange={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('skips a dict entry whose ref is dangling instead of throwing while rendering the rest', () => {
    render(<SchemaForm rowId="row" schema={danglingRefSchema} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText('reel speed')).toBeTruthy();
    expect(screen.queryByLabelText('bogus')).toBeNull();
  });

  it('scopes field ids to their row, so two rows sharing a field name do not collide', () => {
    // Two plugins both declaring a `speed` field — the expected case for a
    // reel-feature ecosystem. Without a row-scoped id both rows would
    // render `id="field-speed"`, the second row's <label> would steal
    // focus onto the first row's <input>, and `getByLabelText` (what
    // Playwright's `getByLabel` in the e2e suite also relies on) would go
    // ambiguous under strict mode.
    const onChangeA = vi.fn();
    const onChangeB = vi.fn();
    render(
      <div>
        <div aria-label="row-a">
          <SchemaForm rowId="row-a" schema={schema} value={{ speed: 1 }} onChange={onChangeA} />
        </div>
        <div aria-label="row-b">
          <SchemaForm rowId="row-b" schema={schema} value={{ speed: 2 }} onChange={onChangeB} />
        </div>
      </div>,
    );

    const inputs = screen.getAllByLabelText('reel speed') as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].id).not.toBe(inputs[1].id);

    fireEvent.change(inputs[1], { target: { value: '9' } });
    expect(onChangeB).toHaveBeenCalledWith({ speed: 9 });
    expect(onChangeA).not.toHaveBeenCalled();
  });
});
