import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';

/**
 * When a text-like field hands its value up. `'change'` — every keystroke
 * (the IDE's own rows: an `update` frame over the socket is cheap).
 * `'blur'` — a draft while focused, one `onChange` on blur or Enter when
 * the value differs (a GAME row: each commit is a `PUT`, and on a cold row
 * a preview reload — typing `480` must not be three of them).
 * Boolean, union and dict fields are unaffected: a click is already one
 * commit, and the dict commits on blur regardless.
 */
export type CommitMode = 'change' | 'blur';

declare global {
  namespace Schemastery {
    interface Meta {
      /** `.extra('pick', 'scene')`: render this string field as a picker of the named thing's ids — see `SchemaForm.pickers`. */
      pick?: string;
      /** `.extra('asset', ['png'])`: a project-relative file path with one of these extensions — offered from `pickers.asset(extensions)`. */
      asset?: string[];
    }
  }
}

/** The parts of a rebuilt schemastery schema the form reads. */
export interface SchemaNode {
  type: string;
  value?: unknown;
  list?: SchemaNode[];
  dict?: Record<string, SchemaNode>;
  /** A `dict` node's value schema, or an `array` node's item schema. */
  inner?: SchemaNode;
  meta?: {
    default?: unknown;
    description?: string;
    min?: number;
    max?: number;
    step?: number;
    extra?: { applies?: 'restart' };
    /** A string field to render as a `<select>` of the named picker's ids — see `SchemaForm.pickers`. */
    pick?: string;
    /** A string field holding an asset path: a `<select>` of `pickers.asset(extensions)`. */
    asset?: string[];
    /** `.role('color')`: a `number` field renders as a colour picker + hex text, not a plain number input. */
    role?: string;
  };
}

/** `SchemaForm.pickers`, reaching `StringField` however deep the field sits (arrays, dicts). */
export const Pickers = createContext<Record<string, (arg?: unknown) => string[]>>({});

export interface FieldProps {
  id: string;
  node: SchemaNode;
  value: unknown;
  onChange: (next: unknown) => void;
  commit: CommitMode;
  /** For a control with no `<label for>` of its own — a string item in an array. */
  ariaLabel?: string;
  /** The id of this field's hint `<p>` (`ObjectFields`), tied to the control with `aria-describedby`. */
  describedBy?: string;
  /** Dotted path from the FORM'S value root (`win.frameShake.onlyOnSymbols`) — stable regardless of
   * `SchemaForm.root` trimming what actually renders; `fieldOverrides` is keyed by it. */
  path: string;
}

/** `SchemaForm.resettable`/`fieldOverrides`, reaching `ObjectFields`/`Field` however deep the field
 * sits — the same shape as `Pickers` above, one context per form-wide option. */
export const FormOptions = createContext<{
  resettable: boolean;
  fieldOverrides: Record<string, (props: FieldProps) => JSX.Element>;
}>({ resettable: false, fieldOverrides: {} });

/** A field's label is the key as written in the YAML — never the description (that's `hint`, a muted line under the control). */
export function label(node: SchemaNode, key: string): string {
  return key;
}

/** The field's description, rendered as a hint under its control — `undefined` when it has none, so nothing renders. */
export function hint(node: SchemaNode): string | undefined {
  return node.meta?.description || undefined;
}

export function needsRestart(node: SchemaNode): boolean {
  return node.meta?.extra?.applies === 'restart';
}

/**
 * `resettable`'s hint suffix on a SET field whose schema default differs
 * from what's set: ` · default <value>`. Only for a primitive default — an
 * object/array default isn't a one-line value worth quoting — and a
 * `.role('color')` default prints the same `#rrggbb` the field itself
 * shows (`hexOf`, below), not the raw decimal.
 */
function defaultNote(node: SchemaNode, current: unknown): string | undefined {
  const value = node.meta?.default;
  if (value === undefined || value === current) return undefined;
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
    return undefined;
  }
  const shown =
    node.meta?.role === 'color' && typeof value === 'number' ? hexOf(value) : String(value);
  return `default ${shown}`;
}

/** A union of string constants, drawn as a `<select>` — `oneOrList`/
 * `literalOrValue` below are the other union shapes this form draws. */
function constants(node: SchemaNode): string[] | null {
  if (node.type !== 'union' || !node.list) return null;
  const values = node.list.map((member) => member.value);
  return values.every((value) => typeof value === 'string') ? (values as string[]) : null;
}

/** `colGap: number | number[]` (a scalar gap, or one per reel-boundary): exactly two members, one `number`, one `array` of `number`. */
function oneOrList(node: SchemaNode): boolean {
  if (node.type !== 'union' || node.list?.length !== 2) return false;
  const [a, b] = node.list;
  const isNumber = (n: SchemaNode) => n.type === 'number';
  const isNumberList = (n: SchemaNode) => n.type === 'array' && n.inner?.type === 'number';
  return (isNumber(a) && isNumberList(b)) || (isNumber(b) && isNumberList(a));
}

/**
 * `topReel: object | null`, anticipation's `reels: 'trailing' | number[]`:
 * exactly two members, one a `const` (`null`, or a string literal) and the
 * other anything but a `const`. Order-independent — the schema may list
 * either member first.
 */
function literalOrValue(node: SchemaNode): { literal: SchemaNode; other: SchemaNode } | null {
  if (node.type !== 'union' || node.list?.length !== 2) return null;
  const [a, b] = node.list;
  const isLiteral = (n: SchemaNode) =>
    n.type === 'const' && (n.value === null || typeof n.value === 'string');
  if (isLiteral(a) && b.type !== 'const') return { literal: a, other: b };
  if (isLiteral(b) && a.type !== 'const') return { literal: b, other: a };
  return null;
}

