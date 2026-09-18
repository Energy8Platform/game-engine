import { useState, type KeyboardEvent } from 'react';
import type { Context } from 'cordis';
import type { FlowDoc, FlowKindInfo, FlowNode } from '@energy8engine/contracts';
import { useFlow } from '../plugins/flow';
import { SchemaForm } from '../schema-form/SchemaForm';
import { renameNode } from './flow-graph';
import { useAssetPicker } from './PropertiesSidebar';

/**
 * The right-hand inspector over `ctx.flow.selected()` — `PropertiesSidebar`
 * for a flow node: its id (an input — Enter or blur renames it and the
 * edges follow; a duplicate or empty id is refused inline), its kind, then
 * a `SchemaForm` over the kind's schema. A `scene` field (`meta.pick ===
 * 'scene'`) picks from `ctx.scenes.docs()`; an `asset` field from the
 * project's files (`useAssetPicker`). Holds no draft of the document:
 * every edit is one `ctx.flow.update(next)`.
 */
export function FlowProperties({ ctx }: { ctx: Context }) {
  const { doc, kinds, selected } = useFlow(ctx);
  const node = selected === null ? undefined : doc?.nodes.find((n) => n.id === selected);
  return (
    <div className="e8-explorer e8-properties" data-testid="flow-properties">
      {doc && node ? (
        <NodeProperties
          key={node.id}
          ctx={ctx}
          doc={doc}
          node={node}
          info={kinds.find((k) => k.kind === node.kind)}
        />
      ) : null}
    </div>
  );
}

function NodeProperties({
  ctx,
  doc,
  node,
  info,
}: {
  ctx: Context;
  doc: FlowDoc;
  node: FlowNode;
  info: FlowKindInfo | undefined;
}) {
  const [draft, setDraft] = useState(node.id);
  const [idError, setIdError] = useState<string | null>(null);
  // The host's refusal of the last props edit — cleared by the next one that lands.
  const [error, setError] = useState<string | null>(null);
  const asset = useAssetPicker(ctx);

  const rename = () => {
    const next = draft.trim();
    if (next === node.id) return setIdError(null);
    if (!next) return setIdError('type a node id');
    if (doc.nodes.some((n) => n.id === next))
      return setIdError(`"${next}" is already a node in this flow`);
    setIdError(null);
    void ctx.flow.update(renameNode(doc, node.id, next)).then((refused) => {
      if (refused.length) setIdError(refused[0].message);
      else ctx.flow.select(next);
    });
  };

  const onChange = (props: Record<string, unknown>) =>
    void ctx.flow
      .update({ ...doc, nodes: doc.nodes.map((n) => (n.id === node.id ? { ...n, props } : n)) })
      .then((refused) => setError(refused[0]?.message ?? null));

  return (
    <>
      <div className="e8-explorer-header">
        <input
          className="e8-explorer-input"
          data-testid="prop-id"
          aria-label="node id"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={rename}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && rename()}
        />
        <span className="e8-explorer-title" data-testid="prop-kind">
          {node.kind}
        </span>
      </div>
      {idError !== null ? (
        <p className="e8-explorer-diagnostic" data-testid="prop-id-error">
          {idError}
        </p>
      ) : null}
      {!info ? (
        <p className="e8-explorer-diagnostic" data-testid="prop-error">
          kind "{node.kind}" is not registered
        </p>
      ) : error !== null ? (
        <p className="e8-explorer-diagnostic" data-testid="prop-error">
          {error}
        </p>
      ) : null}
      {info ? (
        <div className="e8-properties-body">
          <SchemaForm
            rowId={`flow.${node.id}`}
            schema={info.schema}
            value={node.props ?? {}}
            onChange={onChange}
            commit="blur"
            pickers={{ scene: () => ctx.scenes.docs().map((d) => d.id), asset }}
          />
        </div>
      ) : null}
    </>
  );
}
