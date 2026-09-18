import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Context } from 'cordis';
import Schema from 'schemastery';
import type { FileEntry, NodeTypeInfo, SceneDoc, SceneNode } from '@energy8engine/contracts';
import { COMMON } from '@energy8engine/scenes/common-schema';
import { extOf } from '../plugins/asset-node-types';
import { useScenes } from '../plugins/scenes';
import { SchemaForm } from '../schema-form/SchemaForm';
import { map, walk } from './SceneDocument';

/**
 * The right-hand inspector over `ctx.scenes.selected()`. A node: its id
 * (an input — Enter or blur renames it, a duplicate or empty id is
 * refused inline), its type, then a `SchemaForm` over the common props
 * merged with the type's own schema. A scene with no node: its id, the
 * node count and the images it draws, through nested scenes. Holds no
 * draft of the document: every edit is one `ctx.scenes.update(next)`.
 *
 * A string field with `meta.asset` (`.extra('asset', ['png'])`) is a
 * select of the project's files with those extensions — `useAssetPicker`,
 * shared with `FlowProperties`.
 */

/**
 * `SchemaForm.pickers.asset`: the project's file paths by extension, from
 * a tree read on mount and again whenever the scene set changes (a File
 * dropped on the canvas lands as a write, then a scene update; a
 * selection alone is not a change). Whoever else adds a file (the
 * Explorer) is seen on the next mount.
 */
export function useAssetPicker(ctx: Context): (exts?: unknown) => string[] {
  const [entries, setEntries] = useState<readonly FileEntry[]>([]);
  useEffect(() => {
    let live = true;
    const load = () => void ctx.files.tree().then((t) => live && setEntries(t.entries));
    load();
    let docs = ctx.scenes.docs();
    const off = ctx.scenes.subscribe(() => {
      if (ctx.scenes.docs() === docs) return;
      docs = ctx.scenes.docs();
      load();
    });
    return () => {
      live = false;
      off();
    };
  }, [ctx]);
  return (exts) => {
    const want = Array.isArray(exts) ? exts.map(String) : [];
    return entries
      .filter((e) => e.kind === 'file' && want.includes(extOf(e.path) ?? ''))
      .map((e) => e.path);
  };
}

const COMMON_JSON = JSON.parse(JSON.stringify(COMMON)) as unknown;

/** `Schema.object({ ...COMMON.dict, ...own.dict })`, as JSON `SchemaForm` rebuilds; `null` when the type's schema is malformed. */
function mergedSchema(info: NodeTypeInfo | undefined): unknown {
  try {
    const common = new Schema(COMMON_JSON as never) as unknown as { dict: object };
    const own = new Schema((info?.schema ?? {}) as never) as unknown as { dict?: object };
    return JSON.parse(JSON.stringify(Schema.object({ ...common.dict, ...own.dict } as never)));
  } catch {
    return null;
  }
}

/** The tree with the one node replaced by `f(node)`, its children kept. */
function patch(nodes: readonly SceneNode[], id: string, f: (node: SceneNode) => SceneNode) {
  return map(nodes, (node, children) => [
    node.id === id ? f(node) : node.children ? { ...node, children } : node,
  ]);
}

/** `image.src` values of a scene, through the scenes it nests; deduped, a cycle stops. */
function assetsOf(docs: readonly SceneDoc[], id: string, seen = new Set<string>()): string[] {
  if (seen.has(id)) return [];
  seen.add(id);
  const out: string[] = [];
  for (const { node } of walk(docs.find((d) => d.id === id)?.nodes ?? [])) {
    if (node.type === 'image' && typeof node.props.src === 'string') out.push(node.props.src);
    else if (node.type === 'scene' && typeof node.props.scene === 'string')
      out.push(...assetsOf(docs, node.props.scene, seen));
  }
  return [...new Set(out)];
}

export function PropertiesSidebar({ ctx }: { ctx: Context }) {
  const { docs, nodeTypes, selected } = useScenes(ctx);
  const doc = selected ? docs.find((d) => d.id === selected.scene) : undefined;
  const node =
    doc && selected?.node
      ? [...walk(doc.nodes)].find(({ node }) => node.id === selected.node)?.node
      : undefined;

  return (
    <div className="e8-explorer e8-properties" data-testid="properties">
      {doc && selected && !selected.node ? (
        <>
          <div className="e8-explorer-header">
            <span className="e8-explorer-title" data-testid="prop-scene-id">
              {doc.id}
            </span>
          </div>
          <dl className="e8-properties-body">
            <dt>nodes</dt>
            <dd data-testid="prop-node-count">{[...walk(doc.nodes)].length}</dd>
            <dt>assets</dt>
            <dd>
              <ul data-testid="prop-assets">
                {assetsOf(docs, doc.id).map((src) => (
                  <li key={src}>{src}</li>
                ))}
              </ul>
            </dd>
          </dl>
        </>
      ) : doc && node ? (
        <NodeProperties
          key={`${doc.id}.${node.id}`}
          ctx={ctx}
          doc={doc}
          node={node}
          info={nodeTypes.find((t) => t.type === node.type)}
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
  doc: SceneDoc;
  node: SceneNode;
  info: NodeTypeInfo | undefined;
}) {
  const [draft, setDraft] = useState(node.id);
  const [idError, setIdError] = useState<string | null>(null);
  // The host's refusal of the last props edit — cleared by the next one that lands.
  const [error, setError] = useState<string | null>(null);
  const schema = useMemo(() => mergedSchema(info), [info]);
  const asset = useAssetPicker(ctx);

  const rename = () => {
    const next = draft.trim();
    if (next === node.id) return setIdError(null);
    if (!next) return setIdError('type a node id');
    if ([...walk(doc.nodes)].some((e) => e.node.id === next))
      return setIdError(`"${next}" is already a node in this scene`);
    setIdError(null);
    void ctx.scenes
      .update({ ...doc, nodes: patch(doc.nodes, node.id, (n) => ({ ...n, id: next })) })
      .then((refused) => {
        if (refused.length) setIdError(refused[0].message);
        else ctx.scenes.select({ scene: doc.id, node: next });
      });
  };

  const onChange = (props: Record<string, unknown>) =>
    void ctx.scenes
      .update({ ...doc, nodes: patch(doc.nodes, node.id, (n) => ({ ...n, props })) })
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
        <span className="e8-explorer-title" data-testid="prop-type">
          {node.type}
        </span>
      </div>
      {idError !== null ? (
        <p className="e8-explorer-diagnostic" data-testid="prop-id-error">
          {idError}
        </p>
      ) : null}
      {error !== null ? (
        <p className="e8-explorer-diagnostic" data-testid="prop-error">
          {error}
        </p>
      ) : null}
      <div className="e8-properties-body">
        <SchemaForm
          rowId={`${doc.id}.${node.id}`}
          schema={schema}
          value={node.props}
          onChange={onChange}
          commit="blur"
          pickers={{ asset }}
        />
      </div>
    </>
  );
}