/**
 * One labelled field per entry of an `object` node's `dict` — the body of
 * `SchemaForm`, and of every nested object inside it. Emits the WHOLE
 * `value` with the one key replaced, never a copy schemastery has filled
 * with defaults: the host replaces the row's config with what it is
 * handed, so what goes out is what the user has, plus the edit.
 */
export function ObjectFields({
  idPrefix,
  node,
  value,
  onChange,
  commit,
  path,
}: {
  idPrefix: string;
  node: SchemaNode;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  commit: CommitMode;
  /** This object's own dotted path from the form's value root (`''` at the form's own top level, or `root`'s name when `SchemaForm.root` is set) — each child appends its key. */
  path: string;
}) {
  const { resettable } = useContext(FormOptions);
  // A dict entry can point at a uid that isn't in the graph's `refs` (a
  // dangling reference from a truncated or hand-edited schema) — rebuilding
  // then leaves that entry `undefined` rather than dropping the key. Reading
  // it as a live SchemaNode further down (`label()` etc.) would throw, so
  // filter those out here and render every entry that actually resolved.
  const fields = Object.entries(node.dict ?? {}).filter(
    (entry): entry is [string, SchemaNode] => entry[1] != null,
  );
  return (
    <>
      {fields.map(([key, child]) => {
        const id = `${idPrefix}-${key}`;
        const childPath = path ? `${path}.${key}` : key;
        const isGroup =
          (child.type === 'object' && child.dict) ||
          child.type === 'dict' ||
          child.type === 'array';
        // `resettable`'s "set" is `Object.hasOwn`, not "not undefined" — a
        // row's `config` holds only what the patch actually set, and an
        // explicit `null`/`0`/`false` is still a decision worth marking.
        const isSet = resettable && Object.hasOwn(value, key);
        const note = isSet ? defaultNote(child, value[key]) : undefined;
        const hintText = [hint(child), note].filter((s): s is string => Boolean(s)).join(' · ');
        const described = hintText ? `${id}-hint` : undefined;
        const theHint = described ? (
          <p className="e8-field-hint" id={described}>
            {hintText}
          </p>
        ) : null;
        const marker = isSet ? (
          <span className="e8-field-set" aria-label="set in the patch">
            ●
          </span>
        ) : null;
        // A leaf resets ITSELF out of its parent's value; a group resets
        // the whole section the same way — both are "drop this key from
        // the object one level up", the group's legend just says so.
        const resetButton = isSet ? (
          <button
            type="button"
            className="e8-field-reset"
            aria-label={isGroup ? `reset section ${key}` : `reset ${key}`}
            onClick={() => {
              const rest = { ...value };
              delete rest[key];
              onChange(rest);
            }}
          >
            {isGroup ? 'reset section' : 'reset'}
          </button>
        ) : null;
        const control = (
          <Field
            id={id}
            node={child}
            value={value[key]}
            onChange={(next) => onChange({ ...value, [key]: next })}
            commit={commit}
            describedBy={described}
            path={childPath}
          />
        );
        // A nested object, a dict or an array is a group of its own fields,
        // so its name goes on a `<legend>` rather than a `<label for>` —
        // there is no single control for the label to point at. Its hint,
        // for the same reason, renders INSIDE the fieldset right after the
        // legend it explains, rather than after the whole `.e8-field` row.
        return (
          <div className="e8-field" key={key}>
            {isGroup ? (
              <fieldset className="e8-field-group" id={id} aria-describedby={described}>
                <legend title={key}>
                  {label(child, key)}
                  {marker}
                  {resetButton}
                </legend>
                {theHint}
                {control}
              </fieldset>
            ) : (
              <>
                {/* `id={`${id}-label`}` is a second, purely-for-`aria-labelledby`
                    id: `OneOrListField`'s list mode and `LiteralOrValueField`'s
                    string-literal switch have no single control the plain
                    `htmlFor` above can name, so they point their own
                    `role="group"` wrapper at this instead. `title`: a long
                    key truncates (the label's ellipsis) beside the reset
                    button, and this keeps it readable. The marker and
                    reset button share this label-row span (not `.e8-field`
                    directly) so they stay on the label's grid column
                    instead of auto-flowing into the control's. */}
                <span className="e8-field-label-row">
                  <label htmlFor={id} id={`${id}-label`} title={key}>
                    {label(child, key)}
                  </label>
                  {marker}
                  {resetButton}
                </span>
                {control}
              </>
            )}
            {/* This badge reflects what the plugin declared via
                `extra: { applies: 'restart' }` — not a difference in host
                behaviour: the host decides `reload` from the row's `hot`
                and the changed top-level keys (see `runtime-assets.ts`). */}
            {needsRestart(child) ? <span className="e8-badge">restart</span> : null}
            {/* A leaf field's hint renders AFTER the badge (not before): in
                the 3-column `.e8-field` grid the badge is the control's own
                row, and the hint wraps to the row under it (styles.css). */}
            {!isGroup ? theHint : null}
          </div>
        );
      })}
    </>
  );
}

