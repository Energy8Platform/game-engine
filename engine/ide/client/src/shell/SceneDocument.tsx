import { useEffect, useRef, useState, type DragEvent } from 'react';
import Schema from 'schemastery';
import type { NodeTypeInfo, SceneDoc, SceneNode } from '@energy8engine/contracts';
import type { ViewerProps } from '../plugins/viewers';
import { useScenes } from '../plugins/scenes';
import { useWorkspace } from '../plugins/workspace';
import { useGameComposition } from '../plugins/game-composition';
import { activateOnKey } from './activate';
import { createCanvasRpc, type CanvasRpc } from './canvas-rpc';
import { CanvasToolbar, clampZoom, type GridState } from './CanvasToolbar';

/**
 * A scene opened as a tab: the canvas. Three regions — the toolbar
 * (`CanvasToolbar`), the node tree (left pane, collapsible; the slice-17
 * tree, unchanged inside: Explorer rows, hover `×`, drag) and the stage,
 * holding the editor page (`${previewUrl}/editor.html?scene=<id>`) in an
 * iframe sized to the design and scaled with a CSS transform. This view
 * holds no draft: every edit — from the tree or from the canvas — is one
 * `ctx.scenes.update(next)` and both redraw from `docs()` (the write's
 * answer, or the host's `scenes` frame). A refusal, or the canvas'
 * `error`, shows inline.
 *
 * The canvas talks through `canvas-rpc` (attached on the iframe's `load`):
 * its `selected`/`edit`/`remove`/`zorder` events become the same
 * `ctx.scenes` calls the tree makes, and the selection and the grid are
 * mirrored back to it (`select`/`grid` requests; re-sent on `ready`).
 * Selection stays one fact — `ctx.scenes.selected()` — so a pick the
 * service already holds is not re-told. The iframe is remounted on the
 * same rule `PreviewWall` uses: a host `reload` verdict, or another
 * project on the same address.
 *
 * The pure helpers below are what the tests pin: `nextId`, `addNode`,
 * `removeNode`, `moveNode`, `shiftNode`. None mutate; each returns a new
 * document (or the same one when there is nothing to do).
 */

/** The type an internal drag carries: the dragged node's id. */
const DRAG_TYPE = 'text/e8-node';
const ID_FROM_PATH = /^scenes\/([a-z0-9_]+)\.scene\.yml$/;

