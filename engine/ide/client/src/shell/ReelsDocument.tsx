import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Context } from 'cordis';
import type { GameCompositionRow } from '@energy8engine/contracts';
import { useGameComposition } from '../plugins/game-composition';
import { useSymbols } from '../plugins/symbols';
import { useWorkspace } from '../plugins/workspace';
import { SchemaForm } from '../schema-form/SchemaForm';
import type { FieldProps } from '../schema-form/fields';
import { BoardPainter, type BoardShape } from './BoardPainter';
import { SymbolChips } from './SymbolChips';
import { createCanvasRpc, type CanvasRpc } from './canvas-rpc';
import { CANVAS_SILENT, useCanvasSilence } from './useCanvasSilence';

/**
 * The Reels document: `reels1`'s config split into sections (its own
 * `grid`/`win`/`board` keys, one each) plus the whole config of the four
 * rows that plug INTO the reel system it hosts (`motion1`, `anticipation1`,
 * `cascade1`, `features1`) — replacing the single long form Composition
 * used to draw for `reels1` and the four separate rows the others sat in
 * (see this slice's brief). A row missing from the composition draws no
 * section at all; `reels.tsx` keeps this whole document unregistered while
 * `reels1` itself is missing, so `reels1`'s own three sections are always
 * there once this renders.
 *
 * The right column is the reel lab canvas (`@energy8engine/scene-edit`'s
 * reels mode, `editor.html?reels=`) — modelled on `SymbolsDocument`'s own
 * canvas half: the iframe is keyed on the project/reload/preview address
 * (never the sections' own edits, which travel as an rpc call, not a
 * remount), and `canvas-rpc` talks to it the same wire protocol. Its own
 * toolbar runs the lab's test actions (`spin`/`scatters`/`win`/`tumble`) —
 * synthetic boards played through the real board steps, no mechanic and no
 * server — and reports whichever answered `{ ok: false, reason }` in
 * `reels-action-status`.
 *
 * Every form's `rowId` is `reels-<row id>`, never the bare row id:
 * Composition stays mounted (hidden) while this document shows and draws
 * the same rows with the bare id — sharing it would collide every field id
 * and radio `name`, and a label here would toggle Composition's copy.
 *
 * Every section write goes through `ctx.gameComposition.update`, same as
 * Composition's own game rows; a successful one (`diagnostics: []`) also
 * re-sends the canvas that row's CURRENT config via the `rows` rpc (Tasks
 * 3–4) — read straight off `ctx.gameComposition.rows` at send time, not
 * the `rows` this render closed over, so a write that lands between commit
 * and this callback still ships the latest. On `ready` (a fresh load, or a
 * reload the host drove) the canvas gets every reel row instead — whatever
 * board it showed before that is stale.
 *
 * Task 6: two fields aren't drawn by `fields.tsx`'s stock editors —
 * `anticipation1`'s own `triggerSymbols` and `reels1`'s `win.frameShake.
 * onlyOnSymbols` are both `string[]` of symbol ids — `SchemaForm.
 * fieldOverrides` swaps in `SymbolChips` for them (the Win one keyed
 * `win.frameShake.onlyOnSymbols`, the value-root path — see `SchemaForm`'s
 * own doc comment — even though `root: 'win'` trims what actually draws).
 * `board` is `Schema.any()` — no stock editor exists for it at all — so
 * the Board section draws `BoardPainter` directly instead of a
 * `SchemaForm`, over `reels1.config.board` shaped by the grid's own
 * `cols`/`rowsPerReel ?? rows`. Both read the project's symbol ids off
 * `ctx.symbols` (`useSymbols`, same hook `SymbolsProperties` uses) —
 * `known()` first, then any of `doc()?.symbols` not already in it.
 */
const REEL_ROW_IDS = ['reels1', 'motion1', 'anticipation1', 'cascade1', 'features1'] as const;

function byId(rows: readonly GameCompositionRow[], id: string): GameCompositionRow | null {
  return rows.find((row) => row.id === id) ?? null;
}

/** The chips override's and the board painter's shared id list: `known`
 * (the reel board's registered ids) first, then any symbol the doc has
 * that `known` doesn't (a def not yet wired into `game/spec.json`) —
 * neither is dropped, so an id already in a saved value still resolves to
 * a name instead of reading as unknown for no reason. */
