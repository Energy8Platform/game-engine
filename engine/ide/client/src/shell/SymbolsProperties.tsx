import { useMemo, useState } from 'react';
import type { Context } from 'cordis';
import Schema from 'schemastery';
import type { NodeTypeInfo, SymbolDef, SymbolState, SymbolsDoc } from '@energy8engine/contracts';
import { useScenes } from '../plugins/scenes';
import { useSymbols } from '../plugins/symbols';
import { SchemaForm } from '../schema-form/SchemaForm';
import { mergedSchema, useAssetPicker, useNodePicker } from './PropertiesSidebar';
import { EMPTY, setState, setStateType, setSymbol } from './symbols-doc';

/**
 * The right-hand inspector over `ctx.symbols.selected()`: the symbol's
 * `name` (blur commits) and `fit`, then the selected state — a `type`
 * select over the node types the game reported with `accept` (`image`
 * first) and a `SchemaForm` over that type's schema merged with the
 * common props (the state's wrapper applies them, so a symbol can be
 * nudged without new art). A state the def has not got yet is one
 * `Create <state>` button. Changing the type keeps the props the new
 * schema also has. Holds no draft of the document: every edit reduces
 * `ctx.symbols.doc()` as it stands and is one `ctx.symbols.update`.
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
    void ctx.symbols
      .update(reduce(ctx.symbols.doc() ?? EMPTY))
      .then((refused) => setError(refused[0]?.message ?? null));

  const current = def[state];
  const info = current ? nodeTypes.find((t) => t.type === current.type) : undefined;
  const schema = useMemo(() => mergedSchema(info), [info]);
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

  return (
    <>
      <div className="e8-explorer-header">
        <input
          className="e8-explorer-input"
          data-testid="prop-symbol-name"
          aria-label="symbol name"
          placeholder="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && commitName()}
        />
        <span className="e8-explorer-title">{def.id}</span>
      </div>
      {error !== null ? (
        <p className="e8-explorer-diagnostic" data-testid="prop-error">
          {error}
        </p>
      ) : null}
      <div className="e8-properties-body">
        <div className="e8-field">
          <label htmlFor="prop-symbol-fit">fit</label>
          <select
            id="prop-symbol-fit"
            data-testid="prop-symbol-fit"
            value={def.fit ?? 'contain'}
            onChange={(e) =>
              write((d) => setSymbol(d, def.id, { fit: e.target.value as 'contain' | 'none' }))
            }
          >
            <option value="contain">contain</option>
            <option value="none">none</option>
          </select>
        </div>
      </div>
      <div className="e8-explorer-header">
        <span className="e8-explorer-title">{state}</span>
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
      </div>
      <div className="e8-properties-body">
        {current ? (
          <SchemaForm
            rowId={`symbol.${def.id}.${state}`}
            schema={schema}
            value={current.props}
            onChange={(props) =>
              write((d) => setState(d, def.id, state, { type: current.type, props }))
            }
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
    </>
  );
}
