import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { Context } from 'cordis';
import { BUILTIN_STATES, stateNode } from '@energy8engine/contracts';
import { useSymbols } from '../plugins/symbols';
import { useWorkspace } from '../plugins/workspace';
import { useGameComposition } from '../plugins/game-composition';
import { createCanvasRpc, type CanvasRpc } from './canvas-rpc';
import { CANVAS_SILENT, useCanvasSilence } from './useCanvasSilence';
import { DROP_TYPE, symbolWrites } from './symbols-writes';

/**
 * The Symbols document: a toolbar + the live canvas filling the pane
 * (`editor.html?symbol=` in `@energy8engine/scene-edit`'s symbol mode,
 * talked to through `canvas-rpc` exactly as `SceneDocument` talks to the
 * scene canvas) and this canvas' own status line — its `ready`-silence,
 * its `error` event, or what a drop onto it answered. The row list is
 * `SymbolsList`, the tab's `shell.sidebar` entry; this document shares
 * only `ctx.symbols` with it — the doc and the selection.
 *
 * The list and the Explorer share the left sidebar, so a file from the
 * Explorer (`DROP_TYPE`) is dropped here instead: with a symbol selected
 * it becomes the selected state, with none a new symbol named by the
 * file's stem — `symbolWrites`, the list's own drops. The symbol canvas
 * takes no pointer input of its own (styles.css), so a drag over it lands
 * on this document rather than in the iframe.
 *
 * The toolbar shows the picked symbol (`id · name · state`), the board's
 * cell size (read back from the canvas' `snapshot`) and the zoom group
 * (`fit`/`1:1`/`2x`, remembered in `localStorage['e8.symbols-zoom']`) plus
 * a Play button that re-sends the selection. Nothing picked, or a state
 * the def hasn't got: a panel over the stage says so — the help text
 * (what a symbol/state is) or the empty-state line — the iframe staying
 * mounted underneath either way, so the canvas is warm.
 *
 * The canvas is keyed on the project/reload, NOT on the selection: a
 * selection change is a `symbol` RPC call, not a remount. On `ready` the
 * parent resends, IN ORDER: the current doc (`replaceSymbols`, skipped
 * when there is none), the remembered zoom, the current selection
 * (`symbol`, skipped when nothing is selected — the canvas keeps whatever
 * it last showed), then asks `snapshot` for the cell size. `replaceSymbols`
 * and `symbol` repeat on every later doc/selection change; a doc change
 * also re-asks `snapshot`, though `symbols.yml` itself never moves the
 * board — the one thing that WOULD resize the cell, a live edit to
 * `reels1`'s `board.cellSize`, is not caught here at all (scene-edit reads
 * it once at boot): a reels edit needs a canvas reload to show up here
 * until slice 41 wires the board up live.
 *
 * A remote remove (a `symbols` frame without the picked id, or the doc
 * going to `null`) can leave a selection the doc no longer has: dropped
 * here rather than left for the render below to paper over. The def
 * surviving but a NAMED state on it gone (a remote Clear) is the
 * narrower case: falls back to `static` rather than deselecting — a
 * built-in never vanishes this way, so only a named state needs the
 * check.
 */
const ZOOM_KEY = 'e8.symbols-zoom';
const ZOOM_MODES = ['fit', '1:1', '2x'] as const;
type ZoomMode = (typeof ZOOM_MODES)[number];
const ZOOM_LABEL: Record<ZoomMode, string> = { fit: 'Fit', '1:1': '1:1', '2x': '2×' };

/** `localStorage['e8.symbols-zoom']` — junk or a denied storage both fall back to `fit`, `Preview.tsx`'s `readPreviewState` pattern. */
function readZoomState(): ZoomMode {
  try {
    const stored = localStorage.getItem(ZOOM_KEY);
    return (ZOOM_MODES as readonly string[]).includes(stored ?? '') ? (stored as ZoomMode) : 'fit';
  } catch {
    return 'fit';
  }
}

function writeZoomState(mode: ZoomMode) {
  try {
    localStorage.setItem(ZOOM_KEY, mode);
  } catch {
    // a viewer convenience; nothing to do without storage
  }
}

