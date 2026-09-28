import { useCallback, useEffect, useRef, useState } from 'react';
import type { Context } from 'cordis';
import type { GameCompositionRow } from '@energy8engine/contracts';
import { useGameComposition } from '../plugins/game-composition';
import { useWorkspace } from '../plugins/workspace';
import { createCanvasRpc, type CanvasRpc } from './canvas-rpc';
import { CANVAS_SILENT, useCanvasSilence } from './useCanvasSilence';

/**
 * The Reels document: a toolbar over the live reel lab canvas
 * (`@energy8engine/scene-edit`'s reels mode, `editor.html?reels=`) —
 * modelled on `SymbolsDocument`'s own canvas half: the iframe is keyed on
 * the project/reload/preview address (never a config edit, which never
 * remounts it), and `canvas-rpc` talks to it the same wire protocol. The
 * sections that edit `reels1`/`motion1`/`anticipation1`/`cascade1`/
 * `features1`'s config live in `ReelsSettings` instead, the Reels tab's
 * right sidebar (`shell.sideRight` `reels`) — this document shares only
 * `ctx.gameComposition` with it, never a callback: every edit anywhere
 * (a sidebar form, the Composition screen, a remote frame) lands as a
 * `gameComposition` change this document follows on its own.
 *
 * The toolbar runs the lab's own test actions (`spin`/`scatters`/`win`/
 * `tumble`) — synthetic boards played through the real board steps, no
 * mechanic and no server — and reports whichever answered
 * `{ ok: false, reason }` in `reels-action-status`, which also carries the
 * canvas' own `ready`-silence and `error` text, and a row the canvas
 * failed to apply.
 *
 * `sent` (`Map<row id, JSON of the config last sent>`) is what the
 * row-following effect below diffs the composition's CURRENT reel rows
 * against, one reel row at a time — only the ones that actually moved are
 * re-applied, so an edit to `reels1` never rebuilds `motion1` on the
 * canvas along with it. `ready` (a fresh canvas load, or a reload the host
 * drove) sends every reel row instead and resets `sent` to match —
 * whatever board the canvas showed before that is stale.
 */
const REEL_ROW_IDS = ['reels1', 'motion1', 'anticipation1', 'cascade1', 'features1'] as const;

function byId(rows: readonly GameCompositionRow[], id: string): GameCompositionRow | null {
  return rows.find((row) => row.id === id) ?? null;
}

/** `sent`'s shape for the reel rows currently present — every absent id left out. */
function snapshotSent(rows: readonly GameCompositionRow[]): Map<string, string> {
  const sent = new Map<string, string>();
  for (const id of REEL_ROW_IDS) {
    const row = byId(rows, id);
    if (row) sent.set(id, JSON.stringify(row.config));
  }
  return sent;
}

