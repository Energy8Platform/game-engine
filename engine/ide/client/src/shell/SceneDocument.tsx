import { useEffect, useState, type DragEvent } from 'react';
import Schema from 'schemastery';
import type { NodeTypeInfo, SceneDoc, SceneNode } from '@energy8engine/contracts';
import type { ViewerProps } from '../plugins/viewers';
import { useScenes } from '../plugins/scenes';
import { activateOnKey } from './activate';

/**
 * A scene opened as a tab: its node tree, editable. Rows are the
 * Explorer's rows (`e8-explorer-entry`, hover `×`, drag), the toolbar the
 * Explorer's header. This view holds no draft: every edit is one
 * `ctx.scenes.update(next)` and the tree redraws from `docs()` — the
 * write's answer, or the host's `scenes` frame. A refusal shows inline.
 *
 * Becoming the active tab tells the game to show this scene
 * (`preview`), once per activation, not on every shell notify.
 *
 * The pure helpers below are what the tests pin: `nextId`, `addNode`,
 * `removeNode`, `moveNode`. None mutate; each returns a new document (or
 * the same one when there is nothing to do).
 */

/** The type an internal drag carries: the dragged node's id. */
const DRAG_TYPE = 'text/e8-node';
const ID_FROM_PATH = /^scenes\/([a-z0-9_]+)\.scene\.yml$/;

function* walk(
  nodes: readonly SceneNode[],
  depth = 0,
): Generator<{ node: SceneNode; depth: number }> {
  for (const node of nodes) {
    yield { node, depth };
    if (node.children) yield* walk(node.children, depth + 1);
  }
}

function find(nodes: readonly SceneNode[], id: string): SceneNode | undefined {
  for (const { node } of walk(nodes)) if (node.id === id) return node;
  return undefined;
}

/** `<type>-<n>` with the smallest `n ≥ 1` no node in the document has. */
export function nextId(doc: SceneDoc, type: string): string {
  const taken = new Set([...walk(doc.nodes)].map(({ node }) => node.id));
  let n = 1;
  while (taken.has(`${type}-${n}`)) n++;
  return `${type}-${n}`;
}

/** Rebuilds the tree, `f` deciding each node's children. */
function map(
  nodes: readonly SceneNode[],
  f: (node: SceneNode, children: SceneNode[]) => SceneNode[],
): SceneNode[] {
  return nodes.flatMap((node) => f(node, node.children ? map(node.children, f) : []));
}

function appendTo(nodes: readonly SceneNode[], parentId: string, child: SceneNode): SceneNode[] {
  return map(nodes, (node, children) => [
    node.id === parentId
      ? { ...node, children: [...children, child] }
      : node.children
        ? { ...node, children }
        : node,
  ]);
}

/** Appends a node to `parentId`'s children, or to the root when `null` (or when no such parent exists). */
export function addNode(
  doc: SceneDoc,
  type: string,
  props: Record<string, unknown>,
  parentId: string | null,
): SceneDoc {
  const node: SceneNode = { id: nextId(doc, type), type, props };
  const nodes =
    parentId !== null && find(doc.nodes, parentId)
      ? appendTo(doc.nodes, parentId, node)
      : [...doc.nodes, node];
  return { ...doc, nodes };
}

function without(nodes: readonly SceneNode[], id: string): SceneNode[] {
  return map(nodes, (node, children) =>
    node.id === id ? [] : [node.children ? { ...node, children } : node],
  );
}

/** Drops the node and its subtree. */
export function removeNode(doc: SceneDoc, id: string): SceneDoc {
  return find(doc.nodes, id) ? { ...doc, nodes: without(doc.nodes, id) } : doc;
}

/**
 * Moves a node before a sibling-to-be, or into a node as its last child.
 * Unchanged when either end is missing, or the target is the node itself
 * or inside it.
 */
export function moveNode(
  doc: SceneDoc,
  id: string,
  target: { before: string } | { into: string },
): SceneDoc {
  const moving = find(doc.nodes, id);
  const targetId = 'before' in target ? target.before : target.into;
  if (!moving || !find(doc.nodes, targetId) || find([moving], targetId)) return doc;
  const rest = without(doc.nodes, id);
  if ('into' in target) return { ...doc, nodes: appendTo(rest, target.into, moving) };
  return {
    ...doc,
    nodes: map(rest, (node, children) => [
      ...(node.id === target.before ? [moving] : []),
      node.children ? { ...node, children } : node,
    ]),
  };
}

/**
 * What a new node of this type starts with: the schema's defaults.
 * A `required()` field refuses `{}` outright, so those are seeded `''`
 * first (`image.src`); a schema that still refuses gives `{}` — the
 * inspector will show what is missing.
 */
function defaultsFor(info: NodeTypeInfo | undefined): Record<string, unknown> {
  if (!info) return {};
  try {
    const schema = new Schema(info.schema as never) as unknown as ((
      v: unknown,
    ) => Record<string, unknown>) & {
      dict?: Record<string, { meta?: { required?: boolean } }>;
    };
    const seed: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(schema.dict ?? {}))
      if (field.meta?.required) seed[key] = '';
    return schema(seed) ?? {};
  } catch {
    return {};
  }
}