function symbolIds(
  known: readonly { id: string; name: string }[],
  doc: { symbols: readonly { id: string; name?: string }[] } | null,
): { id: string; name: string }[] {
  const seen = new Set(known.map((s) => s.id));
  const extra = (doc?.symbols ?? [])
    .filter((s) => !seen.has(s.id))
    .map((s) => ({ id: s.id, name: s.name ?? s.id }));
  return [...known, ...extra];
}

/** `reels1.config.grid` merged over the schema's own defaults — the shape
 * `BoardPainter` measures the saved `board` against. `rowsPerReel` (an
 * array, one entry per reel — Megaways/variable-height reels) overrides
 * the uniform `rows` entirely when its length is `cols` — reel-core's
 * `normalizeGrid` drops one of any other length, so it does not count
 * here either; otherwise every column gets the same `rows`. */
function boardShape(config: Record<string, unknown>): BoardShape {
  const grid = (config.grid ?? {}) as { cols?: number; rows?: number; rowsPerReel?: number[] };
  const cols = grid.cols ?? 5;
  const rows =
    grid.rowsPerReel?.length === cols ? grid.rowsPerReel : Array(cols).fill(grid.rows ?? 3);
  return { cols, rows };
}

/**
 * One section's chrome: a title, and — when its own slice of the row's
 * config carries any key — a `reset section` button (`fields.tsx`'s own
 * nested-group reset, just applied at the row's OWN top level, which that
 * component never draws a legend for since there's no group node there).
 * `root` scopes both the "any key" check and what reset drops: `undefined`
 * means the whole row (Motion, Anticipation, Cascade, Features — reset
 * writes `{}`), a key means just that part of `reels1`'s config (Grid,
 * Win — reset writes the config without that key, so a sibling section's
 * edits survive).
 */
function Section({
  name,
  title,
  row,
  root,
  write,
  children,
}: {
  name: string;
  title: string;
  row: GameCompositionRow;
  root?: string;
  write: (id: string, config: Record<string, unknown>) => void;
  children: ReactNode;
}) {
  const config = row.config;
  const scoped = root ? ((config[root] ?? {}) as Record<string, unknown>) : config;
  const hasAny = Object.keys(scoped).length > 0;
  const reset = () => {
    if (!root) return write(row.id, {});
    const rest = { ...config };
    delete rest[root];
    write(row.id, rest);
  };
  return (
    <section className="e8-reels-section" data-testid={`reels-section-${name}`}>
      <header className="e8-reels-section-header">
        <strong>{title}</strong>
        {hasAny ? (
          <button
            type="button"
            className="e8-field-reset"
            aria-label={`reset section ${name}`}
            onClick={reset}
          >
            reset section
          </button>
        ) : null}
      </header>
      {children}
    </section>
  );
}