export function Field({
  id,
  node,
  value,
  onChange,
  commit,
  ariaLabel,
  describedBy,
  path,
}: FieldProps) {
  const current = value ?? node.meta?.default;

  // `fieldOverrides` draws a NON-union node whose dotted path matches — a
  // union skips this so `oneOrList`/`literalOrValue` below still draw
  // their switch; the switch's own recursive `Field` call for the value
  // member carries the SAME `path` (see `LiteralOrValueField`), so the
  // override reaches it on the next pass instead of being shut out by
  // the union that wraps it. It gets the RAW `value`, not `current`:
  // applying `node.meta.default` to an unset value is the override's job.
  const { fieldOverrides } = useContext(FormOptions);
  if (node.type !== 'union') {
    const Override = fieldOverrides[path];
    if (Override) {
      return (
        <Override
          id={id}
          node={node}
          value={value}
          onChange={onChange}
          commit={commit}
          ariaLabel={ariaLabel}
          describedBy={describedBy}
          path={path}
        />
      );
    }
  }

  if (node.type === 'object' && node.dict) {
    return (
      <ObjectFields
        idPrefix={id}
        node={node}
        value={(value ?? {}) as Record<string, unknown>}
        onChange={onChange}
        commit={commit}
        path={path}
      />
    );
  }

  if (node.type === 'dict' && node.inner?.type === 'string') {
    return (
      <DictField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        commit={commit}
        path={path}
      />
    );
  }

  if (node.type === 'array' && node.inner) {
    return (
      <ArrayField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        commit={commit}
        path={path}
      />
    );
  }

  if (node.type === 'dict' && node.inner) {
    return (
      <DictObjectField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        commit={commit}
        path={path}
      />
    );
  }

  const options = constants(node);
  if (options) {
    return (
      <select
        id={id}
        aria-describedby={describedBy}
        value={String(current ?? '')}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (oneOrList(node)) {
    return (
      <OneOrListField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        commit={commit}
        describedBy={describedBy}
        path={path}
      />
    );
  }

  const litOrVal = literalOrValue(node);
  if (litOrVal) {
    return (
      <LiteralOrValueField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        commit={commit}
        describedBy={describedBy}
        path={path}
      />
    );
  }

  if (node.type === 'number' && node.meta?.role === 'color') {
    return (
      <ColorField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        describedBy={describedBy}
        path={path}
      />
    );
  }

  // `.role('slider')` needs BOTH bounds to draw a range — without one of
  // them there is nothing to set the track's ends from, so it falls through
  // to the plain `NumberField` below instead.
  if (node.type === 'number' && node.meta?.role === 'slider' && node.meta?.min !== undefined && node.meta?.max !== undefined) {
    return (
      <SliderField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        commit={commit}
        describedBy={describedBy}
        path={path}
      />
    );
  }

  if (node.type === 'number') {
    return (
      <NumberField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        commit={commit}
        ariaLabel={ariaLabel}
        describedBy={describedBy}
        path={path}
      />
    );
  }

  if (node.type === 'boolean') {
    return (
      <input
        id={id}
        aria-describedby={describedBy}
        type="checkbox"
        checked={current === true}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
      />
    );
  }

  if (node.type === 'string') {
    return (
      <StringField
        id={id}
        node={node}
        value={value}
        onChange={onChange}
        commit={commit}
        ariaLabel={ariaLabel}
        describedBy={describedBy}
        path={path}
      />
    );
  }

  // Any field kind this form has no editor for (`any`, a union none of the
  // shapes above covers, …). Rendering it editable would let a keystroke
  // silently replace a structured value with a plain string —
  // read-only-and-labelled is the honest gap; a later task can upgrade it
  // to a real editor.
  return <UnsupportedField id={id} node={node} value={current} describedBy={describedBy} />;
}

/**
 * The draft behind a text-like field. Buffers the raw input text in local
 * state instead of deriving it straight from `value`/`node.meta.default`:
 * `Number('')` is `0`, so a naively controlled number input would commit
 * `0` the instant the user selects-all-deletes to type a fresh number, and
 * — because the parent's `value` prop would then equal that committed `0`
 * — the field could never actually show empty.
 *
 * Three facts ride alongside the draft. `committed` — what this field
 * last handed up (or the latest `value` prop, whichever moved last), so a
 * blur followed by Enter before an async `PUT` answer lands is one commit,
 * not two, and a blur commits only what differs from the LATEST prop.
 * `focused` — while the field has focus, an external `value` change
 * (another tab's frame) updates `committed` but does NOT touch the draft:
 * the keystrokes are the user's, and the blur decides. `dirty` — whether
 * the user typed since focusing; a focus-and-blur with no typing commits
 * nothing and re-syncs the draft to the latest prop on the way out.
 */
function useDraft<T>({
  dep,
  current,
  show,
  parse,
  onChange,
  commit,
}: {
  /** The committed prop, for the re-sync effect's dependency (not `current`, which also depends on the default). */
  dep: unknown;
  current: T;
  show: (value: T) => string;
  /** `null` when the draft is not committable (a cleared number, or not parseable yet). */
  parse: (raw: string) => T | null;
  onChange: (next: T) => void;
  commit: CommitMode;
}) {
  const [raw, setRaw] = useState(show(current));
  const committed = useRef(current);
  const focused = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    committed.current = current;
    if (focused.current) return;
    setRaw(show(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);

  const flush = () => {
    if (!dirty.current) return;
    const parsed = parse(raw);
    if (parsed === null || parsed === committed.current) return;
    committed.current = parsed;
    onChange(parsed);
  };

  return {
    raw,
    onFocus: () => {
      focused.current = true;
      dirty.current = false;
    },
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      setRaw(e.target.value);
      dirty.current = true;
      if (commit !== 'change') return;
      const parsed = parse(e.target.value);
      if (parsed !== null) onChange(parsed);
    },
    onBlur: () => {
      focused.current = false;
      if (commit === 'blur') flush();
      if (!dirty.current) setRaw(show(current));
    },
    onKeyDown:
      commit === 'blur'
        ? (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); // cheap insurance against a future `<form>`
            flush();
          }
        : undefined,
  };
}

function NumberField({ id, node, value, onChange, commit, ariaLabel, describedBy }: FieldProps) {
  const draft = useDraft<number | undefined>({
    dep: value,
    current: (value ?? node.meta?.default) as number | undefined,
    show: (v) => (v === undefined ? '' : String(v)),
    parse: (text) => {
      if (text === '') return null;
      const parsed = Number(text);
      return Number.isNaN(parsed) ? null : parsed;
    },
    onChange,
    commit,
  });
  return (
    <input
      id={id}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      type="number"
      value={draft.raw}
      min={node.meta?.min}
      max={node.meta?.max}
      step={node.meta?.step}
      onFocus={draft.onFocus}
      onChange={draft.onChange}
      onBlur={draft.onBlur}
      onKeyDown={draft.onKeyDown}
    />
  );
}

/** `#RRGGBB` for a 0xRRGGBB number, from the file's own formula: mask off
 * anything past 24 bits (`>>> 0`) and re-pad, so a short or negative value
 * still shows six hex digits. */
const hexOf = (n: number) => '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
const HEX_RE = /^#?[0-9a-f]{6}$/i;

/**
 * A `.role('color')` number: a native colour picker plus a hex text field
 * that buffers a draft and commits on blur/Enter — typing `#ff0000` one
 * keystroke at a time must not write five half-finished numbers. An
 * unparsable draft is left showing (never silently reverted) and flagged
 * `aria-invalid`, matching `useDraft`'s "refuse, don't corrupt" contract
 * for every other field.
 *
 * The picker is the same rule at a different pace: React's `onChange` on
 * `type=color` is the `input` event, one per step while the user drags, so
 * it only moves a local `preview`; the NATIVE `change` event (the picker
 * settled on a colour — attached through the ref, React has no prop for
 * it) or a blur commits it once.
 *
 * With no value and no default there is no colour to show: the hex reads
 * empty (placeholder `built-in` — the row falls back to its own), and the
 * swatch — a colour input always holds SOME colour — is marked
 * `data-unset` rather than passed off as black. The hex is named by the
 * field's own key (`idle hex`), not a bare "hex" repeated per colour.
 */
function ColorField({
  id,
  node,
  value,
  onChange,
  describedBy,
  path,
}: Omit<FieldProps, 'commit' | 'ariaLabel'>) {
  const shown = value ?? node.meta?.default;
  const current = shown === undefined ? undefined : ((Number(shown) >>> 0) as number);
  const draft = useDraft<number | undefined>({
    dep: value,
    current,
    show: (v) => (v === undefined ? '' : hexOf(v)),
    parse: (raw) => (HEX_RE.test(raw) ? parseInt(raw.replace('#', ''), 16) : null),
    onChange,
    commit: 'blur',
  });

  const swatch = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  /** The picker moved since the last commit — a focus-and-blur alone writes nothing. */
  const moved = useRef(false);
  /** What was last handed up (or the latest prop): a blur right after `change` must not send it twice. */
  const sent = useRef(current);
  useEffect(() => {
    sent.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const settle = useRef(() => {});
  settle.current = () => {
    const el = swatch.current;
    if (!moved.current || !el) return;
    moved.current = false;
    setPreview(null);
    const next = parseInt(el.value.slice(1), 16);
    if (next === sent.current) return;
    sent.current = next;
    onChange(next);
  };
  useEffect(() => {
    const el = swatch.current;
    if (!el) return;
    const onNativeChange = () => {
      moved.current = true;
      settle.current();
    };
    el.addEventListener('change', onNativeChange);
    return () => el.removeEventListener('change', onNativeChange);
  }, []);

  const key = path.split('.').pop();
  return (
    <span className="e8-color">
      <input
        ref={swatch}
        id={id}
        aria-describedby={describedBy}
        type="color"
        data-unset={current === undefined && preview === null ? '' : undefined}
        value={preview ?? (current === undefined ? '#000000' : hexOf(current))}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          moved.current = true;
          setPreview(e.target.value);
        }}
        onBlur={() => settle.current()}
      />
      <input
        type="text"
        aria-label={`${key} hex`}
        aria-describedby={describedBy}
        aria-invalid={draft.raw === '' || HEX_RE.test(draft.raw) ? undefined : 'true'}
        placeholder={current === undefined ? 'built-in' : undefined}
        value={draft.raw}
        onFocus={draft.onFocus}
        onChange={draft.onChange}
        onBlur={draft.onBlur}
        onKeyDown={draft.onKeyDown}
      />
    </span>
  );
}

/**
 * A `.role('slider')` number with both `min`/`max` (`Field` only dispatches
 * here once it has checked both are set): a native range plus a small
 * number box beside it, the way `ColorField` pairs a swatch with a hex
 * text field.
 *
 * The range's own `onChange` prop is React's `input` event — one per pixel
 * while the user drags — so, like the swatch, it only moves a local
 * `preview`; the NATIVE `change` event (attached through the ref, React has
 * no prop for it) or a blur commits it once. UNLIKE `ColorField`'s hex
 * field (hardcoded to `commit: 'blur'` — a hex can't be parsed one
 * keystroke at a time), the number box reuses `NumberField` as-is, so it
 * respects whatever `commit` mode the form was given. Its own `onChange` is
 * wrapped just enough to clamp into `[min, max]` — `NumberField`/`useDraft`
 * have no clamping of their own (a plain bounded number field today just
 * sets the HTML `min`/`max` attributes, which typing does not enforce).
 */
function SliderField({
  id,
  node,
  value,
  onChange,
  commit,
  describedBy,
  path,
}: Omit<FieldProps, 'ariaLabel'>) {
  const min = node.meta!.min!;
  const max = node.meta!.max!;
  const current = (value ?? node.meta?.default) as number | undefined;

  const range = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<number | null>(null);
  /** The range moved since the last commit — a focus-and-blur alone writes nothing. */
  const moved = useRef(false);
  /** What was last handed up (or the latest prop): a blur right after `change` must not send it twice. */
  const sent = useRef(current);
  useEffect(() => {
    sent.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const settle = useRef(() => {});
  settle.current = () => {
    const el = range.current;
    if (!moved.current || !el) return;
    moved.current = false;
    setPreview(null);
    const next = Number(el.value);
    if (next === sent.current) return;
    sent.current = next;
    onChange(next);
  };
  useEffect(() => {
    const el = range.current;
    if (!el) return;
    const onNativeChange = () => {
      moved.current = true;
      settle.current();
    };
    el.addEventListener('change', onNativeChange);
    return () => el.removeEventListener('change', onNativeChange);
  }, []);

  const key = path.split('.').pop();
  const shown = preview ?? current ?? min;
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  return (
    <span className="e8-slider">
      <input
        ref={range}
        id={id}
        aria-describedby={describedBy}
        type="range"
        min={min}
        max={max}
        step={node.meta?.step}
        value={shown}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          moved.current = true;
          setPreview(Number(e.target.value));
        }}
        onBlur={() => settle.current()}
      />
      <NumberField
        id={`${id}-value`}
        node={node}
        value={value}
        onChange={(next) => onChange(clamp(next as number))}
        commit={commit}
        ariaLabel={`${key} value`}
        describedBy={describedBy}
        path={path}
      />
    </span>
  );
}

function StringField({
  id,
  node,
  value,
  onChange,
  commit,
  ariaLabel,
  describedBy,
  path,
}: FieldProps) {
  const current = value ?? node.meta?.default;
  const pickers = useContext(Pickers);
  const { pick, asset } = node.meta ?? {};
  const ids =
    pick !== undefined && pickers[pick]
      ? pickers[pick]()
      : asset && pickers.asset
        ? pickers.asset(asset)
        : undefined;
  if (ids) {
    // The current value stays offered even when it is no longer among the
    // ids (a deleted scene, a file no longer there): the select must show what the document says.
    const text = current === undefined ? '' : String(current);
    const options = ['', ...ids, ...(text && !ids.includes(text) ? [text] : [])];
    return (
      <select
        id={id}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        value={text}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return <TextField {...{ id, node, value, onChange, commit, ariaLabel, describedBy, path }} />;
}

function TextField({ id, node, value, onChange, commit, ariaLabel, describedBy }: FieldProps) {
  const current = value ?? node.meta?.default;
  const draft = useDraft<string>({
    dep: value,
    current: current === undefined ? '' : String(current),
    show: (v) => v,
    parse: (text) => text,
    onChange,
    commit,
  });
  return (
    <input
      id={id}
      type="text"
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      value={draft.raw}
      onFocus={draft.onFocus}
      onChange={draft.onChange}
      onBlur={draft.onBlur}
      onKeyDown={draft.onKeyDown}
    />
  );
}

/**
 * A dict of strings (`mechanics1`'s `stages`): one key → value row per
 * entry, `+` adds an empty row, `×` removes one. Rows are buffered locally
 * — a key typed one character at a time must not commit each prefix as a
 * key of its own — and leaving the dict (focus moves outside it) commits
 * the rows the user touched, minus those whose key is still empty. Only
 * string values; a dict of anything else is `DictObjectField` below.
 *
 * The same focused rule as `useDraft`: while focus is inside the dict, an
 * external `value` change (another tab's frame) leaves the rows alone.
 * A commit is the touched rows MERGED over the LATEST value — each dirty
 * row drops the key it came from (`origin`) and sets its current key —
 * so a sibling another tab changed meanwhile is kept, not overwritten by
 * a stale copy. An untouched focus-and-leave commits nothing and re-syncs.
 * A `commit` of `'change'` is not honoured here: a key is only meaningful
 * whole, so the dict commits on leave in either mode.
 */
interface DictRow {
  key: string;
  value: string;
  /** The key this row came from in the committed value; `null` for a `+` row. */
  origin: string | null;
  /** Touched by the user since the last sync. */
  dirty: boolean;
}

function DictField({ id, node, value, onChange }: FieldProps) {
  const current = (value ?? node.meta?.default ?? {}) as Record<string, string>;
  const toRows = (source: Record<string, string>): DictRow[] =>
    Object.entries(source).map(([key, entry]) => ({
      key,
      value: String(entry ?? ''),
      origin: key,
      dirty: false,
    }));
  const [rows, setRows] = useState(() => toRows(current));
  const container = useRef<HTMLDivElement>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (focused.current) return;
    setRows(toRows(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  /** The dirty rows over the latest value; `null` when that changes nothing. */
  const merge = (from: DictRow[]): Record<string, string> | null => {
    const next = { ...current };
    for (const row of from) {
      if (!row.dirty) continue;
      if (row.origin !== null) delete next[row.origin];
      if (row.key !== '') next[row.key] = row.value;
    }
    return JSON.stringify(next) === JSON.stringify(current) ? null : next;
  };
  const edit = (index: number, patch: Partial<Pick<DictRow, 'key' | 'value'>>) =>
    setRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch, dirty: true } : row)),
    );
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && container.current?.contains(e.relatedTarget)) return;
    focused.current = false;
    const next = merge(rows);
    if (next) onChange(next);
    // Re-sync either way, keeping any `+` row still waiting for a key. After
    // a commit the baseline is what was just sent — the caller's `value`
    // may not have round-tripped yet (a PUT is async), and a no-op
    // focus/blur before it does must not re-send the same delta; with no
    // commit, the rows may be stale against a change that landed while
    // focused.
    setRows([
      ...toRows(next ?? current),
      ...rows.filter((row) => row.origin === null && row.key === ''),
    ]);
  };

  return (
    <div
      className="e8-dict"
      ref={container}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={leave}
    >
      {rows.map((row, index) => (
        <div className="e8-dict-row" key={index}>
          <input
            type="text"
            data-dict="key"
            aria-label="key"
            value={row.key}
            onChange={(e: ChangeEvent<HTMLInputElement>) => edit(index, { key: e.target.value })}
          />
          <span className="e8-dict-arrow">→</span>
          <input
            type="text"
            data-dict="value"
            aria-label="value"
            value={row.value}
            onChange={(e: ChangeEvent<HTMLInputElement>) => edit(index, { value: e.target.value })}
          />
          <button
            type="button"
            aria-label="×"
            title="remove"
            onClick={() => {
              const removed = rows[index];
              setRows(rows.filter((_, i) => i !== index));
              if (removed.origin === null) return; // never committed — nothing to remove
              const next = { ...current };
              delete next[removed.origin];
              onChange(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label="+"
        title="add"
        onClick={() =>
          setRows((prev) => [...prev, { key: '', value: '', origin: null, dirty: false }])
        }
      >
        +
      </button>
    </div>
  );
}

/**
 * What a fresh item of `node` starts as: for an object, its children's
 * declared defaults (a required child with none stays absent — the user
 * fills it in); for a primitive, its own default, else an empty string.
 */
function defaults(node: SchemaNode): unknown {
  if (node.type === 'object' && node.dict) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node.dict)) {
      if (child?.meta?.default !== undefined) out[key] = child.meta.default;
    }
    return out;
  }
  if (node.type === 'array') return node.meta?.default ?? [];
  return node.meta?.default ?? '';
}

/**
 * An array (a row's `layers: array(object{id,z})`, a scene's `layers:
 * array(string)`): one row per item, each a nested `Field` of the item
 * schema — so an object item shows its children's labels — with up/down/
 * remove, and `add` after the rows. Structural changes commit at once with
 * the whole array; an edit inside a row goes through the inner field,
 * which already buffers under `commit: 'blur'` and keeps its draft across
 * an external change while focused. The rows render from `value`, but
 * every commit builds on `latest` — what this field last handed up, or
 * the latest prop, whichever moved last: a structural click right after
 * typing blurs the input first (its flush is one commit) and the click is
 * a second, and the host's `value` only moves when the PUT lands, so the
 * second must not be built from the prop or it drops the first.
 */
function ArrayField({ id, node, value, onChange, commit, path }: FieldProps) {
  const items = (value ?? node.meta?.default ?? []) as unknown[];
  const inner = node.inner!;
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const send = (next: unknown[]) => {
    latest.current = next;
    onChange(next);
  };
  const swap = (a: number, b: number) => {
    const next = [...latest.current];
    [next[a], next[b]] = [next[b], next[a]];
    send(next);
  };
  return (
    <div className="e8-array" data-testid={`array-${id}`}>
      {items.map((item, i) => (
        <div className="e8-array-row" data-testid={`array-row-${id}-${i}`} key={i}>
          <Field
            id={`${id}-${i}`}
            node={inner}
            value={item}
            onChange={(next) => send(latest.current.map((it, j) => (j === i ? next : it)))}
            commit={commit}
            ariaLabel={inner.type === 'string' ? `item ${i + 1}` : undefined}
            path={`${path}.${i}`}
          />
          <span className="e8-array-tools">
            <button
              type="button"
              aria-label="up"
              title="up"
              disabled={i === 0}
              onClick={() => swap(i, i - 1)}
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="down"
              title="down"
              disabled={i === items.length - 1}
              onClick={() => swap(i, i + 1)}
            >
              ↓
            </button>
            <button
              type="button"
              aria-label="remove"
              title="remove"
              onClick={() => send(latest.current.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </span>
        </div>
      ))}
      <button
        type="button"
        aria-label="add"
        title="add"
        onClick={() => send([...latest.current, defaults(inner)])}
      >
        +
      </button>
    </div>
  );
}

/** A radiogroup of two named modes, sharing one `name` so the browser
 * enforces mutual exclusion — the piece `OneOrListField` and
 * `LiteralOrValueField` both need. `onSelect` is wired on every option
 * (a no-op for whichever is already checked) so React never sees a
 * `checked` radio with no `onChange` of its own. */
function ModeSwitch({
  id,
  describedBy,
  options,
}: {
  id: string;
  describedBy?: string;
  options: { name: string; checked: boolean; onSelect: () => void }[];
}) {
  return (
    <span role="radiogroup" aria-describedby={describedBy} className="e8-segmented">
      {options.map((option) => (
        <label key={option.name}>
          <input
            type="radio"
            name={`${id}-mode`}
            checked={option.checked}
            onChange={option.onSelect}
          />
          {option.name}
        </label>
      ))}
    </span>
  );
}

/**
 * `colGap: number | number[]` (and `rowGap`, and every other per-axis gap):
 * a scalar or one value per reel-boundary. `one` shows a single number
 * input; `per reel` shows one input per entry plus `+`/`−`. Switching
 * converts in place — `one`'s number becomes `[n]`, a list's first entry
 * becomes the scalar — rather than losing the value the user already set.
 * The switch itself and `+`/`−` are structural (a whole new array, or a
 * whole new scalar) — no draft to buffer, same as `ArrayField`'s own
 * tools. Each NUMBER, though, goes through `Field`/`NumberField` (the
 * union's `number` member for `one`, the array member's `inner` for every
 * entry) so it gets `NumberField`'s own draft: under `commit: 'blur'` (a
 * GAME row) a keystroke is not a `PUT`, and clearing an entry to retype it
 * does not momentarily commit `0`.
 */
function OneOrListField({ id, node, value, onChange, commit, describedBy, path }: FieldProps) {
  const [a, b] = node.list!;
  const [numMember, listMember] = a.type === 'number' ? [a, b] : [b, a];
  const current = value ?? node.meta?.default;
  const list = Array.isArray(current) ? (current as number[]) : null;
  // Unset (no value, no numeric default): the scalar editor shows empty,
  // not a `0` the row does not have, and `per reel` starts from `[]`.
  const single = typeof current === 'number' ? current : undefined;
  // Every write builds on `latest` — what this field last handed up, or the
  // latest prop — never the `value` prop alone: `ArrayField`'s own rule (a
  // click right after typing is a second commit before the PUT lands).
  const latest = useRef(current);
  useEffect(() => {
    latest.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const send = (next: unknown) => {
    latest.current = next;
    onChange(next);
  };
  const latestList = () => (Array.isArray(latest.current) ? (latest.current as number[]) : []);

  if (!list) {
    return (
      <span className="e8-one-or-list">
        <ModeSwitch
          id={id}
          describedBy={describedBy}
          options={[
            { name: 'one', checked: true, onSelect: () => {} },
            {
              name: 'per reel',
              checked: false,
              onSelect: () => send(typeof latest.current === 'number' ? [latest.current] : []),
            },
          ]}
        />
        {/* The scalar IS this field's whole value — same dotted `path` as
            the union above it, so a `fieldOverrides` entry keyed by that
            path reaches it here too. */}
        <Field
          id={id}
          node={numMember}
          value={single}
          onChange={send}
          commit={commit}
          describedBy={describedBy}
          path={path}
        />
      </span>
    );
  }

  return (
    // `role="group"`/`aria-labelledby`: unlike `one` above, nothing in list
    // mode carries the bare `id={id}` the field's own `<label htmlFor>`
    // names — the entries are `${id}-0`, `${id}-1`, … — so this wrapper is
    // what that label actually points at (see `ObjectFields`' `${id}-label`).
    <span
      className="e8-one-or-list"
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
    >
      <ModeSwitch
        id={id}
        describedBy={describedBy}
        options={[
          { name: 'one', checked: false, onSelect: () => send(latestList()[0] ?? 0) },
          { name: 'per reel', checked: true, onSelect: () => {} },
        ]}
      />
      <span className="e8-one-or-list-items">
        {list.map((n, i) => (
          <Field
            key={i}
            id={`${id}-${i}`}
            node={listMember.inner!}
            value={n}
            onChange={(next) => send(latestList().map((v, j) => (j === i ? next : v)))}
            commit={commit}
            ariaLabel={`reel ${i + 1}`}
            describedBy={describedBy}
            path={`${path}.${i}`}
          />
        ))}
        <button
          type="button"
          aria-label="+"
          onClick={() => {
            const items = latestList();
            send([...items, items[items.length - 1] ?? 0]);
          }}
        >
          +
        </button>
        <button
          type="button"
          aria-label="−"
          disabled={list.length === 0}
          onClick={() => send(latestList().slice(0, -1))}
        >
          −
        </button>
      </span>
    </span>
  );
}

/**
 * `topReel: object | null`, anticipation's `reels: 'trailing' | number[]`:
 * a literal (`null`, or a named mode like `'trailing'`) versus a real value.
 * `null` reads as an on/off checkbox — the field's own label names it, same
 * as a plain boolean — with the value's editor appearing once switched on.
 * A string literal reads as a two-way switch, `<literal> | these`, same
 * shape as `OneOrListField` above. Either way switching TO the value writes
 * `defaults(other)`, never an empty shell the value's own `Field` would
 * then have to cope with.
 */
function LiteralOrValueField({ id, node, value, onChange, commit, describedBy, path }: FieldProps) {
  const [a, b] = node.list!;
  const [literal, other] = a.type === 'const' ? [a, b] : [b, a];
  const current = value ?? node.meta?.default;

  if (literal.value === null) {
    const on = current !== null && current !== undefined;
    return (
      <span className="e8-literal-or-value">
        <input
          id={id}
          type="checkbox"
          aria-describedby={describedBy}
          checked={on}
          onChange={(e) => onChange(e.target.checked ? defaults(other) : null)}
        />
        {/* Same `path` as the union above — the value member IS this
            field, just switched on; see `Field`'s override comment. */}
        {on ? (
          <Field
            id={`${id}-value`}
            node={other}
            value={current}
            onChange={onChange}
            commit={commit}
            path={path}
          />
        ) : null}
      </span>
    );
  }

  const literalValue = literal.value as string;
  const on = current === literalValue;
  return (
    // Same `role="group"` reasoning as `OneOrListField`'s list mode: neither
    // radio here carries the bare `id={id}` — the field's own label points
    // at this wrapper instead (`${id}-label`, from `ObjectFields`).
    <span
      className="e8-literal-or-value"
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={describedBy}
    >
      <ModeSwitch
        id={id}
        describedBy={describedBy}
        options={[
          { name: literalValue, checked: on, onSelect: () => onChange(literalValue) },
          { name: 'these', checked: !on, onSelect: () => onChange(defaults(other)) },
        ]}
      />
      {!on ? (
        <Field
          id={`${id}-value`}
          node={other}
          value={current}
          onChange={onChange}
          commit={commit}
          path={path}
        />
      ) : null}
    </span>
  );
}

/**
 * A dict whose values are not plain strings (a row's `scenes:
 * dict(object{…})`): a `key` input plus a nested `Field` of the value
 * schema per entry. Only the KEY is buffered here — typed one character at
 * a time, it must not commit each prefix as an entry of its own — and it
 * lands when its input blurs, renaming the entry (the old key dropped).
 * Value edits go straight through as the whole dict with that entry
 * replaced; the inner fields buffer themselves under `commit: 'blur'`.
 * `add` appends a row with an empty key and the inner defaults, not an
 * entry until the key is non-empty on blur; `remove` commits at once.
 *
 * Same focused rule as `DictField`: while focus is inside, an external
 * `value` change leaves the rows alone; leaving re-syncs to `baseline`.
 * Every commit builds on `baseline` too — the last commit, or the latest
 * prop, whichever moved last — never on the `value` prop: the host's
 * value only moves when a PUT lands, and two commits in a row (a key
 * blur then a click, or two keys typed back to back) must stack, not
 * have the second drop the first.
 */
interface DictObjectRow {
  key: string;
  value: unknown;
  origin: string | null;
  /** The key was edited since the last sync. */
  dirty: boolean;
}

function DictObjectField({ id, node, value, onChange, commit, path }: FieldProps) {
  const current = (value ?? node.meta?.default ?? {}) as Record<string, unknown>;
  const inner = node.inner!;
  const toRows = (source: Record<string, unknown>): DictObjectRow[] =>
    Object.entries(source).map(([key, entry]) => ({
      key,
      value: entry,
      origin: key,
      dirty: false,
    }));
  const pending = (from: DictObjectRow[]) =>
    from.filter((row) => row.origin === null && row.key === '');
  const [rows, setRows] = useState(() => toRows(current));
  const container = useRef<HTMLDivElement>(null);
  const focused = useRef(false);
  const baseline = useRef(current);

  useEffect(() => {
    baseline.current = current;
    if (focused.current) return;
    setRows(toRows(current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commitRows = (next: Record<string, unknown>) => {
    baseline.current = next;
    onChange(next);
  };
  const patch = (index: number, changes: Partial<DictObjectRow>) =>
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  const editValue = (index: number, next: unknown) => {
    patch(index, { value: next });
    const row = rows[index];
    if (row.origin !== null) commitRows({ ...baseline.current, [row.origin]: next });
  };
  const leaveKey = (index: number) => {
    const row = rows[index];
    if (!row.dirty) return;
    const base = baseline.current;
    const next = { ...base };
    if (row.origin !== null) delete next[row.origin];
    if (row.key !== '') next[row.key] = row.value;
    if (JSON.stringify(next) !== JSON.stringify(base)) commitRows(next);
    setRows([...toRows(next), ...pending(rows)]);
  };
  const leave = (e: FocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && container.current?.contains(e.relatedTarget)) return;
    focused.current = false;
    setRows((prev) => [...toRows(baseline.current), ...pending(prev)]);
  };

  return (
    <div
      className="e8-dict"
      ref={container}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={leave}
    >
      {rows.map((row, index) => (
        <div className="e8-array-row" key={index}>
          <input
            type="text"
            data-dict="key"
            aria-label="key"
            value={row.key}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              patch(index, { key: e.target.value, dirty: true })
            }
            onBlur={() => leaveKey(index)}
          />
          <Field
            id={`${id}-${index}`}
            node={inner}
            value={row.value}
            onChange={(next) => editValue(index, next)}
            commit={commit}
            path={`${path}.${row.key}`}
          />
          <button
            type="button"
            aria-label="remove"
            title="remove"
            onClick={() => {
              setRows(rows.filter((_, i) => i !== index));
              if (row.origin === null) return; // never committed — nothing to remove
              const next = { ...baseline.current };
              delete next[row.origin];
              commitRows(next);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label="add"
        title="add"
        onClick={() =>
          setRows((prev) => [
            ...prev,
            { key: '', value: defaults(inner), origin: null, dirty: false },
          ])
        }
      >
        +
      </button>
    </div>
  );
}

/** Read-only stand-in for a field kind the form does not know how to edit. */
function UnsupportedField({
  id,
  node,
  value,
  describedBy,
}: {
  id: string;
  node: SchemaNode;
  value: unknown;
  describedBy?: string;
}) {
  const display =
    value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return (
    <span className="e8-unsupported">
      <input
        id={id}
        aria-describedby={describedBy}
        type="text"
        value={display}
        readOnly
        aria-readonly="true"
      />
      <em className="e8-unsupported-note"> unsupported ({node.type})</em>
    </span>
  );
}
