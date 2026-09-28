import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import Schema from 'schemastery';
import { describe, expect, it, vi } from 'vitest';
import { SchemaForm } from '../src/index';
import type { CommitMode, FieldProps } from '../src/schema-form/fields';

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

/** Shared by `renderForm` and `renderStaticForm` — the two new SchemaForm
 * props (Task 2), alongside the existing `commit`. */
interface FormOpts {
  commit?: CommitMode;
  resettable?: boolean;
  root?: string;
  fieldOverrides?: Record<string, (props: FieldProps) => JSX.Element>;
}

/**
 * A controlled form over a real schemastery schema, returning the spy: the
 * value feeds back so a structural commit (reorder, remove) is what the
 * next click sees.
 */
function renderForm(schema: Schema, initial: Record<string, unknown>, opts: FormOpts = {}) {
  const onChange = vi.fn();
  const json = JSON.parse(JSON.stringify(schema.toJSON()));
  function Form() {
    const [value, setValue] = useState(initial);
    return (
      <SchemaForm
        rowId="row"
        schema={json}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        commit={opts.commit}
        resettable={opts.resettable}
        root={opts.root}
        fieldOverrides={opts.fieldOverrides}
      />
    );
  }
  render(<Form />);
  return onChange;
}

/** The real consumer's shape: `value` only moves when a PUT's frame lands — here never. */
function renderStaticForm(schema: Schema, value: Record<string, unknown>, opts: FormOpts = {}) {
  const onChange = vi.fn();
  const json = JSON.parse(JSON.stringify(schema.toJSON()));
  render(
    <SchemaForm
      rowId="row"
      schema={json}
      value={value}
      onChange={onChange}
      commit={opts.commit}
      resettable={opts.resettable}
      root={opts.root}
      fieldOverrides={opts.fieldOverrides}
    />,
  );
  return onChange;
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

/** A flow `show`'s `scene`: a string the IDE renders as a picker of scene ids. */
const pickSchema = JSON.parse(
  JSON.stringify(
    Schema.object({
      scene: Schema.string().required().extra('pick', 'scene').description('scene id'),
    }).toJSON(),
  ),
);

describe('SchemaForm — pick', () => {
  it('a string field with meta.pick renders as a select of the picker’s ids (plus the current value and an empty option) and commits on change', () => {
    const onChange = vi.fn();
    render(
      <SchemaForm
        rowId="row"
        schema={pickSchema}
        value={{ scene: 'gone' }}
        onChange={onChange}
        commit="blur"
        pickers={{ scene: () => ['base_game', 'bonus'] }}
      />,
    );
    const select = screen.getByLabelText('scene') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'base_game', 'bonus', 'gone']);
    expect(select.value).toBe('gone');
    fireEvent.change(select, { target: { value: 'bonus' } });
    expect(onChange).toHaveBeenCalledWith({ scene: 'bonus' });
  });

  it('without a picker for it, the field stays a text input', () => {
    render(
      <SchemaForm rowId="row" schema={pickSchema} value={{ scene: 'x' }} onChange={() => {}} />,
    );
    const input = screen.getByLabelText('scene') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('x');
  });
});

/** An image's `src`: a string the IDE renders as a picker of the project's files with those extensions. */
const assetSchema = JSON.parse(
  JSON.stringify(
    Schema.object({
      src: Schema.string().required().extra('asset', ['png', 'jpg']).description('image path'),
    }).toJSON(),
  ),
);

describe('SchemaForm — asset', () => {
  it('a string field with meta.asset renders as a select of the asset picker’s paths for those extensions (plus the current value and an empty option) and commits on change', () => {
    const onChange = vi.fn();
    const asset = vi.fn((exts: unknown) =>
      (exts as string[]).includes('png') ? ['assets/a.png', 'assets/b.jpg'] : [],
    );
    render(
      <SchemaForm
        rowId="row"
        schema={assetSchema}
        value={{ src: 'gone.png' }}
        onChange={onChange}
        commit="blur"
        pickers={{ asset }}
      />,
    );
    expect(asset).toHaveBeenCalledWith(['png', 'jpg']);
    const select = screen.getByLabelText('src') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    expect([...select.options].map((o) => o.value)).toEqual([
      '',
      'assets/a.png',
      'assets/b.jpg',
      'gone.png',
    ]);
    expect(select.value).toBe('gone.png');
    fireEvent.change(select, { target: { value: 'assets/b.jpg' } });
    expect(onChange).toHaveBeenCalledWith({ src: 'assets/b.jpg' });
  });

  it('without an asset picker, the field stays a text input', () => {
    render(
      <SchemaForm rowId="row" schema={assetSchema} value={{ src: 'x.png' }} onChange={() => {}} />,
    );
    const input = screen.getByLabelText('src') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.value).toBe('x.png');
  });
});