export function ReelsDocument({ ctx }: { ctx: Context }) {
  const { rows, reloads } = useGameComposition(ctx);
  const list = rows ?? [];
  const anticipation1 = byId(list, 'anticipation1');
  const cascade1 = byId(list, 'cascade1');

  const workspace = useWorkspace(ctx);
  const previewUrl = workspace?.previewUrl ?? null;
  /** Same key `SymbolsDocument` uses: a reload, a project switch or a
   * changed preview address all remount the canvas — a config edit never
   * does, it travels as a `rows` rpc call instead. */
  const canvasKey = workspace ? `${reloads}:${workspace.active}:${previewUrl}` : null;

  const [rpc] = useState<CanvasRpc>(() => createCanvasRpc());
  const rpcRef = useRef<CanvasRpc | null>(rpc);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  /** The last text the canvas itself put in the status line — the one text its `ready` clears. */
  const canvasText = useRef<string | null>(null);
  const canvasSays = (text: string) => {
    canvasText.current = text;
    setStatus(text);
  };

  /** Lazily seeded to the mounted rows' own config, so the row-following
   * effect below finds nothing changed on its first run — there is no
   * canvas to send to yet until it says `ready`. */
  const sentRef = useRef<Map<string, string> | null>(null);
  if (sentRef.current === null) sentRef.current = snapshotSent(list);

  /** The CURRENT config of the given reel rows — every one by default —
   * off the service directly (never the `list` this render closed over),
   * so a write that lands between commit and this callback still ships
   * the latest. A row the canvas answers `failed` for (its `gameRows.
   * update` threw) is named in the status line. */
  const sendRows = (ids: readonly string[] = REEL_ROW_IDS) => {
    const current = ctx.gameComposition.rows ?? [];
    const reelRows = ids
      .map((id) => byId(current, id))
      .filter((row): row is GameCompositionRow => row !== null)
      .map((row) => ({ id: row.id, config: row.config }));
    if (reelRows.length === 0) return;
    void rpcRef.current
      ?.call<{ results?: { id: string; result: string }[] }>('rows', { rows: reelRows })
      .then((answer) => {
        const failed = (answer?.results ?? []).filter((r) => r.result === 'failed');
        if (failed.length > 0) {
          setStatus(`couldn't apply ${failed.map((r) => r.id).join(', ')} on the canvas`);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    rpcRef.current = rpc;
    rpc.on('ready', () => {
      const current = ctx.gameComposition.rows ?? [];
      sentRef.current = snapshotSent(current);
      sendRows();
    });
    rpc.on('error', (payload) => canvasSays((payload as { message: string }).message));
    return () => {
      rpc.dispose();
      rpcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, rpc]);

  // Follows the composition, not any one editor: every reel row whose
  // config's JSON no longer matches `sent` is re-applied, and only that
  // one — a sibling row that did not change stays on the canvas as it was.
  useEffect(() => {
    const sent = sentRef.current!;
    const changed = REEL_ROW_IDS.filter((id) => {
      const row = byId(list, id);
      if (!row) return false;
      const json = JSON.stringify(row.config);
      if (sent.get(id) === json) return false;
      sent.set(id, json);
      return true;
    });
    if (changed.length > 0) sendRows(changed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // A canvas that never boots (a broken editor.html, a throw before
  // scene-edit's reels mode is up) leaves this document silent — say so
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

  /** The iframe's own ref, not its `load` event — `contentWindow` exists as soon as it's inserted (`SymbolsDocument`'s own reasoning). */
  const attachIframe = useCallback(
    (el: HTMLIFrameElement | null) => {
      if (el && previewUrl) rpc.attach(el, new URL(previewUrl).origin);
    },
    [rpc, previewUrl],
  );

  const runAction = async (method: string, params?: unknown) => {
    setBusy(true);
    setStatus(null);
    try {
      // A lab action lasts as long as the motion row's spin does — well past
      // the rpc's 5 s default on a slow style.
      const result = await rpcRef.current!.call<{ ok: boolean; reason?: string }>(method, params, {
        timeout: 60_000,
      });
      if (result && result.ok === false) setStatus(result.reason ?? null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  // This used to read `enabled !== false` — "on unless explicitly turned
  // off" — so a project whose `anticipation1` row is PRESENT but carries
  // no `enabled` key at all (the row's own schema default, and exactly
  // what `e8-base` composes it with — see `reels-anticipation`'s schema
  // doc: "composed but OFF") read as ON. `=== true` is the honest mirror
  // of the schema's own default: off unless a patch (or the sidebar) has
  // actually set it.
  const anticipationOn = anticipation1?.config.enabled === true;
  // The row's own schema default when unset (`reels-anticipation`).
  const triggers = (anticipation1?.config.triggerSymbols as string[] | undefined) ?? ['scatter'];
  // Why Scatters is off, as its `title` — `undefined` when it isn't (busy aside).
  const scattersBlocked = !anticipation1
    ? 'no anticipation1 row'
    : !anticipationOn
      ? 'turn on Anticipation › enabled'
      : triggers.length === 0
        ? 'no trigger symbols'
        : undefined;
  const scattersDisabled = busy || scattersBlocked !== undefined;

  return (
    <div className="e8-reels-doc" data-testid="reels-doc">
      {workspace === null ? (
        <p className="e8-empty">loading…</p>
      ) : previewUrl === null ? (
        <p className="e8-empty" data-testid="reels-canvas-unavailable">
          canvas unavailable: no project open
        </p>
      ) : (
        <>
          <div className="e8-reels-toolbar" data-testid="reels-toolbar">
            <button
              type="button"
              data-testid="reels-action-spin"
              disabled={busy}
              onClick={() => void runAction('spin')}
            >
              Spin
            </button>
            <button
              type="button"
              data-testid="reels-action-scatters"
              disabled={scattersDisabled}
              title={scattersBlocked}
              onClick={() =>
                void runAction('scatters', {
                  triggers,
                  threshold: (anticipation1?.config.threshold as number | undefined) ?? 2,
                })
              }
            >
              Scatters
            </button>
            <button
              type="button"
              data-testid="reels-action-win"
              disabled={busy}
              onClick={() => void runAction('win')}
            >
              Win
            </button>
            {cascade1 ? (
              <button
                type="button"
                data-testid="reels-action-tumble"
                disabled={busy}
                onClick={() => void runAction('tumble')}
              >
                Tumble
              </button>
            ) : null}
            <span className="e8-reels-status" data-testid="reels-action-status">
              {status ?? ''}
            </span>
          </div>
          <div className="e8-reels-stage">
            <iframe
              key={canvasKey}
              ref={attachIframe}
              title="reels canvas"
              src={`${previewUrl}/editor.html?reels=`}
            />
          </div>
        </>
      )}
    </div>
  );
}
