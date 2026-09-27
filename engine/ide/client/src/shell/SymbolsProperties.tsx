import { useMemo, useState } from 'react';
import type { Context } from 'cordis';
import Schema from 'schemastery';
import {
  BUILTIN_STATES,
  stateNode,
  type NodeTypeInfo,
  type SymbolDef,
  type SymbolState,
  type SymbolsDoc,
} from '@energy8engine/contracts';
import { useScenes } from '../plugins/scenes';
import { useSymbols } from '../plugins/symbols';
import { SchemaForm } from '../schema-form/SchemaForm';
import { COMMON_JSON, mergedSchema, useAssetPicker, useNodePicker } from './PropertiesSidebar';
import { removeState, setState, setStateType, setSymbol } from './symbols-doc';

/**
 * The right-hand inspector over `ctx.symbols.selected()`, in three groups.
 * `Symbol` — the def's read-only `id`, its `name` (blur commits) and
 * `fit` (with a hint: what each of the two values does). `State <state>`
 * — a `type` select over the node types the game reported with `accept`
 * (`image` first) and a `SchemaForm` over just that type's OWN schema, no
 * common prop (those mean nothing for a symbol and belong to Adjust
 * instead). `Adjust` — a `SchemaForm` over `COMMON` restricted to the six
 * props a symbol may actually be nudged by (`x`, `y`, `scale`, `rotation`,
 * `alpha`, `tint`); the rest of `COMMON` (`width`, `height`, `visible`,
 * `anchor*`, `mask`, `pin`) is drawn nowhere, but a YAML author's own use
 * of one survives. A type whose OWN schema declares one of Adjust's six
 * names (an own `scale`, say) draws it once, in State — Adjust leaves
 * that key out rather than offering a second, colliding field for it.
 * A state the def has not got yet is one `Create <state>` button (Adjust
 * does not render either, then); a named state (never a built-in) also
 * gets a `Remove state` button that drops it from `def.states`. Changing
 * the type keeps the props the new schema also has — its own keys plus
 * every common key, not just Adjust's six.
 *
 * Holds no draft of the document: every edit is a reducer through
 * `ctx.symbols.update`, queued behind whatever write (here or in
 * `SymbolsDocument`) is already in flight. The real guarantee that makes
 * two close-together edits safe is narrower than "the whole props object
 * rides along": State's and Adjust's forms are two SEPARATE `SchemaForm`s,
 * each handed the WHOLE `current.props` as `value`, so BOTH still show the
 * SAME pre-edit snapshot if a user edits one, then the other, before
 * either write's PUT has round-tripped and re-rendered this component. A
 * write must therefore never apply the WHOLE `next` object onto whatever
 * `d` (the reducer's own argument) holds — `next` is `{ ...value, [key]:
 * … }`, built from that stale snapshot, and would silently roll the other
 * form's already-landed edit back to its pre-edit value. Instead each
 * write diffs `next` against the `props` its form was rendered with (the
 * SAME stale snapshot) to get just the one changed key, looks up the
 * state's LIVE props on `d` — fresh at THIS reducer's own turn in the
 * queue, so it already reflects whatever the sibling write's reducer
 * landed first — and merges only that delta onto it. A state or def gone
 * by its turn (removed, or the whole symbol deleted, while the write
 * waited in the queue) makes it a no-op.
 */
export function SymbolsProperties({ ctx }: { ctx: Context }) {
  const { doc, selected } = useSymbols(ctx);
  const { nodeTypes } = useScenes(ctx);
  const def = selected ? doc?.symbols.find((s) => s.id === selected.id) : undefined;
  return (
    <div className="e8-explorer e8-properties" data-testid="side-right-symbols">
      {def && selected ? (
        <Body
          key={`${def.id}.${selected.state}`}
          ctx={ctx}
          def={def}
          state={selected.state}
          nodeTypes={nodeTypes}
        />
      ) : null}
    </div>
  );
}

/** The field names of a schema JSON — what a type change keeps of the old props. */
function keysOf(schema: unknown): string[] {
  try {
    const s = new Schema(schema as never) as unknown as { dict?: Record<string, unknown> };
    return Object.keys(s.dict ?? {});
  } catch {
    return [];
  }
}