export function ReelsDocument({ ctx }: { ctx: Context }) {
  const { rows, reloads } = useGameComposition(ctx);
  const list = rows ?? [];
  const reels1 = byId(list, 'reels1');
  const motion1 = byId(list, 'motion1');
  const anticipation1 = byId(list, 'anticipation1');
  const cascade1 = byId(list, 'cascade1');
  const features1 = byId(list, 'features1');

  const { known, doc } = useSymbols(ctx);
  const ids = symbolIds(known, doc);
  const chips = (props: FieldProps) => <SymbolChips {...props} known={ids} />;

  const workspace = useWorkspace(ctx);
  const previewUrl = workspace?.previewUrl ?? null;
  /** Same key `SymbolsDocument` uses: a reload, a project switch or a
   * changed preview address all remount the canvas — a section edit never
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

  /** The CURRENT config of the reel rows in `ids` — every one by default —
   * off the service directly (never the `list` this render closed over —
   * see the class doc above). A row the canvas answers `failed` for (its
   * `gameRows.update` threw) is named in the status line. */
  const sendRows = (ids: readonly string[] = REEL_ROW_IDS) => {
    const current = ctx.gameComposition.rows ?? [];
    const reelRows = ids
      .map((id) => byId(current, id))
      .filter((row): row is GameCompositionRow => row !== null)
      .map((row) => ({ id: row.id, config: row.config }));
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
    rpc.on('ready', () => sendRows());
    rpc.on('error', (payload) => canvasSays((payload as { message: string }).message));
    return () => {
      rpc.dispose();
      rpcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, rpc]);

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

  // Only the written row: every row `rows` re-applies rebuilds on the
  // canvas, and the others did not change.
  const write = (id: string, config: Record<string, unknown>) =>
    void ctx.gameComposition.update(id, config).then((answer) => {
      if (answer.diagnostics.length === 0) sendRows([id]);
    });

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

  // Fix round 1: this used to read `enabled !== false` — "on unless
  // explicitly turned off" — so a project whose `anticipation1` row is
  // PRESENT but carries no `enabled` key at all (the row's own schema
  // default, and exactly what `e8-base` composes it with — see
  // `reels-anticipation`'s schema doc: "composed but OFF") read as ON. A
  // real project's Scatters button was enabled from the moment the
  // document opened, before anyone touched the Anticipation section —
  // measured against `first-slot` in `reels.spec.ts`. `=== true` is the
  // honest mirror of the schema's own default: off unless a patch (or
  // this document) actually sets it.
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
      <div className="e8-reels-sections">
        {reels1 ? (
          <>
            <Section name="grid" title="Grid" row={reels1} root="grid" write={write}>
              <SchemaForm
                rowId={`reels-${reels1.id}`}
                schema={reels1.schema}
                value={reels1.config}
                onChange={(next) => write(reels1.id, next)}
                commit="blur"
                resettable
                root="grid"
              />
            </Section>
            <Section name="win" title="Win" row={reels1} root="win" write={write}>
              <SchemaForm
                rowId={`reels-${reels1.id}`}
                schema={reels1.schema}
                value={reels1.config}
                onChange={(next) => write(reels1.id, next)}
                commit="blur"
                resettable
                root="win"
                fieldOverrides={{ 'win.frameShake.onlyOnSymbols': chips }}
              />
            </Section>
            <section className="e8-reels-section" data-testid="reels-section-board">
              <header className="e8-reels-section-header">
                <strong>Board</strong>
              </header>
              <BoardPainter
                board={reels1.config.board}
                shape={boardShape(reels1.config)}
                known={ids}
                onChange={(board) => {
                  const next = { ...reels1.config } as Record<string, unknown>;
                  if (board === undefined) delete next.board;
                  else next.board = board;
                  write(reels1.id, next);
                }}
              />
            </section>
          </>
        ) : null}
        {motion1 ? (
          <Section name="motion" title="Motion" row={motion1} write={write}>
            <SchemaForm
              rowId={`reels-${motion1.id}`}
              schema={motion1.schema}
              value={motion1.config}
              onChange={(next) => write(motion1.id, next)}
              commit="blur"
              resettable
            />
          </Section>
        ) : null}
        {anticipation1 ? (
          <Section name="anticipation" title="Anticipation" row={anticipation1} write={write}>
            <SchemaForm
              rowId={`reels-${anticipation1.id}`}
              schema={anticipation1.schema}
              value={anticipation1.config}
              onChange={(next) => write(anticipation1.id, next)}
              commit="blur"
              resettable
              fieldOverrides={{ triggerSymbols: chips }}
            />
          </Section>
        ) : null}
        {cascade1 ? (
          <Section name="cascade" title="Cascade" row={cascade1} write={write}>
            <SchemaForm
              rowId={`reels-${cascade1.id}`}
              schema={cascade1.schema}
              value={cascade1.config}
              onChange={(next) => write(cascade1.id, next)}
              commit="blur"
              resettable
            />
          </Section>
        ) : null}
        {features1 ? (
          <Section name="features" title="Features" row={features1} write={write}>
            <SchemaForm
              rowId={`reels-${features1.id}`}
              schema={features1.schema}
              value={features1.config}
              onChange={(next) => write(features1.id, next)}
              commit="blur"
              resettable
            />
          </Section>
        ) : null}
      </div>
      <div className="e8-reels-canvas">
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
    </div>
  );
}