export function SceneDocument({ ctx, path }: ViewerProps) {
  const id = ID_FROM_PATH.exec(path)?.[1] ?? '';
  const { docs, nodeTypes, selected } = useScenes(ctx);
  const doc = docs.find((d) => d.id === id);
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState('');
  // The host's refusal of the last edit — cleared by the next one that lands.
  const [error, setError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    const key = `f:${path}`;
    let was = ctx.shell.active()?.key === key;
    if (was) void ctx.scenes.preview(id);
    return ctx.shell.subscribe(() => {
      const now = ctx.shell.active()?.key === key;
      if (now && !was) void ctx.scenes.preview(id);
      was = now;
    });
  }, [ctx, path, id]);

  if (!doc) {
    return (
      <div className="e8-explorer e8-scene-doc" data-testid="scene-doc-gone">
        <p className="e8-empty">{`scene "${id}" is gone — it was deleted`}</p>
      </div>
    );
  }

  const commit = (next: SceneDoc) => {
    if (next === doc) return;
    void ctx.scenes.update(next).then((refused) => setError(refused[0]?.message ?? null));
  };

  const add = () => {
    const type = addType || nodeTypes[0]?.type;
    if (!type) return;
    const picked =
      selected?.scene === id && selected.node ? find(doc.nodes, selected.node) : undefined;
    const parent = picked?.type === 'container' ? picked.id : null;
    commit(addNode(doc, type, defaultsFor(nodeTypes.find((t) => t.type === type)), parent));
    setAdding(false);
  };

  const select = (node: string) => ctx.scenes.select({ scene: id, node });

  function onDragOver(target: string, e: DragEvent<HTMLElement>) {
    if (!Array.from(e.dataTransfer.types).includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== target) setDropTarget(target);
  }

  const onDrop = (target: SceneNode, e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    const from = e.dataTransfer.getData(DRAG_TYPE);
    if (!from) return;
    commit(
      moveNode(
        doc,
        from,
        target.type === 'container' ? { into: target.id } : { before: target.id },
      ),
    );
  };

  return (
    <div className="e8-explorer e8-scene-doc" data-testid={`scene-doc-${id}`}>
      <div className="e8-explorer-header">
        <span className="e8-explorer-title">{id}</span>
        <span className="e8-explorer-actions">
          <button
            type="button"
            className="e8-explorer-action"
            data-testid="node-add"
            title="new node"
            aria-label="new node"
            onClick={() => setAdding((v) => !v)}
          >
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        </span>
      </div>

      {adding ? (
        <div className="e8-explorer-entry e8-scene-add">
          <select
            data-testid="node-add-type"
            aria-label="node type"
            value={addType || nodeTypes[0]?.type || ''}
            onChange={(e) => setAddType(e.target.value)}
          >
            {nodeTypes.map((t) => (
              <option key={t.type} value={t.type}>
                {t.type}
              </option>
            ))}
          </select>
          <button type="button" className="e8-primary" data-testid="node-add-ok" onClick={add}>
            add
          </button>
          <button type="button" onClick={() => setAdding(false)}>
            cancel
          </button>
        </div>
      ) : null}

      {error !== null ? (
        <p className="e8-explorer-diagnostic" data-testid="scene-doc-error">
          {error}
        </p>
      ) : null}

      <ul className="e8-explorer-tree" role="tree">
        {doc.nodes.length === 0 ? (
          <li className="e8-empty" data-testid="scene-doc-empty">
            no nodes yet — press + to add one
          </li>
        ) : null}
        {[...walk(doc.nodes)].map(({ node, depth }) => {
          const isSelected = selected?.scene === id && selected.node === node.id;
          return (
            <li
              key={node.id}
              role="treeitem"
              tabIndex={0}
              aria-level={depth + 1}
              aria-selected={isSelected}
              draggable
              className={[
                'e8-explorer-entry',
                isSelected ? 'e8-explorer-selected' : '',
                dropTarget === node.id ? 'e8-drop-target' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ paddingLeft: 8 + depth * 12 }}
              data-testid={`node-${node.id}`}
              onClick={() => select(node.id)}
              onKeyDown={activateOnKey(() => select(node.id))}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, node.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => onDragOver(node.id, e)}
              onDragLeave={() => dropTarget === node.id && setDropTarget(null)}
              onDrop={(e) => onDrop(node, e)}
            >
              <span className="e8-explorer-name">
                {node.type} {node.id}
              </span>
              <button
                type="button"
                className="e8-explorer-delete"
                data-testid={`node-remove-${node.id}`}
                aria-label={`remove node ${node.id}`}
                title="remove"
                onClick={(event) => {
                  event.stopPropagation();
                  commit(removeNode(doc, node.id));
                }}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