/** The type's OWN schema alone, no common prop — what the `State` section's form draws. `null` when malformed, same as `mergedSchema`. */
function ownSchema(info: NodeTypeInfo | undefined): unknown {
  try {
    const own = new Schema((info?.schema ?? {}) as never) as unknown as { dict?: object };
    return JSON.parse(JSON.stringify(Schema.object((own.dict ?? {}) as never)));
  } catch {
    return null;
  }
}

/** The six common props a symbol may be nudged by — everything else in `COMMON` means nothing for a symbol. */
const ADJUST_KEYS = ['x', 'y', 'scale', 'rotation', 'alpha', 'tint'] as const;

/**
 * `COMMON` restricted to `ADJUST_KEYS`, minus whichever of those the
 * type's OWN schema already declares (`ownKeys` — `keysOf(own)`): a type
 * with its own `scale`, say, draws it once, in `State` — `Adjust` leaves
 * that key out rather than offering a second, colliding `scale` field.
 */
function adjustSchema(ownKeys: readonly string[]): unknown {
  const common = new Schema(COMMON_JSON as never) as unknown as { dict: Record<string, unknown> };
  const keys = ADJUST_KEYS.filter((k) => !ownKeys.includes(k));
  return JSON.parse(
    JSON.stringify(
      Schema.object(Object.fromEntries(keys.map((k) => [k, common.dict[k]])) as never),
    ),
  );
}

/** The keys of `after` that differ from `before` — what one form's `onChange` actually moved. */
function changedKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(after).filter(([k, v]) => !Object.is(before[k], v)));
}

