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
      wave: Schema.object({
        amplitude: Schema.number(),
        phase: Schema.number().extra('extra', { applies: 'restart' }),
      }).description('wave envelope'),
    }).toJSON(),
  ),
);

const anySchema = JSON.parse(
  JSON.stringify(Schema.object({ board: Schema.any().description('initial board') }).toJSON()),
);

/** `mechanics1`'s `stages: dict(string)` — a stage id bound to a mechanic id. */
const dictSchema = JSON.parse(
  JSON.stringify(
    Schema.object({
      stages: Schema.dict(Schema.string()).description('stage id → mechanic id'),
    }).toJSON(),
  ),
);

function DictForm({
  initial,
  onChange,
}: {
  initial: Record<string, unknown>;
  onChange: (v: unknown) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SchemaForm
      rowId="row"
      schema={dictSchema}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

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

  it('renders an unsupported field kind (any) read-only and labelled, without corrupting the value', () => {
    const onChange = vi.fn();
    render(
      <SchemaForm rowId="row" schema={anySchema} value={{ board: [[1]] }} onChange={onChange} />,
    );
    const input = screen.getByLabelText('initial board') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.getByText(/unsupported \(any\)/)).toBeTruthy();
    fireEvent.change(input, { target: { value: 'x' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  // `reels1`'s `config.grid.{cols,rows}` and `stage1`'s `design.{width,height}`
  // are nested objects: without this, the reference project's rows would
  // have nothing editable on them at all.
  it('renders a nested object as its own fields and emits the whole value with the nested path replaced', () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        rowId="row"
        schema={nestedSchema}
        value={{ wave: { amplitude: 2, phase: 1 }, other: 'kept' }}
        onChange={onChange}
      />,
    );
    const group = screen.getByRole('group', { name: 'wave envelope' });
    expect(group).toBeTruthy();
    const input = screen.getByLabelText('amplitude') as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.value).toBe('2');
    fireEvent.change(input, { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ wave: { amplitude: 5, phase: 1 }, other: 'kept' });
  });

  it('a nested object with no value yet starts from an empty object, not from undefined', () => {
    const onChange = vi.fn();
    render(<SchemaForm rowId="row" schema={nestedSchema} value={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('amplitude'), { target: { value: '5' } });
    expect(onChange).toHaveBeenCalledWith({ wave: { amplitude: 5 } });
  });

  it('a restart badge on a nested field is visible too', () => {
    render(<SchemaForm rowId="row" schema={nestedSchema} value={{}} onChange={() => {}} />);
    expect(screen.getByText('restart')).toBeTruthy();
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

  describe('dict of strings', () => {
    it('renders one key → value row per entry', () => {
      render(
        <SchemaForm
          rowId="row"
          schema={dictSchema}
          value={{ stages: { main: 'lines', bonus: 'cascade' } }}
          onChange={() => {}}
        />,
      );
      const group = screen.getByRole('group', { name: 'stage id → mechanic id' });
      const keys = group.querySelectorAll<HTMLInputElement>('input[data-dict="key"]');
      const values = group.querySelectorAll<HTMLInputElement>('input[data-dict="value"]');
      expect([...keys].map((k) => k.value)).toEqual(['main', 'bonus']);
      expect([...values].map((v) => v.value)).toEqual(['lines', 'cascade']);
    });

    it('editing a value commits on blur, with the whole object', () => {
      const onChange = vi.fn();
      render(<DictForm initial={{ stages: { main: 'lines' }, other: 1 }} onChange={onChange} />);
      const value = screen.getByDisplayValue('lines');
      fireEvent.change(value, { target: { value: 'ways' } });
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.blur(value);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ stages: { main: 'ways' }, other: 1 });
    });

    it('+ adds an empty row that is not committed until it has a key', () => {
      const onChange = vi.fn();
      render(<DictForm initial={{ stages: { main: 'lines' } }} onChange={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: '+' }));
      const keys = screen
        .getAllByRole('textbox')
        .filter((i) => i.getAttribute('data-dict') === 'key');
      expect(keys).toHaveLength(2);
      // Blur with the key still empty: nothing to commit.
      fireEvent.blur(keys[1]);
      expect(onChange).not.toHaveBeenCalled();

      fireEvent.change(keys[1], { target: { value: 'bonus' } });
      fireEvent.blur(keys[1]);
      expect(onChange).toHaveBeenCalledWith({ stages: { main: 'lines', bonus: '' } });
    });

    it('renaming a key moves its value', () => {
      const onChange = vi.fn();
      render(<DictForm initial={{ stages: { main: 'lines' } }} onChange={onChange} />);
      const key = screen.getByDisplayValue('main');
      fireEvent.change(key, { target: { value: 'base' } });
      fireEvent.blur(key);
      expect(onChange).toHaveBeenCalledWith({ stages: { base: 'lines' } });
    });

    it('× removes the row and commits at once', () => {
      const onChange = vi.fn();
      render(
        <DictForm initial={{ stages: { main: 'lines', bonus: 'cascade' } }} onChange={onChange} />,
      );
      fireEvent.click(screen.getAllByRole('button', { name: '×' })[0]);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ stages: { bonus: 'cascade' } });
      expect(screen.queryByDisplayValue('lines')).toBeNull();
    });

    it('a blur that changed nothing does not commit', () => {
      const onChange = vi.fn();
      render(<DictForm initial={{ stages: { main: 'lines' } }} onChange={onChange} />);
      fireEvent.blur(screen.getByDisplayValue('lines'));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  /**
   * Review ruling 2: a GAME row's edit is a `PUT` and, for a cold row, a
   * preview reload — typing `480` must not be three of them. `commit:
   * 'blur'` keeps a draft while the field is focused and commits once, on
   * blur or Enter, when the value actually differs. The IDE's own rows
   * keep the default `'change'` (per keystroke over the socket).
   */
  describe("commit: 'blur'", () => {
    const type = (input: HTMLElement, chars: string) => {
      let text = '';
      for (const ch of chars) {
        text += ch;
        fireEvent.change(input, { target: { value: text } });
      }
    };

    it('a number field: three keystrokes commit nothing; blur commits once with the final value', () => {
      const onChange = vi.fn();
      render(
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ speed: 8 }}
          onChange={onChange}
          commit="blur"
        />,
      );
      const input = screen.getByLabelText('reel speed') as HTMLInputElement;
      type(input, '480');
      expect(onChange).not.toHaveBeenCalled();
      expect(input.value).toBe('480');
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ speed: 480 });
    });

    it('blur then Enter before the value prop caught up is still one commit', () => {
      const onChange = vi.fn();
      render(
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ speed: 8 }}
          onChange={onChange}
          commit="blur"
        />,
      );
      const input = screen.getByLabelText('reel speed');
      type(input, '12');
      fireEvent.blur(input);
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('Enter commits too, once', () => {
      const onChange = vi.fn();
      render(
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ speed: 8 }}
          onChange={onChange}
          commit="blur"
        />,
      );
      const input = screen.getByLabelText('reel speed');
      type(input, '12');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ speed: 12 });
    });

    it('a blur with no change commits nothing; a cleared field commits nothing either', () => {
      const onChange = vi.fn();
      render(
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ speed: 8 }}
          onChange={onChange}
          commit="blur"
        />,
      );
      const input = screen.getByLabelText('reel speed');
      fireEvent.blur(input);
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('a string field behaves the same: draft while typing, one commit on blur', () => {
      const onChange = vi.fn();
      render(
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ title: 'Moon' }}
          onChange={onChange}
          commit="blur"
        />,
      );
      const input = screen.getByLabelText('game title') as HTMLInputElement;
      type(input, 'Sun');
      expect(onChange).not.toHaveBeenCalled();
      expect(input.value).toBe('Sun');
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ title: 'Sun' });
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("the default stays 'change': the IDE's rows commit per keystroke", () => {
      const onChange = vi.fn();
      render(<SchemaForm rowId="row" schema={schema} value={{ speed: 8 }} onChange={onChange} />);
      type(screen.getByLabelText('reel speed'), '48');
      expect(onChange).toHaveBeenCalledTimes(2);
      type(screen.getByLabelText('game title'), 'ab');
      expect(onChange).toHaveBeenCalledTimes(4);
    });
  });

  it('dict: two rows with the same key — the later one wins (pinned so it cannot change silently)', () => {
    const onChange = vi.fn();
    render(<DictForm initial={{ stages: { main: 'lines' } }} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    const keys = screen
      .getAllByRole('textbox')
      .filter((i) => i.getAttribute('data-dict') === 'key');
    const values = screen
      .getAllByRole('textbox')
      .filter((i) => i.getAttribute('data-dict') === 'value');
    fireEvent.change(values[1], { target: { value: 'ways' } });
    fireEvent.change(keys[1], { target: { value: 'main' } });
    fireEvent.blur(keys[1]);
    expect(onChange).toHaveBeenCalledWith({ stages: { main: 'ways' } });
  });
});
