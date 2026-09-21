import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import type { Context } from 'cordis';
import Schema from 'schemastery';
import {
  diagnostic,
  type Diagnostic,
  type NodeTypeInfo,
  type SymbolDef,
  type SymbolState,
  type SymbolsDoc,
} from '@energy8engine/contracts';
import { extOf } from '../plugins/asset-node-types';
import { useSymbols } from '../plugins/symbols';
import { useWorkspace } from '../plugins/workspace';
import { useGameComposition } from '../plugins/game-composition';
import { activateOnKey } from './activate';
import { createCanvasRpc, type CanvasRpc } from './canvas-rpc';
import { clampZoom } from './CanvasToolbar';
import { ExplorerMenu } from './ExplorerMenu';
import { addSymbol, EMPTY, nodeForDrop, removeSymbol, setState, STATES } from './symbols-doc';

/**
 * The Symbols document: the list down the left (one row per symbol — its
 * id, name and three state chips showing the state's type or `+`; then
 * the `known` ids not yet in the doc as ghost rows with Add; then an add
 * input for a free id), the live canvas in the centre (`editor.html?symbol=`
 * in `@energy8engine/scene-edit`'s symbol mode, talked to through
 * `canvas-rpc` exactly as `SceneDocument` talks to the scene canvas) and a
 * status line — the last refusal, the doc's first diagnostic, or the
 * canvas' own `error`.
 *
 * The canvas is keyed on the project/reload, NOT on the selection: a
 * selection change is a `symbol` RPC call, not a remount. On `ready` the
 * parent resends the current doc (`replaceSymbols`, skipped when there is
 * none) and the current selection (`symbol`, skipped when nothing is
 * selected — the canvas keeps whatever it last showed); the same two
 * calls follow every later doc/selection change.
 *
 * Every write is a REDUCER over the doc, queued through `ctx.symbols.update`
 * (the Flow document's `commit`, moved into the service so `SymbolsProperties`
 * shares the same chain): each reduces `ctx.symbols.doc()` as it stands
 * when its turn comes — `EMPTY` when there is no symbols.yml yet, so the
 * first add creates the file — and PUTs unless nothing changed.
 *
 * A drop from the Explorer (`text/x-e8-path`) onto a chip sets that
 * state, onto a row its `static`, onto the empty area below the list a
 * new symbol named by the file's stem — any non-empty stem is a legal new
 * id (a math emits names as symbol ids too, so a name is first-class
 * here); an empty stem, or a stem already in the doc, is refused in the
 * status line. The node comes
 * from `ctx.assetNodeTypes.pick` (the tree read so a sibling rule can
 * see what sits beside the file): its type, the prop it put the path in,
 * and — for `win` on a type whose schema has `loop` — `loop: false`.
 */
type Reduce = (doc: SymbolsDoc) => SymbolsDoc;
const DROP_TYPE = 'text/x-e8-path';
const SEVERITY = { error: 2, warning: 1, info: 0 } as const;
// ponytail: fit-scale constants duplicated from SceneDocument rather than a
// shared module — one more consumer of ~20 lines isn't worth extracting yet.
const FALLBACK_DESIGN = { width: 480, height: 288 };
const FIT_PAD = 24;

/** The worst severity among the diagnostics under `where` (itself or a path below it), or `undefined`. */
function worst(diagnostics: readonly Diagnostic[], where: string): string | undefined {
  let top: Diagnostic | undefined;
  for (const d of diagnostics) {
    if (d.where !== where && !d.where.startsWith(`${where}/`)) continue;
    if (!top || SEVERITY[d.severity] > SEVERITY[top.severity]) top = d;
  }
  return top?.severity;
}

/** Whether the type's props schema has a `loop` field — what a `win` turns off. */
export function hasLoop(info: NodeTypeInfo | undefined): boolean {
  if (!info) return false;
  try {
    const schema = new Schema(info.schema as never) as unknown as {
      dict?: Record<string, unknown>;
    };
    return 'loop' in (schema.dict ?? {});
  } catch {
    return false;
  }
}