function Body({
  ctx,
  def,
  state,
  nodeTypes,
}: {
  ctx: Context;
  def: SymbolDef;
  state: SymbolState;
  nodeTypes: readonly NodeTypeInfo[];
}) {
  const [name, setName] = useState(def.name ?? '');
  // The host's refusal of the last edit — cleared by the next one that lands.
  const [error, setError] = useState<string | null>(null);
  const asset = useAssetPicker(ctx);
  const node = useNodePicker(ctx);
  const write = (reduce: (doc: SymbolsDoc) => SymbolsDoc) =>
    void ctx.symbols.update(reduce).then((refused) => setError(refused[0]?.message ?? null));

  const current = stateNode(def, state);
  const named = !(BUILTIN_STATES as readonly string[]).includes(state);
  const info = current ? nodeTypes.find((t) => t.type === current.type) : undefined;
  const own = useMemo(() => ownSchema(info), [info]);
  const adjust = useMemo(() => adjustSchema(keysOf(own)), [own]);
  // The types a state can be: those that take a file, `image` first; the doc's own type stays offered.
  const types = nodeTypes
    .filter((t) => t.accept)
    .map((t) => t.type)
    .sort((a, b) => Number(b === 'image') - Number(a === 'image'));
  if (current && !types.includes(current.type)) types.push(current.type);

  const commitName = () => {
    const next = name.trim();
    if (next !== (def.name ?? '')) write((d) => setSymbol(d, def.id, { name: next }));
  };

  // Both forms below draw a SUBSET of `current.props` (own-only / adjust-only)
  // but are handed the WHOLE object as `value`, so `next` — `ObjectFields`
  // emits `{ ...value, [key]: … }` — carries every prop neither form shows,
  // but at the STALE value the form was rendered with. Applying `next`
  // wholesale would stomp whatever a write still in flight from the SAME
  // render (the sibling form, or this one's own previous edit) already
  // landed on the live props by the time this one reaches its turn in
  // `ctx.symbols.update`'s queue — so this keeps only the keys the edit
  // itself actually moved (`next` vs `props`, the value the form was
  // rendered with) and applies THAT delta onto the state's LIVE props,
  // read from the reducer's own `d` at its turn, never from this closure's
  // render-time snapshot. A def or state gone by then (removed, or the
  // whole symbol deleted, while this write waited its turn) makes it a
  // no-op — `d` comes back unchanged, so `ctx.symbols.update` skips the PUT.
  const writeProps = (props: Record<string, unknown>) => (next: Record<string, unknown>) => {
    const delta = changedKeys(props, next);
    write((d) => {
      const liveDef = d.symbols.find((s) => s.id === def.id);
      const live = liveDef && stateNode(liveDef, state);
      if (!live) return d;
      return setState(d, def.id, state, { type: live.type, props: { ...live.props, ...delta } });
    });
  };

  return (
    <>
      <section data-testid="symbol-props-symbol">
        <div className="e8-explorer-header">
          <span className="e8-explorer-title">Symbol</span>
        </div>
        {error !== null ? (
          <p className="e8-explorer-diagnostic" data-testid="prop-error">
            {error}
          </p>
        ) : null}
        <div className="e8-properties-body">
          <div className="e8-field">
            <label htmlFor="prop-symbol-id">id</label>
            <input
              id="prop-symbol-id"
              data-testid="prop-symbol-id"
              value={def.id}
              readOnly
              aria-readonly="true"
            />
          </div>
          <div className="e8-field">
            <label htmlFor="prop-symbol-name">name</label>
            <input
              id="prop-symbol-name"
              className="e8-explorer-input"
              data-testid="prop-symbol-name"
              placeholder="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && commitName()}
            />
          </div>
          <div className="e8-field">
            <label htmlFor="prop-symbol-fit">fit</label>
            <select
              id="prop-symbol-fit"
              data-testid="prop-symbol-fit"
              aria-describedby="prop-symbol-fit-hint"
              value={def.fit ?? 'contain'}
              onChange={(e) => {
                // Captured now, not read inside the reducer: the reducer runs
                // later, its turn in `ctx.symbols.update`'s queue, and by then
                // a re-render may have reset this controlled select back to
                // `def.fit` — `e.target` would no longer say what was picked.
                const fit = e.target.value as 'contain' | 'none';
                write((d) => setSymbol(d, def.id, { fit }));
              }}
            >
              <option value="contain">contain</option>
              <option value="none">none</option>
            </select>
            <p className="e8-field-hint" id="prop-symbol-fit-hint">
              contain: scaled into the cell · none: centred at its own size
            </p>
          </div>
        </div>
      </section>

      <section data-testid="symbol-props-state">
        <div className="e8-explorer-header">
          <span className="e8-explorer-title">State {state}</span>
          {current ? (
            <select
              data-testid="prop-state-type"
              aria-label="state type"
              value={current.type}
              onChange={(e) => {
                const type = e.target.value;
                const keep = keysOf(mergedSchema(nodeTypes.find((t) => t.type === type)));
                write((d) => setStateType(d, def.id, state, type, keep));
              }}
            >
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : null}
          {named ? (
            <button
              type="button"
              data-testid="prop-state-remove"
              onClick={() => write((d) => removeState(d, def.id, state))}
            >
              Remove state
            </button>
          ) : null}
        </div>
        <div className="e8-properties-body">
          {current ? (
            <SchemaForm
              rowId={`symbol.${def.id}.${state}.own`}
              schema={own}
              value={current.props}
              onChange={writeProps(current.props)}
              commit="blur"
              pickers={{ asset, scene: () => ctx.scenes.docs().map((d) => d.id), node }}
            />
          ) : (
            <button
              type="button"
              className="e8-primary"
              data-testid="prop-state-create"
              onClick={() =>
                write((d) => setState(d, def.id, state, { type: 'image', props: { src: '' } }))
              }
            >
              Create {state}
            </button>
          )}
        </div>
      </section>

      {current ? (
        <section data-testid="symbol-props-adjust">
          <div className="e8-explorer-header">
            <span className="e8-explorer-title">Adjust</span>
          </div>
          <div className="e8-properties-body">
            <SchemaForm
              rowId={`symbol.${def.id}.${state}.adjust`}
              schema={adjust}
              value={current.props}
              onChange={writeProps(current.props)}
              commit="blur"
            />
          </div>
        </section>
      ) : null}
    </>
  );
}