describe('SchemaForm', () => {
  it('labels each field by its key', () => {
    render(<SchemaForm rowId="row" schema={schema} value={{}} onChange={() => {}} />);
    expect(screen.getByLabelText('speed')).toBeTruthy();
    expect(screen.getByLabelText('title')).toBeTruthy();
  });

  it('labels a field by its key and shows the description as a hint tied to the control', () => {
    const cellSizeSchema = JSON.parse(
      JSON.stringify(
        Schema.object({
          cellSize: Schema.number().default(96).description('Square cell size.'),
        }).toJSON(),
      ),
    );
    render(<SchemaForm rowId="row" schema={cellSizeSchema} value={{}} onChange={() => {}} />);
    const input = screen.getByLabelText('cellSize');
    expect(input).toHaveAccessibleDescription('Square cell size.');
    expect(screen.getByText('Square cell size.')).toHaveClass('e8-field-hint');
  });

  // Final review M8: a long key truncates (label ellipsis) beside the reset
  // button — the title keeps it readable.
  it('every field label and group legend carries its key as a title', () => {
    render(
      <SchemaForm
        rowId="row"
        schema={nestedSchema}
        value={{ wave: { amplitude: 1 } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('amplitude', { selector: 'label' })).toHaveAttribute(
      'title',
      'amplitude',
    );
    expect(screen.getByText('wave', { selector: 'legend' })).toHaveAttribute('title', 'wave');
  });

  it('a field with no description has no hint and no aria-describedby', () => {
    const gapSchema = JSON.parse(
      JSON.stringify(Schema.object({ gap: Schema.number().default(6) }).toJSON()),
    );
    render(<SchemaForm rowId="row" schema={gapSchema} value={{}} onChange={() => {}} />);
    const input = screen.getByLabelText('gap');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(document.querySelector('.e8-field-hint')).toBeNull();
  });

  // I1: the hint used to render as the THIRD item of `.e8-field`'s row —
  // beside the control, with the `restart` badge (a later sibling) wrapping
  // to a row of its own. It must render AFTER the badge, so the badge sits
  // on the control's row and the hint is the one that wraps under it.
  it('a leaf field with a description and a restart badge: the badge precedes the hint in DOM order', () => {
    const restartSchema = JSON.parse(
      JSON.stringify(
        Schema.object({
          width: Schema.number()
            .default(1920)
            .description('design px')
            .extra('extra', { applies: 'restart' }),
        }).toJSON(),
      ),
    );
    render(<SchemaForm rowId="row" schema={restartSchema} value={{}} onChange={() => {}} />);
    const field = screen.getByLabelText('width').closest('.e8-field')!;
    const order = [...field.children].map((el) =>
      el.classList.contains('e8-badge')
        ? 'badge'
        : el.classList.contains('e8-field-hint')
          ? 'hint'
          : el.tagName.toLowerCase(),
    );
    expect(order.indexOf('badge')).toBeGreaterThan(-1);
    expect(order.indexOf('badge')).toBeLessThan(order.indexOf('hint'));
  });

  it('a group field puts its key on the legend and its description as the group hint', () => {
    const winSchema = JSON.parse(
      JSON.stringify(
        Schema.object({
          win: Schema.object({ glow: Schema.boolean().default(true) }).description('win highlight'),
        }).toJSON(),
      ),
    );
    render(<SchemaForm rowId="row" schema={winSchema} value={{}} onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'win' });
    expect(group).toHaveAccessibleDescription('win highlight');
  });

  // I1: the group's hint used to render AFTER the whole `<fieldset>`, so it
  // sat far from the `<legend>` it explains. It must be a descendant of the
  // fieldset, right after the legend.
  it("a group field's hint is a descendant of its fieldset, following the legend", () => {
    const winSchema = JSON.parse(
      JSON.stringify(
        Schema.object({
          win: Schema.object({ glow: Schema.boolean().default(true) }).description('win highlight'),
        }).toJSON(),
      ),
    );
    render(<SchemaForm rowId="row" schema={winSchema} value={{}} onChange={() => {}} />);
    const group = screen.getByRole('group', { name: 'win' });
    const hint = group.querySelector('.e8-field-hint')!;
    expect(hint).toBeTruthy();
    expect(hint).toHaveTextContent('win highlight');
    const legend = group.querySelector('legend')!;
    // `legend` precedes `hint` among the fieldset's children.
    const kids = [...group.children];
    expect(kids.indexOf(legend)).toBeLessThan(kids.indexOf(hint));
  });

  it('renders a number field with the bounds from the schema', () => {
    render(<SchemaForm rowId="row" schema={schema} value={{ speed: 8 }} onChange={() => {}} />);
    const input = screen.getByLabelText('speed') as HTMLInputElement;
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
    fireEvent.change(screen.getByLabelText('speed'), { target: { value: '3' } });
    expect(onChange).toHaveBeenCalledWith({ speed: 3, title: 'Moon' });
  });

  it('renders a union as a select of its constants', () => {
    render(<SchemaForm rowId="row" schema={schema} value={{}} onChange={() => {}} />);
    const select = screen.getByLabelText('direction') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['up', 'down']);
  });

  it('marks fields that need a restart, so the cost is visible before the click', () => {
    render(<SchemaForm rowId="row" schema={schema} value={{}} onChange={() => {}} />);
    expect(screen.getByText('restart')).toBeTruthy();
  });

  it('falls back to the schema default when the value has no entry', () => {
    render(<SchemaForm rowId="row" schema={schema} value={{}} onChange={() => {}} />);
    expect((screen.getByLabelText('speed') as HTMLInputElement).value).toBe('8');
  });

  it('does not commit a value when a number field is cleared', () => {
    const onChange = vi.fn();
    render(<SchemaForm rowId="row" schema={schema} value={{ speed: 8 }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('speed'), { target: { value: '' } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lets the user retype after clearing a number field, instead of reverting to the committed value', () => {
    render(<ControlledForm initial={{ speed: 8 }} />);
    const input = screen.getByLabelText('speed') as HTMLInputElement;
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
    const input = screen.getByLabelText('board') as HTMLInputElement;
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
    const group = screen.getByRole('group', { name: 'wave' });
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
    expect(screen.getByLabelText('speed')).toBeTruthy();
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

    const inputs = screen.getAllByLabelText('speed') as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs[0].id).not.toBe(inputs[1].id);

    fireEvent.change(inputs[1], { target: { value: '9' } });
    expect(onChangeB).toHaveBeenCalledWith({ speed: 9 });
    expect(onChangeA).not.toHaveBeenCalled();
  });

  // M8: a symbol id (or any other `rowId` source) may legally carry
  // whitespace — "wild card" is a legal file stem. A raw space in the id
  // prefix would make `aria-describedby="field-symbol.wild card...-hint"`
  // parse as TWO ids, so the control's accessible description would break.
  it('a rowId with a space still gives the control a working accessible description', () => {
    const hinted = JSON.parse(
      JSON.stringify(
        Schema.object({
          speed: Schema.number().default(8).description('reel speed'),
        }).toJSON(),
      ),
    );
    render(
      <SchemaForm rowId="symbol.wild card.static" schema={hinted} value={{}} onChange={() => {}} />,
    );
    const input = screen.getByLabelText('speed');
    expect(input).toHaveAccessibleDescription('reel speed');
    expect(input.getAttribute('aria-describedby')).not.toMatch(/\s/);
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
      const group = screen.getByRole('group', { name: 'stages' });
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

    it('a committed edit is not sent again by a later no-op focus and blur, even before the value round-trips', () => {
      // No state echo: the caller is an async PUT whose answer has not landed.
      const onChange = vi.fn();
      render(
        <SchemaForm
          rowId="row"
          schema={dictSchema}
          value={{ stages: { main: 'lines' } }}
          onChange={onChange}
        />,
      );
      const value = screen.getByDisplayValue('lines');
      fireEvent.focus(value);
      fireEvent.change(value, { target: { value: 'ways' } });
      fireEvent.blur(value);
      expect(onChange).toHaveBeenCalledTimes(1);
      const again = screen.getByDisplayValue('ways');
      fireEvent.focus(again);
      fireEvent.blur(again);
      expect(onChange).toHaveBeenCalledTimes(1);
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

    // Fix round 3: another tab's frame moves the `value` prop while one of
    // the dict's inputs is FOCUSED. The partial edit must survive it, and
    // the blur commits that edit MERGED over the latest value — the
    // sibling change is kept, not overwritten by the stale draft.
    it('an external change to a sibling key while focused keeps the partial edit; blur merges it over the latest value', () => {
      const onChange = vi.fn();
      const form = (stages: Record<string, string>) => (
        <SchemaForm
          rowId="row"
          schema={dictSchema}
          value={{ stages }}
          onChange={onChange}
          commit="blur"
        />
      );
      const { rerender } = render(form({ main: 'lines', bonus: 'cascade' }));
      const main = screen.getByDisplayValue('lines') as HTMLInputElement;
      fireEvent.focus(main);
      fireEvent.change(main, { target: { value: 'wa' } });
      rerender(form({ main: 'lines', bonus: 'tumble' }));
      expect(main.value).toBe('wa');
      fireEvent.blur(main);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ stages: { main: 'wa', bonus: 'tumble' } });
    });

    it('tabbing from the key input to its value input is not leaving the dict — no commit, draft kept', () => {
      const onChange = vi.fn();
      const form = (stages: Record<string, string>) => (
        <SchemaForm rowId="row" schema={dictSchema} value={{ stages }} onChange={onChange} />
      );
      const { rerender } = render(form({ main: 'lines' }));
      const key = screen.getByDisplayValue('main') as HTMLInputElement;
      const val = screen.getByDisplayValue('lines') as HTMLInputElement;
      fireEvent.focus(key);
      fireEvent.change(key, { target: { value: 'ma' } });
      fireEvent.blur(key, { relatedTarget: val });
      expect(onChange).not.toHaveBeenCalled();
      rerender(form({ main: 'lines', bonus: 'cascade' }));
      expect(key.value).toBe('ma');
      fireEvent.blur(val);
      expect(onChange).toHaveBeenCalledWith({ stages: { ma: 'lines', bonus: 'cascade' } });
    });

    it('an external change while NOT focused re-syncs the rows', () => {
      const form = (stages: Record<string, string>) => (
        <SchemaForm rowId="row" schema={dictSchema} value={{ stages }} onChange={() => {}} />
      );
      const { rerender } = render(form({ main: 'lines' }));
      rerender(form({ main: 'ways' }));
      expect(screen.getByDisplayValue('ways')).toBeTruthy();
      expect(screen.queryByDisplayValue('lines')).toBeNull();
    });

    it('focus, no typing, external change, blur: nothing committed and the latest value is shown', () => {
      const onChange = vi.fn();
      const form = (stages: Record<string, string>) => (
        <SchemaForm rowId="row" schema={dictSchema} value={{ stages }} onChange={onChange} />
      );
      const { rerender } = render(form({ main: 'lines' }));
      const main = screen.getByDisplayValue('lines');
      fireEvent.focus(main);
      rerender(form({ main: 'ways' }));
      fireEvent.blur(main);
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByDisplayValue('ways')).toBeTruthy();
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
      const input = screen.getByLabelText('speed') as HTMLInputElement;
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
      const input = screen.getByLabelText('speed');
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
      const input = screen.getByLabelText('speed');
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
      const input = screen.getByLabelText('speed');
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
      const input = screen.getByLabelText('title') as HTMLInputElement;
      type(input, 'Sun');
      expect(onChange).not.toHaveBeenCalled();
      expect(input.value).toBe('Sun');
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ title: 'Sun' });
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    // Fix round 2: another tab's frame moves the `value` prop while this
    // field is FOCUSED. The draft must survive it — and the blur commits
    // the draft because it differs from the LATEST prop.
    it('an external value change while focused does not touch the draft; blur commits it against the latest value', () => {
      const onChange = vi.fn();
      const form = (speed: number) => (
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ speed }}
          onChange={onChange}
          commit="blur"
        />
      );
      const { rerender } = render(form(8));
      const input = screen.getByLabelText('speed') as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '4' } });
      rerender(form(99));
      expect(input.value).toBe('4');
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith({ speed: 4 });
    });

    it('typing the very value another tab just set commits nothing on blur — it is the latest value already', () => {
      const onChange = vi.fn();
      const form = (speed: number) => (
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ speed }}
          onChange={onChange}
          commit="blur"
        />
      );
      const { rerender } = render(form(8));
      const input = screen.getByLabelText('speed') as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: '99' } });
      rerender(form(99));
      fireEvent.blur(input);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('an external value change while NOT focused re-syncs the draft', () => {
      const form = (speed: number) => (
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ speed }}
          onChange={() => {}}
          commit="blur"
        />
      );
      const { rerender } = render(form(8));
      const input = screen.getByLabelText('speed') as HTMLInputElement;
      rerender(form(99));
      expect(input.value).toBe('99');
    });

    it('a string field keeps its draft across an external change while focused, too', () => {
      const onChange = vi.fn();
      const form = (title: string) => (
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ title }}
          onChange={onChange}
          commit="blur"
        />
      );
      const { rerender } = render(form('Moon'));
      const input = screen.getByLabelText('title') as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: 'Sun' } });
      rerender(form('Mars'));
      expect(input.value).toBe('Sun');
      fireEvent.blur(input);
      expect(onChange).toHaveBeenCalledWith({ title: 'Sun' });
    });

    it('focus, no typing, external change, blur: nothing committed and the latest value is shown', () => {
      const onChange = vi.fn();
      const form = (speed: number) => (
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ speed }}
          onChange={onChange}
          commit="blur"
        />
      );
      const { rerender } = render(form(8));
      const input = screen.getByLabelText('speed') as HTMLInputElement;
      fireEvent.focus(input);
      rerender(form(99));
      fireEvent.blur(input);
      expect(onChange).not.toHaveBeenCalled();
      expect(input.value).toBe('99');
    });

    it('Enter prevents the default (a future <form> must not submit)', () => {
      render(
        <SchemaForm
          rowId="row"
          schema={schema}
          value={{ speed: 8 }}
          onChange={() => {}}
          commit="blur"
        />,
      );
      const input = screen.getByLabelText('speed');
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    });

    it("the default stays 'change': the IDE's rows commit per keystroke", () => {
      const onChange = vi.fn();
      render(<SchemaForm rowId="row" schema={schema} value={{ speed: 8 }} onChange={onChange} />);
      type(screen.getByLabelText('speed'), '48');
      expect(onChange).toHaveBeenCalledTimes(2);
      type(screen.getByLabelText('title'), 'ab');
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

// Task 5: `stage1`'s `layers: array(object{id,z})` and `scenes:
// dict(object{layers: array(string), transition})` — the two shapes the
// scenes-and-layers row edits.
describe('SchemaForm — arrays of objects', () => {
  const schema = Schema.object({
    layers: Schema.array(
      Schema.object({ id: Schema.string().required(), z: Schema.number().default(0) }),
    ).default([]),
  });
  it('renders one row per item with the item’s fields', () => {
    renderForm(schema, {
      layers: [
        { id: 'bg', z: 0 },
        { id: 'reels', z: 10 },
      ],
    });
    expect(screen.getAllByTestId(/^array-row-/)).toHaveLength(2);
    expect((screen.getAllByLabelText('id')[1] as HTMLInputElement).value).toBe('reels');
  });
  it('add appends an item from the inner defaults and commits at once', async () => {
    const onChange = renderForm(schema, { layers: [] });
    await userEvent.click(screen.getByRole('button', { name: 'add' }));
    expect(onChange).toHaveBeenLastCalledWith({ layers: [{ z: 0 }] });
  });
  it('remove and up/down commit the reordered array', async () => {
    const onChange = renderForm(schema, {
      layers: [
        { id: 'a', z: 0 },
        { id: 'b', z: 1 },
      ],
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'up' })[1]);
    expect(onChange).toHaveBeenLastCalledWith({
      layers: [
        { id: 'b', z: 1 },
        { id: 'a', z: 0 },
      ],
    });
    await userEvent.click(screen.getAllByRole('button', { name: 'remove' })[0]);
    expect(onChange).toHaveBeenLastCalledWith({ layers: [{ id: 'a', z: 0 }] });
  });
  it('editing a field inside a row commits on blur under commit: blur, with the row replaced in place', async () => {
    const onChange = renderForm(schema, { layers: [{ id: 'a', z: 0 }] }, { commit: 'blur' });
    const z = screen.getByLabelText('z');
    await userEvent.clear(z);
    await userEvent.type(z, '5');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith({ layers: [{ id: 'a', z: 5 }] });
  });
  // Fix round 1: `value` has not moved when the click lands (the PUT is in
  // flight), so the swap must build on what was just flushed, not the prop.
  it('a structural click right after typing keeps the flushed draft, even before the value catches up', async () => {
    const onChange = renderStaticForm(
      schema,
      {
        layers: [
          { id: 'a', z: 0 },
          { id: 'b', z: 1 },
        ],
      },
      { commit: 'blur' },
    );
    const z = screen.getAllByLabelText('z')[1];
    await userEvent.clear(z);
    await userEvent.type(z, '5');
    await userEvent.click(screen.getAllByRole('button', { name: 'up' })[1]);
    expect(onChange).toHaveBeenLastCalledWith({
      layers: [
        { id: 'b', z: 5 },
        { id: 'a', z: 0 },
      ],
    });
  });
});

describe('SchemaForm — dicts of objects', () => {
  const schema = Schema.object({
    scenes: Schema.dict(
      Schema.object({
        layers: Schema.array(Schema.string()).default([]),
        transition: Schema.string(),
      }),
    ).default({}),
  });
  // The entry's own `layers` array has an `add` too, ahead of the dict's in
  // DOM order — the dict's add sits after its rows, so it is the last one.
  it('renders a key input and a nested form per entry; add creates an entry once the key is typed and left', async () => {
    const onChange = renderForm(schema, { scenes: { base_game: { layers: ['bg'] } } });
    expect(screen.getByLabelText('key')).toHaveValue('base_game');
    await userEvent.click(screen.getAllByRole('button', { name: 'add' }).at(-1)!);
    await userEvent.type(screen.getAllByLabelText('key')[1], 'free_spins');
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith({
      scenes: { base_game: { layers: ['bg'] }, free_spins: { layers: [] } },
    });
  });
  it('two entries keyed in a row both land, even before the value catches up', async () => {
    const onChange = renderStaticForm(schema, { scenes: {} });
    for (const key of ['x', 'y']) {
      await userEvent.click(screen.getAllByRole('button', { name: 'add' }).at(-1)!);
      await userEvent.type(screen.getAllByLabelText('key').at(-1)!, key);
      await userEvent.tab();
    }
    expect(onChange).toHaveBeenLastCalledWith({
      scenes: { x: { layers: [] }, y: { layers: [] } },
    });
  });
  it('an array of strings inside renders as a comma-free list of string inputs with add/remove', async () => {
    const onChange = renderForm(schema, { scenes: { base_game: { layers: ['bg'] } } });
    expect(screen.getByLabelText('item 1')).toHaveValue('bg');
    await userEvent.click(screen.getAllByRole('button', { name: 'add' })[0]);
    expect(onChange).toHaveBeenLastCalledWith({ scenes: { base_game: { layers: ['bg', ''] } } });
  });
});

// Task 1: `reels1`'s `colGap`/`rowGap` (`number | number[]`), `topReel`
// (`object | null`) and anticipation's `reels` (`'trailing' | number[]`) all
// used to fall through to `unsupported (union)`, and a frame colour was a
// bare number field — no picker. Three new shapes: `.role('color')`, an
// exactly-two-member `number | number[]` union, and an exactly-two-member
// `const | other` union (`null` or a string literal).
describe('SchemaForm — colour, one-or-list, literal-or-value', () => {
  it('a colour role renders a picker and hex text that read and write the number', () => {
    const onChange = renderStaticForm(
      Schema.object({ color: Schema.number().role('color').default(0x223047) }),
      { color: 0x112233 },
    );
    expect(screen.getByLabelText('color')).toHaveValue('#112233');
    const hex = screen.getByRole('textbox', { name: 'color hex' });
    fireEvent.change(hex, { target: { value: '#ff0000' } });
    fireEvent.blur(hex);
    expect(onChange).toHaveBeenLastCalledWith({ color: 0xff0000 });
    fireEvent.input(screen.getByLabelText('color'), { target: { value: '#00ff00' } });
    fireEvent.change(screen.getByLabelText('color'), { target: { value: '#00ff00' } });
    expect(onChange).toHaveBeenLastCalledWith({ color: 0x00ff00 });
  });

  // Final review I5: `onInput` and React's `onChange` both fired per `input`
  // event, and dragging in the picker fires one per step — a PUT each.
  it('the picker previews while it moves and writes once, on its native change', () => {
    const onChange = renderStaticForm(
      Schema.object({ color: Schema.number().role('color') }),
      {
        color: 1,
      },
      { commit: 'blur' },
    );
    const swatch = screen.getByLabelText('color');
    fireEvent.input(swatch, { target: { value: '#00ff00' } });
    fireEvent.input(swatch, { target: { value: '#0000ff' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(swatch).toHaveValue('#0000ff'); // the preview follows the picker
    fireEvent.change(swatch, { target: { value: '#0000ff' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ color: 0x0000ff });
    fireEvent.blur(swatch);
    expect(onChange).toHaveBeenCalledTimes(1); // already settled
  });

  // Final review I6: an unset colour with no default read as `#000000` —
  // a concrete colour the row does not have.
  it('an unset colour with no default shows an empty hex (placeholder built-in) and an unset swatch', () => {
    const onChange = renderStaticForm(Schema.object({ color: Schema.number().role('color') }), {});
    const hex = screen.getByRole('textbox', { name: 'color hex' });
    expect(hex).toHaveValue('');
    expect(hex).toHaveAttribute('placeholder', 'built-in');
    expect(hex).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('color')).toHaveAttribute('data-unset');
    fireEvent.focus(hex);
    fireEvent.blur(hex);
    expect(onChange).not.toHaveBeenCalled();
  });

  // Final review M7: four frame states each drew a textbox named just "hex".
  it("each colour's hex textbox is named by its own field", () => {
    renderStaticForm(
      Schema.object({
        idle: Schema.number().role('color'),
        winning: Schema.number().role('color'),
      }),
      { idle: 1, winning: 2 },
    );
    expect(screen.getByRole('textbox', { name: 'idle hex' })).toHaveValue('#000001');
    expect(screen.getByRole('textbox', { name: 'winning hex' })).toHaveValue('#000002');
  });

  it('an invalid hex is refused in the field, not written', () => {
    const onChange = renderStaticForm(Schema.object({ color: Schema.number().role('color') }), {
      color: 1,
    });
    const hex = screen.getByRole('textbox', { name: 'color hex' });
    fireEvent.change(hex, { target: { value: 'nope' } });
    fireEvent.blur(hex);
    expect(onChange).not.toHaveBeenCalled();
    expect(hex).toHaveAttribute('aria-invalid', 'true');
  });

  it('number | number[] is a one / per reel switch; switching converts', () => {
    const onChange = renderStaticForm(
      Schema.object({ colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]) }),
      { colGap: 6 },
    );
    expect(screen.getByRole('radio', { name: 'one' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'per reel' }));
    expect(onChange).toHaveBeenLastCalledWith({ colGap: [6] });
  });

  it('a list value shows one input per entry; + appends the last value, − drops the last', () => {
    const onChange = renderStaticForm(
      Schema.object({ colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]) }),
      { colGap: [4, 8] },
    );
    expect(screen.getByRole('radio', { name: 'per reel' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(onChange).toHaveBeenLastCalledWith({ colGap: [4, 8, 8] });
    // The prop never moves here (a PUT still in flight): `−` builds on what
    // `+` just sent, not the stale `[4, 8]` (final review I3).
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(onChange).toHaveBeenLastCalledWith({ colGap: [4, 8] });
  });

  // Fix round 1: a controlled form (the value feeds back), chaining + then
  // − — the ArrayField "remove and up/down" test's own shape. `+` off the
  // fed-back `[4, 8, 8]` must drop the entry `+` itself just appended, not
  // re-derive from the ORIGINAL `[4, 8]` a second time.
  it('a controlled form: + then − chain off the value each click feeds back', () => {
    const onChange = renderForm(
      Schema.object({ colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]) }),
      { colGap: [4, 8] },
    );
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(onChange).toHaveBeenLastCalledWith({ colGap: [4, 8, 8] });
    fireEvent.click(screen.getByRole('button', { name: '−' }));
    expect(onChange).toHaveBeenLastCalledWith({ colGap: [4, 8] });
  });

  // Fix round 1: the per-reel entries used to be raw `<input>`s that
  // ignored `commit` entirely — under `commit: 'blur'` (a GAME row) every
  // keystroke was a `PUT`. They now go through `Field`/`NumberField`, so
  // they get its draft: buffered while focused, one commit on blur, and a
  // cleared entry commits nothing (NumberField's own rule, not re-tested
  // here — this just confirms the entry actually IS a `NumberField`).
  it("under commit: 'blur', a per-reel entry buffers keystrokes and commits once on blur; clearing writes nothing", () => {
    const onChange = renderStaticForm(
      Schema.object({ colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]) }),
      { colGap: [4, 8] },
      { commit: 'blur' },
    );
    const entry = screen.getByLabelText('reel 1') as HTMLInputElement;
    fireEvent.change(entry, { target: { value: '6' } });
    fireEvent.change(entry, { target: { value: '60' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(entry);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ colGap: [60, 8] });

    fireEvent.focus(entry);
    fireEvent.change(entry, { target: { value: '' } });
    fireEvent.blur(entry);
    expect(onChange).toHaveBeenCalledTimes(1); // the clear commits nothing
  });

  // Fix round 1: `one` mode's single number field had the same bug.
  it("under commit: 'blur', one mode's number field buffers too", () => {
    const onChange = renderStaticForm(
      Schema.object({ colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]) }),
      { colGap: 6 },
      { commit: 'blur' },
    );
    const input = screen.getByLabelText('colGap') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '48' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ colGap: 48 });
  });

  // Final review I3: the structural writes were built from the `value`
  // prop, which only moves once the PUT lands — a click right after typing
  // dropped the typed entry (ArrayField's own `latest` rule).
  it('a structural click right after typing keeps the flushed entry, even before the value catches up', () => {
    const onChange = renderStaticForm(
      Schema.object({ colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]) }),
      { colGap: [4, 8] },
      { commit: 'blur' },
    );
    const entry = screen.getByLabelText('reel 2');
    fireEvent.focus(entry);
    fireEvent.change(entry, { target: { value: '9' } });
    fireEvent.blur(entry);
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(onChange.mock.calls).toEqual([[{ colGap: [4, 9] }], [{ colGap: [4, 9, 9] }]]);
  });

  // Final review I6: unset used to show — and switch as — a concrete `0`.
  it('an unset value shows an empty input; per reel writes [] with no default, [default] with one', () => {
    const onChange = renderStaticForm(
      Schema.object({ colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]) }),
      {},
    );
    expect(screen.getByLabelText('colGap')).toHaveValue(null);
    fireEvent.click(screen.getByRole('radio', { name: 'per reel' }));
    expect(onChange).toHaveBeenLastCalledWith({ colGap: [] });
  });

  it('an unset value with a numeric default switches to per reel as [default]', () => {
    const onChange = renderStaticForm(
      Schema.object({
        colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]).default(4),
      }),
      {},
    );
    fireEvent.click(screen.getByRole('radio', { name: 'per reel' }));
    expect(onChange).toHaveBeenLastCalledWith({ colGap: [4] });
  });

  // Fix round 1: in list mode nothing carries the bare `id={id}` the
  // field's own `<label htmlFor>` names — the field must still resolve to
  // a NAMED element some other way, via `role="group"`/`aria-labelledby`.
  it('per-reel mode is a group the field label names', () => {
    renderStaticForm(
      Schema.object({ colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]) }),
      { colGap: [4, 8] },
    );
    expect(screen.getByRole('group', { name: 'colGap' })).toBeInTheDocument();
  });

  it("null | object is an on switch with the object's fields; off writes null", () => {
    const schema = Schema.object({
      topReel: Schema.union([
        Schema.object({ size: Schema.natural().default(4) }),
        Schema.const(null),
      ]).default(null),
    });
    const onChange = renderStaticForm(schema, { topReel: { size: 4 } });
    expect(screen.getByRole('checkbox', { name: 'topReel' })).toBeChecked();
    expect(screen.getByLabelText('size')).toHaveValue(4);
    fireEvent.click(screen.getByRole('checkbox', { name: 'topReel' }));
    expect(onChange).toHaveBeenLastCalledWith({ topReel: null });
  });

  it('turning a null | object on writes the object’s defaults', () => {
    const schema = Schema.object({
      topReel: Schema.union([
        Schema.object({ size: Schema.natural().default(4) }),
        Schema.const(null),
      ]).default(null),
    });
    const onChange = renderStaticForm(schema, {});
    fireEvent.click(screen.getByRole('checkbox', { name: 'topReel' }));
    expect(onChange).toHaveBeenLastCalledWith({ topReel: { size: 4 } });
  });

  it("'trailing' | number[] is a trailing / these switch", () => {
    const schema = Schema.object({
      reels: Schema.union([Schema.const('trailing'), Schema.array(Schema.natural())]).default(
        'trailing',
      ),
    });
    const onChange = renderStaticForm(schema, {});
    expect(screen.getByRole('radio', { name: 'trailing' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'these' }));
    expect(onChange).toHaveBeenLastCalledWith({ reels: [] });
  });

  // Fix round 1: neither radio in this switch carries the bare `id={id}`
  // either (same gap as `OneOrListField`'s list mode above).
  it('the trailing / these switch is a group the field label names', () => {
    const schema = Schema.object({
      reels: Schema.union([Schema.const('trailing'), Schema.array(Schema.natural())]).default(
        'trailing',
      ),
    });
    renderStaticForm(schema, {});
    expect(screen.getByRole('group', { name: 'reels' })).toBeInTheDocument();
  });

  it('rendering never writes: odd values stay as they are until the user acts', () => {
    const onChange = renderStaticForm(
      Schema.object({
        colGap: Schema.union([Schema.number(), Schema.array(Schema.number())]),
        topReel: Schema.union([Schema.object({ size: Schema.natural() }), Schema.const(null)]),
      }),
      { colGap: [6], topReel: {} },
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a union none of the shapes covers is still unsupported', () => {
    renderStaticForm(
      Schema.object({ odd: Schema.union([Schema.number(), Schema.string(), Schema.boolean()]) }),
      {},
    );
    expect(screen.getByText(/unsupported \(union\)/)).toBeInTheDocument();
  });
});