export function SymbolsDocument({ ctx }: { ctx: Context }) {
  const { doc, selected } = useSymbols(ctx);
  const symbols = doc?.symbols ?? [];
  const [status, setStatus] = useState<string | null>(null);
  /** The last text the canvas itself put in the status line — the one text its `ready` clears. */
  const canvasText = useRef<string | null>(null);
  const canvasSays = (text: string) => {
    canvasText.current = text;
    setStatus(text);
  };

  const workspace = useWorkspace(ctx);
  const { reloads } = useGameComposition(ctx);
  const previewUrl = workspace?.previewUrl ?? null;
  /** What the iframe below is keyed on — a reload, a project switch or a changed preview address all remount it. */
  const canvasKey = workspace ? `${reloads}:${workspace.active}:${previewUrl}` : null;

  const [zoomMode, setZoomModeState] = useState<ZoomMode>(readZoomState);
  const zoomRef = useRef(zoomMode);
  useEffect(() => {
    zoomRef.current = zoomMode;
  }, [zoomMode]);
  const [cell, setCell] = useState<{ width: number; height: number } | null>(null);

  // Created synchronously, same reasoning as `SceneDocument`'s: the
  // iframe's ref callback fires during commit, before the mount effect
  // below runs, and needs an rpc to attach to already.
  const [rpc] = useState<CanvasRpc>(() => createCanvasRpc());
  const rpcRef = useRef<CanvasRpc | null>(rpc);
  /** A request the canvas may not be there to answer — nothing to do about it here. */
  const tell = (method: string, params: unknown) => {
    void rpcRef.current?.call(method, params).catch(() => {});
  };
  /** The board's cell size, in design px — re-asked whenever the SYMBOLS doc changes (a symbol edit never moves it, but asking is cheap); a `reels1` edit that actually resizes the cell is not seen live here at all — see the class doc above. */
  const askSnapshot = () => {
    void rpcRef.current
      ?.call<{ cell?: { width: number; height: number } }>('snapshot')
      .then((snap) => snap?.cell && setCell(snap.cell))
      .catch(() => {});
  };

  // A clean write clears what a drop said, never the canvas' own text.
  const { dropState, dropNew } = symbolWrites(ctx, (line) =>
    setStatus((current) => line ?? (current === canvasText.current ? current : null)),
  );
  const [dropping, setDropping] = useState(false);
  // No `dropEffect` of its own: the Explorer allows only `move`, and any
  // other effect would refuse the drop.
  const onDragOver = (e: DragEvent<HTMLElement>) => {
    if (!Array.from(e.dataTransfer.types).includes(DROP_TYPE)) return;
    e.preventDefault();
    setDropping(true);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    const path = e.dataTransfer.getData(DROP_TYPE);
    if (!path) return;
    e.preventDefault();
    setDropping(false);
    const sel = ctx.symbols.selected();
    void (sel ? dropState(sel.id, sel.state, path) : dropNew(path));
  };

  const setZoom = (mode: ZoomMode) => {
    setZoomModeState(mode);
    writeZoomState(mode);
    tell('zoom', { mode });
  };

  useEffect(() => {
    rpcRef.current = rpc;
    rpc.on('ready', () => {
      // The parent is the source of truth: resend the doc, the remembered
      // zoom and the selection the canvas missed while it was still
      // loading, then read back the board's cell size.
      const currentDoc = ctx.symbols.doc();
      if (currentDoc !== null) tell('replaceSymbols', { doc: currentDoc });
      tell('zoom', { mode: zoomRef.current });
      const sel = ctx.symbols.selected();
      if (sel !== null) tell('symbol', sel);
      askSnapshot();
    });
    rpc.on('error', (payload) => canvasSays((payload as { message: string }).message));
    return () => {
      rpc.dispose();
      rpcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, rpc]);

  // A canvas that never boots (a broken editor.html, a throw before
  // scene-edit's symbol mode is up) leaves this document silent — say so
  // after 10s; a later `ready` (this canvas or a remount) clears it. No
  // iframe (no preview address), no canvas to wait for. `ready` clears
  // only what the canvas itself said — its silence or its last `error` —
  // never a status this document set.
  useCanvasSilence(
    rpc,
    previewUrl ? canvasKey : null,
    () => canvasSays(CANVAS_SILENT),
    () => setStatus((current) => (current === canvasText.current ? null : current)),
  );

  // Every later doc change is a `replaceSymbols`; every later selection
  // change (that isn't a deselect) is a `symbol` — the canvas keeps
  // showing its last preview when the selection clears. Keyed on the
  // doc's SHAPE, not its identity: one write lands twice (the PUT answer's
  // doc, then the host's `symbols` frame — equal, distinct objects), and
  // the canvas remounts every live view per `replaceSymbols`.
  const docKey = doc === null ? null : JSON.stringify(doc);
  useEffect(() => {
    if (doc !== null) {
      tell('replaceSymbols', { doc });
      askSnapshot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);
  useEffect(() => {
    if (selected !== null) tell('symbol', selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  useEffect(() => {
    if (selected === null) return;
    const def = symbols.find((s) => s.id === selected.id);
    if (!def) return void ctx.symbols.select(null);
    const named = !(BUILTIN_STATES as readonly string[]).includes(selected.state);
    if (named && !(def.states && Object.hasOwn(def.states, selected.state))) {
      ctx.symbols.select({ id: selected.id, state: 'static' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey]);
  // A new canvas (reload / project / preview address) has not answered
  // its OWN `snapshot` yet — the old cell size would otherwise survive
  // the remount and lie about the new board until `ready` catches up.
  useEffect(() => {
    setCell(null);
  }, [canvasKey]);

  /** The iframe's own ref, not its `load` event — `contentWindow` exists as soon as it's inserted. */
  const attachIframe = useCallback(
    (el: HTMLIFrameElement | null) => {
      if (el && previewUrl) rpc.attach(el, new URL(previewUrl).origin);
    },
    [rpc, previewUrl],
  );

  const selectedDef = selected ? symbols.find((s) => s.id === selected.id) : undefined;
  const stateMissing =
    selected !== null && selectedDef !== undefined && !stateNode(selectedDef, selected.state);

  return (
    <div className="e8-symbols-doc" data-testid="symbols-doc">
      <div
        className={['e8-symbols-canvas', dropping ? 'e8-drop-target' : '']
          .filter(Boolean)
          .join(' ')}
        data-testid="symbols-canvas"
        onDragOver={onDragOver}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        {workspace === null ? (
          <p className="e8-empty">loading…</p>
        ) : previewUrl === null ? (
          <p className="e8-empty" data-testid="canvas-unavailable">
            canvas unavailable: no project open
          </p>
        ) : (
          <>
            <div className="e8-symbols-toolbar" data-testid="symbols-toolbar">
              {selected !== null && selectedDef ? (
                <span className="e8-symbols-header" data-testid="symbols-header">
                  {[selected.id, selectedDef.name, selected.state].filter(Boolean).join(' · ')}
                </span>
              ) : null}
              <div className="e8-symbols-toolbar-right">
                <span className="e8-symbols-cell-size" data-testid="symbols-cell-size">
                  {cell ? `cell ${cell.width}×${cell.height}` : ''}
                </span>
                <span className="e8-symbols-zoom" role="group" aria-label="zoom">
                  {ZOOM_MODES.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      data-testid={`symbols-zoom-${mode}`}
                      aria-pressed={zoomMode === mode}
                      onClick={() => setZoom(mode)}
                    >
                      {ZOOM_LABEL[mode]}
                    </button>
                  ))}
                </span>
                <button
                  type="button"
                  className="e8-symbols-play"
                  data-testid="symbol-replay"
                  title="play"
                  disabled={selected === null || !selectedDef || stateMissing}
                  onClick={() => selected !== null && tell('symbol', selected)}
                >
                  ▶ Play
                </button>
              </div>
            </div>
            {/* The iframe stays mounted under the help/empty-state panel
                (an absolutely positioned layer) so the canvas is warm the
                moment there is something to show it. */}
            <div className="e8-symbols-stage">
              <iframe
                key={canvasKey}
                ref={attachIframe}
                title="symbol canvas"
                // Constant: `?symbol=` boots symbol mode with nothing picked; the
                // selection travels as a `symbol` call, never as a navigation.
                src={`${previewUrl}/editor.html?symbol=`}
              />
              {selected === null || !selectedDef ? (
                <div className="e8-symbols-help" data-testid="symbols-help">
                  <p>
                    <strong>Symbols</strong> — how each symbol a reel shows looks. A reel&apos;s
                    board carries symbol ids; each id here gets a picture per state:
                  </p>
                  <ul>
                    <li>
                      <strong>static</strong> — at rest (required);
                    </li>
                    <li>
                      <strong>idle</strong> — an optional looping look at rest;
                    </li>
                    <li>
                      <strong>win</strong> — plays when the symbol is in a win;
                    </li>
                    <li>
                      <strong>named states</strong> — played by a mechanic&apos;s plan steps (
                      <code>+</code> on a row adds one).
                    </li>
                  </ul>
                  <p>
                    Drop a file from the Explorer onto the canvas to set the selected state, or with
                    nothing selected to add a symbol. Pick a symbol on the left to see it here.
                  </p>
                  {doc === null ? (
                    <p>There is no symbols.yml yet — the first symbol you add creates it.</p>
                  ) : null}
                </div>
              ) : stateMissing ? (
                <div className="e8-symbols-state-empty" data-testid="symbols-state-empty">
                  {`no ${selected.state} yet — drop a file here, or Create in Properties`}
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
      {status !== null ? (
        <p className="e8-explorer-diagnostic e8-symbols-status" data-testid="symbols-canvas-status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