export function* walk(
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
export function map(
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

function shiftIn(nodes: readonly SceneNode[], id: string, delta: 1 | -1): SceneNode[] | null {
  const i = nodes.findIndex((n) => n.id === id);
  if (i >= 0) {
    const j = i + delta;
    if (j < 0 || j >= nodes.length) return null;
    const out = [...nodes];
    [out[i], out[j]] = [out[j], out[i]];
    return out;
  }
  for (let k = 0; k < nodes.length; k++) {
    const children = nodes[k].children;
    const shifted = children ? shiftIn(children, id, delta) : null;
    if (!shifted) continue;
    const out = [...nodes];
    out[k] = { ...nodes[k], children: shifted };
    return out;
  }
  return null;
}

/** Swaps a node with its next (`1`) or previous (`-1`) sibling — the z-order step. Unchanged at either end. */
export function shiftNode(doc: SceneDoc, id: string, delta: 1 | -1): SceneDoc {
  const nodes = shiftIn(doc.nodes, id, delta);
  return nodes ? { ...doc, nodes } : doc;
}

/** The node with `props` merged over its own. */
function patchNode(doc: SceneDoc, id: string, props: Record<string, unknown>): SceneDoc {
  if (!find(doc.nodes, id)) return doc;
  return {
    ...doc,
    nodes: map(doc.nodes, (node, children) => [
      {
        ...node,
        ...(node.id === id ? { props: { ...node.props, ...props } } : {}),
        ...(node.children ? { children } : {}),
      },
    ]),
  };
}

const FALLBACK_DESIGN = { width: 480, height: 288 };
/** Room the fit leaves around the frame, as the old bar did. */
const FIT_PAD = 24;
const DEFAULT_GRID: GridState = { on: false, step: 16 };

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
  // The host's refusal of the last edit, or the canvas' own `error` — cleared by the next edit that lands.
  const [error, setError] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const workspace = useWorkspace(ctx);
  const { rows, reloads } = useGameComposition(ctx);
  const previewUrl = workspace?.previewUrl ?? null;
  const design =
    (rows?.find((r) => r.id === 'scenes1' || r.name === '@energy8engine/scenes')?.config.design as
      { width: number; height: number } | undefined) ?? FALLBACK_DESIGN;

  const [treeOpen, setTreeOpen] = useState(true);
  const [grid, setGrid] = useState(DEFAULT_GRID);
  // `null` = fit automatically (recomputed as the stage resizes); a number = the user's zoom.
  const [zoom, setZoom] = useState<number | null>(null);
  const [fit, setFit] = useState(1);
  const scale = zoom ?? fit;

  const stageRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const rpcRef = useRef<CanvasRpc | null>(null);
  // The canvas' handlers are registered once per mount: they read the
  // service (the live fact, ahead of this render) and this ref for the grid.
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const liveDoc = () => ctx.scenes.docs().find((d) => d.id === id);
  const liveNode = () => {
    const sel = ctx.scenes.selected();
    return sel?.scene === id ? sel.node : null;
  };

  const commit = (next: SceneDoc | undefined) => {
    if (!next || next === liveDoc()) return;
    void ctx.scenes.update(next).then((refused) => setError(refused[0]?.message ?? null));
  };

  // The game is highlighting the selection; a node going with this
  // subtree is told as `node: null` before the doc changes.
  const remove = (nodeId: string) => {
    const current = liveDoc();
    const node = current && find(current.nodes, nodeId);
    if (!current || !node) return;
    const picked = liveNode();
    if (picked && find([node], picked)) ctx.scenes.select({ scene: id, node: null });
    commit(removeNode(current, nodeId));
  };

  /** A request the canvas may not be there to answer (not attached, replaced, gone) — nothing to do about it here. */
  const tell = (method: string, params: unknown) => {
    void rpcRef.current?.call(method, params).catch(() => {});
  };

  useEffect(() => {
    const rpc = createCanvasRpc();
    rpcRef.current = rpc;
    rpc.on('ready', () => {
      tell('select', { node: liveNode() });
      tell('grid', gridRef.current);
    });
    rpc.on('selected', (payload) => {
      const node = (payload as { node: string | null }).node;
      if (liveNode() !== node) ctx.scenes.select({ scene: id, node });
    });
    rpc.on('edit', (payload) => {
      const { node, props } = payload as { node: string; props: Record<string, unknown> };
      const current = liveDoc();
      commit(current && patchNode(current, node, props));
    });
    rpc.on('remove', (payload) => remove((payload as { node: string }).node));
    rpc.on('zorder', (payload) => {
      const { node, delta } = payload as { node: string; delta: number };
      const current = liveDoc();
      commit(current && shiftNode(current, node, delta > 0 ? 1 : -1));
    });
    rpc.on('error', (payload) => setError((payload as { message: string }).message));
    return () => {
      rpc.dispose();
      rpcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, id]);

  const mirrored = selected?.scene === id ? selected.node : null;
  useEffect(() => tell('select', { node: mirrored }), [mirrored]);
  useEffect(() => tell('grid', grid), [grid]);

  // The fit follows the stage's box until the user zooms by hand — a
  // ResizeObserver, as the old bar had (jsdom has none: the fit stays 1).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const box = stage.getBoundingClientRect();
      // A degenerate measurement (mid-load, a pane not laid out yet) would
      // collapse the frame to a few percent — leave the fit alone until there is a real box.
      if (box.width < 50 || box.height < 50) return;
      setFit(
        clampZoom(
          Math.min((box.width - FIT_PAD) / design.width, (box.height - FIT_PAD) / design.height),
        ),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    measure();
    return () => observer.disconnect();
    // `doc === undefined`: the stage is not there until the scene is (a tab opened ahead of the boot GET).
  }, [design.width, design.height, previewUrl, doc === undefined]);

  if (!doc) {
    return (
      <div className="e8-explorer e8-scene-doc" data-testid="scene-doc-gone">
        <p className="e8-empty">{`scene "${id}" is gone — it was deleted`}</p>
      </div>
    );
  }

  // The chosen type, or the first on offer when the game's list no longer has it.
  const type = nodeTypes.some((t) => t.type === addType) ? addType : nodeTypes[0]?.type;

  const add = () => {
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
    <div
      className={['e8-canvas', treeOpen ? '' : 'e8-canvas-tree-collapsed']
        .filter(Boolean)
        .join(' ')}
      data-testid={`scene-doc-${id}`}
    >
      <CanvasToolbar
        zoom={scale}
        onZoom={setZoom}
        grid={grid}
        onGrid={setGrid}
        treeOpen={treeOpen}
        onTreeToggle={() => setTreeOpen((v) => !v)}
      />

      {error !== null ? (
        <p className="e8-explorer-diagnostic e8-canvas-error" data-testid="scene-doc-error">
          {error}
        </p>
      ) : null}

      <div className="e8-explorer e8-canvas-tree" data-testid="canvas-tree">
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
              value={type ?? ''}
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
                    remove(node.id);
                  }}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div
        className="e8-canvas-stage"
        data-testid="canvas-stage"
        ref={stageRef}
        onPointerDown={() => iframeRef.current?.focus()}
      >
        {workspace === null ? (
          <p className="e8-empty">loading…</p>
        ) : previewUrl === null ? (
          <p className="e8-empty" data-testid="canvas-unavailable">
            canvas unavailable: no project open
          </p>
        ) : (
          <div
            className="e8-canvas-frame"
            style={{ width: design.width * scale, height: design.height * scale }}
          >
            <iframe
              key={`${reloads}:${workspace.active}:${previewUrl}`}
              ref={iframeRef}
              title="scene canvas"
              src={`${previewUrl}/editor.html?scene=${encodeURIComponent(id)}`}
              width={design.width}
              height={design.height}
              style={{ transform: `scale(${scale})` }}
              onLoad={(e) => rpcRef.current?.attach(e.currentTarget, new URL(previewUrl).origin)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