/**
 * Task 2 of the reels-editor slice: the Composition screen's game rows edit
 * `row.config`, which holds ONLY what the patch sets — so "resettable"
 * means "reset-able back to whatever schemastery would default it to",
 * and "set" means `Object.hasOwn`, not merely "not undefined".
 */
describe('SchemaForm — resettable', () => {
  const gridSchema = Schema.object({
    grid: Schema.object({
      cols: Schema.number().default(5),
      rows: Schema.number().default(3),
    }),
  });

  it('a set key gets a marker and a reset button; an absent one gets neither; a nested group resets as a whole section', () => {
    const onChange = renderStaticForm(gridSchema, { grid: { cols: 6 } }, { resettable: true });

    const colsField = screen.getByLabelText('cols').closest('.e8-field')!;
    expect(colsField.querySelector('.e8-field-set')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'reset cols' })).toBeInTheDocument();

    const rowsField = screen.getByLabelText('rows').closest('.e8-field')!;
    expect(rowsField.querySelector('.e8-field-set')).toBeNull();
    expect(screen.queryByRole('button', { name: 'reset rows' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'reset cols' }));
    expect(onChange).toHaveBeenLastCalledWith({ grid: {} });

    fireEvent.click(screen.getByRole('button', { name: 'reset section grid' }));
    expect(onChange).toHaveBeenLastCalledWith({});

    expect(screen.getByLabelText('cols')).toHaveAccessibleDescription('default 5');
  });

  it('without resettable, nothing is marked and no reset button renders', () => {
    renderStaticForm(gridSchema, { grid: { cols: 6 } });
    expect(document.querySelector('.e8-field-set')).toBeNull();
    expect(screen.queryByRole('button', { name: 'reset cols' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'reset section grid' })).toBeNull();
  });
});

