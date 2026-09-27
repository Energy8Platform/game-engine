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
 * of one survives — both forms are handed the state's WHOLE `props` as
 * their `value` and write back `{ ...props, ...next }`, so a key neither
 * form shows rides along untouched. A state the def has not got yet is
 * one `Create <state>` button (Adjust does not render either, then); a
 * named state (never a built-in) also gets a `Remove state` button that
 * drops it from `def.states`. Changing the type keeps the props the new
 * schema also has — its own keys plus every common key, not just
 * Adjust's six. Holds no draft of the document: every edit is a reducer
 * through `ctx.symbols.update`, queued behind whatever write (here or in
 * `SymbolsDocument`) is already in flight — two blur-commits close
 * together each reduce the doc as it stands at THEIR turn, not the one
 * read when the field was blurred, so the second never overwrites the
 * first's change.
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

/** `Schema.object` over just `ADJUST_KEYS` of `COMMON` — what the `Adjust` section's form draws. Built once: `COMMON_JSON` never changes at runtime. */
const ADJUST_SCHEMA: unknown = (() => {
  const common = new Schema(COMMON_JSON as never) as unknown as { dict: Record<string, unknown> };
  return JSON.parse(
    JSON.stringify(
      Schema.object(Object.fromEntries(ADJUST_KEYS.map((k) => [k, common.dict[k]])) as never),
    ),
  );
})();

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
  // emits `{ ...value, [key]: … }` — already carries every prop neither
  // form shows. The extra spread over `props` is belt and braces: whichever
  // of the two forms' `value` this closure captured, the write never drops
  // what the OTHER form (or a hidden YAML key) put there.
  const writeProps = (props: Record<string, unknown>) => (next: Record<string, unknown>) =>
    write((d) => setState(d, def.id, state, { type: current!.type, props: { ...props, ...next } }));

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
              schema={ADJUST_SCHEMA}
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