const stemOf = (path: string) => {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
};

export function SymbolsDocument({ ctx }: { ctx: Context }) {
  const { doc, known, diagnostics, selected } = useSymbols(ctx);
  const symbols = doc?.symbols ?? [];
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; def: SymbolDef } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const workspace = useWorkspace(ctx);
  const { rows, reloads } = useGameComposition(ctx);
  const previewUrl = workspace?.previewUrl ?? null;
  const design =
    (rows?.find((r) => r.id === 'scenes1' || r.name === '@energy8engine/scenes')?.config.design as
      { width: number; height: number } | undefined) ?? FALLBACK_DESIGN;

  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  // Created synchronously, same reasoning as `SceneDocument`'s: the
  // iframe's ref callback fires during commit, before the mount effect
  // below runs, and needs an rpc to attach to already.
  const [rpc] = useState<CanvasRpc>(() => createCanvasRpc());
  const rpcRef = useRef<CanvasRpc | null>(rpc);
  /** A request the canvas may not be there to answer — nothing to do about it here. */
  const tell = (method: string, params: unknown) => {
    void rpcRef.current?.call(method, params).catch(() => {});
  };

  useEffect(() => {
    rpcRef.current = rpc;
    rpc.on('ready', () => {
      // The parent is the source of truth: resend the doc and the
      // selection the canvas missed while it was still loading.
      const currentDoc = ctx.symbols.doc();
      if (currentDoc !== null) tell('replaceSymbols', { doc: currentDoc });
      const sel = ctx.symbols.selected();
      if (sel !== null) tell('symbol', sel);
    });
    rpc.on('error', (payload) => setStatus((payload as { message: string }).message));
    return () => {
      rpc.dispose();
      rpcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, rpc]);

  // Every later doc change is a `replaceSymbols`; every later selection
  // change (that isn't a deselect) is a `symbol` — the canvas keeps
  // showing its last preview when the selection clears. Keyed on the
  // doc's SHAPE, not its identity: one write lands twice (the PUT answer's
  // doc, then the host's `symbols` frame — equal, distinct objects), and
  // the canvas remounts every live view per `replaceSymbols`.
  const docKey = doc === null ? null : JSON.stringify(doc);
  useEffect(() => {
    if (doc !== null) tell('replaceSymbols', { doc });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);
  useEffect(() => {
    if (selected !== null) tell('symbol', selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  /** The iframe's own ref, not its `load` event — `contentWindow` exists as soon as it's inserted. */
  const attachIframe = useCallback(
    (el: HTMLIFrameElement | null) => {
      if (el && previewUrl) rpc.attach(el, new URL(previewUrl).origin);
    },
    [rpc, previewUrl],
  );

  // The fit follows the stage's box (jsdom has no ResizeObserver: fit stays 1).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const box = stage.getBoundingClientRect();
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
  }, [design.width, design.height, previewUrl]);

  // The write queue lives in `ctx.symbols.update` now — see that module's
  // top comment — so this only needs to report the answer.
  const commit = useCallback(
    (reduce: Reduce) =>
      ctx.symbols.update(reduce).then((answer) => {
        setStatus(answer[0] ? `${answer[0].where} — ${answer[0].message}` : null);
        return answer.length === 0;
      }),
    [ctx],
  );

  const has = (id: string) => (ctx.symbols.doc() ?? EMPTY).symbols.some((s) => s.id === id);
  /** `false` when the id is already there — the status says so and the caller keeps what it typed. */
  const add = (id: string, name?: string) => {
    if (has(id)) {
      setStatus(`"${id}" is already a symbol`);
      return false;
    }
    void commit((d) => addSymbol(d, id, name));
    return true;
  };

  const remove = (id: string) => {
    if (ctx.symbols.selected()?.id === id) ctx.symbols.select(null);
    void commit((d) => removeSymbol(d, id));
  };

  /** The dropped file as a node, or `undefined` (refused in the status line and reported). */
  const pickNode = async (path: string, state: SymbolState) => {
    const tree = await ctx.files.tree();
    for (const diag of tree.diagnostics) ctx.connection.report(diag);
    // A tree that could not be read whole says nothing about what is beside the file.
    const def = ctx.assetNodeTypes.pick(path, tree.diagnostics.length ? undefined : tree.entries);
    if (!def) {
      const ext = extOf(path);
      const warn = diagnostic(
        'warning',
        'symbols',
        path,
        ext ? `no node type for .${ext}` : `no node type for "${path}"`,
        'the game has not reported its node types yet (is the preview running?)',
      );
      ctx.connection.report(warn);
      setStatus(warn.message);
      return undefined;
    }
    const { type, props } = def.node(path, { x: 0, y: 0 });
    const prop = Object.keys(props).find((k) => props[k] === path) ?? 'src';
    const info = ctx.scenes.nodeTypes().find((t) => t.type === type);
    return nodeForDrop({ type, prop, hasLoop: hasLoop(info) }, path, state);
  };

  const dropState = async (id: string, state: SymbolState, path: string) => {
    const node = await pickNode(path, state);
    if (node) void commit((d) => setState(d, id, state, node));
  };

  const dropNew = async (path: string) => {
    const stem = stemOf(path);
    if (!stem) return setStatus('drop onto a symbol');
    if (has(stem)) return setStatus(`"${stem}" is already a symbol`);
    const node = await pickNode(path, 'static');
    if (!node) return;
    const k = known.find((k) => k.id === stem);
    void commit((d) => setState(addSymbol(d, stem, k?.name), stem, 'static', node));
  };

  const isPath = (e: DragEvent<HTMLElement>) =>
    Array.from(e.dataTransfer.types).includes(DROP_TYPE);
  const onDragOver = (target: string) => (e: DragEvent<HTMLElement>) => {
    if (!isPath(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (dropTarget !== target) setDropTarget(target);
  };
  const onDrop = (handle: (path: string) => void) => (e: DragEvent<HTMLElement>) => {
    const path = e.dataTransfer.getData(DROP_TYPE);
    if (!path) return;
    e.preventDefault();
    e.stopPropagation();
    setDropTarget(null);
    handle(path);
  };

  const first = diagnostics[0];
  const line = status ?? (first ? `${first.where} — ${first.message}` : null);
  const ghosts = known.filter((k) => !symbols.some((s) => s.id === k.id));

  return (
    <div className="e8-explorer e8-symbols-doc" data-testid="symbols-doc">
      <div className="e8-symbols-list">
        <div className="e8-explorer-header">
          <span className="e8-explorer-title">symbols</span>
        </div>
        <ul className="e8-explorer-tree" role="list">
          {symbols.map((def) => {
            const picked = selected?.id === def.id;
            const where = `symbols/${def.id}`;
            return (
              <li
                key={def.id}
                className={[
                  'e8-explorer-entry e8-symbol-row',
                  picked ? 'e8-explorer-selected' : '',
                  dropTarget === def.id ? 'e8-drop-target' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                data-testid={`symbol-row-${def.id}`}
                data-diagnostic={worst(diagnostics, where)}
                tabIndex={0}
                onClick={() => ctx.symbols.select({ id: def.id, state: 'static' })}
                onKeyDown={activateOnKey(() => ctx.symbols.select({ id: def.id, state: 'static' }))}
                onDragOver={onDragOver(def.id)}
                onDragLeave={() => dropTarget === def.id && setDropTarget(null)}
                onDrop={onDrop((path) => void dropState(def.id, 'static', path))}
              >
                <span className="e8-symbol-id">{def.id}</span>
                <span className="e8-explorer-name" data-testid={`symbol-name-${def.id}`}>
                  {def.name ?? ''}
                </span>
                {STATES.map((state) => {
                  const node = def[state];
                  const target = `${def.id}/${state}`;
                  return (
                    <button
                      key={state}
                      type="button"
                      className={[
                        'e8-symbol-chip',
                        node ? '' : 'e8-symbol-chip-empty',
                        picked && selected.state === state ? 'e8-symbol-chip-selected' : '',
                        dropTarget === target ? 'e8-drop-target' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      data-testid={`symbol-chip-${def.id}-${state}`}
                      data-diagnostic={worst(diagnostics, `${where}/${state}`)}
                      title={state}
                      onClick={(e) => {
                        e.stopPropagation();
                        ctx.symbols.select({ id: def.id, state });
                      }}
                      onDragOver={onDragOver(target)}
                      onDragLeave={() => dropTarget === target && setDropTarget(null)}
                      onDrop={onDrop((path) => void dropState(def.id, state, path))}
                    >
                      {node?.type ?? '+'}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="e8-explorer-delete"
                  data-testid={`symbol-menu-${def.id}`}
                  aria-label={`symbol ${def.id} menu`}
                  title="more"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    setMenu({ x: r.left, y: r.bottom, def });
                  }}
                >
                  ⋯
                </button>
              </li>
            );
          })}
          {ghosts.map((k) => (
            <li
              key={k.id}
              className="e8-explorer-entry e8-symbol-row e8-symbol-ghost"
              data-testid={`symbol-ghost-${k.id}`}
            >
              <span className="e8-symbol-id">{k.id}</span>
              <span className="e8-explorer-name">{k.name}</span>
              <button
                type="button"
                className="e8-symbol-add"
                data-testid={`symbol-add-${k.id}`}
                onClick={() => add(k.id, k.name)}
              >
                Add
              </button>
            </li>
          ))}
        </ul>
        <div className="e8-explorer-entry e8-symbol-row">
          <input
            className="e8-explorer-input"
            data-testid="symbol-add-input"
            aria-label="new symbol id"
            placeholder="add symbol…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key !== 'Enter') return;
              const id = draft.trim();
              if (id && add(id)) setDraft('');
            }}
          />
        </div>
        <div
          className={['e8-symbols-drop-new', dropTarget === '' ? 'e8-drop-target' : '']
            .filter(Boolean)
            .join(' ')}
          data-testid="symbols-drop-new"
          onDragOver={onDragOver('')}
          onDragLeave={() => dropTarget === '' && setDropTarget(null)}
          onDrop={onDrop((path) => void dropNew(path))}
        />
      </div>
      <div className="e8-symbols-canvas" data-testid="symbols-canvas">
        {workspace === null ? (
          <p className="e8-empty">loading…</p>
        ) : previewUrl === null ? (
          <p className="e8-empty" data-testid="canvas-unavailable">
            canvas unavailable: no project open
          </p>
        ) : (
          <>
            <div className="e8-canvas-stage" ref={stageRef}>
              <div
                className="e8-canvas-frame"
                style={{ width: design.width * fit, height: design.height * fit }}
              >
                <iframe
                  key={`${reloads}:${workspace.active}:${previewUrl}`}
                  ref={attachIframe}
                  title="symbol canvas"
                  // Constant: `?symbol=` boots symbol mode with nothing picked; the
                  // selection travels as a `symbol` call, never as a navigation.
                  src={`${previewUrl}/editor.html?symbol=`}
                  width={design.width}
                  height={design.height}
                  style={{ transform: `scale(${fit})` }}
                />
              </div>
            </div>
            <button
              type="button"
              className="e8-explorer-action e8-symbols-replay"
              data-testid="symbol-replay"
              title="replay"
              onClick={() => selected !== null && tell('symbol', selected)}
            >
              Replay
            </button>
          </>
        )}
      </div>
      {line !== null ? (
        <p className="e8-explorer-diagnostic e8-symbols-status" data-testid="symbols-status">
          {line}
        </p>
      ) : null}
      {menu && (
        <ExplorerMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: 'Remove symbol', testId: 'symbol-remove', onPick: () => remove(menu.def.id) },
            ...STATES.filter((s) => menu.def[s]).map((s) => ({
              label: `Clear ${s}`,
              testId: `symbol-clear-${s}`,
              onPick: () => void commit((d) => setState(d, menu.def.id, s, null)),
            })),
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