describe('SchemaForm — root', () => {
  const rowSchema = Schema.object({
    grid: Schema.object({ cols: Schema.number() }),
    win: Schema.object({ glow: Schema.boolean() }),
  });

  it('renders only the named key’s fields, with no legend for the key itself, and onChange still carries the whole value', () => {
    const onChange = renderStaticForm(
      rowSchema,
      { grid: { cols: 6 }, win: { glow: true } },
      { root: 'grid' },
    );
    expect(screen.getByLabelText('cols')).toHaveValue(6);
    expect(screen.queryByLabelText('glow')).toBeNull();
    expect(screen.queryByText('grid')).toBeNull();

    fireEvent.change(screen.getByLabelText('cols'), { target: { value: '7' } });
    expect(onChange).toHaveBeenLastCalledWith({ grid: { cols: 7 }, win: { glow: true } });
  });
});

describe('SchemaForm — fieldOverrides', () => {
  it('draws the override at a non-union node’s dotted path; the literal-or-value switch above it still draws itself', () => {
    const schema = Schema.object({
      win: Schema.object({
        frameShake: Schema.object({
          onlyOnSymbols: Schema.union([Schema.const(null), Schema.array(Schema.string())]).default(
            null,
          ),
        }),
      }),
    });
    const received: { path?: string; value?: unknown } = {};
    function Fake({ path, value }: FieldProps) {
      received.path = path;
      received.value = value;
      return <div data-testid="fake" />;
    }
    // A controlled form: the array-mode value the override receives only
    // shows up once the toggle's own `onChange` round-trips into `value`.
    renderForm(
      schema,
      { win: { frameShake: { onlyOnSymbols: null } } },
      { fieldOverrides: { 'win.frameShake.onlyOnSymbols': Fake } },
    );

    const toggle = screen.getByRole('checkbox', { name: 'onlyOnSymbols' });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByTestId('fake')).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByTestId('fake')).toBeInTheDocument();
    expect(received.path).toBe('win.frameShake.onlyOnSymbols');
    expect(received.value).toEqual([]);
  });
});
